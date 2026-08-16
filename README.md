<div align="center">

<img src="workspace/resources/icon.png" width="128" alt="dotzuki">

# dotzuki

**Make a classic JRPG — without writing a single line of Rust.**

[![crates.io](https://img.shields.io/crates/v/dotzuki-engine.svg)](https://crates.io/crates/dotzuki-engine)
[![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-blue.svg)](#license)
[![Docs](https://img.shields.io/badge/docs-liuyanghejerry.github.io%2Fdotzuki-blue)](https://liuyanghejerry.github.io/dotzuki/stable/)

[Quickstart](#make-a-game-in-5-minutes) ·
[Documentation](https://liuyanghejerry.github.io/dotzuki/stable/) ·
[Editor](workspace/tools/dotzuki-editor/) ·
[Examples](workspace/examples/)

</div>

dotzuki is a game engine for building classic, Game Boy-style JRPGs —
overworld maps, NPC dialogue, turn-based battles, shops, menus, chiptune-style
audio, bilingual text — with a declarative DSL and a visual editor. You write
scenes and rules, not engine code.

Written from scratch in Rust as an original, independent implementation of
classic JRPG mechanics — not derived from any existing game's code, and not a
Game Boy emulator.

## Make a game in 5 minutes

No Rust required. Scaffold a project, write a scene, play it:

```bash
dotzuki new my-game
cd my-game
dotzuki run .
```

A scene is just a text file:

```dsl
game_scene Main {
    @storylines {
        @speaker("Guide") {
            "Welcome to your new JRPG project!"
            "Choose your starter!"
        }
        @choice {
            @option("Ember") {
                @speaker("Guide") {
                    @t("Ember is the fire type!", "炎系的选择！")
                }
            }
            @option("Dew") {
                @speaker("Guide") {
                    @t("Dew is the water type!", "水系的选择！")
                }
            }
        }
    }
}
```

`@t("en", "中文")` makes every line bilingual — `dotzuki run --lang zh`
flips the language. `dotzuki run . --watch` hot-reloads scenes and maps as
you save.

## Why dotzuki

- **Zero-Rust game authoring** — a game project is a manifest plus DSL files,
  maps, and assets. `dotzuki new` / `check` / `run` is the whole toolchain.
- **Battles as data** — turn-based combat runs on an effect-stack engine;
  author moves, type charts, and status rules declaratively in `rules.ron`.
- **Visual editor** — the dotzuki-editor (Vue/Vite) ships a Create wizard,
  map/DSL editing, an AI Story Designer, and in-editor playtesting powered by
  a WASM build of the runner.
- **Classic GB-style presentation** — tile/sprite rendering with CJK pixel
  fonts, JRPG UI widgets, and a chiptune-style audio layer included.
- **Bilingual by design** — `@t("en", "中文")` works in scenes, UI layouts,
  and themes from day one.
- **Play anywhere** — native app shell, terminal shell, and a WASM web build
  for shipping games in the browser.

## Using the engine from Rust

All `dotzuki-*` crates are on crates.io:

```toml
[dependencies]
dotzuki-engine = "0.1"
dotzuki-engine-dsl = "0.1"
```

Or pin a git tag — every crate is resolvable from this one repository:

```toml
[dependencies]
dotzuki-engine = { git = "https://github.com/liuyanghejerry/dotzuki", tag = "v0.1.1" }
```

The engine is trait-driven and game-agnostic: game data arrives through the
`GameData` trait, so no game content lives in the engine. See
[`workspace/examples/minimon`](workspace/examples/) for a battle demo built
entirely on the effect stack, plus the `your-first-game` example project.

<details>
<summary><b>Crate map</b> (click to expand)</summary>

- `dotzuki-engine` — core traits (`GameData`), tilemap/camera/triggers, the battle effect-stack (`battle::stack`), item/shop/equip systems, link-play seam
- `dotzuki-rules` + `dotzuki-rules-macro` — declarative battle rules: `rules.ron` → runtime Effect stacks
- `dotzuki-engine-dsl` — Game DSL compiler (`.scene` / `.gui` / `.theme` / `.style`, bilingual `@t`) with a native AST interpreter
- `dotzuki-engine-tiled` — Tiled `.tmx` (JSON) maps → engine types
- `dotzuki-engine-script` — Boa-based async JS scripting
- `dotzuki-renderer` — GB-style tile/sprite/text rendering, CJK pixel fonts, UI layout
- `dotzuki-ui` — reusable JRPG UI widgets on a `Painter` trait
- `dotzuki-audio` — audio abstraction layer
- `dotzuki-app` / `dotzuki-tui` — native app shell (hot-reload) / terminal shell
- `dotzuki-runner` + `dotzuki-runner-web` — zero-Rust project runtime and its WASM build
- `dotzuki-cli` — the `dotzuki` binary: `new` / `check` / `run`
- `dotzuki-web` — WASM bridge for editor layout preview

</details>

## Building from source

The Cargo workspace root is `workspace/`:

```bash
cd workspace
cargo build --release
cargo test
target/release/dotzuki new demo && target/release/dotzuki run demo
```

Releases publish every crate to crates.io from a single `vX.Y.Z` tag via
`.github/workflows/release.yml` — see `AGENTS.md` → "Releasing" for details.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
