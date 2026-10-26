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
| Knowledge Base | `/knowledge` | `app/knowledge/page.tsx` | Fait : action d’ajout alignée, réglages techniques repliés, recherche des documents, filtre des documents communs et accès direct aux demandes à compléter |
| Intégrations | `/integrations` | `app/integrations/page.tsx` | Fait : libellés au-dessus des champs, serveurs IMAP/SMTP regroupés, états de test et modifications non enregistrées distingués |
| Paramètres | `/settings` | `app/settings/page.tsx` | Conforme |
| Équipe | `/team` | `app/team/page.tsx` | Conforme |
| Mon compte | `/account` | `app/account/page.tsx` | Conforme |
| Simulateur | `/simulator` | `app/simulator/page.tsx` | Fait : accès via Paramètres → Tests et démonstration, indicateur persistant, contexte des réglages partagés explicite |
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

## 9. Base de connaissances : documents et contrôle des réponses

La liste et la recherche des documents restent au premier plan. Le modèle, le
seuil et le nombre d’extraits par défaut sont consultables dans les réglages
techniques repliés. Les erreurs de configuration et les documents à actualiser
restent visibles ; l’ajout et l’édition sont indisponibles si le service nécessaire
n’est pas configuré. Les rôles de lecture et les confirmations de suppression
sont conservés.

Le filtre « Documents communs » distingue les documents sans programme de la vue
« Toutes ». Une recherche par titre ou identifiant et une remise à zéro explicite
couvrent le cas où aucun document ne correspond aux critères. Le tableau conserve
son défilement propre sur mobile. Le lien des questions sans source ouvre la file
filtrée `kind=kb_gap`. Dans le test d’une question, changer de question ou de
programme efface les résultats précédents pour éviter de leur attribuer le mauvais
contexte. Aucun chiffre de la maquette n’est ajouté aux données réelles.

## 10. Intégrations : paramètres et état vérifié de la messagerie

Les formulaires présentent les libellés au-dessus des champs. Les serveurs IMAP
et SMTP sont regroupés dans un encart avancé, avec des colonnes régulières pour
l’hôte et le port sur bureau et une seule colonne sur mobile. Les actions sur la
boîte enregistrée restent en tête de carte, y compris sur mobile.

La présence d’identifiants n’est plus présentée comme une connexion vérifiée :
« À tester », « Test réussi » et « Test échoué » correspondent aux résultats
réellement obtenus pendant la consultation. Une erreur de relève signalée par
l’API reste affichée séparément. Après enregistrement des paramètres, le résultat
du test de l’ancienne boîte est effacé.

Les modifications du formulaire sont signalées comme non enregistrées. Changer
un paramètre de connexion ou le mot de passe retire les résultats précédents ;
les opérations de la boîte et du formulaire se verrouillent mutuellement pendant
leur exécution. Les erreurs de chargement proposent une nouvelle tentative. La
confirmation avant un passage pouvant envoyer des emails réels est conservée.
Les vérifications de présentation utilisent une API simulée et ne constituent
pas une recette de connexion à une boîte réelle.

## 11. Placement du simulateur

Le menu principal et l’accueil ne proposent plus de raccourci dédié au simulateur.
Les administrateurs et les conseillers autorisés passent par **Paramètres → Tests
et démonstration** (`/settings/testing`). Les conseillers ne chargent pas les
réglages d’administration. Les observateurs restent exclus des outils de test.
La désactivation par le drapeau existant est conservée et couvre les liens comme
les URL directes. Le lien contextuel dans les réglages de l’agent utilise les
valeurs enregistrées ; les modifications en cours doivent d’abord être sauvegardées.

Le parcours libre et le parcours guidé partagent le même rappel « Environnement
de test — données fictives ». Un indicateur demeure dans l’en-tête pendant le
défilement. Les réglages et le mode de l’agent restent ceux de l’application ;
la création de données fictives exige toujours une action explicite. La route
`/simulator` et les mécanismes métier existants sont conservés.

## 12. Examiner une demande et consulter la fiche prospect

Dans « À traiter », la recommandation, ses sources, la confiance et le risque
précèdent le brouillon et ses boutons de décision. Sur mobile, la lecture et la
décision suivent le même ordre vertical ; le retour explicite à la liste reste
accessible. Les règles de validation, refus et régénération sont conservées.

Le lien « Ouvrir la fiche ↗ » annonce une ouverture dans un nouvel onglet pour
conserver une correction de brouillon en cours dans la demande. La fiche propose
« Revenir à la demande », avec l’identifiant de la tâche et le filtre d’origine
dans l’URL. Ce retour reste disponible après actualisation ; une fiche consultée
depuis la liste habituelle conserve son entrée « Tous les prospects ».
La consultation seule ne demande ni envoi ni traitement par l’agent et ne change
pas les droits de l’observateur.

## 13. Transitions et défilement

