# Engine Gap Analysis — what's missing to build *your own* Pokémon-like game

**Question answered:** What does this project lack that is (a) essential to the
engine and (b) useful for a developer who wants to build their own Pokémon-like
game on top of `dotzuki-engine`?

See companion docs: [`01-engine-inventory.md`](01-engine-inventory.md),
[`02-pokered-inventory.md`](02-pokered-inventory.md),
[`03-firered-systems.md`](03-firered-systems.md).

## Executive summary

The pokered *example game* is mature and nearly complete (~51k LOC of logic, 82
move effects, 151 species, 249 maps, full battles/HMs/audio/SRAM saves). The
**generic engine is not** — and that is the real gap. By the project's own
charter (`dotzuki-engine` = reusable, pokered = one example), the engine today gives
a new developer the overworld, tilemap/camera, dialog, menu controller, save
container, and the JS scripting bridge — but **almost every Pokémon-defining
system lives only inside `examples/pokered/` and cannot be reused.** A developer
starting a fresh game would get a walkable map and a text box, then have to
reimplement battles, parties, items, the bag/party/box UIs, encounters, and
trading from scratch. The highest-value work is **lifting proven pokered-core
systems up into reusable, generically-parameterized engine crates**, using
FireRed's architecture as the reference for how general to make them.

> **P0 status update (2026-06): substantially MIGRATED — engine layer landed, call-site swaps mostly STAGED.**
> All five P0 subsystems now have a generic, game-agnostic engine layer, landed and
> green; four of the five (P0a/c/d/e) also have pokered provider impls + parity tests.
> **Exception: P0b (battle driver) shipped engine-only — no pokered driver wiring and
> no parity test yet** (the real provider overrides none of its 4 new hooks). The
> `dotzuki-engine` crate still
> links **no `rand`** (not even transitively) and the new modules contain **zero
> Pokémon identifiers** — every Gen-1 quirk stays provider-side; RNG flows through
> the `BattleRng` trait. **However, the production call-site swaps were intentionally
> STAGED, not done** for most systems: the engine code is purely additive, and
> pokered still runs its own legacy loops/paths in production. "Staged" means staged.
> Verified: dotzuki-engine 290 tests pass / 0 fail; pokered-core 1802 pass / 0 fail;
> workspace builds clean. See [`05-p0-migration-report.md`](05-p0-migration-report.md)
> for the full per-system DONE-vs-STAGED breakdown and the consolidated follow-up list.
>
> **Fix-pass update (2026-06-02):** the per-review *nits* are now closed — P0a/P0c/P0d
> fully fixed; P0b's event-fidelity crit gap and P0e's cure-parity depth + honesty docs
> fixed (commits `5210d6e1`/`794af386`/`f168e633`/`2dc9b735`/`55c2ba87`). The
> **production call-site swaps stay STAGED** (all five), and P0b's end-to-end
> battle-loop differential parity, P0d fishing parity, and P0e non-cure-effect routing
> remain STAGED/unreachable. Engine still rand-free + Pokémon-free; green at
> **dotzuki-engine 292 / pokered-core 1821**. See the report's top "Update" section.

**Top gaps (tagged by priority):**
- **P0 — ✅ engine layer landed; call-site swap staged** (`60c9477a`, `9b6d561e`) Battle engine now has a generic turn-execution driver (`battle/driver.rs`) and a generic AI driver (`battle/ai.rs`); turn loop, damage, status, AI scoring still execute via pokered's own loop in production (no driver wired in).
- **P0 — ✅ engine layer landed; Pokemon-struct re-point staged** (`792c8410`) Generic party/monster model (EXP, level-up, stats, evolution) lives in `dotzuki-engine/party/`; production leveling still flows through pokered's `process_level_up` (the engine's `gain_exp` is not yet a drop-in — see report §party).
- **P0 — ✅ engine layer landed; call-site swap staged** (`829b0800`) Reusable encounter/wild-spawn + battle-handoff flow in `overworld/encounter.rs`; production `check_wild_encounter_on_step` still uses `rand` directly and the legacy table path.
- **P0 — ✅ engine layer landed; call-site swap staged** (`4413363f`) Generic item-effect + bag/shop driver in `items/use_driver.rs`; production bag/battle/mart UIs still drive the legacy per-effect paths.
- **P1** No generic high-level menu/UI widget library (bag/party/summary/list) — pokered-ui only.
- **P1** PC box storage exists only in pokered; not an engine module.
- **P1** Save framework lacks dual-slot rotation + corruption recovery (FireRed-style).
- **P1** Scripting API: battle/shop/party/PC verbs are pokered-registered, undocumented for reuse.
- **P1** Field-effect / HM (Surf/Cut/Fly…) system is pokered-only; no generic field-move hook.
- **P1** No reusable platform shell — `pokered-web/android/ios` hardcode `PokemonGame`.
- **P2** No networked link transport (only in-process channel); trading can't cross machines.
- **P2** No Pokédex/summary-screen engine widgets; no daycare/breeding; no clock/RTC/time-of-day.
- **P2** Tiled parser is JSON-only; no map-authoring docs/toolchain for engine users.
- **P2** `game_api.rs` is an empty stub; `MenuSystem::new` uses `unsafe mem::zeroed()`.

