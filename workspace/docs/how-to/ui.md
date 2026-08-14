# UI Layouts

How to make `.gui` layouts: the 20×18 tile grid, panels and text, template
bindings, bilingual labels, custom components, and the preview-check loop.

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

The [GUI DSL reference](../reference/dsl/gui.md) is the authority on every
component and property — this page is the task view. Layouts pair with
[themes](./themes.md) and [bilingual text](./i18n.md); the manifest contract
for where files live is in [the project manifest](../reference/project-manifest.md).

## Where layouts live

A `.gui` file holds one [`screen`](../reference/glossary.md) — the top-level
layout — plus any number of [`component`](../reference/glossary.md)
declarations before it. Layout files live under the manifest's `ui`
activity: its `config.guiRoot` (project-root-relative) is the layouts
directory, and `dotzuki check` compiles everything in it:

```json
{ "id": "ui", "type": "ui", "config": { "guiRoot": "ui", "extension": ".gui" } }
```

A file may also hold nothing but `component` declarations — the shared
prelude pattern, conventionally `components.gui` in the same directory.
Finally, a `ui { }` block inside a `.scene` file declares an inline layout;
it compiles to `<SceneName>_ui.json` alongside the scene (see
[Authoring Scenes](./scenes.md)). Every form compiles to the same schema-v2
JSON the renderer expects.

## The tile grid

All positioning is absolute, on a 20×18 tile grid. Every component carries a
`rect`:

```
screen Box {
    panel {
        rect = {tx: 0, ty: 12, tw: 20, th: 6}
    }
}
```

- `tx` / `ty` — tile column / row of the top-left corner (0-based).
- `tw` / `th` — width / height in tiles.

20 tiles wide, 18 tall: a full-width bottom panel is `tx: 0, ty: 12,
tw: 20, th: 6`, a full-screen container is `tx: 0, ty: 0, tw: 20, th: 18`.

## A dialog box

The classic bottom-of-screen text box is a bordered `panel` with a `text`
child and a blinking `tile` cursor:

```
screen Dialog {
    panel {
        rect = {tx: 0, ty: 12, tw: 20, th: 6}
        style = "default"
        text("{text}") {
            rect = {tx: 1, ty: 13, tw: 18, th: 4}
            wrap = "word"
        }
        tile(31) {
            rect = {tx: 18, ty: 16, tw: 1, th: 1}
        }
    }
}
```

`style` picks the border (`"default"`, `"single"`, `"double"`, or a custom
object of tile ids); `wrap = "word"` wraps the text within its `rect`. The
compiled JSON is plain data — the shape the renderer draws:

```json
{
    "schema_version": 2,
    "screen": "Dialog",
    "elements": [
        {"type": "border", "rect": {"tx": 0, "ty": 12, "tw": 20, "th": 6}, "style": "default", "children": [
            {"type": "text", "rect": {"tx": 1, "ty": 13, "tw": 18, "th": 4}, "value": "{text}", "wrap": "word"},
            {"type": "tile", "rect": {"tx": 18, "ty": 16, "tw": 1, "th": 1}, "tile_id": 31}
        ]}
    ]
}
```

## Template variables

`{name}` inside a string is a [template variable](../reference/glossary.md) —
it passes through the compiler untouched and the renderer resolves it at
draw time against the runtime data context. Bindings work in text values,
`rect` values, and conditions:

```
screen BattleHud {
    text("{player_name}") {
        rect = {tx: 1, ty: 1, tw: 7, th: 1}
    }
    tile("{sprite_index}") {
        rect = {tx: 15, ty: 2, tw: 2, th: 2}
        visible = "{has_sprite}"
    }
    text("L{level}") {
        rect = {tx: 14, ty: 1, tw: 3, th: 1}
        color = "DarkGray"
    }
}
```

The game (or the editor preview) supplies the data; the layout names it.
Menus follow the same pattern: a `list` or `flex_list` takes a
`source = "{items}"` binding, and a `cursor` moves by `row` / `col`
bindings — see the [GUI DSL reference](../reference/dsl/gui.md) for the
list shapes.

## Bilingual labels

Wrap any `text(...)` or `button(...)` argument in `@t("en", "中文")` and the
label compiles to a per-language object; the renderer picks by the current
language and falls back to `en`:

```
screen Options {
    text(@t("TEXT SPEED", "文字速度")) {
        rect = {tx: 1, ty: 1, tw: 16, th: 1}
    }
    button(@t("CANCEL", "取消")) {
        rect = {tx: 2, ty: 16, tw: 8, th: 1}
    }
}
```

`@t` mixes with bindings — `@t("MONEY ${balance}", "金钱 ${balance}")` — and
the manifest's `story.locales` declares the language list. Runtime rules
live in [Bilingual Text (i18n)](./i18n.md).

## Custom components

The built-ins cover panels, text, tiles, lists, and cursors. Game-specific
widgets (an HP bar, a party card) are declared in a shared file and used by
name; the compiler validates every use site against the declaration:

```
// components.gui — prop schema only, shared by all layouts
component hp_bar {
  current: expr required
  max: expr required
}
```

```
// battle.gui
screen BattleHud {
    hp_bar {
        rect = {tx: 13, ty: 3, tw: 6, th: 1}
        current = "{hp}"
        max = "{max_hp}"
    }
}
```

The compiled element type is `custom:hp_bar`. A missing required prop, a
prop kind mismatch, or an undeclared prop is a compile error. Rendering the
element is the game's part: games register their `custom:*` implementations
with the renderer (`ElementRegistry`). The zero-Rust runner's own screens
(dialogue, menus, battle) are engine widgets, not layouts; custom layouts
appear wherever a game registers their renderers — including the editor
preview below.

## The preview-check loop

1. **Edit** the layout in the dotzuki-editor's UI activity. The editor's
   preview compiles the source, injects a theme, binds the editor's data,
   and rasterizes the result, so a broken layout shows a compile error
   instead of a picture.
2. **Check** with `dotzuki check` — it compiles every layout under the `ui`
   activity's `guiRoot` (and every `ui { }` block in scenes) and prints
   diagnostics; exit code 0 means the layouts compile.
3. **Ship** — the compiled schema-v2 JSON is the game-side contract; see
   [the codegen contract](../reference/dsl/codegen.md) for the exact
   shapes.
