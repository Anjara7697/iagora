# Intégration progressive de la maquette IAGORA

Référence : `Anjara7697/iagora-prototype`, commit
`92bac023d5d75286e1bf6d4d2540cb221c26b265` (export HTML autonome).
Implémentation : Next.js dans `frontend/`, depuis la branche `dev`.

## Premier lot : socle et prospects

- Couleurs, typographie Instrument Sans / IBM Plex Mono, navigation latérale,
  en-tête, cartes, badges et menu mobile repris de la maquette.
- Polices extraites des ressources embarquées du prototype et servies localement
  dans `public/fonts` ; aucune requête vers Google Fonts au démarrage.
- Connexion avec `POST /auth/login` et utilisateur courant avec `GET /auth/me`.
  Les rôles sont ceux de l'API : `ADMIN`, `ADVISOR`, `VIEWER`.
- Prospects : pipeline et table, recherche, filtres étape/campagne, pagination,
  états chargement/vide/erreur et nouvelle tentative.
- Un prospect multicampagne peut apparaître dans plusieurs colonnes ; chaque
  colonne compte les prospects de la page, pas l'ensemble de la base. Les étapes
  proches sont regroupées (qualification, échanges, rendez-vous…) ; le badge
  conserve l'étape précise. Le filtre campagne sélectionne les prospects, et
  les rattachements retournés par l'API restent tous visibles.
  Les scores affichés restent ceux des rattachements retournés par l'API.
- Fiche : identité, consentement, profil, étapes et scores, historique,
  conversation et décisions existantes. L'accès observateur et la désinscription
  désactivent le lancement de l'agent. L'API reste l'autorité pour les droits.

Les données fictives et commandes de démonstration du prototype ne sont pas
introduites dans les pages connectées. Les autres modules de la console existante
restent accessibles ; leur intégration détaillée suit dans les prochains lots.
La maquette n'est pas injectée comme HTML ni exécutée dans une iframe.

## Deuxième lot : conversations

- Page **Conversations** (boîte de réception) : liste filtrable (statut, responsable, canal, recherche
  nom/email) et conversation sélectionnée avec fiche de transfert, fil des messages et sources.
  Actions : répondre en tant que conseiller, prendre la main, rendre la main à l'agent, relancer l'agent,
  clôturer. Accès observateur et prospect désinscrit : lecture seule.
- Pastille du menu : nombre de conversations en attente d'un conseiller.
- API : `GET /conversations` renvoie le prospect (nom, étape, score) et accepte `status`, `channel`, `q`,
  `advisor_id`, `unassigned`.
- Écart assumé avec la maquette : le **mode assisté** (brouillons de l'agent à valider avant envoi, arrêt
  d'urgence) n'existe pas encore côté API ; il fait l'objet du lot suivant (page « À traiter »). Les messages
  sont pour l'instant enregistrés dans la conversation sans être expédiés (connecteurs à venir).

## Validation

Dans `frontend/` :

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Les tests navigateur utilisent une API simulée pour les erreurs, sessions,
multirattachement, filtres, pagination, accès observateur et mobile.
Ils démarrent le frontend sur le port 3100. Dans le cloud, Chromium système
peut être utilisé sans téléchargement :

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Pour un essai réel, démarrer les services et l'API selon le README, puis
`npm run dev` dans `frontend/`. Utiliser un compte créé avec la CLI backend.
`NEXT_PUBLIC_API_URL` doit désigner l'API accessible au navigateur ; en local
la valeur par défaut est `http://localhost:8000/api/v1`.
Le backend autorise par défaut l'origine `http://localhost:3000`.

## Prochains lots

1. Campagnes : écrans de consultation et gestion, rattachements et filtres plus détaillés.
2. Conversations et transferts : reprise des vues et actions de la maquette,
   avec validation des droits et du consentement côté serveur.
3. Base de connaissances et suivi des décisions de l'agent.
4. Pilotage, équipe et intégrations : comparer chaque action de la maquette
   au contrat API avant de rendre une commande disponible.

Restent hors de ce lot : modification des étapes par glisser-déposer,
assignation, import/export CSV, statistiques globales du pipeline et filtres
sur des dimensions que l'API ne fournit pas encore. Les groupes de navigation
correspondants seront ajoutés avec leurs pages fonctionnelles.
