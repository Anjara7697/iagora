# Interface : HeroUI

La console utilise **HeroUI v3** (`@heroui/react`, `@heroui/styles`) avec Tailwind CSS 4. Les maquettes
d'origine ne sont plus une référence : l'apparence se règle dans le thème, pas écran par écran.

## Thème

Tout est dans `frontend/src/app/heroui.css` : couches Tailwind et HeroUI, polices auto-hébergées
(Instrument Sans, IBM Plex Mono) et jetons du thème clair (`--accent`, `--surface`, `--success`, etc.).

- **Rayon « S »** : `--radius: 0.25rem`. Les autres rayons en dérivent (champs 6 px, cartes 8 px).
  Ne pas fixer de rayon en pixels : utiliser l'échelle (`rounded-lg`, `rounded-xl`).
- **Police mono** réservée au code, aux identifiants et aux valeurs techniques. Dates, compteurs et
  sur-titres sont en police sans-serif avec `tabular-nums`.
- **Champs** : bordure grise `--field-border`, 1 px.

## Couche design system (`frontend/src/components/ds/`)

Les écrans importent ces composants, qui enveloppent HeroUI, plutôt que des éléments HTML bruts.

| Fichier | Contenu |
|---|---|
| `controls.tsx` | `Btn`, `LinkButton`, `RowButton`, `Segmented`, `FilterChip`, `Field`, `TextInput`, `TextBox`, `SelectInput` (liste avec libellé visible), `SelectBox` (liste à interface de `<select>`), `FileInput`, `Check`, `Tag`, `Notice`, `ErrorText` (`Alert`) |
| `card.tsx` | `Box` : `Card` HeroUI rendue dans l'élément voulu (`section`, `aside`, `article`, `form`…) |
| `collapse.tsx` | `Collapse` : zone repliable sur le `Disclosure` HeroUI |
| `table.tsx` | `DataTable` au-dessus du `Table` HeroUI |
| `layout.tsx` | `Screen`, `PageHeader`, `Panel`, `KpiCard`, `BarList` (`Meter`), états vides |
| `settings.tsx` | `SettingsCard`, `InfoRow`, `Toggle`, `Stats`, `ActionsBar` |
| `badges.tsx` | `StageBadge`, `ScoreBadge`, `HeatMeter`, `LevelBadge`, `DemoChip` |

Éléments HTML natifs conservés : listes de définitions `dl`, listes `ul`/`li` sémantiques,
onglets de `EmailConnector`, `input type="color"`, voile du menu mobile.

## Tests

Les tests Playwright (`frontend/tests`) tournent sur une API simulée et incluent un audit axe.

- Un `Table` HeroUI a le rôle `grid` ; une ligne n'y est nommée que par son en-tête de ligne.
- Un `Select` HeroUI garde son popover en animation de sortie : attendre sa fermeture avant d'interroger
  le libellé du champ.
- Une liste HeroUI n'est pas un `<select>` : choisir une option avec l'utilitaire `choose` de `tests/select.ts`
  et vérifier la valeur avec `toHaveAttribute("data-value", …)`.
- Une zone `Collapse` s'ouvre en cliquant sur son titre.
- Lancer les tests en séquentiel ou à deux processus au plus : le serveur de test partage un port.
