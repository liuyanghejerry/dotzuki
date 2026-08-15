# Design Tokens — dotzuki-editor

Single source of truth for the editor's visual theme, defined in
`src/design-tokens.css` (Tailwind CSS v4 `@theme`).

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

### Surfaces (dark hierarchy)

| Token | Value | Old raw class |
|---|---|---|
| `canvas` | `gray-900` | `bg-gray-900` (page background) |
| `canvas-deep` | `gray-950` | `bg-gray-950` (code wells, play backdrop) |
| `surface` | `gray-800` | `bg-gray-800` (panels, header, sidebar, cards) |
| `surface-deep` | `gray-850` | `bg-gray-850` (panels inset below surface) |
| `surface-hover` | `gray-750` | `bg-gray-750` (subtle row hover) |
| `raised` | `gray-700` | `bg-gray-700` (controls, hover background) |
| `overlay` | `gray-600` | `bg-gray-600` (stronger hover / neutral actions) |
| `overlay-strong` | `gray-500` | `hover:bg-gray-500` |
| `inset` | `gray-900` | `bg-gray-900` (input wells on surfaces) |

### Borders

| Token | Value | Old raw class |
|---|---|---|
| `border` | `gray-700` | `border-gray-700` |
| `border-strong` | `gray-600` | `border-gray-600` |
| `border-strongest` | `gray-500` | `border-gray-500` (hover/active) |
| `border-subtle` | `gray-800` | `border-gray-800` |

### Text

| Token | Value | Old raw class |
|---|---|---|
| `ink` | `gray-100` | `text-gray-100` (headings, primary) |
| `ink-secondary` | `gray-200` | `text-gray-200` |
| `ink-body` | `gray-300` | `text-gray-300` |
| `ink-muted` | `gray-400` | `text-gray-400` (secondary) |
| `ink-faint` | `gray-500` | `text-gray-500` (placeholders) |
| `ink-disabled` | `gray-600` | `text-gray-600` |

### Accent (primary action / brand, blue)

| Token | Value | Old raw class |
|---|---|---|
| `accent` | `blue-600` | `bg-blue-600` (primary buttons) |
| `accent-hover` | `blue-700` | `bg-blue-700` / `hover:bg-blue-700` |
| `accent-strong` | `blue-500` | focus rings, active borders |
| `accent-ink` | `blue-400` | `text-blue-400` (active tabs, accent text) |
| `accent-ink-strong` | `blue-300` | `text-blue-300` |
| `accent-ink-faint` | `blue-100` | `text-blue-100` (text on deep accent) |
| `accent-deep` | `blue-900` | `bg-blue-900` (solid deep badges) |
| `accent-selected` | `blue-900` @ 30% | `bg-blue-900/30` (selected rows) |
| `accent-surface` | `blue-600` @ 30% | `bg-blue-600/30` |

### AI accent (purple — AI features, image providers)

| Token | Value | Old raw class |
|---|---|---|
| `ai` | `purple-600` | `bg-purple-600` |
| `ai-hover` | `purple-700` | `hover:bg-purple-700` / `hover:bg-purple-500` |
| `ai-ink` | `purple-400` | `text-purple-400` |
| `ai-ink-strong` | `purple-300` | `text-purple-300` |
| `ai-deep` | `purple-900` | `bg-purple-900` |
| `ai-surface` | `purple-900` @ 30% | `bg-purple-900/50` |

### Status

| Token | Value | Old raw class |
|---|---|---|
| `danger` / `danger-hover` / `danger-deep` | `red-600` / `red-500` / `red-900` | `bg-red-600` / `hover:bg-red-500` / `bg-red-900` |
| `danger-ink` / `danger-ink-strong` | `red-400` / `red-300` | `text-red-400` / `text-red-300` |
| `danger-surface` | `red-900` @ 30% | `bg-red-900/20`, `bg-red-900/30` |
| `success` / `success-hover` / `success-strong` | `green-600` / `green-700` / `green-500` | `bg-green-600` (and `bg-emerald-600`) |
| `success-deep` | `green-900` | `bg-green-900` (and `bg-emerald-900/950`) |
| `success-ink` / `success-ink-strong` | `green-400` / `green-300` | `text-green-400` (and `text-emerald-400`) |
| `success-surface` | `green-900` @ 20% | `bg-green-900/20` |
| `warning` / `warning-hover` / `warning-strong` / `warning-deep` | `amber-500` / `amber-600` / `amber-700` / `amber-900` | `bg-amber-500/600/700/900` |
| `warning-ink` / `warning-ink-strong` | `amber-400` / `amber-300` | `text-amber-400` / `text-amber-300` |
| `on-warning` | `amber-100` | `text-amber-100` |
| `warning-surface` | `yellow-500` @ 20% | `bg-yellow-500/20` |

> The green and emerald families were consolidated into one `success` family
> (green-based, the dominant usage). Code-diff add/remove colors that are not
> covered above may stay raw until they earn a semantic name.

