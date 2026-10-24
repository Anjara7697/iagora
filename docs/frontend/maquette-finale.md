# Maquette finale de la console et guide d’intégration

Ce document accompagne la page **« Maquette finale »** du dossier interface
(artefact Claude « IAGORA — Dossier interface »). Il est écrit pour qu’une
personne ou un autre assistant de code puisse terminer l’intégration **sans
contexte préalable**. Il décrit l’état visé, ce qui est déjà dans le code, et ce
qu’il reste à faire écran par écran.

État au 24 octobre 2026, branche `feat/ui-audit-lots-a-e` (créée depuis `dev`).

## 1. Règles à respecter

Elles viennent de `AGENTS.md` et ne se discutent pas :

- Ne jamais committer sur `dev` ni `main` : une branche par sujet, créée depuis
  `dev` à jour, puis une Pull Request vers `dev`. **Ne jamais merger ni déployer.**
- Avant toute PR, dans `frontend/` : `npm run lint && npm run typecheck && npm run build`,
  puis `npx playwright test` (Chromium : variable
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` si besoin).
- Backend modifié : `ruff check .`, `ruff format --check .`, `mypy`, `pytest` dans `backend/`.
- Aucun secret dans Git, le code ou les journaux.
- L’interface n’invente aucune donnée : chaque chiffre affiché vient de l’API.
  Les chiffres de la maquette sont **fictifs** et servent seulement à montrer la mise en page.
- L’API reste l’autorité pour les droits (`ADMIN`, `ADVISOR`, `VIEWER`) : masquer
  un bouton ne remplace jamais un contrôle côté serveur.

## 2. Système visuel

Tout est dans `frontend/src/app/globals.css`. Le bloc `:root` en tête de fichier
est **la seule source des couleurs** : n’ajoutez pas de code hexadécimal dans
les règles, utilisez une variable (ou ajoutez-en une dans `:root`).

| Rôle | Variables |
|---|---|
| Texte | `--fg` (encre), `--ink-2` (texte secondaire), `--muted` (légendes), `--faint` |
| Fonds | `--bg` (page), `--card` (cartes), `--surface-1/2/3` (du plus clair au plus foncé) |
| Bordures | `--line` (fine), `--line-strong` (champs, boutons) |
| Action | `--accent`, `--accent-hover`, `--accent-bg`, `--accent-line` |
| Identité | `--violet`, `--violet-bg`, `--violet-soft`, `--violet-line`, `--violet-strong` (avatar, recommandations de l’agent) |
| États | `--ok*`, `--warn*`, `--err*` (chaque famille : texte, `-bg`, `-line`) |
| Intérêt | `--level-cold*`, `--level-warm*`, `--level-hot*`, `--level-very-hot*`, et `--level-*-bar` pour les barres |

Règles de sens :

- **Le rouge (`--err`) est réservé** à ce qui bloque ou interdit : désinscription,
  erreur, incident, arrêt d’urgence, suppression. Jamais pour « très chaud ».
- Les niveaux d’intérêt vont du bleu-gris (froid) à l’orange plein (très chaud) :
  classes `badge level-cold|warm|hot|very_hot`, barres `bar bar-level-…`.
- Le violet signale ce qui vient de l’agent (recommandation, lacune de la base).

Typographie : Instrument Sans (texte), IBM Plex Mono (chiffres, libellés en
capitales, identifiants), servies localement depuis `public/fonts`.

Composants et classes à réutiliser :

| Besoin | Classe ou composant |
|---|---|
| En-tête de page | `.page-heading` > `.eyebrow` (« Travail · … ») + `h1` + `p.muted`, actions à droite |
| Carte | `.card` (padding 20 px, rayon 10 px) |
| Chiffres clés | `.kpis.kpis-wide` > `.kpi` |
| Barres de répartition | `.bar-row` > `span` + `.bar > div` + `.mono` |
| Bouton principal | `button.primary`, lien `a.button-link.primary-link` |
| Bouton danger | `button.danger` (fond rouge pâle, texte rouge) |
| Choix exclusif sur une ligne | `.segmented` (voir `Chips segmented` dans `conversations/page.tsx`) |
| Bascules non exclusives | `.chips` |
| Vue Pipeline / Table | `.view-switch` |
| Filtres repliables | `.filters` + `.filters-more` + `.filters-advanced` + `.filters-chips` (voir `prospects/page.tsx`) |
| Tableau large | l’envelopper dans `div.table-scroll` (`role="region"`, `tabIndex={0}`, `aria-label`) |
| États | `Loading`, `Pager`, `StageBadge`, `ScoreBadge`, `DemoBadge` dans `components/ui.tsx` |
| Formulaires de réglages | `Section`, `Field`, `Toggle`, `Feedback` dans `components/forms.tsx` |
| Erreurs | `ApiError.message` est déjà lisible (voir `humanError` dans `lib/api.ts`) |

Mobile (moins de 720 px) : cibles tactiles d’au moins 44 px (déjà en CSS),
aucun défilement horizontal de la page, tableaux dans un cadre défilant, en-tête
sur une seule ligne (menu ☰, titre, « à traiter », avatar).

## 3. Cadre commun (fait)

- Menu en quatre groupes (`components/AppShell.tsx`, `NAV_GROUPS`). Les écrans
  pas encore codés ont `soon: true` et apparaissent dans la ligne repliée
  « À venir ». **Quand un écran est codé**, remplacer `soon: true` par son `href` :
  il quitte automatiquement « À venir ».
- Menu du compte sur l’avatar (nom, rôle, Mon compte, Déconnexion).
- Salutation au prénom (`firstNameOf`) ; carte de l’agent et bouton « Arrêt d’urgence ».

## 4. État de chaque écran

| Écran | Route | Fichier | État |
|---|---|---|---|
| Aujourd’hui | `/` | `app/page.tsx` | Fait : grille en 3 colonnes |
| À traiter | `/todo` | `app/todo/page.tsx` | Ajusté : contexte et brouillon accessibles plus tôt, actions de décision conservées, compteur dans la file ; couleurs partagées avec la console |
| Conversations | `/conversations` | `app/conversations/page.tsx` | Fait : filtres compacts |
| Prospects | `/prospects` | `app/prospects/page.tsx` | Fait : filtres repliés, pipeline par 100 avec repères de défilement |
| Fiche prospect | `/prospects/[id]` | `app/prospects/[id]/page.tsx` | Fait : recommandation vide masquée, en-tête mobile |
| Import CSV | `/prospects/import` | `app/prospects/import/page.tsx` | Conforme |
| Campagnes | `/campaigns` | `app/campaigns/page.tsx` | Conforme |
| Fiche campagne | `/campaigns/[id]` | `app/campaigns/[id]/page.tsx` | Fait : chiffres d’abord, réglages en bas |
| Nouvelle campagne | `/campaigns/new` | `app/campaigns/new/page.tsx` | Conforme |
| Knowledge Base | `/knowledge` | `app/knowledge/page.tsx` | **Reste** : action « Ajouter un document » alignée à droite comme les autres pages ; modèle d’embedding et seuil dans un encart « Réglages techniques » replié |
| Intégrations | `/integrations` | `app/integrations/page.tsx` | **Reste** : libellés toujours au-dessus des champs, grille régulière (ports, sécurité SMTP) |
| Paramètres | `/settings` | `app/settings/page.tsx` | Conforme |
| Équipe | `/team` | `app/team/page.tsx` | Conforme |
| Mon compte | `/account` | `app/account/page.tsx` | Conforme |
| Simulateur | `/simulator` | `app/simulator/page.tsx` | **Reste** : bandeau d’avertissement en texte foncé (`--ink-2`) sur `--warn-bg`, plus compact |
| Connexion | `/login` | `app/login/page.tsx` | Conforme |
| Rendez-vous | `/appointments` | à créer | **À créer** (section 5.1) |
| Dashboard | `/dashboard` | à créer | **À créer** (section 5.2) |
| Analytics | `/analytics` | à créer | **À créer** (section 5.3) |
| Agent | `/agent` | à créer | **À créer** (section 5.4) |

Pour chaque nouvel écran, ajouter aussi son titre et sous-titre dans
`pageTitle` / `pageSubtitle` (`lib/labels.ts`), sinon l’en-tête affiche un titre générique.

## 5. Écrans à créer

Les quatre écrans existent dans la maquette finale (planches « Rendez-vous »,
« Dashboard », « Analytics », « Agent »). Chaque écran a besoin de données que
l’API ne fournit pas encore toutes : **commencer par l’API**, avec ses tests
`pytest`, puis l’écran, puis ses tests Playwright (API simulée, comme dans
`frontend/tests/*.spec.ts`).

### 5.1 Rendez-vous (`/appointments`, groupe Travail)

Contenu : deux tableaux « À venir » et « Passés » ; colonnes Prospect (lien vers
la fiche), Programme, Date (et créneaux proposés quand le statut est « Proposé »),
Conseiller, Lien visio, Statut. Filtres : période (segmenté), statut (segmenté),
conseiller (liste). Un conseiller voit d’abord ses rendez-vous.

Données : le modèle `Appointment` existe (`backend/app/models/appointment.py` :
prospect, conseiller, `start_at`, `end_at`, `status`, `meeting_url`). Statuts :
`proposed`, `scheduled`, `done`, `cancelled`, `no_show`, à traduire « Proposé,
Planifié, Réalisé, Annulé, Absent » dans `lib/labels.ts`. Couleurs : Proposé
`warn`, Planifié `accent`, Réalisé `ok`, Annulé neutre, Absent `err`.

API à créer : `GET /appointments?when=upcoming|past&status=&advisor_id=&limit=&offset=`
→ `Page[AppointmentRead]` avec le nom du prospect, du conseiller et de la campagne.
Lecture pour tous les rôles ; aucune action d’écriture dans cette première version.

### 5.2 Dashboard (`/dashboard`, groupe Pilotage)

Contenu : période (7, 30, 90 jours), export CSV, 4 chiffres clés (leads reçus,
qualifiés par l’agent, rendez-vous planifiés, inscrits), bandeau d’incident si
une source n’apporte plus de leads, puis trois colonnes : entonnoir (avec % de
l’étape précédente), répartition par programme, répartition par source.

Données : `GET /dashboard/summary` fournit déjà l’entonnoir sur 30 jours
(`funnel`, `leads`) ; les incidents viennent de `GET /todo?kind=incident`.
API à créer ou étendre : paramètre `days`, répartitions par programme
(`target_code`) et par source (`source_id`), nombre d’inscrits (étape `converted`).
Les totaux par programme et par source doivent être égaux au total de l’entonnoir.

### 5.3 Analytics (`/analytics`, groupe Pilotage)

Contenu : période ; 4 indicateurs (délai médian de première réponse, confiance
moyenne des brouillons, couverture de la Knowledge Base, escalades utiles) ;
devenir des brouillons (générés, validés sans modification, validés après
modification, refusés) ; motifs de refus ; conversion par étape.

Données : les brouillons ont un statut (`pending`, `approved`, `rejected` avec
motif, `superseded`) et une `confidence` (voir `backend/app/services/drafts.py`,
`schemas/todo.py`). **À vérifier avant de coder** : la distinction « validé avec ou
sans modification » et les motifs de modification ne sont peut-être pas enregistrés.
Si une donnée manque, afficher la carte en pointillé « Pas encore mesuré »
(comme « Escalades utiles » dans la maquette) plutôt qu’un chiffre inventé.
API à créer : `GET /analytics?days=`.

### 5.4 Agent (`/agent`, groupe Intelligence)

Contenu : état actuel et « Arrêt d’urgence » ; mode de fonctionnement (Assisté,
Manuel, Automatique) ; ce que l’agent fait (lecture seule, avec lien vers
Paramètres › Agent et relances) ; activité sur 7 jours ; état des intégrations.

Données existantes : `GET/PUT /agent/mode` (déjà utilisé par
`components/AgentModeCard.tsx` : réutiliser sa logique et ses confirmations),
`GET /dashboard/summary` (`activity`, tous les rôles), `GET /integrations/email`
et `GET /settings` (**administrateur seulement** : pour un conseiller ou un
observateur, masquer l’état des intégrations au lieu d’afficher une erreur).
Le mode Automatique reste réservé à l’administrateur et désactivé par défaut. Ne pas dupliquer les réglages de Paramètres : lien vers eux.

## 6. Méthode conseillée

1. Partir de `dev` à jour (ou de `feat/ui-audit-lots-a-e` si elle n’est pas encore mergée).
2. Une branche et une PR par écran à créer (`feat/console-appointments`, etc.).
3. API d’abord, avec tests ; puis écran ; puis entrée de menu (`soon` → `href`).
4. Vérifier sur bureau (1440 px) et mobile (390 px) : aucune barre de défilement
   horizontale sur la page, toutes les données viennent de l’API, états
   chargement / vide / erreur présents.
5. Lint, typecheck, build, Playwright ; captures avant/après dans la PR.

## 7. Dette connue

- 22 couleurs encore écrites en dur dans `globals.css` (surtout du blanc sur
  bouton plein et quelques teintes uniques) : à remplacer au fil de l’eau.
- `globals.css` garde la trace des étapes successives (sections « Alignement
  maquette », « Réglages »…). Ne pas ajouter de troisième couche : modifier la
  règle existante.
- Les tests Playwright tournent sur bureau ; quelques scénarios ne sont pas
  prévus pour 390 px (liste des campagnes, pagination des prospects).

## 8. Ajustement du parcours de validation après comparaison visuelle

Référence complémentaire : export utilisateur `IAGORA — Dossier interface.html`
(28 planches, dont les vues mobiles). Cette référence guide la comparaison ; les
améliorations d’usage déjà retenues ne sont pas annulées pour reproduire une capture.

Sur « À traiter », le grand bandeau d’introduction a été remplacé par un titre de
page accessible et un compteur dans l’en-tête de la file. Le contexte, le brouillon
et ses actions prennent moins de place. Le bouton « Valider la réponse », l’édition,
le refus motivé, la régénération et la confirmation après décision sont conservés.
Les états de validation et de conversation utilisent les couleurs de `:root`.

Contrôle visuel avec les mêmes données fictives avant/après : le début du brouillon
passe d’environ 526 px à 312 px sur un écran de 1440 px de large. Sur le scénario
court des tests, la validation est visible sans défilement sur bureau et sur mobile
(390 × 844). Les longs messages restent naturellement défilants, sans troncature.
L’accueil et la conversation ont été comparés et conservés : aucune donnée statique
de la maquette n’est intégrée à l’application.
