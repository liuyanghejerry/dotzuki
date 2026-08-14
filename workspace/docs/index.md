# dotzuki Engine — Documentation Index

This directory is the **entry point for dotzuki's developer documentation**. The
engine is game-agnostic and consumed by game repositories as Cargo git
dependencies; most game authors never touch Rust. Pick your path below.

Chinese translations (`-zh-CN` siblings) are listed in `SUMMARY.md` under
the 「中文（zh-CN）」 group; the English source is authoritative (doc-standard
§6).

## Reader guide

| You are… | Start here |
|---|---|
| Game author, zero Rust, want to build a game **without code** | [`tutorials/quickstart.md`](./tutorials/quickstart.md) — the 5-minute CLI path (`dotzuki new` → edit `.scene` → `dotzuki run`). Then [`reference/project-manifest.md`](./reference/project-manifest.md) for the full manifest/contract. |
| Game author using the **dotzuki-editor** (Vue-based editor) | [`tutorials/editor-first-game.md`](./tutorials/editor-first-game.md) and [`../tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md) |
| Authoring **battle rules** (effect-stack, `rules.ron`) | [`how-to/battles.md`](./how-to/battles.md) for authoring; [`reference/battle-rules.md`](./reference/battle-rules.md) for the rule formats; [`explanation/effect-stack.md`](./explanation/effect-stack.md) for the model |
| Authoring **DSL** (`.scene` / `.gui` / `.theme` / `.style`) | [`reference/dsl/scene.md`](./reference/dsl/scene.md), [`reference/dsl/gui.md`](./reference/dsl/gui.md), [`reference/dsl/theme-style.md`](./reference/dsl/theme-style.md), [`reference/dsl/codegen.md`](./reference/dsl/codegen.md) |
| Authoring **maps** (Tiled `.tmx` + tilesets + entities) | [`how-to/maps.md`](./how-to/maps.md); the map entity sidecar `objects.json` is documented there |
| Authoring **audio** (`data/audio/*.json` tracks) | [`how-to/audio.md`](./how-to/audio.md) for the format, [`reference/audio-commands.md`](./reference/audio-commands.md) for the 22 commands |
| Writing **bilingual text** | [`how-to/i18n.md`](./how-to/i18n.md) — `game.lang()` / `game.t()` / `@t` |
| Running / automating projects from the terminal | [`reference/cli.md`](./reference/cli.md) — `dotzuki new` / `check` / `run` and every flag |
| Shipping / deploying / upgrading | [`how-to/publishing.md`](./how-to/publishing.md) — project delivery, headless CI, WASM web play, engine upgrades, save compatibility |
| **Rust developer** extending the engine | [`explanation/architecture.md`](./explanation/architecture.md) for the current architecture, [`reference/rustdoc.md`](./reference/rustdoc.md) for the crate map + docs.rs links, [`explanation/game-data.md`](./explanation/game-data.md) for the `GameData` trait |
| Looking up a term | [`reference/glossary.md`](./reference/glossary.md) — the authoritative term list |

## Tutorials

| Document | Covers |
|---|---|
| [`tutorials/quickstart.md`](./tutorials/quickstart.md) | 5-minute zero-code tour: `dotzuki new` → edit `.scene` → `check` → `run` |
| [`tutorials/your-first-game.md`](./tutorials/your-first-game.md) | Build the `examples/your-first-game/` project step by step: town, scripted battle, random encounters, save |
| [`tutorials/editor-first-game.md`](./tutorials/editor-first-game.md) | 15-minute guided tour of the dotzuki-editor, from an empty machine to a playable project with a battle |

## How-to guides

| Document | Covers |
|---|---|
| [`how-to/maps.md`](./how-to/maps.md) | Tiled `.tmx` (JSON) maps, tilesets, elevation, entities and the `objects.json` sidecar |
| [`how-to/scenes.md`](./how-to/scenes.md) | Authoring `.scene` stories: NPC dialogue, map-entry cutscenes, choices, flags, scene battles |
| [`how-to/ui.md`](./how-to/ui.md) | Authoring `.gui` layouts: the 20×18 grid, panels/text, template bindings, `@t` labels, custom components |
| [`how-to/battles.md`](./how-to/battles.md) | Authoring `rules.ron`: the minimon tutorial, type effectiveness, resources & move costs, cookbook, determinism |
| [`how-to/themes.md`](./how-to/themes.md) | Declaring `.theme` / `.style` files and applying them to UI |
| [`how-to/audio.md`](./how-to/audio.md) | `TrackDef` JSON tracks, channels, scene playback, authoring notes |
| [`how-to/i18n.md`](./how-to/i18n.md) | Bilingual text: the `game` i18n API and `@t` syntax |
| [`how-to/publishing.md`](./how-to/publishing.md) | Shipping a project, headless smoke tests, WASM web play, engine upgrades |

## Reference

| Document | Covers |
|---|---|
| [`reference/project-manifest.md`](./reference/project-manifest.md) | Zero-Rust project manifest (`.dotzuki-editor.json`), directory layout, `dotzuki run`/`check` behavior contract, editor playtest |
| [`reference/battle-rules.md`](./reference/battle-rules.md) | The `battle` manifest section, `rules.ron` hooks, validation contract |
| [`reference/data-tables/`](./reference/data-tables/combatants.md) | Record schemas: [combatants](./reference/data-tables/combatants.md), [encounters](./reference/data-tables/encounters.md), [skills](./reference/data-tables/skills.md), [items](./reference/data-tables/items.md), [levels](./reference/data-tables/levels.md) |
| [`reference/dsl/scene.md`](./reference/dsl/scene.md) | `.scene` syntax — verified against the parser/interpreter, every construct cited to its code location |
| [`reference/dsl/gui.md`](./reference/dsl/gui.md) | Implemented `.gui` / `ui {}` syntax, component schema v2, `@t` |
| [`reference/dsl/theme-style.md`](./reference/dsl/theme-style.md) | `@theme` / `@style` syntax and codegen output |
| [`reference/dsl/codegen.md`](./reference/dsl/codegen.md) | DSL → JS/JSON compilation contract, reconciled against the code |
| [`reference/audio-commands.md`](./reference/audio-commands.md) | The 22 `AudioCommand` variants with fields |
| [`reference/cli.md`](./reference/cli.md) | Every `dotzuki` subcommand and flag, exit codes |
| [`reference/glossary.md`](./reference/glossary.md) | Canonical term definitions |
| [`reference/rustdoc.md`](./reference/rustdoc.md) | Crate map + docs.rs links for Rust developers |

## Explanation

| Document | Covers |
|---|---|
| [`explanation/architecture.md`](./explanation/architecture.md) | Current architecture: engine crates, runner, CLI, editor, and the DSL-to-game flow |
| [`explanation/effect-stack.md`](./explanation/effect-stack.md) | The battle effect-stack model, event/handler architecture, RNG determinism, honest limits |
| [`explanation/game-data.md`](./explanation/game-data.md) | The `GameData` provider trait and its generic associated types |
| [`explanation/save-compatibility.md`](./explanation/save-compatibility.md) | Save versioning and forward/backward compatibility rules |

## Release notes

- [`release-notes/changelog.md`](./release-notes/changelog.md) — version history; migration guides live next to it per release (first: [`release-notes/migration/v0.1.0.md`](./release-notes/migration/v0.1.0.md))

## Archive

Historical documents, kept for context. Their links are not maintained; read
the active pages above instead.

| Document | What it is |
|---|---|
| [`archive/developer-guide-legacy.md`](./archive/developer-guide-legacy.md) | Pre-split engine guide built around the legacy `Provider` API path; superseded by `explanation/architecture.md` |
| [`archive/full-dsl.md`](./archive/full-dsl.md) | Full-vision DSL overview with implemented/proposed status; superseded by `reference/dsl/*` |
| [`archive/dsl-unified-design.md`](./archive/dsl-unified-design.md) | Internal design doc from the DSL migration branches; reconciled into `reference/dsl/codegen.md` |
| [`archive/game-ui-dsl.md`](./archive/game-ui-dsl.md) | Legacy GUI DSL document mixing implemented syntax with proposals; the implemented surface lives in `reference/dsl/gui.md` |

## Documentation system

- [`doc-standard.md`](./doc-standard.md) — the writing & structure standard this
  site follows (four-layer model, meta headers, freshness states, language
  policy, style rules, example verification, code-sync workflow).
- [`doc-outline.md`](./doc-outline.md) — the target site outline and the
  migration map that produced this layout.
- Every page carries a meta header (`Audience` / `Type` / `Status` /
  `Last verified`); a Clausura AI gate (`.github/workflows/docs-review.yml`)
  reviews docs changes against `doc-standard.md` on every PR.

## Related documentation elsewhere in the repo

- [`/README.md`](../../README.md) — repo landing page: what the engine is, crate list, git-dependency usage, build
- [`/AGENTS.md`](../../AGENTS.md) — orientation for AI agents working on the engine
- [`tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md) — full editor guide; [`AI_AGENT_FRAMEWORK.md`](../tools/dotzuki-editor/docs/AI_AGENT_FRAMEWORK.md) — the editor's AI Story Designer framework
- [`tools/asset-converter/README.md`](../tools/asset-converter/README.md) — 2bpp → RGBA tileset + Tiled `.tsx` converter
- [`dotzuki-template/README.md`](../dotzuki-template/README.md) — cargo-generate Rust template (legacy `main.rs` path; the zero-Rust path is `dotzuki new` + project manifest)
