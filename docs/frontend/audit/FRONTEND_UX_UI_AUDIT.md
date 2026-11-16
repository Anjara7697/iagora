# Audit UX et UI — pages, parcours et orientations

Complète le [rapport général](FRONTEND_AUDIT.md). Source de chaque constat : **Rendu** (vu sur capture),
**Code** (lu, non vu), **Hypothèse**. Les captures viennent des tests sur API simulée (limites au §2 du
rapport général).

## 1. Ce que le produit demande à l'interface

Trois profils, trois usages :

| Profil | Fréquence | Besoin dominant | Écrans |
|---|---|---|---|
| Conseiller | toute la journée | décider vite, sans erreur, sur ce que l'agent a préparé | Aujourd'hui, À traiter, Conversations, Rendez-vous, fiche prospect |
| Administrateur | hebdomadaire | piloter et configurer | Campagnes, Tableau de bord, Analyses, Agent, Base de connaissances, Équipe, Intégrations, Paramètres |
| Observateur | ponctuelle | consulter | les mêmes écrans, en lecture |

Conséquence pour la conception : les écrans du conseiller se jugent au **nombre de gestes par décision** ;
ceux de l'administrateur à la **clarté de l'état** (ce qui est branché, actif, en erreur).

## 2. Parcours

| Parcours | Étapes actuelles | Friction | Constat |
|---|---|---|---|
| Arrivée | connexion → Prospects | l'écran d'accueil « Aujourd'hui » n'est pas l'écran d'arrivée (`app/login/page.tsx:26`) | NAV-01 |
| Traiter un brouillon | Aujourd'hui → « Traiter maintenant » → lire le contexte → **défiler** → valider → suivant automatique | défilement obligatoire à 900 px de haut ; souris seule | UX-01, UX-02 |
| Répondre à un prospect | Conversations → choisir → écrire → envoyer | quatre rangées de filtres avant la liste | UX-11 |
| Trouver un prospect | Ctrl K ou Prospects → recherche → fiche | une requête par caractère ; pipeline par défaut | DATA-01, UX-03 |
| Créer une campagne | Campagnes → Nouvelle campagne (3 étapes) → fiche | parcours clair ; non revu en détail | — |
| Modifier un élément | fiche → panneau latéral → enregistrer → toast | cohérent partout | — |
| Supprimer, désactiver | action → `ConfirmDialog` qui dit l'effet → toast | cohérent partout | — |
| Actions en masse | « Valider les N premiers contacts » seulement | aucune sélection multiple ailleurs | UX-12 |
| Session expirée | 401 → `/login` → Prospects | la page et la saisie d'origine sont perdues (`lib/api.ts:137`) | NAV-03 |

## 3. Constats par écran

### 3.1 À traiter (`/todo`)

**UX-01 — L'action de décision est sous la ligne de flottaison** · P1 · effort M · Rendu
- Fichiers : `components/todo/TodoDetail.tsx` (recommandation ligne 91, contexte ligne 129, brouillon ligne 178),
  `components/todo/DraftPanel.tsx:110` (bouton « Valider la réponse »).
- Preuve : à 1440 × 900, le bouton est à environ 940 px du haut. Avant lui : en-tête de page (100 px), en-tête
  du détail, message du prospect, bloc violet « Prochaine action recommandée », bloc « Sources, confiance et
  contexte » déplié, puis la réponse.
- Conséquence : chaque décision commence par un défilement ; le texte qui part chez le prospect, l'élément à
  relire, arrive en dernier.
- Solution : réponse proposée et actions en tête du détail ; message du prospect juste au-dessus ; sources,
  confiance et contexte dans une colonne latérale ou repliés par défaut. Voir §5.1.
- Dépendances : règle 21 (« les actions suivent le contenu ») respectée ; aucune fonction retirée.

**UX-02 — Aucun raccourci clavier dans la file** · P1 · effort M · Code
- Preuve : trois gestionnaires de touches dans tout `src` (palette, panneau latéral, un champ) ; aucun dans
  `components/todo/`.
