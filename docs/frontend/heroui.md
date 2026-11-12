# Interface : HeroUI

La console utilise **HeroUI v3** (`@heroui/react`, `@heroui/styles`) avec Tailwind CSS 4. Les maquettes
d'origine ne sont plus une référence : l'apparence se règle dans le thème, pas écran par écran.

## Thème

Tout est dans `frontend/src/app/heroui.css` : couches Tailwind et HeroUI, polices auto-hébergées
(Instrument Sans, IBM Plex Mono) et jetons du thème clair (`--accent`, `--surface`, `--success`, etc.).

- **Rayon « S »** : `--radius: 0.25rem`, dont dérive l'échelle. Le thème met au rayon `lg` les boutons, pastilles
  de filtre, cartes et alertes (HeroUI : `3xl`) ainsi que les champs (`--field-radius`) : ne pas écrire `rounded-lg`
  sur ces composants. Une classe utilitaire (`rounded-full`…) reste prioritaire. Les pastilles de statut (`Tag`)
  et les fenêtres de confirmation gardent leur rayon HeroUI. Ne pas fixer de rayon en pixels.
- **Thème sombre** : jetons IAGORA sous `[data-theme="dark"]` ; couleurs pleines vives avec texte foncé dessus,
  pour rester lisibles en fond de bouton comme en texte (contraste AA vérifié par axe).
- **Police mono** réservée au code, aux identifiants et aux valeurs techniques. Dates, compteurs et
  sur-titres sont en police sans-serif avec `tabular-nums`.
- **Champs, listes, interrupteurs** : apparence HeroUI par défaut, sans surcharge du thème (pas de bordure ajoutée).
- **Surcouches** : elles acceptent toutes les propriétés du composant HeroUI (`variant`, `size`, `color`…) et
  n'ajoutent que des raccourcis ; ne pas y poser de styles qui changent l'apparence du composant.

## Couche design system (`frontend/src/components/ds/`)

Les écrans importent ces composants, qui enveloppent HeroUI, plutôt que des éléments HTML bruts.

| Fichier | Contenu |
|---|---|
| `controls.tsx` | `Btn`, `LinkButton`, `RowButton`, `Segmented`, `FilterChip`, `FilterChipGroup`, `Field`, `TextInput`, `TextBox`, `SelectInput` (liste avec libellé visible), `SelectBox` (liste à interface de `<select>`), `FileInput`, `Check`, `CheckCardGroup`, `Tag`, `Notice`, `ErrorText` (`Alert`), `TAB_RADIUS` |
| `ConfirmDialog.tsx` | `ConfirmDialog` : `AlertDialog` HeroUI, avec bouton déclencheur ou piloté par `isOpen` |
| `useDiscardGuard.tsx` | « Abandonner les modifications ? » avant de quitter une saisie, et avertissement à la fermeture de l'onglet |
| `motion.tsx` | `reveal(rang)` (cascade d'apparition), `CountUp`, `useReducedMotion` |
| `card.tsx` | `Box` : `Card` HeroUI rendue dans l'élément voulu (`section`, `aside`, `article`, `form`…) |
| `collapse.tsx` | `Collapse` : zone repliable sur le `Disclosure` HeroUI |
| `table.tsx` | `DataTable` au-dessus du `Table` HeroUI |
| `layout.tsx` | `Screen`, `PageHeader`, `Panel`, `KpiCard` / `KpiStrip`, `BarList` (`Meter`), `EmptyPanel`, `ErrorState` (`Alert` danger + « Réessayer ») |
| `settings.tsx` | `SettingsCard`, `InfoRow`, `Toggle`, `Stats`, `ActionsBar` |
| `badges.tsx` | `StageBadge`, `ScoreBadge`, `HeatMeter`, `LevelBadge`, `DemoChip` |

Le panneau latéral est `components/Drawer.tsx` ; l'état d'une page dans l'adresse passe par `lib/url.ts`
(`replaceUrl`) et un module par parcours (`lib/campaignNav.ts`, `lib/knowledgeNav.ts`).

Éléments HTML natifs conservés : listes de définitions `dl`, listes `ul`/`li` sémantiques,
onglets de `EmailConnector`, `input type="color"`, voile du menu mobile.

## Règles des parcours

Établies sur les parcours Campagnes, Base de connaissances, barre et menu, À traiter, Conversations, Prospects (liste et fiche), Rendez-vous, Aujourd'hui, à appliquer à chaque écran refait. Un écart à une
règle se décide avec le responsable du projet, puis s'écrit ici.

**Structure**

1. **Fiche et création** : page dédiée quand l'élément a plusieurs sections (onglets) ou que la création compte
   plusieurs étapes ; sinon, panneau latéral. Modifier un élément se fait toujours dans un panneau.
2. **Panneau latéral** : icône du module (la même que dans le menu), sur-titre (« Campagne », « Document »,
   « Modification »), puis titre.
3. **Onglets** : `Tabs` HeroUI avec `TAB_RADIUS`, l'onglet ouvert dans l'adresse (`?tab=…`).
4. **Tableaux** : le `Table` HeroUI (via `DataTable`) est posé directement sur la page, sans carte autour.
   Toute la ligne ouvre l'élément (clic et Entrée).
5. **Barre au-dessus d'un tableau** : recherche et filtres à gauche, compteur à droite (« N éléments », ou
   « N sur M » quand un filtre est actif). Quand les filtres sont nombreux (Prospects), seuls la recherche et les
   pastilles de périmètre restent dans la barre ; les autres passent dans un panneau latéral ouvert par
   « Filtres · N », qui s'applique tout de suite, et chaque filtre actif s'affiche en puce retirable sous la barre,
   avec « Réinitialiser ».
