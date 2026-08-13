# Architecture Overview

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

How the engine crates, the runner, the CLI and the editor fit together, and how a zero-Rust project flows from DSL files to a running game.

This page replaces the legacy `archive/developer-guide-legacy.md` as the
current-architecture walkthrough.

## Layering

```
game project (zero-Rust)          editor (Vue/Vite + Play via WASM runner)
  manifest + data/ + gfx/ + assets/        │
        │                                  │
        ▼                                  ▼
 dotzuki-runner ◄───────────── dotzuki-runner-web (WASM)
        │  loads manifest/DSL/maps/collision/tilesets
        ▼
 dotzuki-engine ── dotzuki-rules ── dotzuki-engine-dsl ── dotzuki-engine-script
        │            (RON → stacks)  (.scene/.gui/.theme/.style)  (Boa JS)
        ├── dotzuki-engine-tiled (Tiled .tmx → engine types)
        ├── dotzuki-renderer (GB-style tiles/text, CJK fonts) + dotzuki-ui (Painter trait)
        ├── dotzuki-audio (GB-APU emulation + sequencer)
        └── dotzuki-app (window/loop) / dotzuki-tui (terminal) / dotzuki-web
```

- Games are **zero-Rust**: the engine never probes a game's data directory.
  Rust games embed compiled artifacts via `compiler::compile_dirs` /
  `loader::register_compiled`; zero-Rust projects are loaded by the runner.
- Game repositories consume the engine as crates.io deps or tag-pinned git
  deps (see the repo `README.md`).

## From DSL to a running game

`.scene` / `.gui` / `.theme` / `.style` files compile through
`dotzuki-engine-dsl`:

- `.scene` → JavaScript executed by Boa (`dotzuki-engine-script`); the crate
  also ships a native AST interpreter (`interpreter.rs`) that executes scenes
  with no JS engine and mirrors the Boa runtime protocol 1:1 — it is the
  canonical scene semantics (Boa is a dev fallback behind a feature).
- `.gui` → JSON consumed by the renderer layout engine.
- `.theme` / `.style` → JSON token/stylesheet files (see
  [the theme & style reference](../reference/dsl/theme-style.md)).

`dotzuki check` compiles everything in memory; `dotzuki run` boots the runner
with the compiled project.

## Battle = effect stack

Live battle turns run through `dotzuki_engine::battle::stack::StackDriver`:
events, effects and handlers form a stack, and `dotzuki-rules` compiles
declarative `rules.ron` into those runtime stacks. The model and its RNG
determinism rationale are covered in [the effect stack page](effect-stack.md);
authoring is covered in [the battle rules guide](../how-to/battles.md).

## Provider pattern

Game data reaches the engine through the `GameData` trait. All identifier
types (Map, Item, Species, ...) are generic associated types on that trait, so
the engine crates contain no concrete game data and no platform calls
(no I/O, GPU or windowing in `dotzuki-engine`).

## Concern map

| Concern | Crate | Doc page |
|---|---|---|
| Battle stack + core types | `dotzuki-engine` | [effect stack](effect-stack.md) |
| Battle rules authoring | `dotzuki-rules` | [battle rules](../reference/battle-rules.md) |
| Tiled map import | `dotzuki-engine-tiled` | [maps guide](../how-to/maps.md) |
| Scripting | `dotzuki-engine-script` | [i18n guide](../how-to/i18n.md) |
| DSL compile | `dotzuki-engine-dsl` | [codegen contract](../reference/dsl/codegen.md) |
| Rendering | `dotzuki-renderer` / `dotzuki-ui` | [GUI reference](../reference/dsl/gui.md) |
| Audio | `dotzuki-audio` | [audio guide](../how-to/audio.md) |
| Zero-Rust runtime | `dotzuki-runner` | [project manifest](../reference/project-manifest.md) |
| CLI | `dotzuki-cli` | [CLI reference](../reference/cli.md) |
| Editor | `tools/dotzuki-editor` | [editor README](../../tools/dotzuki-editor/README.md) |

## Related pages

- [GameData provider design](game-data.md)
- [Save compatibility](save-compatibility.md)
- [Glossary](../reference/glossary.md)
