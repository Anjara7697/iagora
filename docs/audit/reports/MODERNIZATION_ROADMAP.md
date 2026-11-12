# Feuille de route consolidée — audit IAGORA

- Date : 2026-11-11
- Branche : dev
- SHA : `3b35443`
- Auditeur : agent IA (mission `docs/audit/11_MODERNIZATION_ROADMAP.md`)
- Entrées :
  - les dix rapports de `docs/audit/reports/` (découverte, données, sécurité, métier, IA, architecture, backend,
    frontend, QA, DevOps) ;
  - `docs/limites-et-dette.md` ;
  - la PR de stabilisation des tests [Anjara7697/iagora#158](https://github.com/Anjara7697/iagora/pull/158),
    fusionnée.
- Statut : **proposition à valider par le responsable**. Aucune issue, branche ni tâche n'est créée par ce
  document.

## 1. Résumé exécutif

**État de confiance global : bon pour une démonstration, insuffisant pour un pilote réel sans un court lot de
corrections.**

- **50 constats**, aucun P0 :
  - 1 P1 au départ (SEC-001) ;
  - 18 P2 et 31 P3.
- **Invariants tenus et testés** : consentement et STOP, contrôle humain en mode assisté, données fictives
  isolées, effacement sur les deux bases, idempotence des entrées.
- **Socle** : architecture saine, 663 tests backend (couverture 90,6 %), CI stabilisée par #158.
- **Ce qui bloque un pilote réel** relève surtout de :
  - **décisions** (sous-traitance du modèle, conservation, base légale Meta, documents officiels) ;
  - **exploitation** (sauvegardes hors serveur, alertes) ;
  - quatre **défauts ciblés** et peu coûteux :
    - téléphone et opposition (DATA-001) ;
    - créneau passé (BIZ-001) ;
    - lead Meta perdu (API-001) ;
    - envoi bloqué non signalé (DATA-004).

Re-priorisation pour un pilote réel : 11 constats passent en **P1 pilote** (§3), parce qu'ils touchent un vrai
prospect ou une vraie donnée dès le premier jour. Ils restent à leur priorité d'origine tant que l'usage reste
une démonstration.

## 2. Risques bloquants pour un pilote réel avec DATUM

| # | Risque | Constats | Nature |
|---|---|---|---|
| 1 | Données de prospects envoyées à Gemini sans accord de sous-traitance | SEC-001 | **Décision** (DPO) |
| 2 | Agent appuyé sur une base de connaissances fictive | AI-002 ; dette « documents officiels manquants » | Décision + contenu DATUM |
| 3 | Personne opposée recontactée si son numéro arrive sous un autre format | DATA-001 | Défaut |
| 4 | Perte de données en cas de panne du serveur (sauvegardes sur la même machine) | DATA-002 | Exploitation |
| 5 | Panne non détectée (leads, emails non traités) | OPS-002 | Exploitation |
| 6 | Lead Meta payé et jamais traité | API-001 | Défaut (si Meta est dans le pilote) |
| 7 | Réponse validée jamais envoyée, sans alerte | DATA-004 | Défaut (si l'email est dans le pilote) |
| 8 | Rendez-vous confirmé dans le passé ou chez un conseiller parti | BIZ-001, BIZ-002 | Défaut (si l'agenda est dans le pilote) |
| 9 | Affirmation commerciale inventée envoyée sans relecture | AI-001, SEC-010 | **Bloquant seulement en mode automatique** : pilote en mode assisté recommandé |
| 10 | Console exposée avec une version de Next.js vulnérable et sans en-têtes de sécurité | SEC-002, SEC-003 | Défaut |
| 11 | Durées de conservation non fixées | DATA-003 ; dette P1 | **Décision** (DPO) |

## 3. Tableau consolidé

Priorités : celle du rapport d'origine, puis celle retenue pour un **pilote réel** quand elle diffère (justifiée
au §2). Complexité S / M / L / XL. Le risque de régression (Rég.) est estimé d'après les zones touchées.

| ID | Domaine | Prio. origine → pilote | Preuve (rapport) | Dépend de | Lot | Cx | Rég. | Validation |
|---|---|---|---|---|---|---|---|---|
| SEC-001 | Sécurité / RGPD | P1 | SECURITY §5 | décision DPO | D | — | — | DPA signé ou fournisseur changé |
| SEC-002 | Sécurité | P2 → P1 | SECURITY §5 | — | 1 | S | faible | `npm audit` sans haute/critique ; e2e vert |
| SEC-003 | Sécurité | P2 → P1 | SECURITY §5 | — | 1 | S | faible | en-têtes présents (`curl -I`) |
| API-003 | Backend | P3 | BACKEND §5 | — | 1 | S | faible | requête > 3 Mo refusée (413) |
| OPS-003 | DevOps | P3 | DEVOPS §5 | — | 1 | S | nulle | condition `event == 'push'` |
| DATA-001 | Données / RGPD | P2 → P1 | DATABASE §5 | décision « pays par défaut » | 2 | M | **moyen** (migration de données) | tests de normalisation et d'opposition ; rapport de collisions |
| BIZ-004 | Métier | P3 | BUSINESS §5 | — | 2 | S | faible | test : signalement « À faire » |
| API-004 | Backend | ~~P3~~ retiré | BACKEND §5 | — | — | — | — | constat erroné : levée déjà réservée à l'administrateur |
| BIZ-001 | Métier | P2 → P1* | BUSINESS §5 | — | 3 | S | faible | test : créneau passé → nouvelle proposition |
| BIZ-002 | Métier | P2 → P1* | BUSINESS §5 | décision « conseiller qui part » | 3 | S | faible | test : conseiller inactif |
| AI-006 | Intégrations | P3 | AI §5 | — | 3 | S | faible | tests avec agenda simulé |
| BIZ-003 | Métier | P3 | BUSINESS §5 | décision « fuseau » | 3 | S | moyen (messages) | tests de format |
| API-001 | Backend | P2 → P1* | BACKEND §5 | — | 4 | S | faible | tests `queued` et `failed` |
| DATA-004 | Données | P3 → P1* | DATABASE §5 ; dette P1 | — | 4 | S | faible | test : `sending` ancien → incident |
| BIZ-005 | Métier | P3 | BUSINESS §5 | — | 4 | S | faible | test : plafond d'essais |
| QA-002 | QA | P2 | QA §5 | lot 4 | 4 | S | nulle | tests ajoutés avec chaque correctif |
| AI-001 | IA | P2 (P1 en automatique) | AI §5 | liste de termes DATUM | 5 | M | **moyen** (plus de transferts) | `eval-agent` + `test_policy` étendus |
| SEC-010 | Sécurité | P3 | SECURITY §5 | AI-001 | 5 | — | — | mode automatique conditionné à AI-001 |
| AI-003 | IA | P3 | AI §5 | — | 5 | S | faible | cas d'injection dans `eval-agent` |
| AI-004 | IA | P3 | AI §5 | — | 5 | S | faible | trace : modèle réel, hash des consignes, jetons |
| DATA-002 | Exploitation | P2 → P1 | DATABASE §5 | choix du stockage | 6 | M | nulle (hors app) | restauration testée sur base jetable |
| OPS-002 | Exploitation | P2 → P1 | DEVOPS §5 | choix de l'outil | 6 | S | nulle | alerte reçue sur arrêt simulé |
| OPS-001 | DevOps | P2 | DEVOPS §5 | — | 6 | S | faible | image construite avec versions figées |
| OPS-005 | DevOps | P3 | DEVOPS §5 | — | 6 | S | nulle | déploiement vérifie aussi le frontend |
| ARCH-004 | Architecture | P3 | ARCHITECTURE §5 | — | 6 | S | faible | démarrage refusé sans `ENVIRONMENT` |
| API-002 | Backend | P3 | BACKEND §5 | — | 6 | S | faible | `X-Request-ID` dans réponse et journaux |
| DATA-003 | Données / RGPD | P2 → P1 | DATABASE §5 ; dette P1 | décision DPO | 7 | S | faible | index TTL, purge planifiée |
| AI-002 | IA | P2 → P1 | AI §5 | décision « environnement du pilote » | 7 | S | moyen (RAG) | test : prospect réel sans document fictif |
| DATA-007 | Données | P3 | DATABASE §5 | — | 7 | S | nulle | test par indicateur |
| ARCH-003 | Architecture | P2 | ARCHITECTURE §5 | — | 8 | M | faible | types générés à jour en CI |
| QA-001 | QA | P2 | QA §5 | ARCH-003 | 8 | M | nulle | parcours e2e contre le vrai backend |
| DATA-006 | Données | P3 | DATABASE §5 | — | 8 | S | nulle | `downgrade base` en CI |
| QA-004 | QA | P3 | QA §5 | — | 8 | S | nulle | projet mobile Playwright |
| QA-003 | QA | P3 | QA §5 | — | 8 | S | nulle | si la logique pure grossit |
| FE-001 | Frontend | P3 | FRONTEND §5 (revu) | — | 9 | S | faible | e2e : sortie par le menu confirmée |
| FE-002 | Frontend | P3 | FRONTEND §6 | — | 9 | M | moyen (écrans admin) | règles 1–30, axe, e2e |
| FE-003 | Frontend | P3 | FRONTEND §5 | — | 9 | S | faible | thème clair / sombre |
| DATA-005 | Données | P3 | DATABASE §5 | — | 9 | S | faible | indicateur « liste tronquée » |
| SEC-004 | Sécurité | P2 | SECURITY §5 | — | 10 | M | **moyen** (auth) | cookie `HttpOnly`, e2e connexion |
| SEC-005 | Sécurité | P2 | SECURITY §5 | — | 10 | S | faible | limite par identifiant et par IP |
| SEC-009 | Sécurité | P3 | SECURITY §5 | SEC-004 | 10 | S | faible | jeton refusé après déconnexion |
| SEC-008 | Sécurité | P3 | SECURITY §5 | — | 10 | S | faible | état OAuth lié à la session |
| SEC-007 | Sécurité | P3 | SECURITY §5 | — | 10 | S | **moyen** (rechiffrement) | clé dédiée obligatoire, migration des secrets |
| SEC-006 | Sécurité | P2 | SECURITY §5 | **décision** | F | L | élevé | — |
| ARCH-001 | Architecture | P3 | ARCHITECTURE §5 | — | 11 | S | faible | imports sans cycle |
| ARCH-002 | Architecture | P3 | ARCHITECTURE §5 | — | 11 | S | faible | verrous libérés |
| DATA-008 | Docs | P3 | DATABASE §5 | — | 11 | S | nulle | relecture |
| DATA-009 | Hygiène | P3 | DATABASE §5 | — | 11 | S | faible | index `service_tokens.hash` |
| OPS-004 | DevOps | P3 | DEVOPS §5 | décision Dependabot | 11 | S | nulle | PR automatiques |
| AI-005 | IA | P3 | AI §5 | décision fournisseur | F | M | moyen | — |

\* P1 seulement si la fonction (agenda, Meta, email) fait partie du pilote.

**Liens de cause commune** (preuves gardées dans chaque rapport) :
- DATA-001 et BIZ-004 : la qualité de la liste d'opposition ;
- API-001, DATA-004 et BIZ-005 : des états intermédiaires sans reprise ni alerte, couverts par QA-002 ;
- ARCH-003 et QA-001 : un contrat d'API sans vérification ;
- AI-001 et SEC-010 : le mode automatique dépend du contrôle anti-invention ;
- AI-002, ARCH-004 et DATA-007 : la séparation démo / réel repose sur des conventions ;
- SEC-004 et SEC-009 : le modèle de session.

**Contradiction arbitrée** : `limites-et-dette.md` classe « message resté `sending` » en P1, le rapport Données en
P3. Retenu : P1 pour un pilote qui envoie de vrais emails (silence vis-à-vis d'un vrai prospect), P3 sinon. Le
correctif ne renvoie rien automatiquement : il signale le cas, ce qui garde le choix « ne jamais envoyer deux
fois ».

## 4. Lots ordonnés

Chaque lot est une PR vers `dev`, avec les vérifications d'`AGENTS.md` (ruff, format, mypy, pytest ; lint,
typecheck, build, e2e) et la suite `eval-agent` quand l'agent est touché.

**Lot 0 — Stabilité de la CI (fait, #158 fusionnée).**
- Contenu : tests e2e intermittents ; délai des animations en mode « animations réduites ».
- Acceptation restante : CI verte trois fois de suite sur `dev`.

**Lot 1 — Hygiène de l'exposition (S, P1 pilote).**
- Objectif : console exposée sans vulnérabilité connue.
- Périmètre : Next.js 15.5.29 et PostCSS (SEC-002) ; en-têtes de sécurité et limite de taille dans le bloc Caddy
  documenté (SEC-003, API-003) ; condition du déploiement (OPS-003).
- Exclusions : CSP stricte, qui demande un inventaire des scripts et viendra plus tard.
- Acceptation : `npm audit --omit=dev` sans vulnérabilité haute ou critique ; e2e complet vert ; en-têtes vérifiés
  sur le serveur par le responsable.
- Non-régression : suite e2e complète ; connexion, export CSV, OAuth Google et Zoom (simulés).

**Lot 2 — Opposition et doublons (M, P1 pilote).** Après décision du pays par défaut.
- Périmètre :
  - normalisation E.164 à toutes les entrées ;
  - migration de données avec rapport de collisions, sans fusion automatique ;
  - vérification d'opposition sur l'ancien et le nouveau format ;
  - signalement des oppositions par mot-clé ambiguës (BIZ-004) ;
  - réactivation du consentement : déjà réservée aux administrateurs (API-004 retiré, constat erroné).
- Exclusions : fusion des fiches en double.
- Acceptation : `06…`, `+336…` et `0033 6…` donnent la même fiche ; une personne opposée revenue sous un autre
  format reste opposée ; la migration se rejoue sans effet.
- Non-régression : `test_lot1_safety`, `test_prospects_api`, `test_lead_sources`, `test_erasure`,
  `test_meta_leads` ; migration montée puis descente sur base de test.

**Lot 3 — Rendez-vous (S, P1 si l'agenda est dans le pilote).**
- Périmètre :
  - créneaux passés ignorés (BIZ-001) ;
  - conseiller inactif traité comme non affecté (BIZ-002) ;
  - nouvel essai sur 429/5xx et suppression de la réunion Zoom orpheline (AI-006) ;
  - fuseau horaire après décision (BIZ-003).
- Acceptation : un créneau passé déclenche une nouvelle proposition ; aucun rendez-vous chez un compte désactivé.
- Non-régression : `test_calendar`, `test_appointments`, `test_agent_workflow`, `test_policy`.

**Lot 4 — Reprise après incident (S, P1 selon les fonctions du pilote).**
- Périmètre :
  - reprise des leads Meta `queued` anciens et action « rejouer les échecs » (API-001) ;
  - incident « À faire » pour un `sending` ancien (DATA-004) ;
  - plafond d'essais des relances et de la file de l'agent (BIZ-005) ;
  - un test par cas (QA-002).
- Exclusions : renvoi automatique d'un email `sending`.
- Acceptation : chaque cas est visible dans la console et ne peut ni se perdre ni boucler.
- Non-régression : `test_meta_leads`, `test_email` (envoi unique), `test_auto_agent`.

**Lot 5 — Garde-fou NF-10 (M, P1 seulement avant tout mode automatique).**
- Périmètre :
  - détecteur étendu (nombres en lettres, heures `14h30`, `bac+N`, termes d'admission et de financement) ;
  - messages du prospect ne servant de source que pour ce qu'il dit de lui-même (AI-001) ;
  - règle anti-injection (AI-003) ;
  - traces complètes (AI-004).
- Acceptation : les six phrases du rapport IA sont détectées ; `eval-agent` ne régresse ni en transferts ni en
  intentions.
- Non-régression : `test_policy`, `test_prompts`, `test_agent_workflow`, `eval-agent` hors ligne ; `--live` par le
  responsable.

**Lot 6 — Exploitation (M, P1 pilote).**
- Périmètre :
  - copie chiffrée des sauvegardes hors serveur et restauration testée (DATA-002) ;
  - sonde externe et alerte d'échec de sauvegarde (OPS-002) ;
  - versions Python figées (OPS-001) ;
  - contrôle du frontend après déploiement (OPS-005) ;
  - `ENVIRONMENT` obligatoire (ARCH-004) ;
  - `X-Request-ID` (API-002) ;
  - `.env.example` complet (découverte §3).
- Acceptation : restauration réussie sur une base jetable, documentée ; alerte reçue lors d'un arrêt simulé ;
  build reproductible.
- Non-régression : CI complète ; déploiement sur `dev` suivi par le responsable.

**Lot 7 — Conservation et séparation démo / réel (S, P1 pilote, après décisions DPO).**
- Périmètre :
  - TTL `agent_events`, durée des traces, purge planifiée (DATA-003) ;
  - documents fictifs réservés aux prospects fictifs (AI-002) ;
  - test d'exclusion des fictifs par indicateur (DATA-007).
- Acceptation : un prospect réel n'obtient jamais d'extrait fictif ; la purge s'exécute selon la durée décidée.
- Non-régression : `test_knowledge`, `test_demo`, `test_dashboard`, `test_analytics`, `test_erasure`.

**Lot 8 — Contrat et couverture (M, P2).**
- Périmètre : types générés depuis OpenAPI (ARCH-003) ; parcours e2e contre le vrai backend (QA-001) ; descente
  des migrations en CI (DATA-006) ; projet mobile (QA-004).
- Acceptation : renommer un champ casse la CI.

**Lot 9 — Confort des conseillers (S/M, P3).**
- Périmètre : protection des saisies étendue au menu latéral et à Paramètres (FE-001, constat revu : la
  protection existait déjà sur les autres parcours) ; écrans d'administration revus avec les règles 1 à 30 (FE-002) ;
  jetons de couleur (FE-003) ; liste « À faire » tronquée signalée (DATA-005).

**Lot 10 — Sessions et accès (M, P2, avant d'ouvrir à plus d'utilisateurs).**
- Périmètre : cookie `HttpOnly` (SEC-004), limite de connexion par identifiant (SEC-005), révocation (SEC-009),
  état OAuth (SEC-008), clé de chiffrement dédiée (SEC-007).
- Risque : le plus élevé des lots, car il touche la connexion. Le faire hors période de soutenance.

**Lot 11 — Dette technique (S, P3).**
- Périmètre : ARCH-001, ARCH-002, DATA-008, DATA-009, OPS-004 ; mise à jour des documents en retard (découverte
  §10 : `architecture.md`, `passation.md`, `limites-et-dette.md`, Notion).

**Ordre conseillé avant la soutenance du 8 décembre** :
1. lot 1 (le lot 0 est fait) ;
2. lots 2, 4 et 3 ;
3. lot 6 ;
4. lot 7 dès les décisions DPO prises.

Les lots 5 et 8 à 11 peuvent suivre sans bloquer une démonstration en mode assisté.

## 5. Décisions humaines requises

> **12 novembre 2026** : toutes ces décisions ont été prises par le responsable du projet, voir
> [decisions.md](../../decisions.md) D-13 à D-28. Celles qui relèvent du DPO y sont marquées comme propositions à
> faire valider avant un pilote réel. Restent hors décision : les documents officiels (fournis par DATUM) et la
> double authentification (reportée).

| Décision | Qui | Débloque |
|---|---|---|
| Accord de sous-traitance du modèle (Gemini payant, autre fournisseur) | DPO, responsable | SEC-001, AI-005 |
| Durées de conservation (prospects, traces, sauvegardes), fréquence de purge | DPO | DATA-003, DATA-002 |
| Base légale des leads Meta | DPO, DATUM | Meta dans le pilote |
| Recontact d'une personne effacée qui réécrit (fiche recréée en opposition) | DPO | confirmation de l'existant |
| Visibilité des prospects entre conseillers | DATUM, responsable | SEC-006 |
| Justificatif exigé pour rétablir un consentement (déjà réservé à l'administrateur) | DPO, DATUM | traçabilité |
| Pays par défaut des numéros | DATUM | DATA-001 |
| Fuseau horaire des prospects | DATUM | BIZ-003 |
| Conseiller qui quitte l'équipe : réaffectation | DATUM | BIZ-002 |
| Seuils (score 50 / 24, confiance 0,5, plafond de relances) | DATUM | `policy.py` |
| Termes d'admission et de financement à sourcer | DATUM | AI-001 |
| Mode automatique autorisé pendant le pilote ? (recommandation : non) | Responsable | SEC-010 |
| Documents officiels pour la base de connaissances | DATUM | RAG réel |
| Environnement du pilote (`dev` ou production séparée) | Responsable | AI-002, OPS |
| Stockage externe des sauvegardes, outil d'alerte et destinataires | Responsable technique | DATA-002, OPS-002 |
| Dependabot sur le dépôt ; génération des types frontend | Responsable technique | OPS-004, ARCH-003 |
| Double authentification des administrateurs | Responsable, DPO | évolution |

## 6. Éléments à préserver (ne pas modifier sans test ni décision)

- `graph/policy.py` :
  - ordre des règles de décision ;
  - seuils ;
  - détection du STOP ;
  - `ungrounded_claims` (on étend, on ne relâche jamais).
- Relecture du consentement et du mode juste avant l'envoi (`services/email_sync.py`, `conversations.py:258`).
- Réservation atomique `not_sent` → `sending`, et refus de renvoyer un email incertain.
- Idempotence des entrées :
  - clé (`channel_id`, `external_id`) ;
  - `_id` des leads Meta ;
  - jetons de service ;
  - `event_id` des traces.
- Effacement rejouable sur les deux bases et liste d'opposition salée.
- Ports et adaptateurs : aucun SDK dans `app/graph` ni `app/agents`.
- Mode assisté par défaut et mode automatique réservé à l'administrateur.
- Outils de recette refusés en production ; données fictives en `@demo.example.com`.
- `alembic check` et tests sur moteurs réels en CI.
- **À ne pas modifier avant une décision ou un test réel** :
  - les seuils de `policy.py` ;
  - le format des numéros déjà stockés (avant le rapport de collisions) ;
  - la purge (avant les durées DPO) ;
  - le mode automatique (avant le lot 5) ;
  - les connecteurs Google, Zoom et Meta (avant une recette sur vrais comptes).

## 7. Évolutions futures (hors périmètre correctif)

- Cloisonnement des données par campagne ou conseiller (SEC-006), après la décision de visibilité.
- Second fournisseur de modèle (AI-005).
- Worker séparé pour les tâches de fond (D-08), si la charge le montre.
- Index vectoriel HNSW, si la base dépasse quelques dizaines de milliers d'extraits.
- LinkedIn (aucun accès API).
- Fusion assistée des doublons.
- Réponse groupée aux emails rapprochés.
- Rappels avant rendez-vous ; invitation du prospect à l'événement Google.
- Double authentification.
- CSP stricte.
- Journaux structurés, quand un outil les exploitera.

## 8. Incertitudes restantes

- Rien n'a été vérifié sur le serveur `dev` :
  - configuration Caddy réelle ;
  - planification des sauvegardes ;
  - variables d'environnement ;
  - présence de vrais prospects.
- Aucune mesure de qualité avec le vrai modèle (`eval-agent --live` à lancer par le responsable).
- Aucune recette réelle de Google, Zoom ou Meta.
- Volumes, latence et coût réels inconnus (pas de trace des jetons).
- Rendu visuel non vérifié dans l'audit frontend.
- Échéance du pilote non fixée (question 4 de la découverte) : elle peut déplacer des constats entre P1 et P2.
