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
| `surface` | `gray-800` | `bg-gray-800` (panels, header, sidebar, cards) |
| `raised` | `gray-700` | `bg-gray-700` (controls, hover background) |
| `overlay` | `gray-600` | `bg-gray-600` (stronger hover/active) |
| `inset` | `gray-900` | `bg-gray-900` (input wells on surfaces) |

### Borders

| Token | Value | Old raw class |
|---|---|---|
| `border` | `gray-700` | `border-gray-700` |
| `border-strong` | `gray-600` | `border-gray-600` |
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

### Accent (primary action / brand)

| Token | Value | Old raw class |
|---|---|---|
| `accent` | `blue-600` | `bg-blue-600` (primary buttons) |
| `accent-hover` | `blue-700` | `hover:bg-blue-700` |
| `accent-strong` | `blue-500` | focus rings, active borders |
| `accent-ink` | `blue-400` | `text-blue-400` (active tabs, accent text) |
| `accent-ink-strong` | `blue-300` | `text-blue-300` |
| `accent-surface` | `blue-600` @ 30% | `bg-blue-600/30` |

### Status

| Token | Value | Old raw class |
|---|---|---|
| `danger` / `danger-ink` / `danger-surface` | `red-600` / `red-400` / `red-900` @ 30% | `bg-red-600` / `text-red-400` / `bg-red-900/30` |
| `success` / `success-ink` / `success-surface` | `emerald-600` / `emerald-400` / `green-900` @ 20% | `bg-emerald-600` / `text-emerald-400` / `bg-green-900/20` |
| `warning` / `warning-ink` / `warning-surface` | `amber-500` / `amber-400` / `yellow-500` @ 20% | `bg-amber-500` / `text-amber-400` / `bg-yellow-500/20` |

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
   for one-off colors with no semantic meaning.
2. **A redesign = edit `src/design-tokens.css`.** New tokens are added there
   under the matching `@theme` block; they instantly become utilities.
3. **Opacity modifiers still work**: `bg-raised/60` is valid.

## Migration map (for the upcoming redesign pass)

| Old | New |
|---|---|
| `bg-gray-900` (page/layout) | `bg-canvas` |
| `bg-gray-800` | `bg-surface` |
| `bg-gray-700` | `bg-raised` |
| `bg-gray-600` | `bg-overlay` |
| `border-gray-700` | `border-border` |
| `border-gray-600` | `border-border-strong` |
| `border-gray-800` | `border-border-subtle` |
| `text-gray-100` | `text-ink` |
| `text-gray-200` | `text-ink-secondary` |
| `text-gray-300` | `text-ink-body` |
| `text-gray-400` | `text-ink-muted` |
| `text-gray-500` | `text-ink-faint` |
| `text-gray-600` | `text-ink-disabled` |
| `bg-blue-600` / `hover:bg-blue-700` | `bg-accent` / `hover:bg-accent-hover` |
| `text-blue-400` / `text-blue-300` | `text-accent-ink` / `text-accent-ink-strong` |
| `text-red-400` / `bg-red-900/30` | `text-danger-ink` / `bg-danger-surface` |
| `text-emerald-400` / `bg-green-900/20` | `text-success-ink` / `bg-success-surface` |
| `text-amber-400` / `bg-yellow-500/20` | `text-warning-ink` / `bg-warning-surface` |
| `rounded` / `rounded-lg` / `rounded-full` | `rounded-control` / `rounded-card` / `rounded-pill` |
| `shadow-xl` | `shadow-popover` |
| `text-[10px]` / `text-[11px]` | `text-micro` / `text-tiny` |
