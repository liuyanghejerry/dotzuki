# GUI DSL Reference

The authoritative syntax reference for `.gui` layout files and `ui {}` blocks:
every implemented component, property, and binding, and the schema v2 JSON they
compile to.

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

Proposals from the legacy GAME_UI_DSL document live in archive/game-ui-dsl.md; this page documents only the implemented surface.

## Overview

The GUI DSL is a declarative UI description language for game interfaces. The
compiler supports two usage modes:

1. **Standalone `.gui` files** — pure UI layout definitions, compiled to schema v2 JSON
2. **`ui` blocks in `.scene` files** — inline UI layouts that live alongside the game script

### Implemented core features

- **Declarative syntax** — describes "what", not "how"
- **Tile-coordinate positioning** — absolute positioning on a 20×18 tile grid
  (via `rect`)
- **Built-in component types** — `panel`, `container`, `text`, `button`, `tile`,
  `divider`, `list`, `flex_list`, `cursor`, `bracket`, `pixel_rect`
- **Custom components** — `component` declarations (build-time prop schema) plus
  game-registered `custom:*` elements (see the Custom components section)
- **Object literals** — `{key: value, ...}` syntax for complex properties
- **Template variables** — `{variable}` runtime data binding
- **Bilingual text (i18n)** — `@t("en", "中文")` inline localized strings
  (see the Bilingual text section)
- **Schema v2 output** — compiles to the JSON format the renderer expects

### Bilingual text (i18n) — `@t`

Any `text(...)` or `button(...)` text argument can be wrapped in
`@t("english", "中文")` to make it bilingual (first argument is English `en`,
second is Chinese `zh`):

```
text(@t("TEXT SPEED", "文字速度")) { rect = {tx: 1, ty: 1, tw: 16, th: 1} }
button(@t("CANCEL", "取消"))      { rect = {tx: 2, ty: 16, tw: 8, th: 1} }
```

When compiling to schema v2 JSON, the `value` field becomes an object indexed
by language:

```json
{ "type": "text", "value": { "en": "TEXT SPEED", "zh": "文字速度" } }
```

The renderer picks the text by the current language (`DataContext`'s `__lang`,
default `en`); a missing language falls back to `en`, then to any language
present. A plain string (no `@t`) behaves as before and compiles to a single
string. `@t` also mixes with template bindings:
`@t("MONEY ${balance}", "金钱 ${balance}")`.

> In the `.scene` script DSL, `@t(...)` also applies to `@speaker` text and
> `@option` labels, compiling to runtime `game.t("en", "zh")` calls
> (see [how-to/i18n.md](../../how-to/i18n.md)).

## Syntax rules

### Document structure

A `.gui` file holds one `screen` declaration:

```
screen Name {
    components
}
```

A file may also hold `component` declarations before the `screen` — or hold
nothing but `component` declarations (a shared prelude such as
`components.gui`). Inside a `screen` block, each entry is a component, with an
optional id:

```
[id =] type[(argument)] { properties and child components }
```

`screen` and `ui` blocks accept components only. The scene-level directives
(`@variables`, `@theme`, `@style`, `@atlas`, `@if`, `@each`) belong to the
`.scene` script DSL, not to `.gui` files; see [codegen.md](codegen.md) for
those compile contracts.

### Indentation

- Indent with **spaces** (2 or 4 recommended); the lexer rejects tabs.
- Statements at the same level must share the same indentation.
- Content after `{` indents one level; `}` dedents one level.

### Comments

```
// 单行注释

/*
 * 多行注释
 * 可以跨行
 */
```

## Data types

### Primitive types

| Type | Examples | Notes |
| ---- | -------- | ----- |
| String | `"hello"`, `'world'` | Double or single quotes |
| Number | `42`, `3.14`, `-10` | Integer or decimal |
| Number (hex) | `0xFF` | Hex integer form |
| Boolean | `true`, `false` | Lowercase |

### Composite types

```
// Array
colors = ["red", "green", "blue"]
margins = [10, 20, 10, 20]

// Object
style = {
    color: "red"
    size: 14
}

// Multi-line object (recommended)
item = {
    name: "Sword"
    price: 120
    tags: ["weapon", "melee"]
}
```

Object literal fields use `key: value`.

### Template variables (data binding)

```
// Binding
text = "{username}"
text = "你好，{username}！"
```

Strings that contain `{...}` pass through the compiler unchanged; the renderer
resolves them at draw time against the runtime data context.

## Tile coordinate system

### Coordinate system

The game screen uses a **20×18 tile grid**:

- `tx` — tile column (0 = left)
- `ty` — tile row (0 = top)
- `tw` — width in tiles
- `th` — height in tiles

