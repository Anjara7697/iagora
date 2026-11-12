# Rapport d'audit — Frontend et UX

- Date : 2026-11-11
- Branche : dev
- SHA audité : `da56bae`
- Auditeur : agent IA (mission `docs/audit/06_FRONTEND_UX_AUDIT.md`)
- Périmètre : console Next.js 15 / HeroUI v3 (`frontend/src`), 22 routes, tests Playwright.
- Exclusions : **aucune vérification visuelle dans cet audit** (pas de capture prise). Les constats viennent de
  la lecture du code, du build local et des tests existants.

## 1. Résumé exécutif

La console est complète : toutes les entrées de navigation mènent à un écran réel. Elle est cohérente :
- 30 « Règles des parcours » écrites dans `docs/frontend/heroui.md` ;
- états chargement / vide / erreur avec bouton « Réessayer » sur les écrans de pilotage ;
- erreurs traduites pour un conseiller ;
- accessibilité vérifiée par axe-core dans les tests.

Pas de P0 ni de P1. Les points à traiter :
- les **quatre écrans d'administration** (Paramètres, Équipe, Intégrations, Simulateur) n'ont pas été repris avec
  les règles 1 à 30 (FE-002) ;
- **aucune protection contre la perte d'une saisie** en cours, par exemple un brouillon modifié dans « À traiter »
  (FE-001) ;
- deux points déjà décrits ailleurs : le jeton de connexion dans `localStorage` (SEC-004) et le contrat d'API
  recopié à la main (ARCH-003).

## 2. Périmètre et méthode

