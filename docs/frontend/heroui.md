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

Établies sur les parcours Campagnes et Base de connaissances, à appliquer à chaque écran refait. Un écart à une
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
   « N sur M » quand un filtre est actif).
6. **Adresse** : onglet, filtres, page et élément ouvert sont dans l'URL, mise à jour sans entrée d'historique
   (`replaceUrl`). Une adresse de retour est reconstruite à partir des valeurs connues, jamais suivie telle quelle.

**Apparence**

7. **Arrondis** : rayon `lg` fourni par le thème (voir « Thème »).
8. **Champs** : `variant="secondary"` sur la page et dans les cartes blanches ; `variant="primary"` dans un
   panneau latéral (fond gris).
9. **Animations** : cascade `reveal(rang)` sur chaque écran (en-tête, alertes et chiffres, puis lignes),
   désactivée quand l'utilisateur demande moins de mouvement.
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