### Radii, shadows, type scale

| Token | Value | Old raw class |
|---|---|---|
| `radius-control` | `0.25rem` | `rounded` |
| `radius-card` | `0.5rem` | `rounded-lg` |
| `radius-pill` | `9999px` | `rounded-full` |
| `shadow-popover` | shadow-xl values | `shadow-xl` |
| `text-micro` | `0.625rem` | `text-[10px]` |
| `text-tiny` | `0.6875rem` | `text-[11px]` |

Radii deliberately use custom names (`rounded-control` instead of overriding
`rounded-sm`): overriding a default name would silently restyle every existing
use of the default utility.

### Gray shade fix

Components used `bg-gray-750` / `bg-gray-850`, which are **not** part of the
default Tailwind palette — those classes silently generated no CSS. The token
file now defines them as `color-mix` midpoints, so they render as intended:

```css
--color-gray-750: color-mix(in oklab, var(--color-gray-700) 50%, var(--color-gray-800));
--color-gray-850: color-mix(in oklab, var(--color-gray-800) 50%, var(--color-gray-900));
```

## Usage rules

1. **Components use semantic tokens, not raw palette classes.** Write
   `bg-surface`, `text-ink-muted`, `border-border` — never `bg-gray-800`,
   `text-gray-400`, `border-gray-700`. Raw palette classes are acceptable only
   for one-off colors with no semantic meaning (see the leftover list below).
2. **A redesign = edit `src/design-tokens.css`.** New tokens are added there
   under the matching `@theme` block; they instantly become utilities.
3. **Opacity modifiers still work**: `bg-raised/60` is valid.

## Migration map

| Old | New |
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
| `bg-blue-900` / `bg-blue-900/30` / `bg-blue-600/30` | `bg-accent-deep` / `-accent-selected` / `-accent-surface` |
| `text-blue-400` / `-300` / `-100` / `-500` | `text-accent-ink` / `-accent-ink-strong` / `-accent-ink-faint` / `-accent-strong` |
| `border-blue-400` / `-500` / `-900` | `border-accent-ink` / `-accent-strong` / `-accent-deep` |
| `ring-blue-400` / `ring-blue-500` | `ring-accent-ink` / `ring-accent-strong` |
| `bg-purple-600` / hover | `bg-ai` / `hover:bg-ai-hover` |
| `bg-purple-900` / `bg-purple-900/50` | `bg-ai-deep` / `-ai-surface` |
| `text-purple-400` / `-300` / `-500` | `text-ai-ink` / `-ai-ink-strong` / `text-ai` |
| `bg-red-600` / `hover:bg-red-500` / `bg-red-900` | `bg-danger` / `hover:bg-danger-hover` / `bg-danger-deep` |
| `text-red-400` / `-300` / `-500` | `text-danger-ink` / `-danger-ink-strong` / `text-danger` |
| `bg-red-900/20` / `/30` / `/40` | `bg-danger-surface` (or `bg-danger-surface/40`) |
| `border-red-*` | `border-danger-*` per the token table |
| `bg-green-600` / `-700` / `-500` / `-900` | `bg-success` / `-success-hover` / `-success-strong` / `-success-deep` |
| `bg-emerald-*`, `text-emerald-*` | same `success` family (consolidated) |
| `text-green-400` / `-300` | `text-success-ink` / `-success-ink-strong` |
| `bg-green-900/20` | `bg-success-surface` |
| `bg-amber-500` / `-600` / `-700` / `-400` / `-900` | `bg-warning` / `-warning-hover` / `-warning-strong` / `-warning-ink` / `-warning-deep` |
| `text-amber-400` / `-300` / `-500` / `-100` | `text-warning-ink` / `-warning-ink-strong` / `text-warning` / `text-on-warning` |
| `bg-yellow-500/20` / `text-yellow-400` | `bg-warning-surface` / `text-warning-ink` |
| `border-amber-400` / `-500` | `border-warning-ink` / `border-warning` |
| `rounded` / `rounded-lg` / `rounded-full` | `rounded-control` / `rounded-card` / `rounded-pill` |
| `shadow-xl` | `shadow-popover` |
| `text-[10px]` / `text-[11px]` | `text-micro` / `text-tiny` |

## Known leftovers (intentionally raw)

Rare, context-specific colors that have no semantic name yet (revisit when a
pattern emerges):

- `text-gray-700` / `text-gray-900` — text on the few light/colored surfaces
- `bg-gray-500`, `border-green-500/70` — story-graph status node colors (domain palette)
- `bg-blue-950`, `bg-purple-950/10`, `bg-purple-950/15` — near-invisible panel tints
- `bg-red-700`, `bg-red-700/50`, `text-red-100` / `text-red-200` — rare badge variants
- `text-green-100` / `text-green-200` — rare badge variants
- `rounded-t` / `rounded-br` — directional radii
- `text-[8px]` / `text-[9px]` / `text-[12px]` — sub-micro sizes
