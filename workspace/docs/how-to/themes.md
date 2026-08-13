# Themes & Styles How-to

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

Declare colors and reusable style sets in `.theme` / `.style` files (or inline `@theme` / `@style` blocks) and apply them to UI components. The syntax and codegen contract live in [the theme & style reference](../reference/dsl/theme-style.md).

Themes and styles compile through `dotzuki-engine-dsl` into JSON consumed by
the renderer. `dotzuki check` validates them in memory without writing
artifacts; disk outputs are produced only when an output directory is given
(e.g. a game crate's `build.rs` via `compiler::compile_dirs`).

## File types and outputs

| Input | Requirement | Compiled output |
|---|---|---|
| `foo.theme` | At least one `@theme` block | Each `@theme <name>` → `<name>.json` (`{"name", "tokens"}`) |
| `bar.style` | At least one `@style` block | `_auto_styles.json` (a standalone `.style` file is always wrapped as scene `_auto`, independent of the file name; the resolved inheritance chain is included) |
| Inline `@theme` in a `.scene` | — | `<scene名>_theme_<i>.json` |
| Inline `@style` in a `.scene` | — | `<scene名>_styles.json` |

All outputs carry a `// @generated` header plus JSON.

## Ways to use themes and styles

1. **Standalone files** — `*.theme` / `*.style` anywhere under `data/` or the
   DSL directories; `dotzuki check` compiles them.
2. **Inline blocks** — `@theme` / `@style` at the top level of a `.scene`,
   compiled together with the scene.
3. **Referencing from the GUI** — `.gui` / `ui {}` components apply styles via
   `style = "<name>"`; theme tokens are referenced in property values as
   `@theme.<key>` (the value is passed through verbatim into the JSON and
   interpreted by the consumer/renderer).

A minimal standalone theme:

```dsl
@theme dark {
    primary    = "#c9a03d"
    background = "#1a1a2e"
    text       = "#eeeeee"
}
```

## Related pages

- [Theme & style syntax reference](../reference/dsl/theme-style.md)
- [GUI DSL reference](../reference/dsl/gui.md)
- [DSL codegen contract](../reference/dsl/codegen.md)