Les interactions utilisent des transitions courtes (140 ms), l’apparition des
panneaux un fondu (200 ms), et le menu mobile un coulissement accompagné du voile
(240 ms), à l’ouverture comme à la fermeture. Le contenu de lecture ne se déplace
pas. Le menu du compte apparaît avec un léger décalage de 4 px. La préférence
système de réduction des animations désactive ces effets.

À la souris, les barres natives utilisent une piste transparente et une poignée
fine et arrondie dans Chromium/Safari, plus marquée au survol. Firefox bénéficie
de la présentation fine standard. Les écrans tactiles conservent le comportement
natif ; le mode de contraste forcé rétablit la présentation système.

## 14. Retrouver le résultat d’une décision

La confirmation après validation ou refus nomme le prospect et donne accès à la
décision exacte dans « Traités ». Elle reçoit le focus et revient à l’écran après
l’action, y compris sur mobile. La régénération conserve une confirmation séparée
sans lien vers une décision qui n’existe pas encore.

La fiche traitée distingue la validation de l’envoi : prête à envoyer, en cours,
envoyée, en échec, bloquée ou refusée. Chaque état est expliqué et peut être
actualisé explicitement. La nouvelle tentative reste réservée aux conseillers et
administrateurs, pour un message validé dont l’envoi est bloqué ou en échec. Son
acceptation est signalée sans annoncer un envoi confirmé ; une erreur reste
visible et ne produit aucune confirmation de réussite.

Un lien direct vers une décision absente des dernières 24 heures propose
l’actualisation et les conversations. Une erreur de chargement présente une
nouvelle tentative, sans conclure que la décision a disparu. Les états présentés
proviennent de l’API existante, sans interrogation périodique ni modification du
mécanisme d’envoi.

## 15. Reprendre une conversation transférée

La fiche de transfert regroupe le motif, le résumé, la question en attente et
l’action recommandée. Son bouton « Rédiger une réponse » donne le focus au champ
de rédaction et le ramène à l’écran, même après un long historique, sans ajouter
ni envoyer de texte. Il n’est pas proposé à l’observateur, au prospect désinscrit
ou dans une conversation clôturée.

L’envoi de la réponse reste l’action principale. La prise ou restitution de la
main, la relance de l’agent et la clôture sont regroupées dans « Gestion de la
conversation ». La confirmation de clôture est conservée. Chaque opération a
son retour explicite ; la confirmation d’enregistrement d’une réponse ne prétend
pas confirmer sa livraison. En cas d’échec, le texte reste dans le champ.

Le chargement du consentement et ses erreurs deviennent visibles avec une
nouvelle tentative. La réponse reste désactivée tant que les données nécessaires
ne sont pas disponibles. Les rôles et les mécanismes d’envoi existants restent
inchangés.

Le résumé de la conversation sélectionnée est aussi chargé indépendamment de la
liste filtrée. Après restitution de la main à l’agent, la conversation peut quitter
« En attente » sans faire disparaître sa fiche ni la confirmation de l’action.

## 16. Réponses en cours et compteurs cohérents

Les réponses non envoyées sont conservées en mémoire par conversation pendant la
navigation dans l’application. Changer de conversation ou consulter une autre
page ne supprime plus la saisie. L’enregistrement réussi efface uniquement la
réponse concernée ; un échec conserve le texte. Un bouton permet de l’effacer avec
confirmation. Le navigateur est averti des saisies en cours avant actualisation
ou fermeture, et une déconnexion demande confirmation avant leur suppression.

Ces textes ne sont stockés ni sur le serveur ni dans le stockage persistant du
navigateur. Ils ne survivent pas à une actualisation confirmée ou à la fin de la
session. Ils sont isolés par utilisateur connecté et ne sont pas restaurés après
reconnexion.

Après une décision dans « À traiter » ou une action sur une conversation, les
compteurs du menu et de l’en-tête sont relus depuis l’API. Les vues de la file et
les compteurs de l’accueil se rechargent aussi lorsqu’ils sont montés. Un échec
d’opération ne déclenche pas de décrément optimiste. Une ancienne réponse réseau
ne peut pas écraser une valeur plus récente dans l’en-tête.

## 17. Lire et répondre sur mobile

Dans « À traiter », la demande précède une recommandation compacte puis la
réponse proposée. L’action recommandée, sa justification, le risque et l’absence
éventuelle de sources restent visibles. « Sources, confiance et contexte »
regroupe les éléments détaillés et les indicateurs commerciaux ; ce volet se
manipule au clavier comme au toucher. La priorité de traitement reste dans
l’en-tête et se distingue du score commercial.

Dans Conversations, l’en-tête privilégie l’identité, le statut et le canal. Le
transfert présente la question à reprendre, l’action recommandée et l’accès à
la rédaction. Sans question enregistrée, son résumé reste visible. Le résumé
complémentaire, le responsable, la campagne, les scores et les règles d’envoi
restent accessibles dans « Contexte et règles d’envoi ».

Une désinscription apparaît avant le transfert et le fil ; les erreurs de
chargement et les brouillons à valider restent hors des volets repliables. Les
contrôles de consentement, les droits et les actions d’envoi ne changent pas.
