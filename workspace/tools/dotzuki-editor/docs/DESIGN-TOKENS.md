# Design Tokens — dotzuki-editor

Single source of truth for the editor's visual theme, defined in
`src/design-tokens.css` (Tailwind CSS v4 `@theme`).

Current theme: **light "modern workbench"** — white panels on a light-gray
canvas, coral-orange accent, soft tinted status surfaces, generous radii.

## How it works

Every `--color-*`, `--radius-*`, `--shadow-*` and `--text-*` variable declared
in `@theme` generates a matching set of Tailwind utilities:

| Token | Generated utilities |
|---|---|
| `--color-surface` | `bg-surface`, `text-surface`, `border-surface`, … (plus `/opacity` variants) |
| `--radius-card` | `rounded-card` |
| `--shadow-popover` | `shadow-popover` |
| `--text-micro` | `text-micro` |

Values are mapped onto the Tailwind default palette through `var()` references
inside `@theme inline`, so a redesign means editing this one file — components
never carry raw colors.

## Token reference

### Surfaces (light hierarchy)

| Token | Value | Usage |
|---|---|---|
| `canvas` | `gray-100` | page background |
| `canvas-deep` | `gray-200` | deepest wells, play backdrop |
| `surface` | `white` | panels, header, sidebar, cards |
| `surface-deep` | `gray-50` | panels inset below surface |
| `surface-hover` | `gray-100` | subtle row hover on surface |
| `raised` | `gray-200` | controls, hover background |
| `overlay` | `gray-300` | stronger hover / neutral actions |
| `overlay-strong` | `gray-400` | active / pressed |
| `inset` | `gray-50` | input wells on surfaces |

### Borders

| Token | Value | Usage |
|---|---|---|
| `border` | `gray-200` | default borders |
| `border-strong` | `gray-300` | emphasized borders |
| `border-strongest` | `gray-400` | hover/active borders |
| `border-subtle` | `gray-100` | faint separators |

### Text

| Token | Value | Usage |
|---|---|---|
| `ink` | `gray-900` | headings, primary |
| `ink-secondary` | `gray-800` | emphasized body |
| `ink-body` | `gray-700` | regular body |
| `ink-muted` | `gray-600` | secondary / descriptions |
| `ink-faint` | `gray-500` | tertiary, placeholders |
| `ink-disabled` | `gray-400` | disabled states |

### Accent (primary action / brand, coral orange)

| Token | Value | Usage |
|---|---|---|
| `accent` | `orange-600` | primary buttons |
| `accent-hover` | `orange-700` | primary button hover |
| `accent-strong` | `orange-500` | focus rings, active borders |
| `accent-ink` | `orange-600` | accent text, active tabs |
| `accent-ink-strong` | `orange-700` | accent text hover |
| `accent-ink-faint` | `orange-100` | accent text on deep accent bg |
| `accent-deep` | `orange-700` | deep accent borders, tint base (`bg-accent-deep/20`) |
| `accent-selected` | `orange-500` @ 18% | selected rows |
| `accent-surface` | `orange-600` @ 10% | soft accent panels, tinted badges |

### AI accent (purple — AI features, image providers)

| Token | Value | Usage |
|---|---|---|
| `ai` | `purple-600` | solid AI actions |
| `ai-hover` | `purple-700` | hover |
| `ai-ink` | `purple-600` | AI accent text |
| `ai-ink-strong` | `purple-700` | AI accent text hover / on tints |
| `ai-deep` | `purple-700` | deep AI borders (`border-ai-deep/40`) |
| `ai-surface` | `purple-600` @ 10% | soft AI panels, tinted badges |

### Status

| Token | Value | Usage |
|---|---|---|
| `danger` / `danger-hover` / `danger-deep` | `red-600` / `red-700` / `red-700` | danger actions, alert borders |
| `danger-ink` / `danger-ink-strong` | `red-600` / `red-700` | danger text |
| `danger-surface` | `red-600` @ 10% | alert backgrounds, diff removals |
| `success` / `success-hover` / `success-strong` | `green-600` / `green-700` / `green-600` | success actions / emphasized success text |
| `success-deep` | `green-700` | success borders, tint base |
| `success-ink` / `success-ink-strong` | `green-700` / `green-800` | success text |
| `success-surface` | `green-600` @ 12% | success backgrounds, diff additions |
| `warning` / `warning-hover` / `warning-strong` / `warning-deep` | `amber-500` / `amber-600` / `amber-700` / `amber-700` | warning actions / solid badges |
| `warning-ink` / `warning-ink-strong` | `amber-700` / `amber-800` | warning text |
| `on-warning` | `amber-100` | text on solid `warning-strong` bg |
| `warning-surface` | `amber-500` @ 15% | warning backgrounds |

> On the light theme, `-surface` tokens (soft tints) pair with `-ink-strong`
> text for badges and alert boxes; `-deep` tokens are the saturated border /
> low-opacity tint base.

### Radii, shadows, type scale

