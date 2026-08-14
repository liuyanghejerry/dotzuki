# Scenes

How to author `.scene` story files: NPC dialogue, map-entry cutscenes,
choices, flags, battles from scenes, and the edit-check loop.

> - **Audience**: game authors
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

The [syntax reference](../reference/dsl/scene.md) is the authority on every
construct — this page is the task view: the recipes you reach for while
building, plus the runner contract that connects them to maps. If you have
not yet wired a map and its scene, start with
[Your First Game](../tutorials/your-first-game.md).

## Where scene files live

A [scene](../reference/glossary.md) is one `game_scene <Name> { ... }`
document in one `.scene` file. There is no import statement; every file
compiles on its own. Two places, one rule:

- `assets/scenes/` — the manifest's `game.scenesDir` (default), for story
  scenes. `game.entryScene` names the file used when the project runs
  without maps.
- `<mapsDir>/<map>/script.scene` — the per-map scene. The runner resolves a
  map's scene as this exact path, so the placement is the binding. With
  maps present, `entryMap` wins and the map's own scene drives play.

Both compile the same way. A `game_scene` holds `@variables`, `@storylines`
(the unnamed `main`), named `@storyline("name")` blocks, and at most one
`@load` (runs when the scene loads); the full block list is in the
[syntax reference](../reference/dsl/scene.md).

## NPC dialogue

The objects sidecar names the [storyline](../reference/glossary.md) an NPC
runs: the npc's `talk` field is a storyline name, and the scene declares
that storyline with a [trigger](../reference/glossary.md) route:

```json
"npcs": [{ "id": 1, "name": "Guide", "x": 10, "y": 7,
           "facing": "down", "sprite": "guide", "talk": "guide_talk" }]
```

```dsl
game_scene Hometown {
    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @speaker("Guide") {
            "Welcome to Hometown!"
            "The warp east leads to the Clearing."
        }
    }
}
```

- `@speaker(name)` marks player-initiated dialogue; the lines join into one
  paged text box with a `"Name: "` prefix. `@speaker("")` is the narrator
  form — lines render verbatim, no prefix.
- The runtime match is the npc's `talk` field; the `@trigger`'s `npc` value
  is the route key in the generated bindings, so keep the two names in
  sync.
- One storyline per NPC is the normal shape; the full trigger key table is
  in the [syntax reference](../reference/dsl/scene.md).

## A cutscene on map entry

Add `on_enter = true` to a trigger and the runner fires that storyline when
the map loads; use [`@say`](../reference/glossary.md) for scripted lines:

```dsl
game_scene Hometown {
    @storyline("hometown_intro") {
        @trigger(map = "Hometown", on_enter = true)
        @say("Guide") { "Hey! A traveler!" }
        @say("") { "The Guide walks over to greet you." }
    }
}
```

`@say` and `@speaker` compile to the same text box — the difference is
meaning: `@say` is [cutscene speech](../reference/glossary.md) inside an
auto-triggered storyline. All of a map's `on_enter` storylines run one
after another when the map loads.

## Choices, flags, and branching

Menus are `@choice` with `@option` bodies; branch on expressions with
`@if` / `@else`. [Flags](../reference/glossary.md) persist across scenes for
the session and ride the save:

```dsl
game_scene Hometown {
    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @if (getFlag("WON_GUIDE_BATTLE")) {
            @speaker("Guide") { "You beat the slime!" }
        } @else {
            @speaker("Guide") { "Want to try a battle?" }
            @choice {
                @option("Let's fight!") {
                    result = startBattle("slime")
                    @if (result == "win") {
                        @speaker("Guide") { "Well fought!" }
                        setFlag("WON_GUIDE_BATTLE")
                    } @else {
                        @speaker("Guide") { "Heal up and try again." }
                    }
                }
                @option("Not yet.") {
                    @speaker("Guide") { "Come back anytime." }
                }
            }
        }
    }
}
```

- The last `@option` is the fallback branch of the menu.
- Conditions may call sync queries such as `getFlag("X")`; keep async
  commands out of conditions.
- `result = startBattle("id")` binds the battle outcome — `"win"`,
  `"lose"`, or `"run"` — so the scene branches on it. Plain assignments
  hoist to the top of the storyline; call-valued ones stay in place.

## Battles from scenes

`startBattle(id)` starts a battle from a storyline: the id resolves an
[encounter](../reference/glossary.md) record first (trainer battles
included), then a single enemy record — a
[wild battle](../reference/glossary.md), where Run always succeeds.
Walk-triggered random battles are different: they are
[sceneless](../reference/glossary.md), armed by the map's `encounters`
block, and never resume a scene — see [Authoring Maps](./maps.md) and
[Battle Rules](../reference/battle-rules.md).

## Bilingual text

Author dialogue with [`@t("en", "中文")`](../reference/glossary.md) and the
host picks the variant at runtime from the manifest's `story.locales`,
falling back to `en`:

```dsl
game_scene Hometown {
    @storyline("guide_talk") {
        @trigger(map = "Hometown", npc = "Guide")
        @speaker("Guide") {
            @t("Welcome to Hometown!", "欢迎来到家乡镇！")
        }
    }
}
```

The recipe and runtime rules are in [Bilingual Text (i18n)](./i18n.md).

## The edit-check loop

1. Write or edit the `.scene` file.
2. Run `dotzuki check` — it compiles every scene (plus layouts, themes, and
   styles) and prints diagnostics; exit code 0 means the scenes compile.
3. Run `dotzuki run` and walk through the storyline. Branches that walking
   cannot reach (win/lose paths) are easiest to verify with temporary
   flags or triggers.

Same-(map, npc) routes without an `after` chain warn as a compile-time
conflict; see [the syntax reference](../reference/dsl/scene.md) for the
wording and the full trigger table.