## Prioritized gap table

> **P0 rows below: status as of 2026-06.** Each P0 gap's engine layer + provider impl + parity tests are landed and green; the **production call-site swap is mostly STAGED** (engine is additive, pokered still runs legacy paths). Status + commit noted inline. Details: [`05-p0-migration-report.md`](05-p0-migration-report.md).

| Gap | Why essential | Currently where | FireRed reference | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| Turn-based battle engine (turn loop, order, damage formula, status ticks, switching) | The core of any Pokémon-like; engine has the framework but no driver | `dotzuki-engine/battle/mod.rs` = real `BattleProvider`/`BattleState`/`MoveEffect` abstraction (~1.1k LOC, tested); **generic turn-execution driver now landed** in `battle/driver.rs` + `battle/rng.rs` (`BattleDriver`, `BattleRng`, hooks `turn_order_key`/`before_move`/`accuracy_check`/`end_of_turn`). Real driver still in `pokered-core/battle/` (13.4k LOC) | `battle_main.c`, `battle_script_commands.c` | L | **P0** | ✅ engine layer landed; **call-site swap staged** (`60c9477a`). pokered `BattleProvider` overrides none of the 4 new hooks; **no differential parity test yet** — equivalence to the real Gen-1 loop is asserted but not demonstrated. |
| Generic battle AI | Trainer/opponent behavior; no impl in engine | `BattleAI` trait only; **new generic `BattleAiProvider` + `BattleAi::choose` argmax/tie-break driver** in `battle/ai.rs`; impl in `pokered-core/battle/trainer_ai/` | `battle_ai_script_commands.c` (93 cmds) | M | **P0** | ✅ engine layer landed; **call-site swap staged** (`9b6d561e`). Parity test runs the **real** `choose_moves`/`pick_move`, but only for the empty-layer (all-tied) case; non-trivial Layer1/2/3 scoring not yet parity-tested. |
| Party / monster model (EXP, level-up, stat growth, evolution) | No game without parties; engine treats `Species` as opaque ID | **new generic model in `dotzuki-engine/party/`** (`Monster`/`MonsterStatus`, `Party`/`BoxStore`, `MonsterProvider`/`ExpProvider`/`EvolutionProvider`); pokered-core `pokemon/`, `battle/experience/` retain production logic | `pokemon.c` `GetMonData`/`SetMonData` | L | **P0** | ✅ engine layer landed; **Pokemon-struct re-point staged** (`792c8410`). Provider stat/exp/evo math is pure delegation (parity-tested); but engine `gain_exp`/`recalc_stats` HP handling **diverges** from legacy `process_level_up` (no HP-delta growth, no move-learning) — **not a drop-in** for the level-up path. |
| Wild encounter + battle handoff | Connect overworld → battle generically | **new `EncounterProvider`/`EncounterEngine::on_step` in `overworld/encounter.rs`**; pokered-core overworld encounters + `script_bridge` retain production path | `field_control_avatar.c` `CheckStandardWildEncounter` | M | **P0** | ✅ engine layer landed; **call-site swap staged** (`829b0800`). Parity test is genuine (drives legacy `check_wild_encounter` vs `on_step` on the same RNG stream). Swap deferred for a real reason: legacy draws **both** RNG bytes unconditionally up front; `on_step` gates first and draws zero on ineligible tiles → swapping would change the RNG draw count and desync the stream. |
| Item effects + bag/shop flow | `Inventory` exists but no effect application or use-flow | **new generic `use_driver.rs` (`use_item`/`buy`/`sell`) + defaulted `ItemProvider::usable_in`/`apply_effect` + `ShopProvider`**; pokered-core `items/`, `pokered-ui` bag/mart retain production paths | scrcmd item ops, `buy_menu_helpers.c` | M | **P0** | ✅ engine layer landed; **call-site swap staged** (`4413363f`). Only status-cure flows through `apply_effect`; HP/PP/vitamin/Rare-Candy return `NoEffect` there (stay on the `Pokemon` path) — a naive swap of the use path to `use_item` would silently break healing/PP/vitamin items. Parity tested for Potion/Antidote(Poison)/HP-Up only. |
| High-level menu/UI widget library (list menu, bag/party/summary, yes-no, multichoice) | Engine has only a low-level `MenuSystem`; every game needs these | `pokered-ui/src/menus/` (19 renderers) | `list_menu.c`, `script_menu.c`, `pokemon_summary_screen.c` | M | **P1** |
| PC / box storage system | Standard Pokémon feature; reusable container | pokered-core `pokemon/pc_box.rs`, `pc_menu.rs` | `pokemon_storage_system*.c` (14 boxes) | M | **P1** |
| Robust save framework (dual-slot rotation, CRC, corruption recovery) | Engine save is single-blob CRC only | `dotzuki-engine/save/` (`SaveManager`, CRC16) | `save.c`, `save_failed_screen.c` (14 sectors) | M | **P1** |
| Documented, reusable scripting API surface (battle/shop/party/PC/give verbs) | These are registered by pokered, invisible to new games | `engine.rs::register_core_game_api` + pokered registrar | `scrcmd.c` (~213), `gSpecials` (445) | S–M | **P1** |
| Field-effect / HM / field-move hook system | Surf/Cut/Fly/Strength/Flash are game-defining traversal | pokered-core `overworld/hm_effects.rs` | `field_effect.c`, `fldeff_*.c` (75 FLDEFF) | M | **P1** |
| Reusable platform shell (decoupled from PokemonGame) | "Engine+example" split breaks at platform layer | `pokered-web/android/ios` hardcode `pokered_app` | n/a (Rust-specific) | M | **P1** |
| Networked link transport (TCP/serial) | Only in-process channel exists; no cross-machine trade/battle | `pokered-core/link/transport.rs` (`ChannelTransport`) | `link.c`, `trade.c`, RFU stack | M–L | **P2** |
| Pokédex + summary screen as engine widgets | Common, currently pokered-only | pokered-core pokedex screens | `pokedex.c`, `pokemon_summary_screen.c` | M | **P2** |
| Daycare/breeding, clock/RTC, time-of-day evolution | Depth features absent from Gen-1 baseline | absent | `daycare.c`, `berry.c`, `RtcCalcLocalTime` | M | **P2** |
| Map authoring toolchain + docs (and XML Tiled support) | New devs need a documented map pipeline; parser is JSON-only | `dotzuki-engine-tiled` (JSON `.tmx`), `tools/` | `mapjson`, `layouts.json`, porymap docs | S–M | **P2** |
| Cleanups: `game_api.rs` stub, `MenuSystem` `unsafe mem::zeroed()` | Correctness/clarity for engine consumers | `dotzuki-engine-script/game_api.rs`, `menu/mod.rs:383` | n/a | S | **P2** |

