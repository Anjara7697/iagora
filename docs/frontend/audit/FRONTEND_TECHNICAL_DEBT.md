# Dette technique du frontend

Complète le [rapport général](FRONTEND_AUDIT.md). Sauf mention contraire, les constats viennent de la lecture
du code et de recherches dans `frontend/src` au commit `5ce9fda`.

## 1. État de santé

| Indicateur | Valeur |
|---|---|
| `any`, `@ts-ignore`, `@ts-expect-error` | 0 |
| `eslint-disable` | 1 (`lib/useApi.ts:52`, dépendances d'effet, justifié par `keepPrevious`) |
| Casts forcés | 2 (TS-01) |
| `useEffect` | 35 dans tout `src` |
| `dangerouslySetInnerHTML` | 1, le script fixe du thème |
| Lint, types, build | réussis |
| `npm audit --omit=dev` | 0 vulnérabilité |

## 2. Données et API

**DATA-01 — Recherche sans délai de frappe ni annulation** · P1 · effort S
- Fichiers : `app/prospects/page.tsx:145`, `app/conversations/page.tsx:130` ; même schéma probable sur
  `app/team/page.tsx:109` et `components/knowledge/DocumentList.tsx:58` (non vérifié : filtrage local possible).
- Preuve : `onChange` écrit dans l'adresse à chaque caractère ; le chemin de `useApi` change ; une requête
  part. Aucune occurrence de `debounce`, `useDeferredValue` ni `AbortController` dans `src`.
- Conséquence : taper « martin » lance six requêtes, plus six pour le total « N sur M ». Les réponses tardives
  sont ignorées (pas d'affichage faux) mais le serveur les calcule toutes.
- Solution : `useDebouncedValue(q, 250)` pour le chemin ; `AbortController` dans `api()` et `useApi`.
- Dépendances : aucune côté backend.

**DATA-02 — Appels en double** · P1 · effort M
- `/todo?limit=1` : `components/AppShell.tsx:82` et `app/page.tsx:58`, au même moment sur Aujourd'hui.
- `/todo?kind=incident&limit=1` en plus sur Aujourd'hui (`app/page.tsx:59`) et sur le Tableau de bord.
- `/campaigns?limit=200` sur Prospects pour nommer les filtres, rechargé à chaque visite.
- État de l'agent : chargé par le menu du compte à chaque changement de page (`refreshKey={pathname}`).
- Solution : déduplication des GET identiques en cours dans `useApi` ; compteur de la file fourni par le
  contexte de session plutôt que rechargé par la page.

**DATA-03 — Compteurs obtenus par des requêtes de liste** · P2 · effort S (frontend)
- `app/campaigns/page.tsx:58-60` : trois appels `limit=1` pour lire trois `total`, plus la liste et la
  synthèse : cinq requêtes pour un écran.
- Même procédé pour « N sur M » (Prospects, Conversations) et « À attribuer (N) ».
- Solution sans toucher l'API : dédupliquer et ne pas recharger quand le filtre change. Solution propre : des
  compteurs dans la réponse de liste, **à proposer au backend**, sans rien retirer du contrat actuel.

**DATA-04 — Deux sources de types** · P2 · effort M
- `lib/types.ts` : 54 types écrits à la main ; `lib/api/schema.d.ts` : 8 444 lignes générées depuis l'OpenAPI.
- `lib/api/contract.ts` vérifie 46 correspondances à la compilation : un champ lu par la console et absent de
  l'API casse le build. C'est un bon garde-fou, mais il ne vérifie ni les types des champs ni leur caractère
  facultatif.
- Solution progressive : dériver les types de lecture du schéma (`components["schemas"]["…"]`) domaine par
  domaine, en gardant `types.ts` comme façade de noms.

Autres points :

| Id | Constat | Priorité | Effort |
|---|---|---|---|
| DATA-05 | Pas de délai maximal sur `fetch` : un serveur muet laisse l'écran en chargement. | P2 | S |
| DATA-06 | Message d'erreur réseau « le backend est-il démarré ? » (`lib/api.ts:134`, `175`) : formulation de développeur montrée à un conseiller. | P2 | S |
| DATA-07 | Les réponses ne sont pas validées à l'exécution (`payload as T`). Acceptable avec le contrat de types ; à garder en tête pour les réponses critiques. | P3 | — |
| DATA-08 | Après une écriture, la page recharge à la main chaque ressource (`refreshAll` dans `app/prospects/[id]/page.tsx`). Risque d'oubli quand un écran grandit. | P3 | M |
| DATA-09 | Soumissions multiples : protégées par des états `busy` locaux, écran par écran. Pas de défaut trouvé ; pas de convention commune. | P3 | S |

## 3. État et effets

- `AppShell` : voir ARCH-01 dans l'[architecture](FRONTEND_ARCHITECTURE.md).
- Redirection de mot de passe temporaire relancée chaque seconde par `setInterval` (`AppShell.tsx:101`) :
  contournement d'une navigation absorbée. À remplacer par une redirection décidée avant le rendu des
  enfants.
- `ReplyDraftsProvider` : le contexte change à chaque frappe et rend tous ses consommateurs. Sans effet
  mesuré ; à surveiller si la saisie ralentit (INP non mesuré).
- `app/settings/page.tsx` : chargement écrit à la main (`load`, `loadError`) au lieu de `useApi`.

## 4. Formulaires et validation

**FORM-01 — Formulaires sans les composants de formulaire de HeroUI** · P1 · effort M
- Preuve : 16 `type="number"` (14 dans `components/settings/SettingsSections.tsx`, 2 dans
  `components/EmailSettings.tsx`) convertis par `Number(e.target.value) as never`
  (`app/settings/page.tsx:123`) ; 3 occurrences seulement de `isInvalid`, `aria-invalid` ou `FieldError` ;
  `Form`, `TextField`, `NumberField`, `FieldError` de HeroUI 3.2.6 non utilisés.
- Conséquences : un champ vidé vaut 0 ; pas de bornes ni d'unité ; les erreurs arrivent à la soumission ou du
  serveur (« champ « x » invalide », avec le nom technique du champ, `lib/api.ts:90`).
- Solution : `NumberField` avec bornes ; `TextField` + `FieldError` ; correspondance entre les noms de champs
  de l'API et les libellés pour les erreurs 422. Les règles restent celles du backend : pas de schéma de
  validation dupliqué côté console.

Autres points : mot de passe du compte validé en direct (`app/account/page.tsx`), bon modèle à généraliser ;
garde de saisie présente sur tous les formulaires lus.

## 5. TypeScript

| Id | Constat | Fichier | Priorité |
|---|---|---|---|
| TS-01 | `as never` pour contourner un type | `app/settings/page.tsx:123`, `components/ds/Providers.tsx:14` | P3 |
| TS-02 | Clés d'URL lues par cast (`params.get("kind") as TodoKind`) après vérification d'appartenance : correct, répétitif | `app/todo/page.tsx` | P3 |
| TS-03 | Métadonnées de message typées à la lecture (`m.metadata.draft as { status?: string }`) | `app/prospects/[id]/page.tsx` | P3 |
| TS-04 | Assertion non nulle `name![0]` après un `filter(Boolean)` | `components/prospect/ProspectHeader.tsx:53` | P3 |
| TS-05 | `tsconfig` : `target: ES2017`, pas de `noUncheckedIndexedAccess` | `tsconfig.json` | P3, à évaluer |

## 6. Dépendances

| Paquet | Constat | Action |
|---|---|---|
| `tw-animate-css` | importé dans `app/heroui.css:8`, absent de `package.json`, présent seulement comme dépendance de `@heroui/styles` (DEP-01) | le déclarer en dépendance, à la version installée (1.4.0) |
| `@internationalized/date` | un seul import ; dépendance de pair de HeroUI | garder |
| `@eslint/eslintrc` | sert au mode de compatibilité de la configuration ESLint | garder |
| `@heroui/*` 3.2.6 → 3.2.7 | correctif | hors refonte ; lot de maintenance |
| `next` 15 → 16, `eslint` 9 → 10, `typescript` 5 → 7, `lucide-react` 0.x → 1.x | montées majeures | ne pas faire pendant la refonte (RISK-01) |

Aucun paquet inutilisé trouvé. Aucun script tiers. Aucune image (ni `next/image` ni `<img>`).

## 7. Tests

| Id | Constat | Priorité | Effort |
|---|---|---|---|
| TEST-01 | Aucun test unitaire ni de composant. Les fonctions pures (`humanError`, lecture d'URL de `*Nav.ts`, `labels.ts`, `kpi.ts`) ne sont testées qu'à travers le navigateur. `node --test` est déjà utilisé dans le dépôt (`tools/n8n`) : pas de dépendance à ajouter. | P2 | M |
| TEST-02 | `playwright.config.ts` n'a ni projet mobile ni thème sombre ; 11 fichiers règlent la taille d'écran à la main, 1 seul touche au thème. | P2 | S |
| TEST-03 | Chaque fichier de test redéfinit son API simulée et sa connexion (`mockApi`, `open`). | P3 | M |
| TEST-04 | Pas de capture de référence : une régression visuelle passe les 211 tests. | P2 | M |
| TEST-05 | Un seul parcours contre le vrai backend (`tests-api/console.spec.ts`). | P3 | — |

Acquis : 211 tests, audit axe dans 17 fichiers sur 18, tests sur le build de production en CI, vérification du
schéma d'API (`npm run api:check`).

## 8. Code à assainir

Chaque élément a été cherché dans `src`, `tests` et `tests-api` ; aucun import dynamique dans le projet.

**CLEAN-01 — Exports sans aucun usage** (une seule occurrence, leur définition) :

| Élément | Fichier |
|---|---|
| `Pager` | `components/ui.tsx:77` |
| `usePagination` | `components/ds/table.tsx:80` |
| `pageTitle` | `lib/labels.ts:233` |
| `PLATFORM_MARK` | `lib/labels.ts:277` |

`pageTitle` servira pour A11Y-03 (titre de document par écran) : à brancher plutôt qu'à supprimer.

**CLEAN-02 — Doublons** :

| Élément | Emplacements |
|---|---|
| `ROLE_LABELS` | `components/shell/AccountMenu.tsx:13`, `app/account/page.tsx:12` |
| initiales | `components/ds/layout.tsx:330`, `components/shell/AccountMenu.tsx:23`, `components/prospect/ProspectHeader.tsx:48` |
| nom affiché | `firstNameOf` (`AppShell.tsx:35`), `displayNameOf` (`AccountMenu.tsx:15`) |
| ton d'un statut de campagne | `STATUS_TONE` dans `CampaignsTable.tsx` et `app/campaigns/[id]/page.tsx` |
| pagination | `TablePagination` (utilisée) et `Pager` (morte) |

**CLEAN-03 — Exports utilisés seulement dans leur fichier** (à rendre privés) : `CONSENT_TONE`,
`APPOINTMENT_TONES`, `meetingLink`, `useConnectorStates`, `draftState`, `useThemePreference`, `resolveTheme`,
`NAV_GROUPS`, `THEME_KEY`, `campaignListReturnHref`, et les types `KpiItem`, `DataColumn`, `NavItem`,
`SectionProps`, `SkeletonShape`, `StatusFilter`, `OwnerFilter`, `CampaignTab`, `MetaFormDraft`, `Priority`.

**CLEAN-04 — Fichiers volumineux** (plus de 350 lignes) : `app/simulator/page.tsx` (523),
`components/settings/SettingsSections.tsx` (465), `components/conversations/ConversationDetail.tsx` (415),
`components/GuidedSimulation.tsx` (401), `app/page.tsx` (387), `components/EmailSettings.tsx` (386),
`components/todo/ReviewPanels.tsx` (385), `components/team/TeamPanels.tsx` (369),
`components/MetaLeadSettings.tsx` (354). À découper quand l'écran est refait, pas avant.

**CLEAN-05 — CSS** : `heroui.css` tient en 233 lignes, sans règle orpheline repérée. Une classe
`pipeline-card` est posée dans `ProspectPipeline.tsx:82` : à vérifier (aucune règle de ce nom dans
`heroui.css`).

Rien n'est à supprimer sans cette vérification : `lib/api/contract.ts` n'est importé nulle part, c'est
voulu (il n'agit qu'à la compilation).
