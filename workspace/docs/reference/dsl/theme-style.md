# Theme & Style DSL Reference (`.theme` / `.style`)

> - **Audience**: DSL authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

Syntax and compiled output of `@theme` / `@style` blocks; usage patterns live in [the themes & styles how-to](../../how-to/themes.md).

You declare themes and styles in standalone `.theme` / `.style` files or as
inline `@theme` / `@style` blocks at the top level of `.scene` files (`.gui`
files reference styles by name only), and `dotzuki-engine-dsl` compiles them
into JSON for the renderer. This reference tracks the current codegen
(`crates/dotzuki-engine-dsl/src/codegen/json_theme.rs`).

## `@theme` — color themes

```dsl
@theme dark {
    primary    = "#c9a03d"
    background = "#1a1a2e"
    surface    = "#16213e"
    text       = "#eeeeee"
    text_muted = "#888888"
}
```

- Syntax: `@theme <name> { <key> = <value>; ... }`. Token values accept strings
  only (numeric expressions are an `@style` property feature).
- Compiles to `{"name": "dark", "tokens": {"primary": "#c9a03d", ...}}`.
- Properties reference theme tokens by name: `background =
  "@theme.surface"`. The engine does not resolve the reference — the value
  enters the JSON as the literal string, and the consumer/renderer interprets
  it by convention.

## `@style` — reusable styles (with inheritance chains)

```dsl
@style card {
    border     = "rounded"
    padding    = 12
    background = "@theme.surface"
}

@style card_hover : card {
    background = "@theme.primary"
    scale      = 1.02
}
```

- Syntax: `@style <name> { <prop> = <value>; ... }`.
- Inheritance uses the colon form `@style <child> : <parent> { ... }` (there is
  no `extends` keyword).
- The compiler resolves inheritance chains: child properties override parent
  properties. The card example compiles to:

```json
[
  { "name": "card", "properties": { "border": "rounded", "padding": 12, "background": "@theme.surface" } },
  {
    "name": "card_hover",
    "extends": "card",
    "inheritance_chain": ["card_hover", "card"],
    "properties": { "border": "rounded", "padding": 12, "background": "@theme.primary", "scale": 1.02 }
  }
]
```

- Circular inheritance (`A : B : A`) is a compile-time error
  (`CircularStyleInheritance`) and fails compilation.

## Divergence from legacy documents

Legacy `DSL_MAPPING.md` entries 9/10 described a single-map theme shape and a
`{"card_hover": {"__extends": "card"}}` style shape. Both are stale: the
current codegen emits one `{"name", "tokens"}` file per theme and style output
with an `extends` field plus an `inheritance_chain` array, as shown above.
This page and the [codegen contract](./codegen.md) are authoritative.

> Note: the legacy GAME_UI_DSL document (§4.2/4.3) sketched a broader
> theme/style vision; the inline-`@theme`-in-`.gui` part remains a proposal
> (see [the archived GAME_UI_DSL document](../../archive/game-ui-dsl.md)).
