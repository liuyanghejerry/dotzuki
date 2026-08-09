# pokefirered Engine Systems Inventory (reference)

FireRed (Gen 3) is built on the GBA "AGB kernel + game" architecture and has a
far more general, data-driven engine than a Gen-1 reimplementation. Below are the
reusable systems with key source paths (under `/Users/liuyanghe02/develop/pokefirered`).
The repo also ships `docs/analysis/00_index.md … 08_kernel_misc.md`
mirroring these categories with `src/file.c:line` citations.

## 1. Overworld engine
- **Field control / input dispatch** — the per-frame loop that turns map data
  into gameplay (trainer checks, sign/object interaction, coord-triggered
  scripts, warps, wild encounters). `src/field_control_avatar.c`
  (`ProcessPlayerFieldInput`), `include/field_control_avatar.h` (`struct FieldInput`).
- **Object/NPC movement (data-driven)** — `struct ObjectEvent` driven by **81
  movement types** + **172 movement actions**; `applymovement` queues
  movement-action bytecode per object. `src/event_object_movement.c`,
  `include/constants/event_object_movement.h`, `data/scripts/movement.inc`.
- **Field effects** — a small bytecode VM (`gFieldEffectScriptPointers`,
  LoadTiles/LoadPal/CallNative) + `gFieldEffectArguments[8]` for **75 `FLDEFF_*`**
  (HM cut/surf/strength/flash/dig/teleport, sparkles, footprints).
  `src/field_effect.c`, `src/fldeff_*.c`.
- **Warps + map connections + map headers** — `SetWarpDestination`,
  dynamic/escape/hole/heal warps; seamless `struct MapConnection` scroll-in;
  header carries layout/music/weather/map-type/flash/cycling. `src/overworld.c`,
  `src/fieldmap.c`, `src/heal_location.c`.
- **Surfing / cycling / fishing** — `src/bike.c`, `src/field_player_avatar.c`.
- **Metatile behaviors (111 `MB_*`)** — tile semantics decoupled from graphics,
  queried via `MapGridGetMetatileBehaviorAt`. `src/metatile_behavior.c`.
- **Trainer line-of-sight** — `src/trainer_see.c`.
- **Weather** — 18 `WEATHER_*` states. `src/field_weather.c`.

