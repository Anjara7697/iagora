# Design system — état et conventions proposées

Complète le [rapport général](FRONTEND_AUDIT.md). Ce document est une **proposition** : il ne remplace
`docs/frontend/heroui.md` qu'après validation, règle par règle.

## 1. Ce qui existe et se garde

- Un seul fichier de thème, `frontend/src/app/heroui.css` : jetons clairs et sombres, polices auto-hébergées,
  couleurs métier (`agent`, `level-*`), marque.
- Une couche `components/ds/` au-dessus de HeroUI 3.2.6.
- Aucune classe `dark:` dans le code : le thème sombre passe entièrement par les jetons.
- Deux couleurs écrites en dur seulement, les marques LinkedIn et Meta (`ds/SourceAvatars.tsx:26-27`),
  légitimes.

## 2. Écarts mesurés

| Id | Écart | Preuve (code) | Conséquence |
|---|---|---|---|
| UI-07 | Tailles de texte en pixels hors échelle | 91 `text-[13px]`, 37 avec interligne, puis 11, 12, 12,5, 13,5, 15, 22, 26, 28 et 44 px | sept tailles voisines entre 11 et 15 px, sans rôle défini |
| UI-08 | Rayons | `rounded-lg` 64, `rounded-xl` 37, `rounded-2xl` 9, `rounded-md` 9, `rounded-sm` 3, alors que la règle 7 fixe `lg` | cartes, squelettes et panneaux à des rayons différents (`ui.tsx`, `ds/settings.tsx`, `AppShell.tsx`, `GuidedSimulation.tsx`) |
| UI-01 | Champs sans bordure | choix du thème (« pas de bordure ajoutée ») | champ vide, pastille et zone désactivée se confondent (rendu) |
| UI-02 | Deux apparences de champ | 28 `variant="secondary"` ; `SearchField` blanc sur Intégrations | incohérence visible |
| UI-09 | Ombres et bordures | 78 `border-border` ou `border-separator` dans 40 fichiers ; cartes ombrées | bordure et ombre se cumulent sur certaines surfaces |
| UI-10 | Animation d'entrée sur chaque bloc et chaque ligne | `reveal(rang)` jusqu'à 12 × 55 ms, 400 ms de durée (`ds/motion.tsx`) | jusqu'à une seconde avant que le dernier bloc soit lisible, à chaque visite |
| UI-11 | Composants HeroUI disponibles et non utilisés | `Form`, `TextField`, `FieldError`, `Fieldset`, `NumberField`, `RadioGroup`, `ComboBox`, `Breadcrumbs`, `EmptyState`, `TagGroup`, `InputGroup`, `Toolbar`, `Surface`, `Badge` | composants maison là où une solution native existe (`Field`, `EmptyPanel`, champs numériques) |

## 3. Couleurs

Jetons actuels conservés. Rôles à écrire noir sur blanc :

| Jeton | Rôle | Interdit |
|---|---|---|
| `--accent` | action principale, lien, élément choisi | décoration, icône de section |
| `--success`, `--warning`, `--danger` | état d'un objet ou d'un système | colorer un chiffre sans légende visible |
| `--agent` | ce que l'agent a produit ou recommande | fond de grands panneaux |
| `--level-*` | niveau d'intérêt | autre usage |
| `--muted` | texte secondaire | texte porteur d'information unique |
| `--surface`, `--surface-secondary`, `--background` | trois niveaux de surface au plus sur un écran | carte dans une carte |

Changements proposés :

1. Un chiffre clé reste en `--foreground` ; le jugement (« En cours », « À lancer ») s'affiche en pastille à
   côté, visible, au lieu d'une couleur de chiffre lue seulement par les lecteurs d'écran.
2. Le panneau « Prochaine action recommandée » passe d'un aplat `--agent-soft` à une surface neutre avec un
   liseré et une icône `--agent`.
3. Thème sombre : mêmes jetons. Chaque écran refait est capturé dans les deux thèmes (lot 1 de la
   [feuille de route](FRONTEND_REFACTORING_ROADMAP.md)).

## 4. Typographie, espacements, rayons, ombres

Échelle proposée, à déclarer dans `@theme` de `heroui.css` et à utiliser par nom :

| Nom | Taille / interligne | Usage |
|---|---|---|
| `text-caption` | 12 / 16 | horodatage, aide, en-tête de colonne |
| `text-body-sm` | 13 / 20 | lignes de tableau, texte secondaire |
| `text-body` | 14 / 20 | texte courant, champs, boutons |
| `text-title-sm` | 16 / 24 | titre de section, de panneau |
| `text-title` | 20 / 28 | titre d'écran |
| `text-display` | 28 / 34 | chiffre clé, connexion |

- Poids : 400 (texte), 500 (libellés, boutons), 600 (titres). Pas de capitales espacées, sauf en-têtes de
  colonne.
