# Glossary

> - **Audience**: all readers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

Canonical definitions of dotzuki terms. Link to an entry here the first time
you use a term in a document (doc-standard §4.2); this page is the only
authoritative term list (doc-standard §11.4).

## Project & authoring

- **zero-Rust project** — a game built without Rust: a plain directory with a
  `.dotzuki-editor.json` manifest plus `data/`, `gfx/` and `assets/` (DSL
  files), run by the `dotzuki` CLI or the editor. See
  [the project manifest](./project-manifest.md).
- **manifest** — the `.dotzuki-editor.json` file declaring the game's layout,
  entry map, activities and battle section.
- **activity** — one editing surface in the dotzuki-editor (Maps / Scripts /
  Data / Assets / Tiles / Story / Play); maps to a manifest section.
- **data table** — a record collection in `data/` with a fixed schema
  (combatants, encounters, skills, items, levels). See
  [data tables](./data-tables/combatants.md).
- **Game DSL** — the declarative language for scenes and UI: `.scene`
  (storylines), `.gui` (layouts), `.theme` / `.style` (colors & styles).
- **`@t("en", "中文")`** — bilingual text syntax; compiles to per-locale
  values, and the runtime language selects the value. See
  [the i18n guide](../how-to/i18n.md).
- **RON** — the Rusty Object Notation config format used for battle rules
  (`rules.ron`).

## Engine

- **`GameData`** — the provider trait every game implements to hand data to
  the engine; all identifier types (Map, Item, Species, ...) are generic
  associated types on it, so the engine carries no concrete game data.
- **effect stack** — the battle model: turns run as a stack of effects and
  handlers driven by `dotzuki_engine::battle::stack::StackDriver`. See
  [the effect stack explanation](../explanation/effect-stack.md).
- **`rules.ron`** — the declarative battle-rules file compiled by
  `dotzuki-rules` into runtime effect stacks. See
  [battle rules](./battle-rules.md).
- **runner** — `dotzuki-runner`: loads a zero-Rust project (manifest, DSL,
  maps, collision, tilesets) and drives `RunnerGame`; also runs headless.
- **headless** — running without a window or audio device, used for CI smoke
  tests and screenshots (`dotzuki run --headless`).
- **Boa** — the JavaScript engine behind `dotzuki-engine-script`; the DSL's
  native AST interpreter mirrors its runtime protocol and is the canonical
  scene semantics.
- **`TrackDef` / `AudioCommand`** — the JSON audio track schema and its 22
  channel commands. See [audio commands](./audio-commands.md).
- **save version** — the version stamp inside `.dotzuki-save.json`; older
  saves load on newer engines, newer saves are refused by older engines. See
  [save compatibility](../explanation/save-compatibility.md).
- **minimon** — the engine demo example (`examples/minimon`): a battle system
  authored entirely in `rules.ron`, proving the engine is game-agnostic.
- **WASM runner** — `dotzuki-runner-web`, the web build of the runner that
  powers the editor's Play activity and web playtesting.