Lecture de `src/app/**`, `src/components/**`, `src/lib/{api,types,theme}.ts`, `docs/frontend/heroui.md`,
`docs/frontend/maquette-finale.md`. Commande exécutée : `npm run build` en local (réussi, tailles ci-dessous).
Tests Playwright **non relancés** dans cet audit : ils passent en CI sur la PR [Anjara7697/iagora#155](https://github.com/Anjara7697/iagora/pull/155),
tâche `frontend` réussie.

## 3. Matrice des parcours

| Écran | Route | États chargement / vide / erreur (lus dans le code) | Rôles | Règles 1–30 appliquées | Risque principal |
|---|---|---|---|---|---|
| Aujourd'hui | `/` | oui | tous | oui | — |
| À traiter | `/todo` | oui | écriture pour conseiller et admin | oui | perte d'un brouillon modifié (FE-001) |
| Conversations | `/conversations` | oui | idem | oui | idem |
| Prospects, fiche | `/prospects`, `/prospects/[id]` | oui | idem | oui | — |
| Import CSV | `/prospects/import` | à vérifier | écriture | à vérifier | — |
| Campagnes, détail | `/campaigns`, `/campaigns/[id]` | oui | idem | oui | page la plus lourde (352 ko) |
| Rendez-vous | `/appointments` | oui | tous | oui (écart 26 décidé) | — |
| Base de connaissances | `/knowledge` | oui | admin pour écrire | oui | perte d'une saisie (FE-001) |
| Tableau de bord, Analyses | `/dashboard`, `/analytics` | oui | tous | oui | — |
| Agent | `/agent` | oui | admin pour modifier | oui | — |
| Paramètres | `/settings` | indicateur « non enregistré » ; reste à vérifier | admin | **non revu** | FE-002 |
| Équipe | `/team` | à vérifier | admin | **non revu** | FE-002 |
| Intégrations | `/integrations` | états de test présents ; reste à vérifier | admin | **non revu** | FE-002 |
| Simulateur | `/simulator` | à vérifier | admin et conseillers autorisés | **non revu** | FE-002 |
| Compte, connexion | `/account`, `/login` | à vérifier | tous | à vérifier | couleurs en dur (FE-003) |

## 4. Points positifs à préserver

- **Erreurs lisibles** (`src/lib/api.ts:64-87`) :
  - les messages métier sont gardés ;
  - les 422 nomment le champ en cause ;
  - les 500 restent génériques, sans identifiant technique ;
  - une 401 renvoie vers la connexion (`api.ts:114`).
- **Pas de HTML injecté** : le seul `dangerouslySetInnerHTML` est le script fixe du thème (`app/layout.tsx`).
- **Navigation par URL** : période, filtres et sélection dans l'adresse (`replaceUrl`), donc partageables et
  conservés au rafraîchissement.
- **Rôles** : actions masquées ou désactivées avec raison selon le rôle (environ 100 contrôles). Le backend reste
  la vraie barrière (voir SEC).
- **Accessibilité** : vérification axe-core dans 16 des 17 fichiers de test ; libellés au-dessus des champs ; contraste
  AA vérifié pour les couleurs métier (`heroui.md:16`).
- **Poids raisonnable** (build local) : 102 ko de code partagé, 216 à 352 ko au premier chargement selon la page.

## 5. Constats techniques

### AUDIT-FE-001 — Aucune protection contre la perte d'une saisie
- Catégorie : prévention d'erreur
- Criticité : P3
- Confiance : Confirmé (absence dans le code) ; impact Probable
- Preuve : aucun `beforeunload` ni garde de navigation dans `src/` ; seul Paramètres signale les modifications
  non enregistrées (`components/TestingAccess.tsx:12-29`).
- Scénario : un conseiller réécrit un brouillon dans « À traiter », clique sur une autre conversation ou ferme
  l'onglet : le texte est perdu sans avertissement.
- Recommandation : un hook commun `useUnsavedChanges(dirty)` qui avertit avant de quitter (onglet et navigation
  interne) ; l'appliquer au brouillon, à l'éditeur de connaissances et aux formulaires d'administration.
- Complexité : S

### AUDIT-FE-003 — Couleurs en dur hors des jetons du thème
- Catégorie : conformité HeroUI
- Criticité : P3
- Confiance : Confirmé
- Preuve : `src/app/login/page.tsx` (`#0f1220`, `#7a3df0`), `src/components/ds/Brand.tsx` (`#a79bf0`).
  Les couleurs des logos LinkedIn et Meta (`SourceAvatars.tsx`) sont des couleurs de marque, donc légitimes.
- Recommandation : passer par les jetons du thème ou les déclarer dans `heroui.css`.
- Complexité : S

Liés : jeton dans `localStorage` (SEC-004) ; Next.js 15.5.27 vulnérable (SEC-002) ; types recopiés à la main
(ARCH-003).

## 6. Constats UX

### AUDIT-FE-002 — Écrans d'administration non revus avec les règles des parcours
- Catégorie : cohérence
- Criticité : P3
- Confiance : Probable (non vérifié visuellement)
- Preuve : `docs/frontend/heroui.md:48` (règles établies sur les autres parcours) ; `docs/frontend/maquette-finale.md:122-126`
  (ces écrans sont jugés « conformes » à la maquette, avant les règles 23 à 30) ; `app/settings/page.tsx` et
  `app/simulator/page.tsx` font plus de 600 lignes chacun.
- Risque : ces écrans servent rarement, mais aux opérations sensibles (mode de l'agent, comptes, connecteurs). Un
  écart de présentation y coûte plus cher qu'ailleurs.
- Recommandation : revue écran par écran (règles 1 à 30), en commençant par Intégrations ; découper les deux plus
  gros fichiers en composants de section.
- Complexité : M

## 7. Éléments non vérifiés

- Rendu visuel, thème sombre, mobile : pas de capture dans cet audit (les tests en vérifient une partie).
- Lecteur d'écran réel (seul axe-core est automatisé).
- Performance sur un vrai réseau (seul le poids du code est mesuré).

## 8. Recommandations priorisées

1. SEC-002 : monter Next.js en 15.5.29 (déjà recommandé).
2. AUDIT-FE-001 : protection des saisies.
3. AUDIT-FE-002 : revue des écrans d'administration, Intégrations d'abord.
4. AUDIT-FE-003 : jetons de couleur.

## 9. Fichiers et commandes

`frontend/src/**`, `frontend/tests/**`, `docs/frontend/*.md`. `npm run build` : réussi (exit 0), tailles relevées
au §4. Aucun autre outil exécuté.
