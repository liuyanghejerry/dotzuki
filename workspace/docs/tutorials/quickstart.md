# Quickstart — your first zero-Rust game in 5 minutes

This is the **CLI-only** path (no editor, no Rust). It produces the same
project layout as the editor's Create wizard. For the editor path see
[`tools/dotzuki-editor/docs/first-game.md`](../tools/dotzuki-editor/docs/first-game.md).

**Prerequisite:** a `dotzuki` binary (build once: `cargo build --release --bin
dotzuki` from the workspace root — the binary is `target/release/dotzuki`).

## 1. Scaffold a project

```bash
dotzuki new my-game
cd my-game
```

This creates `.dotzuki-editor.json` (the manifest) plus `data/`, `gfx/` and an
`assets/scenes/main.scene` with a first dialogue.

## 2. Write a scene

Edit `assets/scenes/main.scene` in the **Game DSL** — dialogue, choices,
conditions and commands, all without code:

```dsl
game_scene Main {
    @variables {
        starter = 0
    }

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

`@t("en", "中文")` makes any text bilingual — `dotzuki run --lang zh` switches
language. See [`GAME_UI_DSL.md`](./GAME_UI_DSL.md) and
[`DSL_MAPPING.md`](./DSL_MAPPING.md) for the full syntax.

## 3. Check it compiles

```bash
dotzuki check .
```

This compiles every DSL file in-memory and reports diagnostics; exit code 0
means the scenes are valid.

## 4. Play it

```bash
dotzuki run .
```

Controls: **Arrows/WASD** move, **Z** = confirm/talk, **X** = cancel/run,
**Enter/Space** = Start menu, **Backspace** = Select.

Iterate with hot reload:

```bash
dotzuki run . --watch      # scenes + map reload as you save files
```

## Where to go next

- **Project layout & manifest** — [`game-project-spec.md`](./game-project-spec.md)
- **All CLI flags** — [`CLI_REFERENCE.md`](./CLI_REFERENCE.md)
- **Battle rules (`rules.ron`)** — [`BATTLE_ENGINE_GUIDE.md`](./BATTLE_ENGINE_GUIDE.md) §5
- **Editor with AI Story Designer** — [`../tools/dotzuki-editor/README.md`](../tools/dotzuki-editor/README.md)
- **Full doc index** — [`README.md`](./README.md)