6. **Adresse** : onglet, filtres, page et élément ouvert sont dans l'URL, mise à jour sans entrée d'historique
   (`replaceUrl`). Une adresse de retour est reconstruite à partir des valeurs connues, jamais suivie telle quelle.

**Apparence**

7. **Arrondis** : rayon `lg` fourni par le thème (voir « Thème »). Seule exception, décidée pour Conversations : les
   bulles du fil (`ConversationView`) gardent un arrondi de messagerie, plus grand, au coin resserré du côté de
   l'auteur.
8. **Champs** : `variant="secondary"` sur la page et dans les cartes blanches ; `variant="primary"` dans un
   panneau latéral (fond gris).
9. **Animations** : cascade `reveal(rang)` sur chaque écran (en-tête, alertes et chiffres, puis lignes),
   désactivée quand l'utilisateur demande moins de mouvement. **Défilement** : toute zone qui défile dans l'écran
   passe par `ScrollShadow` HeroUI (`SCROLL_SHADOW_SIZE`), qui fond le contenu en haut et en bas tant qu'il en reste :
   écran (`Screen scroll`), tableaux, menu latéral, résultats de recherche, listes des colonnes (`ListScroll`).
10. **Couleurs métier** conservées : palette du projet, puces « agent » et « très chaud », niveaux `level-*`.

**Retours et états**

11. **Succès** : toute écriture réussie (créer, enregistrer, activer, retirer, supprimer…) est confirmée par
    un Toast HeroUI court.
12. **Erreurs** : une seule apparence, l'`Alert` HeroUI danger (`ErrorState` pour un chargement, avec
    « Réessayer » ; `ErrorText` pour une action). Le message dit ce qui a échoué avant le détail du serveur.
13. **États durables** (service non configuré, éléments à recalculer…) : `Alert` HeroUI annoncée poliment
    (`role="status"`), avec l'action qui résout.
14. **Confirmations** : `ConfirmDialog` avant une action destructive ou à conséquence, qui en dit l'effet ;
    `useDiscardGuard` avant d'abandonner une saisie. Une action impossible est désactivée avec sa raison
    (infobulle), plutôt que refusée après le clic.
15. **États vides, chargement** : `EmptyPanel` avec l'action suivante (et « Afficher tout » quand un filtre
    est actif) ; `Skeleton` ou chargement du tableau, jamais de « … ».

**Barre et menu** (`components/AppShell.tsx`, `components/shell/`)

16. **Barre du haut** : à gauche, la recherche unique (la palette `CommandPalette`, Ctrl K / ⌘ K : prospects,
    pages, actions) ; à droite, « N à traiter » et le menu du compte. Pas de second champ de recherche dans un
    écran pour les mêmes données.