### The `rect` property

Every component accepts a `rect` property for absolute positioning:

```
panel {
    rect = {tx: 0, ty: 12, tw: 20, th: 6}
}

text("Hello") {
    rect = {tx: 1, ty: 13, tw: 18, th: 4}
}
```

### Template variables in `rect`

`rect` values may be template variables:

```
tile(223) {
    rect = {tx: "{cursor_x}", ty: 3, tw: 1, th: 1}
}
```

## Components

### Panel — bordered container

```
panel {
    rect = {tx: 0, ty: 12, tw: 20, th: 6}
    style = "default"              // "default" | "single" | "double" | custom object
    text("内容") { rect = {tx: 1, ty: 13, tw: 18, th: 4} }
}
```

**`style` values:**

- `"default"` — default border style
- `"single"` / `"double"` — single-line / double-line border
- Custom object:
  ```
  style = {corner_tl: 99, edge_top: 100, corner_tr: 101, edge_left: 102, edge_right: 103, corner_bl: 108, edge_bottom: 111, corner_br: 110}
  ```

### Container — borderless container

```
container {
    rect = {tx: 0, ty: 0, tw: 20, th: 18}
    layout = {gap: 0}
    clip = false
    visible = "{show_entry1}"
    text("子元素") { rect = {tx: 4, ty: 0, tw: 10, th: 1} }
}
```

### Text — text component

```
text("显示内容") {
    rect = {tx: 1, ty: 1, tw: 6, th: 1}
    color = "Black"                // "Black" | "DarkGray" | "LightGray" | "White" | "#rrggbb"
    align = "left"                 // "left" | "center" | "right"
    font = "pk_glyph"              // font name
    wrap = "word"                  // "word" enables wrapping
    line_spacing = 1               // line spacing in tiles
}
```

**Template variables:**

```
text("{player_name}") {
    rect = {tx: 5, ty: 2, tw: 7, th: 1}
}
```

**`value` alias:**

```
// Both forms are equivalent
text("Hello") { rect = {...} }
text {
    value = "Hello"
    rect = {...}
}
```

### Tile — tile rendering

```
tile(31) {
    rect = {tx: 18, ty: 16, tw: 1, th: 1}
}

tile("{sprite_index}") {
    rect = {tx: 15, ty: 4, tw: 2, th: 2}
    visible = "{has_selected}"
    flip_x = false
    flip_y = false
    palette = "name"
    repeat = 1                     // horizontal repeat count
}
```

### Divider — separator line

```
divider {
    rect = {tx: 1, ty: 9, tw: 18, th: 1}
    tiles = [122]                  // array of tile ids
    repeat = 17                    // repeat count
    orientation = "horizontal"     // "horizontal" | "vertical"
}
```

### List — scrolling list

```
list {
    rect = {tx: 1, ty: 1, tw: 11, th: 3}
    source = "{items}"             // data-source template variable
    item_template = {height: 1, gap: 1}
    cursor = {tile: 223, position: "left"}
    max_visible = 3
    selected = 0
    footer = "text"
}
```

**`cursor` property:**

- Shorthand: `cursor = {tile: 223}` (tile id only)
- Full form: `cursor = {tile: 223, position: "left"}`

### FlexList — multi-column list

```
flex_list("{bag_items}") {
    rect = {tx: 1, ty: 4, tw: 18, th: 13}
    item_layout = [
        {field: "name", width: 14, align: "left"},
        {field: "qty", width: 3, align: "right", prefix: "x"}
    ]
    padding = {top: 1, left: 1}
    gap = 1
    cursor = {tile: 223, position: "left"}
    selected = 0
}
```

**`item_layout` column definitions:**

- `field` — data field name
- `width` — column width in tiles
- `align` — alignment
- `prefix` — value prefix (such as `"x"`, `"$"`)

### Button — button

```
button("确定") {
    rect = {tx: 10, ty: 15, tw: 5, th: 1}
    on_click = "handler"
}
```

### Image — image

```
image("sprite.png") {
    rect = {tx: 0, ty: 0, tw: 7, th: 7}
    slice = "[8,8,8,8]"            // nine-slice margins
}
```

### Input / Dropdown — input components

```
input {
    rect = {tx: 0, ty: 0, tw: 20, th: 1}
    placeholder = "请输入..."
}

dropdown {
    rect = {tx: 0, ty: 0, tw: 10, th: 1}
}
```

`input` compiles to a `custom:input` element and `dropdown` to a
`custom:dropdown` element; the game registers their renderers.

### Cursor — selection cursor

