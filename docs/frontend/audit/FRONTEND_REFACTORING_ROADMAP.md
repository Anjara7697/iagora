# Feuille de route de la refonte du frontend

Plan établi à partir du [rapport général](FRONTEND_AUDIT.md). Orientations validées le 13/11/2026 (voir
« Décisions ») ; **rien n'est encore implémenté**. Le découpage en Pull Requests des deux premiers lots est dans
« Plan de travail » ; celui des lots suivants s'écrit au démarrage de chacun.

## Principes

- Un lot = une branche depuis `dev` à jour, une Pull Request vers `dev`, fusionnée par le responsable du
  projet.
- Aucun lot ne retire une fonction, ne change un contrat d'API ni ne monte une dépendance majeure.
- Les tests d'un écran sont adaptés dans le lot qui le modifie ; aucun n'est désactivé.
- Vérifications de chaque lot : `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e`,
  captures bureau et mobile, clair et sombre, audit axe.
- Un écart aux « Règles des parcours » se décide avant le lot, puis s'écrit dans `docs/frontend/heroui.md`.

## Ordre et dépendances

```
Lot 1 Socle ──► Lot 2 Design system ──► Lot 3 À traiter ──► Lot 5 Aujourd'hui
                        │
                        ├──► Lot 4 Listes
                        └──► Lot 6 Administration
                                              Lot 7 Assainissement (en dernier)
```

| Lot | Objet | Priorité portée | Effort |
|---|---|---|---|
| 1 | Socle technique | P1 | M |
| 2 | Design system | P2 | L |
| 3 | À traiter | P1 | M |
| 4 | Listes et tableaux | P1, P2 | L |
| 5 | Aujourd'hui | P1, P2 | M |
| 6 | Administration | P1, P2 | M |
| 7 | Assainissement | P3 | M |

Le lot 3 porte le plus de valeur pour les conseillers. Il vient après les lots 1 et 2 parce qu'il s'appuie sur
les raccourcis, les jetons et le panneau unique ; si la priorité est de livrer vite, il peut passer avant le
lot 2 au prix d'une reprise visuelle ensuite.

## Lot 1 — Socle technique