17. **Menu du compte** (`shell/AccountMenu.tsx`, `Popover` HeroUI car il contient des contrôles) : identité,
    Mon compte, état et contrôle de l'agent (arrêt d'urgence ou reprise après confirmation ; un point de
    couleur sur l'avatar rappelle l'état), thème clair / sombre / système (`ToggleButtonGroup`, choix gardé
    dans le navigateur, appliqué avant l'affichage par `lib/theme.ts`), Déconnexion.
18. **Menu** : intitulés en français identiques aux titres des pages (`shell/navigation.ts`). Sur bureau, menu
    réductible à ses icônes, intitulé en `Tooltip` et nom accessible conservé, choix mémorisé dans le
    navigateur. Sur mobile et tablette, `Drawer` HeroUI (focus gardé, Échap, bouton Fermer).
19. **Rien de natif** : pas de `window.confirm` ni d'`alert` ; une confirmation passe par `ConfirmDialog`.

**File de travail** (`app/todo`, `components/todo/` ; `app/conversations`, `components/conversations/`)

20. **Maître-détail** (écart à la règle 4, décidé pour « À traiter », repris pour Conversations) : quand on traite des éléments l'un après
    l'autre, la file reste à gauche et le détail s'ouvre à droite, au lieu d'un tableau et d'un panneau. La file
    est posée sur la page : titre et compteur à droite, onglets, filtres (`FilterChipGroup`), liste sur sa
    surface, `TablePagination`. Sur bureau, la colonne est collante (`calc(100dvh - 9rem)`) et seule la liste
    défile, dans `ListScroll` : titre, filtres et pagination restent visibles. Sur mobile, la file ou le détail,
    avec « ← Liste des éléments ».
21. **Enchaînement** : une saisie en cours dans le détail est protégée (`useDiscardGuard`) pour tout changement
    d'élément, de filtre, d'onglet ou de page. Après une décision : Toast avec « Voir la décision », puis
    l'élément suivant s'ouvre et son titre reçoit le focus. Les actions suivent le contenu qu'elles
    concernent, jamais une barre collante qui le masque.
22. **Actions sur l'état** (Conversations) : dans l'en-tête du détail, à côté du statut, l'action principale
    selon l'état et les autres dans un menu « … » (`Dropdown` HeroUI). Celles qui ont un effet (rendre la main à
    l'agent, le relancer, clôturer) passent par `ConfirmDialog`. Un brouillon de l'agent se décide sur place avec
    le panneau d'« À traiter » (`components/todo/DraftPanel.tsx`), mêmes confirmations.

**Fiche prospect** (`app/prospects/[id]`, `components/prospect/`)

23. **En-tête et onglets** : l'en-tête (identité, consentement, étape, score) porte les actions, puis quatre onglets
    dans l'adresse : Vue d'ensemble (recommandation, profil, identité), Conversation (fil en lecture, fiche de
    transfert, historique des échanges), Parcours (un bloc par campagne et source), Décisions de l'agent. Les
    paramètres de retour (`from`, `task`, `kind`) sont conservés quand on change d'onglet.
24. **Actions** (comme la règle 22) : action principale selon l'état (« Voir dans la file » si un brouillon attend,
    sinon « Lancer l'agent », après `ConfirmDialog`), « Ouvrir dans Conversations », puis « Autres actions » :
    désinscription (`ConfirmDialog`), consentement (panneau avec la source), effacement RGPD (panneau,
    administrateur). Un observateur ne voit ni le lancement ni ce menu ; un lancement impossible reste visible,
    désactivé, avec sa raison en infobulle.
25. **Panneaux** : modifier l'affectation ou l'étape d'un parcours et attribuer une campagne s'ouvrent dans un
    panneau latéral ; la fiche reste affichée pendant le rechargement qui suit une écriture.
**Rendez-vous et Aujourd'hui** (`app/appointments`, `app/page.tsx`, `components/appointments/`)

26. **Agenda par jour** (écart à la règle 4, décidé pour Rendez-vous) : les rendez-vous restent une liste groupée
    par jour, lue comme un agenda, plutôt qu'un tableau. Toute la ligne ouvre la fiche du prospect (clic ; au
    clavier, le nom du prospect est le lien). Barre : période, conseiller, statut et prospects fictifs à gauche,
    « Réinitialiser » quand un filtre est actif, compteur « N rendez-vous » (ou « N sur M ») à droite ;
    pagination `TablePagination`.
27. **Aujourd'hui** : « Prochains rendez-vous » (les siens pour un conseiller, tous sinon, cinq au plus) avec un
    lien vers la liste complète. Statut et lien de visio partagés avec Rendez-vous
    (`components/appointments/shared.tsx`). Pendant le chargement, rien ou un `Skeleton`, jamais « … ».

