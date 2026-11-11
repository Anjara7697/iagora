# MISSION 06 — AUDIT FRONTEND & UX/UI

Audite la console Next.js/React/TypeScript sur `dev`, en considérant les parcours réels des conseillers et administrateurs.

## Références
Lire impérativement `docs/frontend/heroui.md`, les spécifications/maquettes pertinentes et les conventions `AGENTS.md`. HeroUI v3 et le design system local sont les références, pas une invitation à remplacer les composants existants.

## Vérifications techniques
- App Router, layouts, pages, composants, hooks, providers et frontières serveur/client.
- Organisation par domaine, réutilisation, duplication, responsabilités et imports.
- Contrat API, typage, gestion des erreurs, auth, expirations et cohérence des données.
- États loading/empty/error/success, retry, optimistic updates et erreurs réseau.
- Formulaires, validation, feedback, confirmations et protection contre perte de saisie.
- Gestion des états globaux, URL, filtres, pagination et synchronisation.
- Accessibilité clavier/lecteur d'écran, focus, contraste, labels et axe si tests disponibles.
- Responsive, lisibilité, densité des données, performance et bundles.
- Sécurité frontend : exposition de secrets, rendu HTML, stockage client et autorisations supposées côté UI.

## Vérifications UX métier
Examiner notamment Aujourd'hui, À traiter, Conversations, Prospects et fiche prospect, Campagnes et détail campagne, rendez-vous, base de connaissances, intégrations, équipe, paramètres, simulateur.
Pour chaque parcours : compréhension, navigation, hiérarchie, actions principales, retours système, prévention d'erreur, cohérence des statuts et charge cognitive. Vérifier les vues selon rôle et affectation. Ne pas inventer d'écran absent.

## Règles
- Distinguer défaut observé dans le code d'observation visuelle réellement vérifiée.
- Si navigateur/screenshot indisponible, ne pas prétendre avoir testé visuellement.
- Ne modifier aucun composant, style ou route.
- Ne pas proposer de refonte globale sans bénéfice utilisateur prouvé.

## Livrable
Matrice page/parcours/état/risque, constats UX et techniques séparés, écarts aux conventions HeroUI, problèmes d'accessibilité/performance, points positifs et recommandations priorisées.