- Police mono : identifiants et valeurs techniques, comme aujourd'hui.
- Espacements : pas de 4 px ; 8 entre éléments liés, 16 entre groupes, 24 entre sections, 32 entre zones.
  Marges d'écran : 16 (mobile), 24 (tablette), 28 (bureau).
- Rayons : `lg` pour boutons, champs, cartes, panneaux ; `sm` pour les petites marques ; `full` pour avatars et
  points d'état. Les 58 usages de `xl`, `2xl`, `md` rejoignent `lg`. **Correction (13/11/2026, PR 2.1)** : la
  première version de ce document donnait `lg` = 8 px et `sm` = 4 px. Avec le rayon de base du projet
  (`--radius: 0.25rem`, « Rayon S » décidé dans `heroui.md`), `lg` vaut 4 px et `sm` 2 px : la taille actuelle est
  gardée, seuls les rayons dispersés sont ramenés à l'échelle.
- Bordures : 1 px `--border` pour délimiter un champ ou une carte ; `--separator` entre lignes.
- Ombres : aucune sur les cartes posées sur la page (bordure seule) ; `--overlay-shadow` pour ce qui flotte
  (menus, panneaux, toasts, dialogues).

## 5. Composants

| Élément | Convention proposée | Composant HeroUI 3.2.6 | État actuel |
|---|---|---|---|
| Bouton | un seul `primary` par écran ; `secondary` pour les actions voisines ; `ghost` dans les barres ; `danger-soft` avant confirmation ; hauteur 36 px, 32 en `sm` | `Button` | conforme, sauf UX-07 |
| Champ texte | bordure 1 px, fond `--surface`, libellé au-dessus, erreur sous le champ dès la sortie du champ | `TextField`, `Input`, `FieldError` | `Field` maison, erreurs à la soumission |
| Nombre | bornes et unité visibles | `NumberField` | 16 `type="number"` |
| Liste de choix | même bordure que les champs ; recherche intégrée au-delà de dix options | `Select`, `ComboBox` | `SelectInput`, `SelectBox` |
| Choix exclusif court | segments, largeur du contenu, jamais étirés | `Tabs` (`Segmented`) | étirés sur les fiches |
| Onglets de fiche | soulignés, alignés à gauche, onglet dans l'adresse | `Tabs` | conteneur plein |
| Filtres | un périmètre en segments, le reste dans « Filtres · N », filtres actifs en puces retirables | `ToggleButton`, `Popover` ou panneau, `TagGroup` | cinq variantes |
| Tableau | lignes de 44 px, en-têtes en `text-caption`, tri natif, ligne cliquable, pagination abrégée | `Table`, `Pagination` | sans tri ; toutes les pages listées |
| Panneau latéral | une seule implémentation, 480 ou 640 px, pied collant pour les actions | `Drawer` | deux implémentations |
| Dialogue | confirmation qui dit l'effet | `AlertDialog` | conforme |
| Menu d'actions | « … » à droite, actions destructives en dernier | `Dropdown` | conforme |
| Infobulle | raison d'une action désactivée ; raccourci clavier | `Tooltip`, `Kbd` | conforme pour les raisons |
| Notification | toast court en bas à droite après une écriture | `Toast` | conforme |
| Alerte | état durable avec l'action qui résout | `Alert` | conforme |
| État vide | icône, phrase, action | `EmptyState` (à évaluer face à `EmptyPanel`) | `EmptyPanel` maison |
| Chargement | squelette à la forme du contenu ; jamais de saut de mise en page | `Skeleton` | conforme ; replis `Suspense` hétérogènes |
| En-tête d'écran | titre, compteur ou état, actions, sur une ligne | — (`PageHeader`) | 100 px, trois niveaux |
| Retour | un composant | `Breadcrumbs` ou `BackLink` | trois écritures |

## 6. Pastilles

| Famille | Apparence | Exemples | Règle |
|---|---|---|---|
| Statut | pastille douce, une couleur sémantique | Ouverte, Active, Brouillon, Désactivé | un statut par objet |
| Étape | pastille douce `agent` ou neutre | Qualifié, En conversation | une par parcours |
| Mesure | texte et jauge, sans fond | score 80, niveau | « Très chaud » reste la seule pastille pleine |
| Marque | contour | Fictif | — |

Dans une ligne de liste ou une carte de pipeline : deux éléments au plus. Le consentement ne s'affiche en liste
que s'il bloque l'action (désinscrit).

## 7. Mouvement

- Entrée d'écran : un fondu de 150 ms sur le contenu, sans cascade par ligne.
- Menus, panneaux, dialogues : animations HeroUI par défaut.
- `CountUp` : supprimé des listes ; à garder au plus sur le Tableau de bord.
- `prefers-reduced-motion` : règle actuelle conservée.

## 8. Mise en œuvre

Tout passe par `heroui.css` (jetons) et `components/ds/` (composants). Un écran refait n'écrit plus de taille
en pixels ni de rayon. Ordre et critères dans la
[feuille de route](FRONTEND_REFACTORING_ROADMAP.md), lot 2.
