# Revue qualité avant mise en production

Revue complète (interface, métier, backend, états, simulateur) faite sur `dev` après le connecteur
email. Chaque point est classé **B** (bloquant), **I** (important) ou **F** (finition) et rattaché
au lot qui le traite. Statuts : ✅ corrigé · ⏳ prévu · ❓ décision à prendre.

## Lots

| Lot | Branche | Contenu | Statut |
|---|---|---|---|
| 1 | `fix/review-lot1-backend-safety` | Garde-fous : STOP, messages, brouillons, envoi | ✅ |
| 2 | `fix/review-lot2-navigation` | Fiche campagne + prospects, titres, tableau de bord, états (chargement/vide/erreur/réessayer), confirmations | ✅ |
| 3 | `feat/review-lot3-demo-mode` | Mode démo : drapeau `is_demo`, badges, bandeau, filtre, purge, simulateur abouti | ✅ |
| 4 | `fix/review-lot456-consolidation` | Fiche prospect : désinscription/consentement, campagne liée, lien conversation, libellés | ✅ (interactions et conseiller affecté : voir « Reste ») |
| 5 | `fix/review-lot456-consolidation` | Index Mongo/PG, filtres prospects, statistiques sans fictifs, `latest_for_prospect` | ✅ partiel |
| 6 | `fix/review-lot456-consolidation` | Garde-fous de production, limitation de débit login, erreurs génériques, CORS, bail des tâches de fond | ✅ |

## Lot 1 — garde-fous backend (✅)

- **B** Un « STOP » du prospect n'était détecté que par l'agent : en mode manuel, conversation transférée
  ou réponse automatique désactivée, il restait sans effet. Désormais honoré à l'arrivée du message
  (API et email), sans passer par le modèle (`services/inbound.py`).
- **I** Un message reçu par l'API pouvait forcer `delivery`/`draft` et contourner la validation : les clés
  réservées sont retirées, l'auteur des messages conseiller est enregistré.
- **I** Brouillons : deux décisions simultanées (une seule gagne, l'autre reçoit 409) ; plus de
  validation dans une conversation clôturée ; la clôture annule les brouillons ; un nouveau message du
  prospect remplace le brouillon en attente (plus de double brouillon validable).
- **I** Envoi : jamais vers une adresse fictive (`@demo.example.com`, `example.*`) ni dans une
  conversation clôturée ; une erreur inattendue ne laisse plus le message bloqué en `sending` ;
  un email « poison » est mis de côté après 3 échecs.
- **I** Relance : une panne technique la remet à « programmée » au lieu de la perdre.
- **I** Lever une désinscription (`/consent`) est réservé à un administrateur.

## Lot 2 — navigation et états (⏳)

- **B** Fiche campagne : ajouter la liste paginée de ses prospects sous les sources ; entonnoir cliquable.
- **B** Titre d'en-tête et titre de page corrects sur toutes les routes (Connaissances, Intégrations,
  Nouvelle campagne, Campagne, Fiche prospect).
