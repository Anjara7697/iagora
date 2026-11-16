# Audit du frontend — rapport général

- Date : 13/11/2026
- Branche auditée : `dev`, commit `5ce9fda`
- Périmètre : `frontend/` (console Next.js). Aucun fichier de code modifié pendant l'audit.
- Documents liés : [UX et UI](FRONTEND_UX_UI_AUDIT.md) · [architecture](FRONTEND_ARCHITECTURE.md) ·
  [design system](DESIGN_SYSTEM.md) · [dette technique](FRONTEND_TECHNICAL_DEBT.md) ·
  [feuille de route](FRONTEND_REFACTORING_ROADMAP.md)

## 1. Synthèse

La console est techniquement saine : typage strict sans `any`, contrat d'API vérifié à la compilation, état des
écrans dans l'adresse, erreurs lisibles, confirmations, gardes de saisie, 211 tests navigateur avec audit axe.
Il n'y a **aucun P0**.

Le gain est dans l'expérience utilisateur et la hiérarchie visuelle, pas dans une réécriture :

1. **Le parcours central (« À traiter ») fait défiler avant d'agir** : la réponse proposée et son bouton de
   validation sont sous la ligne de flottaison, sans raccourci clavier (UX-01, UX-02).
2. **Le mobile est utilisable mais pas pensé** : pipeline par défaut, tableaux réduits à une colonne, textes
   tronqués (UX-03 à UX-06).
3. **L'information se répète et les cartes s'accumulent** : compteur de la file affiché quatre fois, entonnoir en
   double, en-têtes de 100 px, jusqu'à quatre pastilles par carte (UX-08 à UX-12, UI-01 à UI-06).
4. **La couche de données est artisanale** : ni délai de frappe, ni annulation, ni déduplication ; appels en
   double (DATA-01 à DATA-03).
5. **Les jetons du thème sont contournés** : sept tailles de texte en pixels, quatre rayons en concurrence, deux
   panneaux latéraux (UI-07, UI-08, ARCH-03).

## 2. Méthode et limites

| Vérification | Commande ou moyen | Résultat |
|---|---|---|
| Lint | `npm run lint` | réussi |
| Types | `npm run typecheck` | réussi |
| Build de production | `npm run build` | réussi, tailles au §6 |
| Vulnérabilités | `npm audit --omit=dev` | 0 |
| Versions | `npm outdated` | voir [dette technique](FRONTEND_TECHNICAL_DEBT.md) §6 |
| Tests navigateur, bureau clair 1440 × 900 | suite Playwright, API simulée, build de production | 211 sur 211 réussis |
| Rendu observé | captures de fin de test | une quinzaine d'écrans en clair, « À traiter » en sombre, 6 écrans en 390 px |
| Performance | `PerformanceObserver` dans Chromium, build de production, en local | LCP et CLS au §6 |

Chaque constat porte sa source :

- **Rendu** : vu sur une capture de l'interface réellement affichée.
- **Code** : lu dans le source, non vu à l'écran.
- **Mesure** : chiffre obtenu par un outil.
- **Hypothèse** : probable, à confirmer avant d'agir.

Limites à garder en tête :

- Les données viennent des jeux de données des tests, pas du vrai backend (ni Docker ni MongoDB dans
  l'environnement d'audit). Les volumes réels (longues listes, longs messages) ne sont pas observés.
- Les captures sont des états de fin de test : elles montrent parfois un toast ou un filtre actif.
- Non exécutés : Lighthouse, React Profiler, analyseur de bundle, lecteur d'écran réel. L'INP n'est pas mesuré.
- Écrans jugés sur captures ou recherches ciblées, sans lecture complète du code : Rendez-vous, Base de
  connaissances, Agent, Analyses, Import et les panneaux d'Intégrations.
- Thème sombre : 11 écrans capturés, un seul examiné en détail (« À traiter »).
- Quatre tests échouent en 390 px : ils sont écrits pour le bureau, ce ne sont pas des défauts de la console.

## 3. Stack réelle