## Recommended roadmap

**Phase P0 — "a developer can build a basic Pokémon-like on the engine." — ✅ SUBSTANTIALLY MIGRATED (engine layer landed; call-site swaps mostly staged).**
The battle turn-execution driver, generic battle AI, party/monster model,
wild-encounter→battle handoff, and item-effect/bag/shop flow have been lifted into
generically-parameterized engine modules under `dotzuki-engine/` (`battle/driver.rs`,
`battle/ai.rs`, `party/`, `overworld/encounter.rs`, `items/use_driver.rs`), each
with pokered provider impls + parity tests, landed and green (dotzuki-engine 290/0,
pokered-core 1802/0, workspace build clean; engine links no `rand` and carries no
Pokémon types). *Rationale stands:* without these, the engine produces only a
walkable map + text box; these are what make it a game.
**What remains STAGED (not yet done):** the production call-site swaps — routing
pokered's live battle loop / AI / encounter check / item-use path through the new
engine drivers — plus the P0a re-point of the `Pokemon` struct onto the engine
`Monster` model. These were deferred deliberately (see
[`05-p0-migration-report.md`](05-p0-migration-report.md) for the per-system reason
each swap is unsafe today, e.g. the encounter RNG-draw-count divergence, the
level-up HP-delta divergence, and `apply_effect` covering only status cures). Until
the swaps land, behavior is unchanged and the ~1800 Gen-1 tests stay green by
construction, not by passing through the new layer.

**Phase P1 — "it feels like a real Pokémon engine."** A high-level UI widget
library (list/bag/party/summary/multichoice), PC box storage, a robust dual-slot
save framework with recovery, a documented reusable scripting API, a generic
HM/field-effect hook, and a platform shell decoupled from `PokemonGame`.
*Rationale:* these are expected in every such game and currently force a new dev
to copy pokered wholesale.

**Phase P2 — "depth & polish."** Networked link transport, Pokédex/summary
engine widgets, daycare/clock/RTC/time-of-day, the map-authoring toolchain +
docs (and XML Tiled support), and the small correctness cleanups. *Rationale:*
high value but not blocking a first playable game.

## What's already strong (don't redo)

- **Overworld** (`dotzuki-engine/overworld/`): collision, grid movement, NPC
  movement/interaction, map transitions, event flags, OAM sprites — real and reusable.
- **Tilemap / metatile / camera / Tiled import** — functional and game-agnostic.
- **Dialog/text engine** (typewriter, control codes) — reusable.
- **JS scripting bridge** (`dotzuki-engine-script`): Boa async/await `ScriptCommand`
  loop, cutscene manager, per-map config — a genuine strength; the async-yield
  design parallels FireRed's NATIVE-mode script VM.
- **Low-level `MenuSystem`** and the **save CRC container** — solid foundations to
  build the P1 widget library and save framework on top of.
- **Provider/`GameData` dependency-injection architecture** — the right backbone;
  the gaps above are about adding subsystems, not reworking this design.
