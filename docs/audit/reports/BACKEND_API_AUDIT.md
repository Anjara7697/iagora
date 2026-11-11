# Rapport d'audit — Backend et API

- Date : 2026-11-11
- Branche : dev
- SHA audité : `0d7eded`
- Auditeur : agent IA (mission `docs/audit/03_BACKEND_API_AUDIT.md`)
- Périmètre : routes `api/v1`, dépendances et rôles, services, transactions, tâches de fond, entrées
  (REST, webhook Meta, CSV, email), erreurs, journaux, contrats consommés par le frontend.
- Exclusions : aucun appel à une API réelle, aucun message envoyé ; les autorisations détaillées sont dans
  `SECURITY_AUDIT.md`, les règles métier dans `BUSINESS_LOGIC_AUDIT.md`.

## 1. Résumé exécutif

Le backend est homogène :
- des routes fines qui délèguent aux services ;
- des schémas Pydantic bornés (longueurs, pagination de 1 à 200) ;
- des erreurs typées sans fuite d'information interne ;
- des délais d'expiration sur tous les connecteurs ;
- l'idempotence sur toutes les entrées (clé externe des interactions, `leadgen_id` Meta, jetons de service).

Un défaut de reprise ressort : **un lead Meta peut être perdu** s'il reste en `queued` après un redémarrage, et
un lead en échec n'a aucun moyen d'être rejoué une fois que Meta a cessé de le renvoyer (AUDIT-API-001). Le reste
concerne l'observabilité (pas d'identifiant de corrélation des requêtes) et l'absence de limite de taille des requêtes
dans la configuration Caddy documentée.

## 2. Périmètre et méthode