**Tableau de bord** (`app/dashboard`)

28. **Pilotage** : période (7, 30, 90 jours) dans l'adresse (`?days=`), chiffres clés en `KpiStrip`, puis
    entonnoir (avec la part de l'étape précédente), répartition par programme et par source en `BarList`. Les
    étapes sont comptées atteintes, ce que l'écran dit en clair. Incident de réception en `Alert` danger avec
    « Diagnostiquer ». Aucun chiffre n'est estimé : ce que l'API ne mesure pas n'est pas affiché.

29. **Analyses** (`app/analytics`) : même période que le tableau de bord ; quatre indicateurs en `KpiStrip`, dont
    « Escalades utiles » en `pending` (« Pas encore mesuré ») ; devenir des brouillons et conversion en `BarList`,
    motifs de refus en liste. Une mesure sans donnée affiche « — » et sa précision dit pourquoi.
30. **Agent** (`app/agent`) : état et action d'arrêt ou de reprise (`ConfirmDialog`, mêmes textes que le menu
    du compte), modes en lecture (Automatique sans bouton), règles de l'agent et réglages clés en lecture avec
    un lien vers Paramètres, activité sur 7 jours ; état des intégrations pour l'administrateur seulement
    (masqué, pas en erreur, pour les autres rôles).

**Administration** (`app/settings`)

31. **Paramètres** (écarts aux règles 3 et 21, décidés pour cet écran) : les catégories sont un menu vertical avec
    une aide sous chaque intitulé (une liste sur mobile), la catégorie ouverte dans l'adresse (`?section=`) ; une
    seule barre « Enregistrer les paramètres », commune aux catégories, reste collée en bas de l'écran et reprend sa
    place après le dernier champ. La couleur des emails se choisit avec le `ColorPicker` HeroUI (`ColorChoice`).
    « Revenir aux valeurs du serveur » passe par `ConfirmDialog` ; succès en Toast, échec en `ErrorText`.
32. **Équipe** (`app/team`, `components/team/`) : tableau des membres (recherche et rôle dans l'adresse, compteur
    « N membres · N actifs ») ; « Ajouter un membre » et la fiche d'un membre s'ouvrent dans un panneau latéral
    (`?member=`). Réinitialiser le mot de passe, désactiver et réactiver passent par `ConfirmDialog` ; sur son propre
    compte, ces actions et le rôle restent visibles, désactivés avec leur raison. Le mot de passe temporaire
    s'affiche une seule fois, dans le panneau ouvert, puis sur la page jusqu'à « J'ai transmis le mot de passe ».
33. **Intégrations** (`app/integrations`, écarts aux règles 2 et 4 décidés pour cet écran) : les connecteurs restent
    un catalogue de cartes regroupées par catégorie (pas un tableau), et leur panneau porte l'icône du connecteur,
    pas celle du module. Recherche (`?q=`), filtre (`?f=`), connecteur ouvert (`?c=`) et onglet de la messagerie
    (`?tab=`) sont dans l'adresse ; compteur « N connecteurs » à droite. Une saisie non enregistrée dans un
    panneau est protégée à sa fermeture ; passage d'envoi réel, oubli de la boîte et révocation d'un jeton passent
    par `ConfirmDialog`. Chaque panneau : `SettingsLoading` au chargement, succès en Toast, échec en `ErrorText`
    (message construit avec `failure()` de `lib/api`).

**Vérification** : chaque nouvel état a son test Playwright et son audit axe (aucune violation grave), et
le parcours est capturé avant / après.

## Tests

Les tests Playwright (`frontend/tests`) tournent sur une API simulée et incluent un audit axe.

- Un `Table` HeroUI a le rôle `grid` ; une ligne n'y est nommée que par son en-tête de ligne.
- Un `Select` HeroUI garde son popover en animation de sortie : attendre sa fermeture avant d'interroger
  le libellé du champ.
- Une liste HeroUI n'est pas un `<select>` : choisir une option avec l'utilitaire `choose` de `tests/select.ts`
  et vérifier la valeur avec `toHaveAttribute("data-value", …)`.
- Une zone `Collapse` s'ouvre en cliquant sur son titre.
- Lancer les tests en séquentiel ou à deux processus au plus : le serveur de test partage un port.