- Conséquence : un conseiller qui traite vingt éléments fait vingt allers-retours à la souris.
- Solution : élément suivant et précédent, valider, modifier ; raccourcis affichés dans les infobulles des
  boutons et dans la palette ; inactifs pendant une saisie. Le passage à l'élément suivant après décision
  existe déjà.

Autres points (P3, Rendu) : quatre pastilles de type sur deux rangées pour deux éléments ; le sous-titre de page
répète le rôle de l'écran.

### 3.2 Aujourd'hui (`/`)

**UX-08 — Le nombre d'éléments à traiter est affiché quatre fois** · P2 · effort M · Rendu
- Preuve : barre du haut (« 5 à traiter »), badge du menu, sous-titre (« 5 éléments vous attendent »), quatre
  cartes « Vue rapide de la file » (`app/page.tsx:170`).
- Conséquence : la page répète au lieu d'orienter ; onze cartes pour un écran dont la question est « que
  faire maintenant ».
- Solution : garder la « Prochaine action » et une ligne de répartition par type (liens vers la file filtrée) ;
  retirer les quatre cartes. Voir §5.2.

**UX-09 — L'entonnoir double celui du Tableau de bord** · P2 · effort S · Rendu
- Fichier : `app/page.tsx:366`. Solution : lien « Voir le tableau de bord » ; l'entonnoir reste dans Pilotage.

**UX-05 — Rendez-vous tronqués en mobile** · P1 · effort S · Rendu
- Fichier : `app/page.tsx:215` (colonne d'heure à largeur fixe `w-28`, nom en `truncate`, bouton de visio non
  réductible).
- Preuve : à 390 px, le nom s'affiche « S… » et le statut « Plan ».
- Solution : en mobile, heure et nom sur une ligne, statut et visio dessous.

**UX-06 — Chiffres clés sur une colonne en mobile** · P2 · effort S · Rendu : quatre cartes pleine largeur avant
le premier contenu utile. Disparaît avec UX-08.

**UI-06 — Colonnes déséquilibrées** · P2 · Rendu : trois cartes à gauche, une à droite, grand vide sous
« Activité de l'agent ».

### 3.3 Conversations (`/conversations`)

**UX-11 — Quatre rangées de filtres au-dessus de la liste** · P2 · effort M · Rendu
- Fichier : `app/conversations/page.tsx:117-150` : recherche, statut (quatre pastilles), responsable (trois
  pastilles), canal (liste).
- Conséquence : environ 200 px avant la première conversation ; en mobile, la liste commence à mi-écran.
- Solution : recherche et statut visibles ; responsable et canal dans un menu « Filtres · N » avec puces
  retirables, comme sur Prospects (règle 5).

**UX-10 (cas de cet écran) — Deux titres** · Rendu : « Conversations » (h1) puis « Boîte de réception » (h2,
ligne 117), le sur-titre disant déjà « Boîte de réception » (ligne 90). Même schéma sur À traiter (« Votre file
de travail », `components/todo/TodoQueue.tsx:108`).

**UI-01 (cas de cet écran)** · Rendu : la zone de réponse est un grand bloc gris plein ; elle se lit comme une
zone désactivée.

### 3.4 Prospects (`/prospects`) et fiche (`/prospects/[id]`)

**UX-03 — Le pipeline est la vue par défaut, y compris en mobile** · P1 · effort S · Rendu + code
- Fichier : `lib/prospectResults.ts:29`. Preuve : à 390 px, une colonne visible et le bord de la suivante ; la
  page affiche elle-même « 1 prospect affiché sur 26… utilisez la vue Table ».