| Élément | Version installée | Dernière publiée | Remarque |
|---|---|---|---|
| Next.js (App Router) | 15.5.29 | 16.4.6 | montée majeure hors périmètre (RISK-01) |
| React, React DOM | 19.1.0 | 19.3.1 | |
| `@heroui/react`, `@heroui/styles` | 3.2.6 | 3.2.7 | repose sur `react-aria-components` ^1.21.1 |
| Tailwind CSS | 4.3.3 | 4.3.5 | configuration dans `src/app/heroui.css` |
| TypeScript | 5.9.3 | 7.0.2 | `strict: true` |
| lucide-react | 0.545.0 | 1.72.0 | 71 fichiers l'importent |
| `@internationalized/date` | 3.12.4 | — | dépendance de pair de HeroUI |
| Playwright, axe-core | 1.64.0, 4.14 | 1.65.0 | seuls outils de test |

Pas de bibliothèque d'état, de requêtes, de formulaires ni de validation : `useState`, un hook `useApi` maison et
la validation HTML native.

## 4. Cartographie

22 routes, un seul layout (`src/app/layout.tsx`), toutes rendues côté client. Aucun `error.tsx`, `loading.tsx`,
`not-found.tsx` ni middleware.

| Route | Écran | Rôles | Objectif | Données (API) | Actions principales |
|---|---|---|---|---|---|
| `/login` | Connexion | public | ouvrir une session | `POST /auth/login` | se connecter |
| `/` | Aujourd'hui | tous | savoir quoi faire maintenant | `/dashboard/summary`, `/todo`, `/appointments` | ouvrir la file |
| `/todo` | À traiter | écriture : conseiller, administrateur | décider sur chaque élément préparé par l'agent | `/todo`, `/todo/treated`, brouillons | valider, modifier, régénérer, refuser |
| `/conversations` | Conversations | idem | lire et répondre | `/conversations`, résumé, fil | répondre, prendre la main, clôturer |
| `/appointments` | Rendez-vous | tous | agenda par jour | `/appointments` | ouvrir la fiche, la visio |
| `/prospects` | Prospects | tous | chercher, filtrer, exporter | `/prospects`, `/campaigns` | filtrer, exporter, importer |
| `/prospects/[id]` | Fiche prospect | tous | comprendre et agir sur un prospect | prospect, conversation, décisions | lancer l'agent, consentement, effacement |
| `/prospects/import` | Import CSV | écriture | importer une liste | aperçu, import | prévisualiser, importer |
| `/campaigns` | Campagnes | tous | suivre les campagnes | `/campaigns` × 4, `/campaigns/overview` | créer, filtrer |
| `/campaigns/new` | Nouvelle campagne | administrateur | création en étapes | `/targets`, `POST /campaigns` | créer |
| `/campaigns/[id]` | Fiche campagne | tous | chiffres, sources, prospects, réglages | campagne, statistiques | activer, mettre en pause, modifier |
| `/dashboard` | Tableau de bord | tous | pilotage sur 7, 30, 90 jours | `/dashboard/overview` | changer la période, exporter |
| `/analytics` | Analyses | tous | qualité de l'agent | indicateurs | changer la période |
| `/agent` | Agent | modification : administrateur | état, modes, arrêt d'urgence | statut, activité | arrêter, reprendre |
| `/knowledge` | Base de connaissances | écriture : administrateur | documents et test de recherche | documents, recherche | ajouter, modifier, tester |
| `/team` | Équipe | administrateur | comptes | utilisateurs | ajouter, désactiver, réinitialiser |
| `/integrations` | Intégrations | administrateur | connecteurs | messagerie, agenda, Zoom, Meta, jetons | configurer |
| `/settings` | Paramètres | administrateur (outils de test pour un conseiller) | réglages de l'agent | `/settings` | enregistrer |
| `/settings/testing` | Tests et démonstration | administrateur, conseiller | accès au simulateur | — | ouvrir le simulateur |
| `/simulator` | Simulateur | administrateur, conseiller | jouer un prospect fictif | simulation | envoyer, valider |
| `/account` | Mon compte | tous | mot de passe, agenda, Zoom | `/auth/password` | changer le mot de passe |
| `/_not-found` | 404 | — | page par défaut de Next.js | — | — |