- **Objectif** : rendre la console robuste et mesurable avant de toucher aux écrans.
- **Périmètre** : `lib/api.ts`, `lib/useApi.ts`, `components/AppShell.tsx`, `app/` (fichiers d'erreur),
  `playwright.config.ts`, `package.json`.
- **Modifications**
  - ARCH-02 : `error.tsx`, `global-error.tsx`, `not-found.tsx`.
  - ARCH-01 : `SessionProvider`, `useWorkQueueCount`, mise en page séparée.
  - DATA-01, DATA-02, DATA-05, DATA-06 : délai de frappe, annulation, déduplication, délai maximal, message
    réseau reformulé.
  - A11Y-03 : titre de document par écran (avec `pageTitle`).
  - NAV-01, NAV-03 : arrivée sur Aujourd'hui, retour à la page d'origine après reconnexion.
  - DEP-01 : `tw-animate-css` déclaré.
  - TEST-02, TEST-04 : projets Playwright mobile et sombre sur un sous-ensemble ; captures de référence des
    écrans principaux.
  - TEST-01 : tests unitaires des fonctions pures avec `node --test`.
- **À préserver** : interface de `useApi`, traduction des erreurs, redirection de mot de passe temporaire,
  garde des réponses non envoyées à la déconnexion.
- **Risques** : la déduplication ne doit pas servir une réponse périmée après une écriture (`reload` force un
  nouvel appel) ; l'adresse de retour doit être interne et reconstruite.
- **Tests** : suite complète ; nouveaux cas : erreur de rendu, 404, recherche (une seule requête après la
  frappe), session expirée puis retour.
- **Critères d'acceptation**
  - une exception de rendu affiche un message en français avec « Réessayer », dans la coquille ;
  - taper six caractères dans la recherche de Prospects produit une requête de liste ;
  - Aujourd'hui n'appelle `/todo?limit=1` qu'une fois ;
  - chaque écran a son titre de document ;
  - la CI exécute un projet mobile et un projet sombre.

## Lot 2 — Design system

- **Objectif** : poser les conventions de [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) dans le thème et `components/ds`.
- **Périmètre** : `app/heroui.css`, `components/ds/*`, `components/Drawer.tsx`, `components/ui.tsx`.
- **Modifications**
  - UI-07, UI-08 : échelle de texte nommée ; rayons ramenés à `sm`, `lg`, `full`.
  - UI-01, UI-02 : champs à bordure, une seule apparence.
  - UI-03 : onglets de fiche soulignés ; segments à largeur du contenu.
  - UI-04 : familles de pastilles.
  - UI-06, UI-09 : cartes sans ombre sur la page ; sections sans carte.
  - UX-10, NAV-04 : `PageHeader` sur une ligne ; `BackLink`.
  - UI-10 : entrée d'écran en fondu simple.
  - ARCH-03, A11Y-02 : `Drawer` branché sur HeroUI.
  - PERF-05 : pagination abrégée.
  - A11Y-01, A11Y-05 : règles axe WCAG 2.2 activées ; taille des cibles mesurée.
- **À préserver** : tous les rôles et noms accessibles ; thème sombre ; couleurs métier.
- **Risques** : changement visible sur tous les écrans d'un coup ; surcharges de classes internes de HeroUI
  (RISK-04). Parade : captures de référence du lot 1, revue écran par écran.
- **Tests** : suite complète dans les deux thèmes ; contraste par axe.
- **Critères d'acceptation**
  - aucune taille de texte en pixels ni rayon hors échelle dans `components/ds` ;
  - une seule implémentation de panneau latéral ;
  - aucune violation axe grave, critique ou modérée sur les écrans capturés ;
  - règles 7, 8 et 9 de `heroui.md` mises à jour.

## Lot 3 — À traiter

- **Objectif** : décider sans défiler et au clavier (UX-01, UX-02).
- **Périmètre** : `app/todo/page.tsx`, `components/todo/*`, `DraftPanel` (partagé avec Conversations).
- **Modifications** : disposition en trois zones ([UX et UI](FRONTEND_UX_UI_AUDIT.md) §5.1) ; `useShortcuts` ;
  raccourcis affichés dans les infobulles et la palette.
- **À préserver** : tous les types d'éléments et leurs panneaux ; confirmations ; garde de saisie ;
  enchaînement et focus après décision ; onglet « Traités » ; validation par lot des premiers contacts ;
  version mobile file ou détail.
- **Risques** : 21 tests à adapter ; raccourcis actifs pendant une saisie (à neutraliser) ; écrans de 1024 à
  1280 px.
- **Tests** : `todo.spec.ts`, `conversations.spec.ts` ; nouveaux cas clavier.
- **Critères d'acceptation**
  - à 1440 × 900 et 1280 × 720, « Valider la réponse » est visible sans défilement à l'ouverture d'un
    brouillon ;
  - une file de trois brouillons se traite sans souris ;
  - aucun raccourci ne se déclenche dans un champ de saisie ;
  - règle 20 mise à jour.

## Lot 4 — Listes et tableaux

- **Objectif** : un seul modèle de liste, utilisable en mobile.
- **Périmètre** : Prospects, Campagnes, Conversations, Équipe, Base de connaissances ; `ds/table.tsx`.
- **Modifications**
  - `ListToolbar` : recherche, périmètre, « Filtres · N », compteur (UX-11).
  - UX-03 : Table par défaut sous 1024 px.
  - UX-04 : lignes à deux niveaux sous 640 px.
  - UX-13 : 20 campagnes par page.
  - UI-05 : alignement des pastilles du pipeline.
  - DATA-03 : compteurs sans rechargement inutile.
  - UX-12 : tri et sélection **si** le backend fournit les paramètres ; sinon reporté et documenté.
- **À préserver** : tous les filtres et leur présence dans l'adresse ; export identique aux filtres ; pipeline ;
  « À attribuer » ; pagination serveur.
- **Risques** : le plus grand nombre de tests touchés (prospects 36, campagnes 30, conversations 19) ; à
  découper en une Pull Request par écran.
- **Critères d'acceptation**
  - à 390 px, statut et chiffres d'une campagne sont lisibles sans défilement horizontal ;
  - les mêmes filtres donnent les mêmes requêtes qu'aujourd'hui ;
  - règles 4 et 5 mises à jour.

## Lot 5 — Aujourd'hui

- **Objectif** : une page d'orientation ([UX et UI](FRONTEND_UX_UI_AUDIT.md) §5.2).
- **Périmètre** : `app/page.tsx`, `components/appointments/shared.tsx`.
- **Modifications** : UX-05, UX-06, UX-08, UX-09, UI-06.
- **À préserver** : alerte d'incident, prochaine action, rendez-vous (les siens pour un conseiller), prospects à
  fort signal, relances, activité de l'agent, message « aucun envoi sans validation ».
- **Risques** : 6 tests ; l'entonnoir quitte la page (décision de la règle 28).
- **Critères d'acceptation**
  - le compteur de la file apparaît une fois dans la page ;
  - à 390 px, aucun nom ni statut tronqué dans les rendez-vous ;
  - à 1440 × 900, tout le contenu prioritaire tient dans le premier écran.

## Lot 6 — Administration

- **Objectif** : hiérarchie des actions et formulaires fiables.
- **Périmètre** : Intégrations, Paramètres, Simulateur, Compte.
- **Modifications** : UX-07 (boutons neutres), UX-15 et A11Y-04 (barre d'enregistrement), NAV-02 (entrée
  « Tests »), FORM-01 (`NumberField`, `FieldError`, libellés des erreurs 422), Compte sur `PageHeader`.
- **À préserver** : tous les réglages et leurs valeurs ; garde de saisie ; confirmations ; affichage unique des
  secrets ; droits par rôle.
- **Risques** : un champ numérique vidé ne doit plus valoir 0 sans que l'utilisateur le voie ; tests
  d'intégrations (28) et de paramètres (10).
- **Critères d'acceptation**
  - un seul bouton primaire par écran ;
  - une valeur hors bornes est signalée sous le champ avant l'envoi ;
  - dans le Simulateur, le menu surligne l'entrée du Simulateur.

## Lot 7 — Assainissement

- **Objectif** : ranger sans changer le comportement.
- **Périmètre** : `components/`, `lib/`.
- **Modifications** : ARCH-04 (dossiers par domaine), CLEAN-01 à CLEAN-03, DATA-04 (types dérivés du schéma,
  domaine par domaine), TS-01 à TS-04.
- **À préserver** : tout. Déplacements et suppressions vérifiés par le compilateur et la suite.
- **Risques** : conflits avec des branches ouvertes ; à faire quand les lots 3 à 6 sont fusionnés.
- **Critères d'acceptation** : build et suite inchangés ; aucun export mort ; `components/` sans fichier de
  domaine à la racine.

## Hors périmètre, à planifier séparément

| Sujet | Raison |
|---|---|
| Next.js 16, ESLint 10, TypeScript 7, lucide-react 1.x | montées majeures (RISK-01) |
| Contrôle de session dans un middleware (ARCH-05) | hypothèse à vérifier |
| Compteurs et tri dans les réponses de liste | décision du backend |
| Bibliothèque de requêtes | à réévaluer après le lot 1 |
| Lighthouse, profil React, lecteur d'écran réel, recette sur données réelles | non exécutés pendant l'audit |

## Décisions

Prises par le responsable du projet le 13/11/2026 :

| Sujet | Décision |
|---|---|
| Orientations 5.1 à 5.5 de l'[audit UX et UI](FRONTEND_UX_UI_AUDIT.md) | validées |
| Ordre des lots | design system (lot 2) avant « À traiter » (lot 3) ; le socle (lot 1) reste en premier |
| Règles des parcours touchées (4, 5, 8, 9, 20, 27, 28, 33) | découlent des orientations validées ; chaque règle est réécrite dans `docs/frontend/heroui.md` par la Pull Request qui l'applique, et signalée dans sa description |

Encore ouvert :

| Sujet | Effet tant que ce n'est pas tranché |
|---|---|
| Tri des listes côté serveur (UX-12) | le lot 4 se fait sans tri ni sélection multiple ; aucun contrat d'API n'est modifié |

## Plan de travail

Une ligne = une branche depuis `dev` à jour et une Pull Request vers `dev`. Une Pull Request ne démarre que
lorsque celle dont elle dépend est fusionnée. Vérifications communes à toutes : `npm run lint`,
`npm run typecheck`, `npm run build`, `npm run test:e2e`, plus celles de la colonne « Vérification propre ».

### Lot 1 — Socle technique

| N° | Branche | Contenu | Fichiers principaux | Constats | Dépend de | Vérification propre |
|---|---|---|---|---|---|---|
| 1.1 | `test/frontend-filet-visuel` | projets Playwright mobile (390 px) et sombre sur un sous-ensemble de tests marqués ; captures de référence des écrans principaux ; tests unitaires des fonctions pures | `playwright.config.ts`, `tests/`, `package.json` (script de test) | TEST-01, TEST-02, TEST-04, A11Y-06 | — | la CI exécute les trois projets ; captures de référence versionnées |
| 1.2 | `fix/frontend-erreurs-et-titres` | `error.tsx`, `global-error.tsx`, `not-found.tsx` ; titre de document par écran ; message réseau reformulé ; `tw-animate-css` déclaré | `src/app/`, `src/lib/labels.ts`, `src/lib/api.ts`, `package.json` | ARCH-02, A11Y-03, DATA-06, DEP-01 | 1.1 | tests : exception de rendu, adresse inconnue, titre de trois écrans |
| 1.3 | `refactor/frontend-session` | `SessionProvider`, `useWorkQueueCount`, mise en page séparée ; arrivée sur Aujourd'hui ; retour à la page d'origine après reconnexion | `src/components/AppShell.tsx`, `src/lib/session/`, `src/app/login/page.tsx`, `src/lib/api.ts` | ARCH-01, NAV-01, NAV-03 | 1.2 | captures de référence inchangées ; test : session expirée puis retour ; adresse de retour externe refusée |
| 1.4 | `feat/frontend-donnees` | annulation, déduplication des GET en cours, délai maximal, délai de frappe des recherches | `src/lib/api.ts`, `src/lib/useApi.ts`, `src/lib/data/`, pages Prospects et Conversations | DATA-01, DATA-02, DATA-05 | 1.3 | tests : une requête de liste après six caractères ; un seul `/todo?limit=1` sur Aujourd'hui ; `reload` après écriture rappelle bien l'API |

Points à lever au début du lot :

- **Tests unitaires** : `node --test` est déjà utilisé dans le dépôt (`tools/n8n`), en JavaScript. Les fonctions à
  tester sont en TypeScript et certaines importent par l'alias `@/` (`lib/campaignNav.ts`). À vérifier en 1.1 :
  exécution directe par Node 22 de la CI, sans nouvelle dépendance. Si ce n'est pas possible, la question d'un
  outil de test est soumise au responsable du projet avant tout ajout.
- **Captures de référence** : elles dépendent des polices et du moteur de rendu. Elles sont produites et
  comparées dans la CI seulement, sur le build de production, avec un seuil de tolérance.

### Lot 2 — Design system

| N° | Branche | Contenu | Fichiers principaux | Constats | Règles réécrites | Dépend de | Vérification propre |
|---|---|---|---|---|---|---|---|
| 2.1 | `feat/ds-jetons` | échelle de texte nommée, rayons `sm` / `lg` / `full`, ombres réservées à ce qui flotte ; appliqués dans `components/ds` seulement | `src/app/heroui.css`, `src/components/ds/*` | UI-07, UI-08, UI-09 | 7 | lot 1 | aucune taille en pixels ni rayon hors échelle dans `components/ds` |
| 2.2 | `feat/ds-champs` | champs, listes et recherche à bordure ; une seule apparence | `heroui.css`, `ds/controls.tsx` | UI-01, UI-02 | 8 | 2.1 | contraste des bordures et du texte d'aide par axe, deux thèmes |
| 2.3 | `feat/ds-structure` | `PageHeader` sur une ligne, `BackLink`, onglets de fiche soulignés, segments à largeur du contenu, sections sans carte, entrée d'écran en fondu | `ds/layout.tsx`, `ds/controls.tsx`, `ds/motion.tsx` | UX-10, NAV-04, UI-03, UI-06, UI-10 | 3, 9 | 2.2 | mouvement réduit respecté ; hauteur d'en-tête mesurée |
| 2.4 | `feat/ds-pastilles` | familles statut, étape, mesure, marque ; chiffres clés sans couleur de jugement, pastille visible à côté | `ds/badges.tsx`, `ds/controls.tsx`, `ds/layout.tsx`, `heroui.css` | UI-04 | 10 | 2.1 | « Très chaud » reste la seule pastille pleine |
| 2.5 | `refactor/ds-panneau` | `components/Drawer.tsx` branché sur le `Drawer` HeroUI, même interface | `src/components/Drawer.tsx` | ARCH-03, A11Y-02 | — | 2.1 | les 7 écrans appelants passent leurs tests sans modification ; garde de saisie superposée vérifiée |
| 2.6 | `feat/ds-pagination-a11y` | pagination abrégée ; règles axe WCAG 2.2 et violations modérées ; taille des cibles mesurée | `ds/table.tsx`, `tests/a11y.ts` | PERF-05, A11Y-01, A11Y-05 | — | 2.3 | aucune violation grave, critique ou modérée sur les écrans capturés |
| 2.7 | `refactor/ecrans-jetons` | remplacement des tailles et rayons hors échelle dans les écrans (mécanique, sans changement de structure) | `src/app/**`, `src/components/**` hors `ds` | UI-07, UI-08 | — | 2.1 à 2.4 | plus aucune taille de texte en pixels dans `src` ; une Pull Request par groupe d'écrans si la revue le demande |

Chaque Pull Request du lot 2 change l'apparence de plusieurs écrans : elle met à jour les captures de
référence et joint les captures avant / après, bureau et mobile, clair et sombre.

### Lots 3 à 7

Contenu, risques et critères d'acceptation : sections « Lot 3 » à « Lot 7 » ci-dessus. Découpage prévu :

| Lot | Pull Requests prévues |
|---|---|
| 3 | disposition en trois zones ; raccourcis clavier |
| 4 | une par écran : Prospects, Campagnes, Conversations, Équipe et Base de connaissances |
| 5 | une |
| 6 | Intégrations ; Paramètres et formulaires ; Simulateur et menu |
| 7 | rangement des dossiers ; exports et doublons ; types dérivés du schéma, par domaine |

## Suivi

| Lot | État |
|---|---|
| Audit (phases 1 et 2) | fusionné, [Anjara7697/iagora#184](https://github.com/Anjara7697/iagora/pull/184) |
| 1 — Socle technique | fusionné : [Anjara7697/iagora#188](https://github.com/Anjara7697/iagora/pull/188), [#189](https://github.com/Anjara7697/iagora/pull/189), [#190](https://github.com/Anjara7697/iagora/pull/190), [#191](https://github.com/Anjara7697/iagora/pull/191) |
| 2 — Design system | en cours : 2.1 fusionnée ([#192](https://github.com/Anjara7697/iagora/pull/192)), 2.2 (champs) |
| 3 à 7 | à faire |