- **B** Tableau de bord : erreurs/réessayer, cartes cliquables, indicateurs utiles (brouillons, transferts,
  chauds, mode de l'agent).
- **B** Confirmation avant arrêt d'urgence, clôture, désactivation de campagne ; bouton « Rouvrir ».
- **B** « Modifier la campagne » sans effet si `/targets` échoue.
- **I** Composant de chargement avec « Réessayer » partout ; ne plus vider les listes à chaque filtre ;
  recherche avec délai ; filtres dans l'URL ; liens entre écrans (conversation ↔ fiche ↔ campagne).
- **I** Boutons non permis masqués selon le rôle (Intégrations, simulateur).

## Lot 3 — mode démo et simulateur (⏳)

- **B** Prospects fictifs mélangés aux vrais (listes, KPI, à traiter) : champ `is_demo`, badge « Fictif »,
  filtre, purge (hors production).
- **B** Bandeau permanent « Mode démo — aucun envoi réel » dans le simulateur ; simulateur absent en
  production.
- **B** Programme conservé en changeant de campagne dans le simulateur.
- **I** Observateur ne peut pas lancer de simulation ; session reprise au rechargement.

## Lots 4 à 6 (⏳)

- **4** Désinscription/consentement/interactions depuis la fiche prospect, conseiller affecté, campagne
  nommée et liée, libellés français, seuils de niveau venant du backend.
- **5** Index Mongo (`status`, `draft.status`, `delivery`, `agent_runs.conversation_id`) et PG
  (`follow_ups.prospect_id`…), `/todo` sans chargement massif, campagnes sans N+1, filtres prospects
  (niveau, consentement, source, démo), `/dashboard/summary`, conversations d'un prospect.
- **6** `ENVIRONMENT` explicite, `/docs` et `DEBUG` coupés en production, CORS strict, limitation de
  débit du login, erreurs génériques côté client, une seule instance pour les boucles de fond,
  `alembic upgrade head` + `alembic check` en CI.

## Décisions à prendre ❓

1. **Plusieurs instances** du backend en production ? (sinon : une seule, simple ; sinon : worker dédié).
2. **Premier contact** d'un prospect au consentement « inconnu » : autorisé aujourd'hui ; à valider avec
   le tuteur au regard du RGPD.
3. **Effacement RGPD** (suppression/anonymisation d'un prospect et de ses conversations) : à planifier.
4. Fusion de fiches en double : non prévue.

## Lots 4 à 6 — consolidation (✅)

- **Fiche prospect** : désinscription (confirmée) et consentement depuis l'écran (conseiller/admin ; lever
  une désinscription : admin), campagne nommée et liée, lien « Ouvrir dans Conversations », libellés
  français (statut, canal, champs du profil), niveau d'intérêt venant du backend.
- **Index** : Mongo (`conversations.status`, `draft.status`, `delivery`, `agent_runs.conversation_id`) et
  PostgreSQL (migration 0008 : `follow_ups.prospect_id`, `conversion_stage`, `interactions.conversation_ref`).
- **API** : filtres `level` et `consent_status` sur `/prospects` ; la conversation d'un prospect ne charge
  plus tout l'historique ; statistiques de campagne **sans** prospects fictifs.
- **Production** : `ENVIRONMENT=production` refuse `DEBUG`, `CORS_ORIGINS` contenant `*`/localhost et un
  secret JWT faible ; `/docs` et `/openapi.json` coupés ; CORS limité aux méthodes et en-têtes utiles ;
  erreur 500 générique (détail dans les journaux seulement) ; erreurs des fournisseurs LLM/embeddings
  non renvoyées au client ; `run-follow-ups --anytime` refusé en production.
- **Connexion** : 5 échecs en 15 minutes → 429 (par adresse et identifiant).
- **Plusieurs instances** : relances et boîte email protégées par un bail MongoDB (une seule instance
  exécute chaque boucle). Le verrou par conversation reste local à un processus : pour une charge
  importante, prévoir un worker dédié.

## Décisions prises

- Lever une désinscription : **administrateur uniquement**.
- Premier contact avec un consentement « inconnu » : **autorisé**, à valider avec le tuteur (RGPD).
- Plusieurs instances : non tranché ; le code est sûr dans les deux cas (bail), un worker dédié reste conseillé.

## Reste à traiter

- Liste des interactions et conseiller affecté (nom + affectation) sur la fiche prospect.
- Filtres de l'écran Prospects dans l'URL, recherche avec délai ; niveau/consentement dans les filtres.
- Ouverture d'une conversation / d'un élément « À traiter » absent de la page courante ; actions sur les
  éléments « lacune de la base » et « incident ».
- `/todo` : pagination côté base (aujourd'hui 500 conversations max) et champ `has_pending_draft`.
- Endpoint de synthèse du tableau de bord, relances et rendez-vous visibles dans l'interface.
- Effacement/anonymisation RGPD d'un prospect, fusion de doublons, jetons de service pour les webhooks.
- Comptes : insensibilité à la casse des identifiants, changement de mot de passe par l'utilisateur.
