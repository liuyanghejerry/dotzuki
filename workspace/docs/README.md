# dotzuki Engine — Documentation Index

This directory is the **entry point for dotzuki's developer documentation**. The
engine is game-agnostic and consumed by game repositories as Cargo git
dependencies; most game authors never touch Rust. Pick your path below.

> **How to use this index.** Start from the *Reader guide*. Each document is
> marked **active** (maintained, reflects current code) or **historical**
> (predates the current architecture — read for context, not as reference).

## Reader guide

| You are… | Start here |
|---|---|
| Game author, zero Rust, want to build a game **without code** | [`QUICKSTART.md`](./QUICKSTART.md) — the 5-minute CLI path (`dotzuki new` → edit `.scene` → `dotzuki run`). Then [`game-project-spec.md`](./game-project-spec.md) for the full manifest/contract. |
| Game author using the **dotzuki-editor** (Vue-based editor) | [`../tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md) and [`first-game.md`](../tools/dotzuki-editor/docs/first-game.md) |
| Authoring **battle rules** (effect-stack, `rules.ron`) | [`BATTLE_ENGINE_GUIDE.md`](./BATTLE_ENGINE_GUIDE.md) (or [`BATTLE_ENGINE_GUIDE.zh-CN.md`](./BATTLE_ENGINE_GUIDE.zh-CN.md)) |
| Authoring **DSL** (`.scene` scripts, `.gui` UI, `.theme`/`.style`) | [`GAME_UI_DSL.md`](./GAME_UI_DSL.md) for the implemented UI syntax; [`THEME_STYLE_DSL.md`](./THEME_STYLE_DSL.md) for `.theme`/`.style`; see the DSL section below for the scene side |
| Authoring **maps** (Tiled `.tmx` + tilesets + entities) | `game-project-spec.md` §Maps; map entity sidecar `objects.json` is documented there |
| Authoring **audio** (`data/audio/*.json` tracks) | [`AUDIO.md`](./AUDIO.md) — `TrackDef` JSON, channels, commands, scene playback |
| Running / automating projects from the terminal | [`CLI_REFERENCE.md`](./CLI_REFERENCE.md) — `dotzuki new` / `check` / `run` and every flag |
| Shipping / deploying / upgrading | [`PUBLISHING.md`](./PUBLISHING.md) — project delivery, headless CI, WASM web play, engine upgrades, save compatibility |
| **Rust developer** extending the engine | [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) (maps/NPCs/items/save — legacy `Provider` API) + `BATTLE_ENGINE_GUIDE.md` (battle stack). Prefer reading the crate source / rustdoc for the current surface. |

## Active documents

| Document | Audience | Covers |
|---|---|---|
| [`QUICKSTART.md`](./QUICKSTART.md) | Game authors (CLI path) | 5-minute zero-code tour: `dotzuki new` → edit `.scene` → `check` → `run` |
| [`CLI_REFERENCE.md`](./CLI_REFERENCE.md) | Game authors, CI | Every `dotzuki` subcommand and flag: `new` / `check` / `run`, headless runs, screenshots, save options, exit codes |
| [`game-project-spec.md`](./game-project-spec.md) | Game authors, tool implementers | Zero-Rust project manifest (`.dotzuki-editor.json`), directory layout, `dotzuki run`/`check` behavior contract, **data-table record schemas** (combatant/encounter/skill/item/level), battle RON hooks, save compatibility. **The most current spec.** |
| [`AUDIO.md`](./AUDIO.md) | Game authors | Audio authoring: `data/audio/**/*.json` `TrackDef` format, channels, the 21 `AudioCommand`s, scene playback calls, runtime behavior |
| [`THEME_STYLE_DSL.md`](./THEME_STYLE_DSL.md) | DSL authors | `.theme` / `.style` file syntax, `@theme` tokens, `@style` colon-inheritance, codegen output shape |
| [`PUBLISHING.md`](./PUBLISHING.md) | Game authors, CI | Shipping a project, headless smoke tests, WASM web play via `dotzuki-runner-web`, engine upgrades, save versioning |
| [`BATTLE_ENGINE_GUIDE.md`](./BATTLE_ENGINE_GUIDE.md) | Battle authors (Rust + RON) | `dotzuki_engine::battle::stack` effect-stack engine, event/effect/handler model, RNG determinism, `dotzuki-rules` RON authoring, minimon tutorial, honest limitations |
| [`BATTLE_ENGINE_GUIDE.zh-CN.md`](./BATTLE_ENGINE_GUIDE.zh-CN.md) | Same (Chinese) | Simplified-Chinese translation of the battle guide (tracked separately) |
| [`GAME_UI_DSL.md`](./GAME_UI_DSL.md) | DSL authors | Implemented GUI DSL syntax: `.gui` files and `ui {}` blocks, component schema v2, `@t` bilingual text. (Flex/RTL/animation parts are proposals — marked inside.) |
| [`DSL_MAPPING.md`](./DSL_MAPPING.md) | DSL authors, compiler maintainers | Compilation contract: DSL constructs → emitted JS/JSON. **Note: contradicts DSL_UNIFIED_DESIGN on `@if`/`@run`; being reconciled against the code.** |
| [`../tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md) | Editor users | Full editor guide: activities (Maps/Scripts/Data/Assets/Tiles/Story/Play), AI Story Designer, animation pipeline, API endpoints |

## Historical / context documents

These predate the current engine architecture or the repo split. Read them for
background and design rationale; **do not use them as an API reference**.

| Document | What it is |
|---|---|
| [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) | Broad engine guide (architecture, maps, NPCs, items, save, rendering) built around the **legacy** `Provider`/`battle::driver` path. Battle section predates the effect stack — see the battle guide instead. Contains pre-split (`pokered`) references. |
| [`FULL_DSL.md`](./FULL_DSL.md) | Full-vision DSL overview; status table marks what is implemented vs proposed. Historical — the implemented surface lives in GAME_UI_DSL.md and DSL_MAPPING.md. |
| [`DSL_UNIFIED_DESIGN.md`](./DSL_UNIFIED_DESIGN.md) | Internal design doc from the DSL migration branches (`.scene` as binding truth, first-class `@if`). Historical — contradicts DSL_MAPPING on `@if`/`@run`; code supports both today. |
| [`JS_SCRIPT_I18N.md`](./JS_SCRIPT_I18N.md) | `game.lang()`/`game.t()`/`@t` usage in JS. Example paths are pre-split (`pokered-data`); API surface is still valid. |
| [`dsl-demo.html`](./dsl-demo.html) | Standalone syntax-highlighting demo page for the DSL. |

## Internal analysis (engine-gap-analysis/)

[`engine-gap-analysis/`](./engine-gap-analysis/) contains numbered design/audit
documents (00–17) used during engine generalization (effect-stack migration,
RON loader, production flip plan, etc.). These are **internal working notes**,
not user documentation — they are kept for design history.

## Related documentation elsewhere in the repo

- [`/README.md`](../../README.md) — repo landing page: what the engine is, crate list, git-dependency usage, build
- [`/AGENTS.md`](../../AGENTS.md) — orientation for AI agents working on the engine
- [`dotzuki-template/README.md`](../dotzuki-template/README.md) — cargo-generate Rust template (legacy main.rs path; the zero-Rust path is `dotzuki new` + game-project-spec)