## 2. Scripting engine (event script VM)
- **Generic bytecode VM** (the most reusable single system). `struct
  ScriptContext` {mode, PC, stack[20], comparisonResult, nativePtr, cmdTable};
  STOPPED/BYTECODE/**NATIVE** modes — NATIVE lets a script yield to a C function
  that runs over multiple frames then resumes bytecode (FireRed's analogue of the
  Rust JS-async bridge). `src/script.c`, `include/script.h`.
- **~213 script commands** in `gScriptCmdTable`: control flow (goto/call/return,
  `gotostd`/`callstd`, `vgoto`/`vcall` for RAM/virtual scripts), vars/flags,
  messages/menus (`yesnobox`, `multichoice`, `multichoicegrid`, `braillemessage`),
  text buffering (`bufferspeciesname`/`itemname`/`movename`/`numberstring`),
  items/money/Pokémon, battles (`trainerbattle`, `setwildbattle`), overworld
  (warps, `applymovement`, `dofieldeffect`, `setweather`, doors, `setmetatile`).
  `src/scrcmd.c` (2264 lines), `data/event_scripts.s`.
- **Map script hooks** — 7 trigger types (`ON_LOAD`, `ON_FRAME_TABLE`,
  `ON_TRANSITION`, `ON_WARP_INTO_MAP_TABLE`, `ON_RESUME`, `ON_RETURN_TO_FIELD`) +
  coord-event triggers — the generic cutscene/scene-state mechanism.
- **"Specials" table** — 445 native C functions (`gSpecials`) callable by ID from
  scripts; the standard escape hatch. `data/specials.inc`, `src/field_specials.c`.

## 3. Battle engine
- **State machine + controllers** — `battle_main.c` turn loop; per-battler
  **controller** abstraction (player/opponent/link/safari/tutorial) separates
  input source from logic. `src/battle_controllers.c`, `src/battle_controller_*.c`.
- **Battle script VM (separate from overworld VM)** — combat is bytecode:
  `gBattleScriptingCommandsTable[]`, moves → scripts via
  `gBattleScriptsForMoveEffects[]`. `src/battle_script_commands.c`,
  `data/battle_scripts_1.s`.
- **Battle AI** — its own mini VM with 94 AI commands + switch/item AI.
  `src/battle_ai_script_commands.c`, `data/battle_ai_scripts.s`.
- **Abilities & held items** — centralized hooks `AbilityBattleEffects(...)` /
  `ItemBattleEffects(...)` at switch-in/end-of-turn/on-hit. `src/battle_util.c`.
- **Double battles, transitions, animations** — `src/battle_transition.c`,
  `src/battle_anim*.c`, `data/battle_anim_scripts.s`, `src/battle_interface.c`.

## 4. Menus / UI framework
- **Window system** — `struct WindowTemplate`, `AddWindow`/`InitWindows`,
  `FillWindowPixelBuffer`, `CopyWindowToVram`. `src/window.c`, `include/window.h`.
- **Text printer** — incremental callback-driven; `AddTextPrinterParameterized`,
  `GetStringWidth`, multi-font, speed control. `src/text.c`, `src/text_printer.c`.
- **List menus** — generic scrolling `struct ListMenuTemplate`/`ListMenuItem`,
  `ListMenuInit`. `src/list_menu.c`. Powers bag/PC/shop.
- **Script-driven menus** — `ScriptMenu_Multichoice`, `MultichoiceGrid`, `YesNo`,
  `ShowPokemonPic`. `src/script_menu.c`.
- **Generic helpers + start/option menus** — `src/menu.c`, `src/menu_helpers.c`,
  `src/start_menu.c`, `src/option_menu.c`.
- **Naming screen / keyboard** — `src/naming_screen.c`, `src/keyboard_text.c`.

## 5. Save system
- **Sectored flash save with rotation + recovery** — data split across **14
  sectors/slot** (3968B + 128B footer); two alternating slots for wear-leveling/
  crash safety; per-sector counter+signature+CRC16; `SAVEBLOCK_CHUNK` maps C
  structs onto sectors; dedicated **"save failed" recovery screen**. `src/save.c`,
  `src/load_save.c`, `src/save_failed_screen.c`; flash HAL `src/agb_flash*.c`.

## 6. Pokémon systems
- **PC storage / boxes** — `struct PokemonStorage`: **14 boxes** of `BoxPokemon`,
  names + wallpapers, drag-and-drop UI. `src/pokemon_storage_system*.c`.
- **Daycare/breeding/eggs**, **evolution** (scene+graphics+conditions incl.
  time-of-day), **move learning**, **summary screen** (paged stat/move/info UI).
  `src/daycare.c`, `src/evolution_scene.c`, `src/learn_move.c`,
  `src/pokemon_summary_screen.c`.
- **Pokédex** — seen/caught tracking, list/detail, region-map area markers.
  `src/pokedex.c`, `src/pokedex_screen.c`, `src/region_map.c`.
- **Core data layer** — `Pokemon`/`BoxPokemon` with encrypted substruct-shuffled
  storage + uniform `GetMonData`/`SetMonData`. `src/pokemon.c`, `include/pokemon.h`.

## 7. Data-driven authoring & build
- **JSON maps** — `data/maps/<Name>/map.json` declares layout/music/weather/
  map_type/connections + 4 event arrays (`object_events`, `warp_events`,
  `coord_events`, `bg_events`); compiled by `tools/mapjson`. `map_data_rules.mk`.
- **Layouts / tilesets** — `data/layouts/layouts.json` (size/border/primary+
  secondary tileset/blockdata); tileset attributes encode behavior+layering;
  separate tileset animation engine. `src/tilesets.c`, `src/tileset_anims.c`.
- **Build tools** — `jsonproc` (JSON→C templates), `mapjson`, `preproc`
  (charmap-aware string preprocessing), `gbagfx`. `charmap.txt`,
  `asm/macros/event.inc` (257 script macros).

## 8. Misc reusable "kernel" pieces
- **RNG** — LCG `gRngValue*1103515245 + 24691`. `src/random.c`.
- **Task system** — 16-slot cooperative scheduler `CreateTask(func, priority)`,
  per-task `data[16]`, followup funcs. Pairs with main-callback system
  (`gMain.callback1/2`, `SetMainCallback2`, `SetVBlankCallback`). `src/task.c`,
  `src/main.c`. Essential game-agnostic primitives.
- **Sprite / OAM manager** — `struct Sprite`/`SpriteTemplate`, anim command lists,
  affine anims, per-sprite callback + `data[8]`, subsprites. `src/sprite.c`; GPU/BG
  helpers `src/bg.c`, `src/palette.c`, `src/scanline_effect.c`, `src/dma3_manager.c`.
- **Sound engine (m4a)** — software sequencer (song table + voice groups + thin
  play API). `src/m4a.c`, `src/sound.c`. Architecture reusable; GBA mixer not.
- **String formatting** — `StringExpandPlaceholders`, `ConvertIntToDecimalStringN`.
  `src/string_util.c`, `src/dynamic_placeholder_text_util.c`.
- **Clock / RTC / playtime / berries** — `RtcCalcLocalTime`/`gLocalTime` feed
  time-of-day evolution & events; berry trees grow over time. `src/berry.c`,
  `src/play_time.c`.
- **Memory + math** — arena allocator `src/malloc.c`; trig/fixed-point `src/trig.c`.
- **Link / multiplayer & trading** — serial + wireless (RFU) stacks, cable club,
  trade flow + scene, union room, **Mystery Gift** (reuses the script VM via
  RAM/virtual-script opcodes — neat DLC pattern). `src/link.c`, `src/trade.c`,
  `src/union_room*.c`, `src/mystery_gift*.c`. Transport is hardware-specific; the
  trade-negotiation/session logic is reusable.

## Top picks vs a Gen-1 reimplementation (ranked)
1. **Event-script bytecode VM with NATIVE-mode yielding** (`script.c`) — ~213
   opcodes + `specials` escape hatch.
2. **JSON-authored maps (4 event categories) + map connections + map-script
   lifecycle hooks**.
3. **Data-driven NPC movement (172 actions) + field-effect script system**.
4. **Generic window + text-printer + list-menu + script-multichoice UI**.
5. **Sectored, checksummed, dual-slot save with failure recovery**.
6. **Metatile-behavior layer** decoupling tile graphics from overworld logic.
7. **Task scheduler + sprite/OAM engine + main-callback loop** (the kernel).
8. **Battle-script + battle-AI VMs + ability/item effect hooks**.
9. **PC box storage, daycare/breeding, time-of-day evolution, Pokédex**.