- Solution : Table par défaut sous 1024 px (le choix explicite dans l'adresse reste prioritaire).

**UX-14 — Un prospect par rattachement dans le pipeline** · P3 · Rendu : la même personne apparaît dans deux
colonnes. À décider avec le métier : c'est fidèle au modèle (un parcours par campagne) mais déroutant.

**UI-05 — Pastille « Accordé » étirée** · P2 · effort S · Rendu : dans une carte du pipeline, la pastille de
consentement prend la hauteur de deux lignes (`components/prospects/ProspectPipeline.tsx:115`, conteneur flex
sans alignement).

**UI-04 — Trop de pastilles** · P2 · Rendu : étape, score avec jauge, niveau, consentement, parfois « Fictif »,
toutes colorées, sur chaque carte et dans l'en-tête de fiche. La couleur ne hiérarchise plus rien.

**UI-03 — Onglets étirés** · P2 · effort S · Rendu : les quatre onglets de la fiche occupent 1 140 px
(`app/prospects/[id]/page.tsx:190`) ; même rendu sur la fiche campagne et la base de connaissances.

**UX-12 — Tableau sans tri ni sélection** · P2 · effort L · Code : aucune occurrence de `allowsSorting` ni de
`sortDescriptor` ; `selectionMode` n'est utilisé que hors tableaux. Le tri demande des paramètres d'API :
**à coordonner avec le backend**, sans changer le contrat existant.

### 3.5 Campagnes (`/campaigns`, `/campaigns/[id]`)

**UX-13 — Six campagnes par page** · P2 · effort S · Code (`app/campaigns/page.tsx:19`) : pagination dès la
septième ligne alors que l'écran en montre vingt.

**UX-04 — Tableau réduit à une colonne en mobile** · P1 · effort M · Rendu
- Fichiers : `components/CampaignsTable.tsx:34` (`minWidth={820}`), `components/prospects/ProspectTable.tsx:26`
  (720).
- Preuve : à 390 px, seule la colonne « Campagne » est visible ; le statut et les chiffres demandent un
  défilement horizontal que rien n'annonce (barre masquée).
- Solution : sous 640 px, une liste de lignes à deux niveaux (nom et statut, puis chiffres), même composant
  de données.

Chiffres clés (Rendu) : la couleur du chiffre porte un jugement (« 0 / 1 » en brun, « 42 % » en vert) sans
légende visible ; le mot n'existe que pour les lecteurs d'écran.

### 3.6 Intégrations (`/integrations`)

**UX-07 — Quatre boutons primaires** · P1 · effort S · Rendu
- Fichier : `app/integrations/page.tsx:245`. Preuve : « Configurer » en bleu plein sur quatre cartes.
- Conséquence : aucune action ne ressort ; la règle « une action principale par écran » n'est pas tenue.
- Solution : bouton neutre ; l'état (« Non branché ») porte l'information.

**UI-02 — Champ de recherche blanc** · P2 · Rendu : `SearchField` (ligne 167) rendu sur fond blanc, les autres
recherches en gris (`variant="secondary"`, 28 usages). En mobile, l'onglet « À configurer » passe sur deux
lignes et « Bientôt » est coupé.

### 3.7 Paramètres (`/settings`) et Simulateur

**UX-15 — La barre d'enregistrement recouvre le contenu** · P2 · effort S · Rendu
(`app/settings/page.tsx:268`) : elle passe sur l'aperçu d'email et sous le toast de confirmation.
Solution : barre dans le flux en bas de section, ou en-tête collant avec l'état « non enregistré ».

**NAV-02 — Le Simulateur surligne « Paramètres »** · P2 · effort S · Rendu + code
(`components/shell/AppNav.tsx:42`) : l'utilisateur est dans un outil de test et le menu dit « Paramètres ».
L'accès passe par Paramètres → Tests et démonstration → Simulateur, trois niveaux pour un outil que les
conseillers utilisent aussi. Solution : entrée de menu propre (« Tests »), visible selon le rôle et
l'environnement.

**FORM-01** : seize champs numériques en `type="number"`, détaillés dans la
[dette technique](FRONTEND_TECHNICAL_DEBT.md) §4.

### 3.8 Équipe, Base de connaissances, Tableau de bord, Analyses, Agent, Rendez-vous, Import, Compte

Vus sur capture pour Équipe, Tableau de bord et Base de connaissances ; non lus en détail pour les autres.

- Équipe (Rendu) : le libellé « Rechercher un membre » est visible alors que les autres recherches n'en ont
  pas ; les lignes sont des cartes blanches posées dans un conteneur gris (deux niveaux de surface pour un
  tableau).
- Compte (Code) : titre de page, en-tête et alerte écrits à la main au lieu de `PageHeader` et `Notice`
  (`app/account/page.tsx`).
- Aucun défaut P1 relevé sur ces écrans ; ils suivront les conventions communes du lot 2.

## 4. Constats transverses

**UX-10 — En-têtes d'écran** · P2 · effort S · Rendu
- `PageHeader` (`components/ds/layout.tsx`) : sur-titre en capitales, titre de 28 px, sous-titre d'une à deux
  lignes ; environ 100 px par écran.
- Le sur-titre répète le groupe du menu (« Travail · … ») ; le sous-titre explique l'écran à un utilisateur qui
  y vient dix fois par jour.
- Solution : titre de 20 px, compteur ou état à côté, actions à droite, sur une seule ligne ; sous-titre réservé
  aux états vides.

**UI-01 — Champs et pastilles sans bordure** · P2 · effort M · Rendu : champs, listes et pastilles de filtre sont
des aplats gris sur fond gris clair. Un champ vide, une pastille non choisie et une zone désactivée se
ressemblent. Solution au [design system](DESIGN_SYSTEM.md) §5.

**UI-06 — Cartes** · P2 · Rendu : chaque bloc est une carte blanche ombrée sur fond gris, parfois avec un bloc
gris à l'intérieur (fiche prospect, « Consentement »). Réserver la carte aux objets (un prospect, un
connecteur) ; les sections d'une page se séparent par un titre et un filet.