| Token | Value | Closest default |
|---|---|---|
| `radius-control` | `0.375rem` | `rounded-md` |
| `radius-card` | `0.75rem` | `rounded-xl` |
| `radius-pill` | `9999px` | `rounded-full` |
| `shadow-popover` | soft diffuse xl | `shadow-xl` (softened for light theme) |
| `text-micro` | `0.625rem` | `text-[10px]` |
| `text-tiny` | `0.6875rem` | `text-[11px]` |
| `spacing` | `0.28125rem` | `--spacing` base (+12.5% vs Tailwind default — every `p-*`/`m-*`/`gap-*` utility runs looser) |

Radii deliberately use custom names (`rounded-control` instead of overriding
`rounded-sm`): overriding a default name would silently restyle every existing
use of the default utility.

## Usage rules

1. **Components use semantic tokens, not raw palette classes.** Write
   `bg-surface`, `text-ink-muted`, `border-border` — never `bg-gray-800`,
   `text-gray-400`, `border-gray-700`. Raw palette classes are acceptable only
   for one-off colors with no semantic meaning (see the leftover list below).
2. **A redesign = edit `src/design-tokens.css`.** New tokens are added there
   under the matching `@theme` block; they instantly become utilities.
3. **Opacity modifiers still work**: `bg-raised/60` is valid.

## Migration map

| Old (dark theme) | New |
|---|---|
| `bg-gray-900` (page/layout) | `bg-canvas` |
| `bg-gray-950` | `bg-canvas-deep` |
| `bg-gray-800` | `bg-surface` |
| `bg-gray-850` | `bg-surface-deep` |
| `bg-gray-750` | `bg-surface-hover` |
| `bg-gray-700` | `bg-raised` |
| `bg-gray-600` | `bg-overlay` |
| `hover:bg-gray-500` | `hover:bg-overlay-strong` |
| `border-gray-800` / `-700` / `-600` / `-500` | `border-border-subtle` / `-border` / `-border-strong` / `-border-strongest` |
| `text-gray-100` / `-200` / `-300` / `-400` / `-500` / `-600` | `text-ink` / `-ink-secondary` / `-ink-body` / `-ink-muted` / `-ink-faint` / `-ink-disabled` |
| `bg-blue-600` / `-700` / `-500` | `bg-accent` / `-accent-hover` / `-accent-strong` |
| `bg-blue-900/30` / `bg-blue-600/30` | `bg-accent-selected` / `-accent-surface` |
| `text-blue-400` / `-300` / `-100` / `-500` | `text-accent-ink` / `-accent-ink-strong` / `-accent-ink-faint` / `-accent-strong` |
| `border-blue-400` / `-500` / `-900` | `border-accent-ink` / `-accent-strong` / `-accent-deep` |
| `ring-blue-400` / `ring-blue-500` | `ring-accent-ink` / `ring-accent-strong` |
| `bg-purple-600` / hover | `bg-ai` / `hover:bg-ai-hover` |
| `bg-purple-950/10`–`/15` (panel tints) | `bg-ai-surface` |
| `text-purple-400` / `-300` / `-500` | `text-ai-ink` / `-ai-ink-strong` / `text-ai` |
| `bg-red-600` / `hover:bg-red-500` | `bg-danger` / `hover:bg-danger-hover` |
| `text-red-400` / `-300` / `-500` | `text-danger-ink` / `-danger-ink-strong` / `text-danger` |
| `bg-red-900/20`–`/60`, `bg-red-700/50` badges | `bg-danger-surface` |
| `border-red-*` | `border-danger-*` per the token table |
| `bg-green-600` / `-700` / `-500` | `bg-success` / `-success-hover` / `-success-strong` |
| `bg-emerald-*`, `text-emerald-*` | same `success` family (consolidated) |
| `text-green-400` / `-300` | `text-success-ink` / `-success-ink-strong` |
| `bg-green-900/20`–`/60` | `bg-success-surface` |
| `bg-amber-500` / `-600` / `-700` | `bg-warning` / `-warning-hover` / `-warning-strong` |
| `text-amber-400` / `-300` / `-500` / `-100` | `text-warning-ink` / `-warning-ink-strong` / `text-warning` / `text-on-warning` |
| `bg-yellow-500/20` / `text-yellow-400` | `bg-warning-surface` / `text-warning-ink` |
| `border-amber-400` / `-500` | `border-warning-ink` / `border-warning` |
| `bg-{indigo,teal,rose,sky}-900 text-*-300` badges | `bg-{indigo,teal,rose,sky}-100 text-*-700` |
| `rounded` / `rounded-lg` / `rounded-full` | `rounded-control` / `rounded-card` / `rounded-pill` |
| `shadow-xl` | `shadow-popover` |
| `text-[10px]` / `text-[11px]` | `text-micro` / `text-tiny` |

## Known leftovers (intentionally raw)

Rare, context-specific colors that have no semantic name yet (revisit when a
pattern emerges):

- `text-gray-700` / `text-gray-900` — dark text on light/colored surfaces
  (amber badges, separators)
- `text-green-100` / `text-green-200`, `text-red-100`, `bg-red-700` — light
  text on solid status buttons in MapActivity
- `bg-gray-500`, `border-green-500/70` — story-graph status node colors (domain palette)
- `rounded-t` / `rounded-br` — directional radii
- `text-[8px]` / `text-[9px]` / `text-[12px]` — sub-micro sizes
