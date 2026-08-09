# Pokémon Implementation Inventory — `examples/pokered/crates/`

## Scale overview

| Crate | .rs files | LOC | Role |
|---|---|---|---|
| pokered-core | 179 | 51,029 | Pure game logic |
| pokered-data | 72 | 24,046 | Static data + maps |
| pokered-audio | 14 | 10,479 | GB APU + sequencer |
| pokered-app | 18 | 8,155 | Native binary + debug CLI |
| pokered-tui | 10 | 5,845 | Terminal frontend |
| pokered-renderer | 5 | 6,347 | 160×144 framebuffer |
| pokered-ui | 23 | 2,980 | UI engine + menus |

The project is **mature and substantially complete**. Essentially **zero
`todo!()`/`unimplemented!()`** in the codebase and only a single `// TODO` in
non-test source (`pokered-audio/src/sequencer.rs:588`). ~2,817 `#[test]` blocks.
Gaps are at the *integration/wiring* level, not the logic level.

## System-by-system

### Battle — IMPLEMENTED (deep)
`pokered-core/src/battle/`: 46 files, 13,408 LOC.
- Wild & trainer battles (`wild.rs`, `trainer_ai/`, `turn.rs`,
  `turn_order.rs`, `move_execution.rs`). Damage/accuracy/crit with Gen-1 quirks.
- `battle/effects/` dispatcher covers **all 82 `MoveEffect` variants** (81 match
  arms; only `NoAdditionalEffect` is a no-op). OHKO/SuperFang/JumpKick/Swift
  delegated to `move_execution.rs`/`damage.rs`/`accuracy.rs`.
- Capture/escape/experience/settlement dirs (Safari catch logic, evolution,
  money, level-up). Trainer AI move-choice scoring.

### Overworld — IMPLEMENTED (deep)
`pokered-core/src/overworld/`: 28 files, 10,808 LOC (`update.rs` alone 2,016).
Movement, collision, warps/doors/elevators, NPC interaction+movement, wild
encounters, event flags, trainer line-of-sight (`trainer_engine.rs`), map
loading/connections. **HM field moves implemented** (Cut, Surf, Strength, Fly,
Flash — `hm_effects.rs`, 363 LOC). `script_bridge.rs` handles **40 distinct
`ScriptCommand` variants**.

### Menus / UI — MOSTLY IMPLEMENTED, with wiring gaps
- State machines: title, main_menu, oak_speech, naming_screen, options_menu,
  save_menu, start_menu, party_screen, stats_screen (each with tests).
- `pokered-ui/src/menus/` has 19 renderers incl. bag, mart, party, pokedex,
  stats, options, save, all battle sub-menus.
- **Gap (native app):** `pokered-app/src/game.rs:1698-1703` — start-menu
  `OpenItem` (bag), `OpenPokedex`, `OpenTrainerInfo` just redisplay the menu;
  `GameScreen` enum has no Bag/Pokedex/PC variants. Bag/pokedex/trainer-card
  exist in logic+UI but aren't navigable in-game. Party/Save/Options *are* wired.

### Pokémon data — IMPLEMENTED (complete Gen-1 set)
**151 species** JSONs + 152-variant `Species` enum; **165 move** JSONs; **84
items**; **47 trainer** classes; **12 shops**. Full 15-type chart (~80+
matchups). Learnsets/evolutions (`evos_moves.rs`), stats/growth. PC boxes
(`pokemon/pc_box.rs`, `pc_menu.rs`), Pokédex (151-species seen/owned bit arrays).

### Trading / link — IMPLEMENTED (local/in-process only)
`pokered-core/src/link/` (7 files, 1,591 LOC) + `slots/` (724 LOC).
`link_trade.rs`, `link_battle.rs`, `protocol.rs`, `transport.rs`. **Limitation:**
the only transport is `ChannelTransport` (in-process `mpsc`); `NetworkTransport`
is a trait but **no TCP/cable implementation ships** — cross-machine play is not
provided. Game Corner slot machine fully implemented.

### Audio — IMPLEMENTED (deep)
`pokered-audio/`: full 4-channel GB APU (`apu.rs`), sequencer (1,118),
`music_data.rs` (2,618, ~57 songs), `sfx_data.rs` (2,329). One minor TODO.

### Save — IMPLEMENTED
`pokered-core/src/save/`: 14 files, 2,806 LOC. Real Gen-1 **SRAM** import/export,
checksums, **JSON snapshot** round-trip (serde), Hall of Fame. CLI supports
`.sav ↔ snapshot.json`.

## Maps
**249 map directories** (248 with a `script.js`; only `shared/` lacks one). 128
scripts exceed 20 lines (7,804 total script LOC). Examples: PalletTown (160-line
script), ViridianCity, CeladonCity, all 5 CeladonMart floors, full SafariZone
set (10 maps), CeruleanCave 1F/2F/B1F.

## Not-yet-implemented / stubbed (concrete)
1. **Native app start-menu wiring** (`game.rs:1698`): ITEM/POKéDEX/TRAINER-INFO
   redisplay instead of opening their (existing) screens.
2. **Debug-server commands** (`game.rs:1986,1989`): `GiveItem`/`GivePokemon`
   return `"not yet implemented"`.
3. **Networked link play** — only in-process `ChannelTransport`; no TCP/serial.
4. **Audio** `sequencer.rs:588` — global-volume stored per-channel (cosmetic).
5. **WASM/TUI** — save persistence disabled on `wasm32`; text-only fallback
   rendering if renderer init fails (graceful, not missing).

Everything else (82 move effects, 151 species, 165 moves, 47 trainers, 249 maps,
battles, HMs, scripting, audio, SRAM saves) is implemented.