**NAV-04 — Retours** · P3 · Code : trois écritures du lien de retour (`TextLink` « ← Campagnes », `backLinkClass`
sur la fiche prospect, bouton fantôme en mobile). Solution : un composant `BackLink`, ou `Breadcrumbs` HeroUI.

**Tableaux et listes** : synthèse des écarts au modèle cible.

| Écran | Recherche | Filtres | Tri | Sélection | Pagination | Mobile |
|---|---|---|---|---|---|---|
| Prospects | oui, sans délai | panneau + puces | non | non | serveur, 25 | pipeline par défaut |
| Campagnes | non | pastilles | non | non | serveur, 6 | une colonne |
| Conversations | oui, sans délai | quatre rangées | — | non | serveur, 30 | liste ou détail |
| Équipe | oui | pastilles | non | non | — | non vu |
| Base de connaissances | oui | onglets | non | non | — | non vu |

## 5. Orientations de conception proposées

À valider avant toute implémentation (phase 3). Chaque orientation garde toutes les fonctions existantes.

### 5.1 À traiter : décider sans défiler

| | |
|---|---|
| Organisation actuelle | file à gauche ; à droite, empilés : message, recommandation, contexte, réponse, actions |
| Problèmes | UX-01, UX-02 |
| Organisation proposée | trois zones : file, décision, contexte |
| Composants HeroUI | `Tabs`, `Button`, `Tooltip` avec `Kbd`, `Disclosure`, `ScrollShadow`, `AlertDialog` (inchangé) |
| Conséquences techniques | réordonner `TodoDetail` ; un hook `useShortcuts` ; aucune API touchée |
| Risques | 21 tests dans `todo.spec.ts` à adapter ; largeur sous 1280 px (contexte replié sous la réponse) |

```
┌ File (320) ───────┬ Décision ────────────────────────────┬ Contexte (300) ────┐
│ À traiter · 2     │ Marie Dupont · Brouillon · Élevée    │ Recommandation     │
│ [Tout][Brouillons]│ « Je ne sais pas si je peux financer »│ Risque : faible    │
│ ▸ Marie Dupont    │ ┌ Réponse proposée — Email ─────────┐│ Sources            │
│   Ahmed Belkacem  │ │ Bonjour Marie, le financement…    ││  Financement v3    │
│                   │ └───────────────────────────────────┘│ Confiance 91 %     │
│                   │ [Valider ⏎] [Modifier E] [Régénérer] │ Étape · Score      │
│                   │ [Refuser]            Voir l'échange →│ Ouvrir la fiche →  │
└───────────────────┴──────────────────────────────────────┴────────────────────┘
```

### 5.2 Aujourd'hui : une page d'orientation

