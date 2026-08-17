# Rust API Portal

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

The crate map and where each crate's API documentation lives; rustdoc is
the authoritative API reference, the pages below are the prose
counterpart.

All `dotzuki-*` crates share one version (currently `0.1.0`) and are published
on crates.io, so their API docs live on docs.rs. Local copy:

```bash
cd workspace
cargo doc --workspace --no-deps --open
```

## Crate map

| Crate | Purpose | API docs | Prose docs |
|---|---|---|---|
| `dotzuki-engine` | Core traits (`GameData`), tilemap/camera/triggers, battle effect stack, item/shop/equip | [docs.rs](https://docs.rs/dotzuki-engine) | [architecture](../explanation/architecture.md), [effect stack](../explanation/effect-stack.md) |
| `dotzuki-rules` | Declarative battle rules: RON → effect stacks | [docs.rs](https://docs.rs/dotzuki-rules) | [battle rules](battle-rules.md) |
| `dotzuki-rules-macro` | Derive/helpers for `dotzuki-rules` | [docs.rs](https://docs.rs/dotzuki-rules-macro) | [battle rules](battle-rules.md) |
| `dotzuki-engine-tiled` | Tiled `.tmx` (JSON) → engine types | [docs.rs](https://docs.rs/dotzuki-engine-tiled) | [maps guide](../how-to/maps.md) |
| `dotzuki-engine-script` | Boa-based async JS scripting | [docs.rs](https://docs.rs/dotzuki-engine-script) | [i18n guide](../how-to/i18n.md) |
| `dotzuki-engine-dsl` | Game DSL compiler (`.scene`/`.gui`/`.theme`/`.style`) + runtime compile API | [docs.rs](https://docs.rs/dotzuki-engine-dsl) | [scene](dsl/scene.md), [gui](dsl/gui.md), [theme & style](dsl/theme-style.md), [codegen](dsl/codegen.md) |
| `dotzuki-renderer` | GB-style tile/text renderer, CJK fonts | [docs.rs](https://docs.rs/dotzuki-renderer) | [gui](dsl/gui.md) |
| `dotzuki-ui` | UI widgets on a `Painter` trait | [docs.rs](https://docs.rs/dotzuki-ui) | [gui](dsl/gui.md) |
| `dotzuki-audio` | Audio abstraction + GB-APU sequencer | [docs.rs](https://docs.rs/dotzuki-audio) | [audio guide](../how-to/audio.md), [audio commands](audio-commands.md) |
| `dotzuki-app` | Native app shell (window/loop/hot-reload) | [docs.rs](https://docs.rs/dotzuki-app) | — |
| `dotzuki-tui` | Terminal shell (ratatui) | [docs.rs](https://docs.rs/dotzuki-tui) | — |
| `dotzuki-runner` | Zero-Rust project runtime + headless driver | [docs.rs](https://docs.rs/dotzuki-runner) | [project manifest](project-manifest.md) |
| `dotzuki-runner-web` | WASM build of the runner (editor Play) | [docs.rs](https://docs.rs/dotzuki-runner-web) | [publishing guide](../how-to/publishing.md) |
| `dotzuki-cli` | The `dotzuki` binary: `new` / `check` / `run` | [docs.rs](https://docs.rs/dotzuki-cli) | [CLI reference](cli.md) |
| `dotzuki-web` | WASM layout-preview bridge | [docs.rs](https://docs.rs/dotzuki-web) | — |

Tools outside the crates.io set:

| Tool | Purpose | Docs |
|---|---|---|
| `tools/dotzuki-editor` | Game-agnostic Vue/Vite editor, AI Story Designer, in-editor Play | [editor README](../../tools/dotzuki-editor/README.md) |
| `tools/asset-converter` | 2bpp → RGBA tileset + Tiled `.tsx` converter | [README](../../tools/asset-converter/README.md) |
| `tools/editor-extensions` | VSCode DSL syntax highlighting | `tools/editor-extensions` |
| `dotzuki-template/` | cargo-generate starter template | [README](../../dotzuki-template/README.md) |