Draws a selection marker (▶) from the `rect.tx/ty` base point with a
"base + grid offset" step. The final position is
`base_tx + col*col_step` / `base_ty + row*row_step`, with `col`/`row` as
data bindings:

```
cursor {
    rect = {tx: 5, ty: 14, tw: 1, th: 1}
    row = "{cursor}"          // 1-D list cursor: set row_step only
    row_step = 2
}
```

- 1-D list cursor: set `row_step`, `row = "{cursor}"`
- 2-D grid (battle FIGHT/MON/ITEM/RUN): set both `col_step` + `row_step`
- Enum offset selector (options screen): `col_step = 1`, `col = "{opt_index}"`
- Multi-cursor screens (party's ▶ + ◆): place multiple `cursor` elements,
  each with its own `visible` condition

### Bracket / PixelRect — pixel primitives

Declarative versions of the pokered-ui `Frame` primitives (bracket frame, raw
rectangle), composited from the painter's `draw_pixel_rect`:

```
bracket {
    rect = {tx: 0, ty: 8, tw: 10, th: 4}
}

pixel_rect {
    rect = {tx: 2, ty: 2, tw: 4, th: 1}
}
```

### Custom components — `component` declarations + `custom:*` elements

The engine core does not include game-specific primitives (such as a Gen-I HP
bar). The game registers them as `custom:*` elements (`ElementRegistry`;
pokered sees pokered-ui's `custom_elements` module), and the `.gui` declares
their build-time schema with `component`. The compiler validates every use
site against the declaration (a missing required prop, a prop kind mismatch,
or an undeclared prop are all compile errors); after the runtime loads the
layout, the implementation-side `schema()` re-validates.

Declaration (usually collected in a shared `components.gui`):

```
// Gen-I HP bar: 4px tall, three-color fill by the original GetHealthBarColor thresholds
component hp_bar {
  current: expr required
  max: expr required
}
```

Prop kinds are `int` / `string` / `bool` / `color` / `expr`, with an optional
`required` marker. Use sites write the declared name as the element type:

```
hp_bar {
    rect = {tx: 13, ty: 3, tw: 6, th: 1}
    current = "{hp}"
    max = "{max_hp}"
}
```

The compiled JSON element `type` is `custom:hp_bar`; the game-registered
implementation renders it.

## Complete examples

### Dialog box

```
screen Dialog {
    panel {
        rect = {tx: 0, ty: 12, tw: 20, th: 6}
        style = "default"
        text("{text}") {
            rect = {tx: 1, ty: 13, tw: 18, th: 4}
            wrap = "word"
            line_spacing = 1
        }
        tile(31) {
            rect = {tx: 18, ty: 16, tw: 1, th: 1}
        }
    }
}
```

Compiled output:

```json
{
    "schema_version": 2,
    "screen": "Dialog",
    "elements": [
        {"type": "border", "rect": {"tx": 0, "ty": 12, "tw": 20, "th": 6}, "style": "default", "children": [
            {"type": "text", "rect": {"tx": 1, "ty": 13, "tw": 18, "th": 4}, "value": "{text}", "wrap": "word", "line_spacing": 1},
            {"type": "tile", "rect": {"tx": 18, "ty": 16, "tw": 1, "th": 1}, "tile_id": 31}
        ]}
    ]
}
```

### Bag screen

```
screen Bag {
    panel {
        rect = {tx: 6, ty: 0, tw: 8, th: 3}
        style = "default"
    }
    text("ITEM") {
        rect = {tx: 7, ty: 1, tw: 6, th: 1}
    }
    panel {
        rect = {tx: 0, ty: 3, tw: 20, th: 15}
        style = "default"
    }
    flex_list("{bag_items}") {
        rect = {tx: 1, ty: 4, tw: 18, th: 13}
        item_layout = [
            {field: "name", width: 14, align: "left"},
            {field: "qty", width: 3, align: "right", prefix: "x"}
        ]
        padding = {top: 1, left: 1}
        gap = 1
        cursor = {tile: 223, position: "left"}
    }
    text("CANCEL") {
        rect = {tx: 2, ty: 16, tw: 16, th: 1}
        color = "DarkGray"
    }
}
```

### Party screen

```
screen Party {
    text("No MONSTER!") {
        rect = {tx: 3, ty: 8, tw: 10, th: 1}
        visible = "{show_empty}"
    }
    container {
        rect = {tx: 0, ty: 0, tw: 20, th: 18}
        layout = {gap: 0}
        clip = false
        visible = "{show_entry1}"
        text("{mon1_name}") {
            rect = {tx: 4, ty: 0, tw: 10, th: 1}
        }
        text("L{mon1_level}") {
            rect = {tx: 14, ty: 0, tw: 3, th: 1}
        }
        text("{mon1_status}") {
            rect = {tx: 17, ty: 0, tw: 3, th: 1}
            color = "DarkGray"
        }
        text("{mon1_hp}") {
            rect = {tx: 14, ty: 1, tw: 6, th: 1}
        }
    }
    // ... mon2 through mon6 share this structure
}
```

## Syntax overview

Implemented syntax (pokered UI layout):

| Category | Syntax | Example |
| -------- | ------ | ------- |
| **Screen** | `screen` | `screen Dialog { }` |
| **Component** | `type`, `id = type` | `text("hello")`, `tile(31)` |
| **Positioning** | `rect` | `rect = {tx: 0, ty: 12, tw: 20, th: 6}` |
| **Property** | `key = value` | `align = "center"` |
| **Binding** | `{expression}` | `"{player_name}"` |
| **Object literal** | `{key: value}` | `cursor = {tile: 223, position: "left"}` |
| **Border** | `panel` | `panel { style = "default" }` |
| **Container** | `container` | `container { layout = {gap: 0} }` |
| **Text** | `text` | `text("Hello") { color = "Black" }` |
| **Tile** | `tile` | `tile(31) { rect = {...} }` |
| **Divider** | `divider` | `divider { tiles = [122] repeat = 17 }` |
| **List** | `list` | `list { source = "{items}" }` |
| **Flex list** | `flex_list` | `flex_list("{items}") { item_layout = [...] }` |
| **Button** | `button` | `button("OK") { on_click = "handler" }` |
| **Image** | `image` | `image("sprite.png") { slice = "..." }` |
| **Input** | `input` | `input { placeholder = "..." }` |
| **Dropdown** | `dropdown` | `dropdown { }` |
| **Cursor** | `cursor` | `cursor { row = "{cursor}" row_step = 2 }` |
| **Bracket frame** | `bracket` | `bracket { rect = {...} }` |
| **Pixel rectangle** | `pixel_rect` | `pixel_rect { rect = {...} }` |
| **Custom component** | `component` declaration + use | `component hp_bar { current: expr required }` → `hp_bar { current = "{hp}" }` |

`on_click` is the one implemented event property (on `button`); the other
`on_*` event properties, the `t()` runtime translation function, `dir`/RTL,
and animation remain proposals.

## Design principles

The implemented surface follows these principles:

1. **Declarative** — describes "what", not "how"
2. **Tile coordinates** — absolute positioning on a 20×18 grid
3. **Component-based** — built-in components plus game-defined custom
   components (`custom:*`) via `component` declarations
4. **Data binding** — `{var}` template variables resolved at runtime
5. **Object literals** — `{key: value}` syntax for complex properties
6. **Schema v2 output** — compiles to the JSON format the renderer expects
7. **Build-time validation** — use sites are checked against the `component`
   schema at compile time and re-validated after load at runtime

## File extensions and compile outputs

| File type | Extension | Purpose | Status |
| --------- | --------- | ------- | ------ |
| Scene file | `.scene` | Game scene (script + optional UI) | Implemented |
| UI layout | `.gui` | Pure UI layout definition | Implemented |
| Theme file | `.theme` | Color theme definitions | Implemented |
| Style file | `.style` | Reusable style collections | Implemented |
| Resource manifest | `.res` | Resource manifest | Not implemented |
| Animation definition | `.anim` | Keyframe animation definitions | Not implemented |

| Input | Output | Purpose |
| ----- | ------ | ------- |
| `.scene` | `name.js` + `name_ui.json` | Script + optional UI layout |
| `.gui` | `name.json` (schema v2) | Pure UI layout |
| `.theme` | `name.json` | Theme tokens |
| `.style` | `name_styles.json` | Resolved styles (including inheritance chain) |

A `.scene` that also carries `@theme`, `@style`, or `@atlas` blocks emits
additional `name_theme_N.json`, `name_styles.json`, and `name_atlas_N.json`
artifacts. `.theme` and `.style` file syntax lives in
[theme-style.md](theme-style.md).

## Related pages

- [Scene DSL compile contracts](codegen.md) — `@variables`, `@theme`,
  `@style`, `@atlas`, and `@if`/`@each` at the scene level
- [Theme and style file reference](theme-style.md) — `.theme` / `.style` syntax
- [Project manifest](../project-manifest.md) — where DSL files live in a game
  project
- [Internationalization guide](../../how-to/i18n.md)
- [Design history](../../archive/dsl-unified-design.md)
- [Docs index](../../index.md)