| | |
|---|---|
| Organisation actuelle | alerte, prochaine action, quatre chiffres, puis cinq cartes sur deux colonnes |
| Problèmes | UX-05, UX-06, UX-08, UX-09, UI-06 |
| Organisation proposée | prochaine action ; répartition de la file en une ligne ; deux listes (rendez-vous du jour, prospects à fort signal) ; activité de l'agent en une ligne de chiffres ; relances en liste repliée |
| Composants HeroUI | `Alert`, `Button`, `Chip`, `Disclosure` |
| Conséquences techniques | mêmes appels, un de moins (voir DATA-02) |
| Risques | 6 tests dans `today.spec.ts` ; règle 27 à réécrire |

```
Bonjour Nadia                                              5 à traiter
┌ Relire une réponse · Marie Martin · priorité élevée   [Traiter maintenant] ┐
└ 2 validations · 1 escalade · 1 question sans réponse · 1 incident          ┘
Rendez-vous du jour            │ Prospects à fort signal
13:00 Sophie Merlin  Planifié  │ Sophie Merlin · Qualifié · 88
Agent, 24 h : 24 analysés · 3 brouillons · 2 envoyés · 1 escalade · 1 erreur
▸ Relances programmées (3)                         Voir le tableau de bord →
```

### 5.3 Un modèle de liste unique

| | |
|---|---|
| Organisation actuelle | cinq variantes (tableau du §4) |
| Problèmes | UX-03, UX-04, UX-11, UX-12, UX-13, DATA-01, PERF-05 |
| Organisation proposée | une barre : recherche (délai de 250 ms), un filtre de périmètre, « Filtres · N », compteur ; un tableau dense (lignes de 44 px, en-têtes triables quand l'API le permet) ; sous 640 px, des lignes à deux niveaux ; pagination « précédent, 1 … 4 5 6 … 12, suivant » |
| Composants HeroUI | `Table` (tri et sélection natifs), `SearchField`, `Dropdown` ou `Popover` de filtres, `TagGroup` pour les filtres actifs, `Pagination` |
| Conséquences techniques | `DataTable` enrichi ; un composant `ListToolbar` ; tri côté serveur à demander au backend |
| Risques | tests des cinq écrans ; règles 4, 5 et 20 |

### 5.4 Pastilles : un état, une couleur

Trois familles seulement : **statut** (pastille douce, une couleur sémantique), **mesure** (score en texte et
jauge, sans fond), **marque** (« Fictif », contour). Dans une liste, deux éléments au plus par ligne ; le reste
va dans la fiche. Détail au [design system](DESIGN_SYSTEM.md) §6.

### 5.5 Navigation

- Connexion → Aujourd'hui ; session expirée → retour à la page d'origine (adresse interne reconstruite, règle 6).
- Entrée « Tests » dans le menu pour le Simulateur.
- Titre de document par écran.
- Menu : groupes conservés ; libellés de groupe en casse normale.

## 6. Règles des parcours touchées

`AGENTS.md` demande une décision du responsable du projet pour chaque écart. Les orientations ci-dessus
modifient :

| Règle | Contenu actuel | Changement proposé |
|---|---|---|
| 4 | tableau posé sur la page, toute la ligne ouvre l'élément | inchangée sur bureau ; lignes à deux niveaux en mobile |
| 5 | recherche et filtres à gauche, compteur à droite | étendue à Conversations et Campagnes |
| 8 | champs `secondary` sur la page, `primary` dans un panneau | une seule apparence, à bordure |
| 9 | cascade `reveal` sur chaque écran | limitée au premier chargement d'une page, jamais aux lignes |
| 20 | maître-détail à deux zones | trois zones sur À traiter |
| 26 | agenda par jour | inchangée |
| 27 | contenu d'Aujourd'hui | réécrite selon §5.2 |
| 28 | Tableau de bord | devient le seul écran qui porte l'entonnoir |
| 33 | catalogue de cartes pour Intégrations | conservé ; boutons neutres |

Les règles 11 à 19, 21 à 25 et 29 à 35 ne sont pas modifiées.