Composants globaux : `AppShell` (session, menu, barre), `CommandPalette` (Ctrl K), `AccountMenu`, `Toaster`,
`ReplyDraftsProvider` (réponses en cours de saisie).

## 5. Répartition des dix-huit rubriques

| Rubrique demandée | Où la lire |
|---|---|
| Synthèse, cartographie | ce document, §1 et §4 |
| Audit UX et UI par page, navigation, parcours, recommandations de redesign | [FRONTEND_UX_UI_AUDIT.md](FRONTEND_UX_UI_AUDIT.md) |
| Design system | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| Architecture React et Next.js | [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) |
| API et données, TypeScript, tests, code inutilisé, dépendances | [FRONTEND_TECHNICAL_DEBT.md](FRONTEND_TECHNICAL_DEBT.md) |
| Performance, accessibilité, risques | ce document, §6 à §8 |
| Plan d'action priorisé | [FRONTEND_REFACTORING_ROADMAP.md](FRONTEND_REFACTORING_ROADMAP.md) |

## 6. Performance

Mesures (build de production servi en local, API simulée avec 80 ms de latence, un seul passage ; la machine
exécutait d'autres tests, les durées sont donc indicatives) :

| Page | FCP | LCP | CLS | JS transféré | CSS transféré | Polices |
|---|---|---|---|---|---|---|
| `/login` | 0,38 s | 0,38 s | 0,0006 | 290 ko | 45 ko | 30 ko |
| `/` | 0,33 s | 1,52 s | 0 | 361 ko | 45 ko | 41 ko |
| `/prospects` | 0,36 s | 1,59 s | 0 | 368 ko | 45 ko | 41 ko |

Tailles du build : 102 ko de JS partagé, 254 à 387 ko au premier chargement selon la route (maximum :
`/campaigns/[id]`), une feuille CSS de 457 ko non compressée, un chunk de 467 ko non compressé.

| Id | Constat | Source | Priorité | Effort |
|---|---|---|---|---|
| PERF-01 | Sur une page authentifiée, le contenu utile attend deux allers-retours en série : `/auth/me` dans `AppShell.tsx:51`, puis les données de la page. C'est ce qui porte le LCP à environ 1,5 s en local ; l'écart grandira avec la latence réelle. | Mesure + code | P2 | M |
| PERF-02 | Aucun découpage à la demande (`dynamic`, `lazy` : 0 occurrence). Les panneaux lourds (connecteurs, sélecteur de couleur, calendrier de période) sont dans le bundle de leur page. | Code | P3 | S |
| PERF-03 | Le chunk de 467 ko contient probablement HeroUI et react-aria importés par le point d'entrée unique `@heroui/react`. | Hypothèse (analyseur de bundle non exécuté) | P3 | S pour vérifier |
| PERF-04 | Polices déclarées en `@font-face` dans `heroui.css`, sans préchargement. Le CLS mesuré est nul : pas d'effet constaté. | Mesure | — | — |
| PERF-05 | `TablePagination` rend un bouton par page (`components/ds/table.tsx`, boucle sur `pages`). Sans effet aujourd'hui, coûteux et illisible au-delà de quelques dizaines de pages. | Code | P2 | S |

Non mesuré : INP, comportement sur réseau mobile réel, profil de rendu React.

## 7. Accessibilité

Acquis vérifiés : audit axe (`wcag2a`, `wcag2aa`, violations graves et critiques) dans 17 fichiers de test sur
18 ; lien d’évitement ; `aria-current` sur le menu ; libellés reliés aux champs (`Field`) ; mouvement réduit
respecté (`heroui.css:190`) ; 35 zones `role="status"` ou `role="alert"`.

| Id | Constat | Source | Priorité | Effort |
|---|---|---|---|---|
| A11Y-01 | L'audit automatique ne retient que les violations graves et critiques, et ne couvre pas les critères ajoutés par WCAG 2.2 (taille des cibles, focus non masqué). Les violations modérées ne sont pas connues. | Code (`tests/a11y.ts`) | P2 | S |
| A11Y-02 | `components/Drawer.tsx` gère le focus à la main (liste `FOCUSABLE`, ligne 9) et déclare `aria-modal` sans rendre le reste de la page inerte. Le `Drawer` HeroUI, déjà utilisé pour le menu mobile, le fait nativement. | Code | P2 | M (voir ARCH-03) |
| A11Y-03 | Toutes les pages ont le même titre de document (`app/layout.tsx:8`) : un lecteur d'écran n'annonce pas le changement d'écran, les onglets du navigateur sont indistincts. | Code | P1 | S |
| A11Y-04 | Barre d'enregistrement collante de Paramètres (`app/settings/page.tsx:268`) : elle recouvre le contenu en bas de l'écran ; un champ qui reçoit le focus peut être masqué (critère 2.4.11). | Rendu | P2 | S |
| A11Y-05 | Pastilles de filtre et boutons en taille `sm` : hauteur de cible non mesurée au regard du critère 2.5.8 (24 px). | Hypothèse | P3 | S pour mesurer |
| A11Y-06 | Aucun test en thème sombre ni au clavier seul dans la suite, hors un fichier. Le contraste du thème sombre n'est vérifié par axe que là. | Code | P2 | S |

Non vérifié : lecteur d'écran réel, zoom à 200 %, mode de contraste élevé.

## 8. Risques techniques

| Id | Risque | Conséquence | Parade |
|---|---|---|---|
| RISK-01 | Next.js 16 est publié ; la console reste en 15. | Fin de support à terme. | Ne pas monter de version pendant la refonte ; lot séparé, après. |
| RISK-02 | Les 211 tests s'appuient sur des rôles, des libellés et parfois la structure. | Une refonte d'écran casse des tests sans régression réelle. | Adapter les tests dans le même lot que l'écran ; ne jamais en désactiver. |
| RISK-03 | Les « Règles des parcours » (`docs/frontend/heroui.md`) fixent des choix que la refonte remet en cause. | Écart non décidé avec le responsable du projet. | Liste des règles touchées dans [UX et UI](FRONTEND_UX_UI_AUDIT.md) §6, à décider une par une. |
| RISK-04 | HeroUI 3 évolue vite (3.2.6 → 3.2.7 en cours d'audit) et le thème surcharge des classes internes (`.tabs__tab`, `.chip--soft`). | Une mise à jour mineure peut défaire une surcharge. | Garder les surcharges dans `heroui.css`, peu nombreuses, couvertes par une capture de référence. |
| RISK-05 | Les données de test sont courtes. | Un écran validé sur capture peut casser avec de vrais contenus. | Recette de chaque lot contre le backend réel avec `seed-demo`. |
| RISK-06 | Toute la console est rendue côté client derrière `/auth/me`. | Un changement de la gestion de session touche tous les écrans. | Isoler la session dans un fournisseur dédié avant tout autre changement (ARCH-01). |

## 9. Index des constats

Priorités : P0 bloquant · P1 important · P2 amélioration significative · P3 finition.
Effort : S moins d'une journée · M un à trois jours · L plus de trois jours.

| Id | Constat | Priorité | Effort | Type | Lot |
|---|---|---|---|---|---|
| UX-01 | À traiter : action de validation sous la ligne de flottaison | P1 | M | UX structurelle | 3 |
| UX-02 | Aucun raccourci clavier dans la file | P1 | M | UX structurelle | 3 |
| UX-03 | Prospects s'ouvre sur le pipeline en mobile | P1 | S | Gain rapide | 4 |
| UX-04 | Tableaux réduits à une colonne en mobile | P1 | M | UX structurelle | 4 |
| UX-05 | Rendez-vous d'Aujourd'hui tronqués en mobile | P1 | S | Gain rapide | 5 |
| UX-06 | Chiffres clés empilés sur une colonne en mobile | P2 | S | Gain rapide | 5 |
| UX-07 | Quatre boutons primaires sur Intégrations | P1 | S | Gain rapide | 6 |
| UX-08 | Compteur de la file affiché quatre fois sur Aujourd'hui | P2 | M | UX structurelle | 5 |
| UX-09 | Entonnoir en double (Aujourd'hui, Tableau de bord) | P2 | S | UX structurelle | 5 |
| UX-10 | En-têtes d'écran de 100 px, sur-titre redondant | P2 | S | Refonte UI | 2 |
| UX-11 | Quatre rangées de filtres dans Conversations | P2 | M | UX structurelle | 4 |
| UX-12 | Tableaux sans tri, sélection ni action groupée | P2 | L | UX structurelle | 4 |
| UX-13 | Campagnes paginée à 6 lignes | P2 | S | Gain rapide | 4 |
| UX-14 | Le même prospect apparaît dans plusieurs colonnes du pipeline | P3 | M | UX structurelle | 4 |
| UX-15 | Barre d'enregistrement de Paramètres recouvre le contenu | P2 | S | Gain rapide | 6 |
| NAV-01 | La connexion mène à Prospects, pas à Aujourd'hui | P2 | S | Gain rapide | 1 |
| NAV-02 | Le Simulateur surligne « Paramètres » | P2 | S | Gain rapide | 6 |
| NAV-03 | Session expirée : la page d'origine est perdue | P2 | S | Gain rapide | 1 |
| NAV-04 | Aucun fil d'Ariane ; retours hétérogènes | P3 | S | Refonte UI | 2 |
| UI-01 | Champs et pastilles en blocs gris pleins sans bordure | P2 | M | Refonte UI | 2 |
| UI-02 | Champ de recherche blanc sur Intégrations, gris ailleurs | P2 | S | Refonte UI | 2 |
| UI-03 | Onglets étirés sur toute la largeur | P2 | S | Refonte UI | 2 |
| UI-04 | Jusqu'à quatre pastilles colorées par carte | P2 | M | Refonte UI | 2 |
| UI-05 | Pastille « Accordé » étirée sur deux lignes dans le pipeline | P2 | S | Gain rapide | 4 |
| UI-06 | Cartes imbriquées et accumulées | P2 | M | Refonte UI | 2, 5 |
| UI-07 | Sept tailles de texte en pixels hors échelle | P2 | M | Refonte UI | 2 |
| UI-08 | Quatre rayons en concurrence | P2 | S | Refonte UI | 2 |
| ARCH-01 | `AppShell` cumule session, contexte, compteur et mise en page | P2 | M | Refactoring | 1 |
| ARCH-02 | Aucune frontière d'erreur ni page 404 propre | P1 | S | Refactoring | 1 |
| ARCH-03 | Deux panneaux latéraux | P2 | M | Refactoring | 2 |
| ARCH-04 | 29 composants à la racine de `components/` | P3 | M | Refactoring | 7 |
| ARCH-05 | Accès contrôlé côté client seulement | P3 | M | Refactoring | — |
| DATA-01 | Recherche sans délai de frappe ni annulation | P1 | S | Performance | 1 |
| DATA-02 | Appels en double, pas de déduplication | P1 | M | Performance | 1 |
| DATA-03 | Compteurs obtenus par des requêtes de liste | P2 | S | Performance | 1 |
| DATA-04 | Types écrits à la main à côté du schéma généré | P2 | M | Refactoring | 7 |
| FORM-01 | Champs numériques et validation sans composants HeroUI | P1 | M | Refactoring | 6 |
| TS-01 | Deux casts forcés | P3 | S | Nettoyage | 7 |
| TEST-01 | Aucun test unitaire ni de composant | P2 | M | Tests | 1 |
| TEST-02 | Ni mobile ni thème sombre dans la configuration Playwright | P2 | S | Tests | 1 |
| CLEAN-01 | Quatre exports morts | P3 | S | Nettoyage | 7 |
| CLEAN-02 | Aides dupliquées (rôles, initiales, noms) | P3 | S | Nettoyage | 7 |
| DEP-01 | `tw-animate-css` importé sans être déclaré | P2 | S | Nettoyage | 1 |
| A11Y-01 à 06 | voir §7 | P1 à P3 | S à M | Accessibilité | 1, 2, 6 |
| PERF-01 à 05 | voir §6 | P2 à P3 | S à M | Performance | 1, 4 |