Lecture des routes et de leurs dépendances (`api/v1/*.py`, `api/dependencies.py`, `api/errors.py`), des services
des parcours prioritaires, des adaptateurs (délais d'expiration, threads), de `frontend/src/lib/api.ts`.
Aucun test exécuté ni service démarré.

## 3. Parcours prioritaires : routes → services → garanties

| Parcours | Entrée | Service | Garanties observées | Tests |
|---|---|---|---|---|
| Création / import de prospect | `POST /prospects`, `POST /prospects/import` (CSV, voir `api/v1/imports.py`), `POST /leads` (jeton) | `prospects.ingest_prospect`, `prospect_import` | déduplication en base, `IntegrityError` rattrapée, CSV ≤ 2 Mo et 5 000 lignes, liste d'opposition | `test_prospects_api`, `test_lead_sources`, `test_intake_context` |
| Rattachement à une campagne, affectation | `campaign_prospects`, `campaigns` | `prospects`, `campaign_ownership` | verrou de campagne, unicité (source, prospect) | `test_campaign_ownership*`, `test_campaigns_api` |
| Interaction entrante | boucle email, `POST /leads`, webhook Meta | `email_sync`, `inbound`, `meta_leads` | unicité (`channel_id`, `external_id`), STOP détecté avant l'agent | `test_email`, `test_meta_leads` |
| Brouillon, validation, envoi | `todo`, `conversations` | `drafts`, `email_sync` | réservation atomique `not_sent` → `sending`, opposition revérifiée à l'envoi | `test_assisted_mode`, `test_review_safeguards`, `test_email` |
| Opposition / STOP | message entrant, `POST /prospects/{id}/opt-out` | `inbound`, `prospects` | relances et brouillons annulés ; envoi refusé | `test_lot1_safety` |
| Relance | boucle `follow_up_loop` | `agents/auto` | réservation atomique, fenêtre, plafond | `test_auto_agent` |
| Rendez-vous | agent, `appointments` | `agenda`, `integrations/calendar` | revérification de l'agenda ; voir BIZ-001 | `test_calendar`, `test_appointments` |
| Effacement RGPD | `POST /prospects/{id}/erase`, commande `purge-inactive` | `erasure` | rejouable, deux bases | `test_erasure` |
| Utilisateurs | `users` | `users` | pas d'auto-désactivation, mot de passe temporaire | `test_team`, `test_auth` |

## 4. Points positifs à préserver

- **Erreurs** : `ServiceError` → 404 / 409 / 422 avec message métier ; toute autre exception → 500 générique,
  détail seulement dans les journaux (`api/errors.py:18-30`). Le frontend traduit les 422 de FastAPI en « champ
  invalide » (`frontend/src/lib/api.ts:64-87`).
- **Entrées bornées** :
  - pagination `limit` de 1 à 200 sur toutes les listes ;
  - longueurs maximales dans les schémas (ex. document de connaissances ≤ 200 000 caractères) ;
  - CSV lu au plus jusqu'à `MAX_BYTES + 1`.
- **Connecteurs** : délais de 5 à 30 s sur chaque client HTTP, IMAP et SMTP ; appels bloquants dans des threads.
- **Codes HTTP** : 201 pour les créations, 204 pour les suppressions, 409 pour les conflits métier (source
  encore utilisée, envoi déjà fait).
- **Tâches de fond reprises** : la réponse de l'agent passe par la file `agent_events` (MongoDB), relue par
  `reply_queue_loop` ; une relance en erreur est libérée puis retentée.

## 5. Registre des constats

### AUDIT-API-001 — Lead Meta perdu après un redémarrage, ou en échec sans reprise possible
- Catégorie : reprise après incident
- Criticité : P2
- Confiance : Confirmé (lecture du code) ; aucun test du cas
- Preuve :
  - `backend/app/api/v1/meta.py:178-182` : réservation puis traitement en `BackgroundTasks`, en mémoire ;
  - `backend/app/services/meta_leads.py:23-46` : seul un événement `failed` est repris, et seulement si Meta le
    renvoie ;
  - aucune autre lecture des événements `queued` ou `failed` dans le code ;
  - `docs/sources-leads.md:38-40` : la reprise manuelle est mentionnée mais n'est pas outillée.
- Scénario 1 : le conteneur redémarre (déploiement, mémoire) entre la réponse 200 au webhook et la fin du
  traitement. Le lead reste `queued` ; si Meta le renvoie, il est compté comme doublon. Il ne sera jamais traité.
- Scénario 2 : un formulaire n'est pas encore associé à une campagne. Le lead passe en `failed` ; une fois le
  formulaire associé, rien ne permet de le relancer.
- Impact : prospect payé par la publicité et jamais contacté. L'écran Intégrations affiche bien le nombre
  d'échecs, mais pas les leads restés en `queued`.
- Recommandation :
  - au démarrage et périodiquement, reprendre les `queued` de plus de quelques minutes ;
  - ajouter une action d'administration « rejouer les leads en échec » (bouton ou commande), plafonnée et tracée ;
  - compter les `queued` anciens dans les statistiques ;
  - ajouter un test pour chaque scénario.
- Complexité : S

### AUDIT-API-002 — Pas d'identifiant de corrélation des requêtes
- Catégorie : observabilité
- Criticité : P3
- Confiance : Confirmé
- Preuve : aucun `request_id` ni `X-Request-ID` dans `backend/app` ; format texte simple
  (`backend/app/core/logging.py:7-9`).
- Impact : relier une erreur 500 vue par un conseiller à sa trace dans les journaux demande de croiser les heures.
- Recommandation : un middleware qui crée ou reprend `X-Request-ID`, l'ajoute à chaque ligne de journal et le
  renvoie dans la réponse. Le frontend peut l'afficher dans le message d'erreur 500. Pas de journaux JSON tant
  qu'aucun outil ne les exploite.
- Complexité : S

### AUDIT-API-003 — Taille maximale des requêtes non bornée par l'application
- Catégorie : robustesse
- Criticité : P3
- Confiance : Probable (configuration réelle du serveur non consultée)
- Preuve : aucune limite globale de corps dans `backend/app/main.py` ; les limites Pydantic s'appliquent après la
  lecture complète du corps ; le bloc Caddy documenté (`docs/deploiement.md` §4) ne fixe aucune limite.
- Scénario : une requête de plusieurs centaines de Mo sur la route des leads ou `/webhooks/meta` (routes sans connexion)
  est lue en mémoire avant d'être refusée, alors que l'API est limitée à 768 Mo.
- Recommandation : `request_body { max_size 3MB }` dans le bloc Caddy documenté, puis sur le serveur.
- Complexité : S

### AUDIT-API-004 — Rétablissement du consentement ouvert à tout rôle d'écriture
- Catégorie : autorisation métier
- Criticité : P3
- Confiance : Confirmé
- Preuve : `backend/app/api/v1/prospects.py:269-270` (`POST /prospects/{id}/consent`, `CAN_WRITE`).
- Observation : un conseiller peut annuler l'opposition d'un prospect sans motif ni preuve. Le changement est
  tracé dans `consent_events`.
- Recommandation : selon la décision BIZ n° 3, exiger un motif ou réserver l'action aux administrateurs.
- Complexité : S

Constats liés, décrits ailleurs :
- envoi bloqué en `sending` (AUDIT-DATA-004) ;
- liste « À faire » tronquée à 500 (AUDIT-DATA-005) ;
- relance retentée sans limite (AUDIT-BIZ-005) ;
- limitation des connexions en mémoire (SEC-005) ;
- absence de cloisonnement par campagne (SEC-006) ;
- contrat frontend recopié à la main (AUDIT-ARCH-003).

## 6. Tests manquants repérés

- Lead Meta resté `queued` après un redémarrage ; reprise d'un lead `failed` (API-001).
- Choix d'un créneau déjà passé (BIZ-001).
- Contrat frontend / API sur la vraie API (ARCH-003).

## 7. Questions et décisions humaines

1. Qui peut rétablir le consentement d'un prospect opposé, et avec quel justificatif ?
2. Valeur de la limite de taille des requêtes sur le proxy du serveur.

## 8. Recommandations priorisées

1. AUDIT-API-001 : reprise des leads Meta, avant la recette réelle de Meta.
2. AUDIT-API-003 : limite de taille dans Caddy.
3. AUDIT-API-002 et 004 : avec la prochaine évolution du backend.

## 9. Fichiers examinés

`backend/app/api/**`, `backend/app/services/{prospects,prospect_import,meta_leads,email_sync,inbound,drafts,
erasure,users,campaign_ownership,lease}.py`, `backend/app/agents/{runtime,auto}.py`,
`backend/app/integrations/**` (délais), `backend/app/core/logging.py`, `frontend/src/lib/api.ts`,
`docs/sources-leads.md`. Aucun test exécuté (audit en lecture seule).
