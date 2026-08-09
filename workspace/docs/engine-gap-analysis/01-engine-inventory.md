# Engine Inventory & Gap Analysis (game-agnostic crates)

Read-only inventory of the game-agnostic engine in workspace. Goal: catalog
what the ENGINE provides today, how complete each subsystem is (real vs
scaffold/stub), and what a reusable JRPG/Pokemon-like engine still lacks.

Scope: dotzuki-engine, dotzuki-engine-tiled, dotzuki-engine-script in depth; platform
shells (pokered-web/android/ios/debug-server) briefly; other jrpg-* crates
surveyed.

Stale-doc notes: CLAUDE.md references crates/dotzuki-template which does NOT exist
(template is dotzuki-template/ at workspace root). Crates CLAUDE.md calls pokered-*
(renderer, ui, audio, app, tui) are now jrpg-*. The web/android/ios/debug-server
shells are still pokered-*.

---

## 1. crates/dotzuki-engine -- core engine crate

Deps: serde, serde_json, bytemuck, log, thiserror, image (for save_png). No
Pokemon data, no GPU/windowing, no async.

### 1.1 src/lib.rs (135 lines) -- GameData master trait
18 public modules. GameData is a DI hub: assoc types Tileset/Map/Palette/
TileMeta (trait-bounded) + bare IDs Move/Item/Species (Copy+Eq+Hash+Debug);
provider accessors tileset_provider/map_provider/palette_provider/tile_metadata/
render_data. The richer RPG-rules abstractions live in the battle/items modules,
which define their OWN provider traits (not hung off GameData).

### 1.2 Tile/map/palette/render providers -- REAL
- tileset.rs (44): TilesetTrait, TilesetProvider (blockset bytes/size/tiles-per-
  block). Minimal.
- map.rs (58): MapTrait, MapProvider (dims/tileset/block_data/border/
  connections), MapConnection. GB-style 4-way.
- palette.rs (185): SgbColor, SgbPaletteId (37 named PAL_* ids), SetPalCommand,
  PaletteTrait, PaletteProvider (bg/obj0/obj1/overworld/monster/hp-bar/SGB).
  REAL but GB/SGB-specific, 4-colour-locked.
- palette_swap.rs (175): RGBA palette-swap table + PaletteSwapManager. Generic
  RGBA override layer.
- tile_meta.rs (78): CollisionType (Passable/Impassable/Ledge/Counter/Grass/
  Water/Warp/Door), TileMetaTrait, TileMetadata. Real but Pokemon-flavoured.
- tilemap.rs (438): TilemapEntry (16-bit tile + flip + palette bank + priority +
  collision/anim override), Tilemap 2-D grid. Real, tested.
- metatile.rs (642): MetatileCell, CollisionCell, TriggerType/TriggerDef,
  MetatileDef (NxN block, per-cell collision, z-offset, anim), MetatileRegistry,
  GB .bst import. Real, substantial, tested.
- render_data.rs (36): RenderData trait (move/item/species names, move PP/type).
  Thin.
- render_config.rs (37): RenderConfig (160x144 default). Trivial.
- icon.rs (28): IconKind (monster-icon categories). Trivial, Pokemon-flavoured.

Tile/metatile/tilemap is the most mature, genuinely reusable layer. Palette is
real but hardwired to GB 4-shade/SGB -- no generic N-colour/RGBA base model.

### 1.3 src/render/ -- software framebuffer + painter, REAL
- render/mod.rs (226): BlendMode, MapLayer (tilemap+opacity+parallax+blend+z),
  MapRenderState (layer stack + bg colour).
- color.rs (131): Rgba.
- framebuffer.rs (301): FrameBuffer (RGBA buffer, set/get/fill_rect/blit_row/
  save_png), DirtyRegion (incremental redraw).
- geometry.rs (77): TilePos/TileRect/BracketSides.
- ink_color.rs (13): InkColor (4 GB shades + 3 HP-bar colours).
- painter.rs (275): Painter trait + Ui/Frame builder, HP bars/brackets/lines/
  label-value grids.
Real CPU rasteriser + backend-agnostic Painter (pixel and recording backends).
Multi-layer compositing data. NO GPU abstraction (GPU is in shells), NO retained
scene graph (immediate-mode). 8x8 tile / 160x144 oriented.

### 1.4 src/overworld/ -- REAL, tested grid-movement engine
- mod.rs (33), types.rs (383: Direction, TransportMode, MovementState,
  MapConnection(s), WarpPoint, Sign, NpcDefinition, MapData, PlayerState,
  OverworldState, OverworldInput; serde).
- collision.rs (321): CollisionProvider (passability, tile-pair/elevation,
  ledge-jump, counter, warp/door, extra-warp), CollisionResult,
  check_movement_collision. Faithful to Gen-I.
- player_movement.rs (430): InputState, MoveResult, try_move, advance_step, warp
  checks, process_frame driver.
- npc_movement.rs (348): NpcRuntimeState, wander/scripted-path/face-player.
- npc_interaction.rs (148): talk/interact, line-of-sight (trainer), sign, counter
  extension.
- map_transitions.rs (130): connection-edge transitions, warp lookup.
- event_flags.rs (198): EventFlags (HashMap<String,bool>). Generic.
- sprites/mod.rs (472): GB OAM model (SpriteStateData1/2, ShadowOam, SpriteTable,
  facing tables). oam.rs (89), update.rs (120), collision.rs (112).
Functional, tested grid engine with NPCs/collisions/ledges/warps/connections and
a 40-entry OAM sprite system. Sprite layer leaks GB OAM specifics.

### 1.5 src/save/mod.rs (531) -- REAL save framework
SaveData (serialize/deserialize + CRC16/XMODEM + validate), SaveStorage trait,
SaveManager (3 slots), SaveError, InMemoryStorage, crc16_xmodem. Tested,
generic over payload. 3-slot count is the only Pokemon convention.

### 1.6 src/text/mod.rs (754) -- REAL generic dialog engine
TextProvider trait (charmap decode/render/width/control-codes), TileBuffer
(20x18), TextStream, ControlAction, DialogState/DialogMode, DialogEngine
(frame-by-frame typewriter with page breaks/waits/scroll). Tested. 20x18 fixed.

### 1.7 src/trigger_manager.rs (496) -- REAL trigger engine
Trigger + TriggerManager: OnStep/OnEnter on movement, OnInteract on A-press,
enter-detection, one-shot tracking. Tested. JS-scripting glue.

### 1.8 src/camera.rs (662) -- REAL
Float Camera (Vec2/Rect), smooth follow, world<->screen, zoom (0.1-10), bounds
clamp/centre, tile helpers, cull checks. Tested, general-purpose.

### 1.9 The three "judge specifically" modules -- ALL REAL (NOT stubs)

battle/mod.rs (1115): REAL generic battle ABSTRACTION (not markers).
BattleProvider (8 assoc types Monster/Move/Ability/Status/Stat/Species/Type/Item;
calculate_damage/select_move/apply_move_effect/create_monster/check_faint);
BattlerState<P> (hp, stat EnumMap, stat-stage EnumMap, status, moves);
BattleState<P> (parties, turn order, Weather, Terrain, turn count); MoveEffect
(13 variants), EffectResult (14), DamageResult; TypeChart/BattleAI/EffectHandler
traits; EnumMap; ~30 tests with a mock RPS battle. CAVEAT: abstraction layer,
NOT a turn engine -- no implemented turn loop/priority queue/RNG sequencing; the
GAME crate drives turns. "Real framework, no driver."

items/mod.rs (484): REAL generic item/inventory. Inventory<I> (stacking add/
remove/contains/count); ItemProvider (name/desc/effect/price/can-use/use_on_
monster/consume); ShopProvider (per-shop inventory+name); ItemResult,
BagCategory. Full tests. Effect DATA + bag wiring live in game crate.

menu/mod.rs (923): REAL generic menu. MenuInput/MenuAction/MenuOption; layout
(MenuLayout, BorderStyle 9-slot, CursorStyle, EdgeInsets, MenuConfig);
MenuProvider; MenuSystem<M> (cursor w/ disabled-skip, scroll, open/close,
handle_input, render via Painter); ~20 tests w/ recording painter. Note: one
`unsafe std::mem::zeroed()` to default current_menu (foot-gun if MenuId not
zeroable). Pokemon-specific screens still live in dotzuki-ui.

CORRECTION: these three are NOT empty scaffolds -- ~2,500 lines of real, tested
code. The gap is "abstractions without engine-level drivers/data" (sec 6).

---

## 2. crates/dotzuki-engine-tiled (1303) -- Tiled map parsing
Single lib.rs. Parses Tiled JSON (.tmx-as-JSON) into engine types: parse_tmx ->
TmxMap; gid_to_tilemap_entry/clean_gid (H/V flips; diagonal ignored);
tmx_to_map_state -> MapRenderState; TileProperties + configurable PropertyConfig
(collision/trigger/trigger_type/animation_group/z_offset/palette_swap);
extract_triggers_from_tmx; hex-colour parsing. Extensive tests. JSON-only (not
XML .tmx), targets GB-flavoured model.

---

## 3. crates/dotzuki-engine-script -- Boa JS scripting
Files: lib.rs(48), engine.rs(1123), command.rs(142), cutscene.rs(279),
api_registrar.rs(33), loader.rs(386), config.rs(92), game_api.rs(1, re-export).
Has DESIGN.md. Boa pure-Rust JS (ES modules).

3.1 Architecture (REAL, most novel piece): scripts are async JS ES modules.
`await game.<cmd>(...)` -> register_async_command! makes a pending JS Promise,
stores (ScriptCommand, resolve_fn) in SharedBridge, returns the promise.
ScriptEngine::tick() surfaces the pending command; game executes + signal_done
(CommandResult) resolves the promise so the async fn continues. EngineState
Idle/Running/WaitingForCommand/Finished. engine.rs: module load/link/evaluate,
hot-reloadable shared modules, typed call helpers. loader.rs: per-map script.js +
script_config.json (mtime hot-reload) or embedded. cutscene.rs: CutsceneManager
(active/queue/blocking). config.rs: MapScriptConfig (npc/sign/coord-event -> JS
fn bindings). api_registrar.rs: game adds its own game.* fns.

3.2 Exhaustive game.* surface. Core (register_core_game_api) + game-specific
(ScriptApiRegistrar).
Synchronous: game.lang(), game.t(en,zh), getFlag, setFlag, resetFlag,
getPlayerPosition.
Async (Promise): showText, showChoice, moveNpc, startNpcMove, awaitNpcMove,
movePlayer, moveNpcTo, startNpcMoveTo, movePlayerTo, faceNpc, facePlayer,
setNpcFrame, setNpcPosition, playMusic, playSound, stopMusic, fadeOutMusic,
delay, warpTo, heal, animateHealingMachine, fadeScreen, showObject/hideObject
(index or toggle-id), setJoyIgnore, clearJoyIgnore, followNpc, openNamingScreen,
openShop, showEmotionBubble.
ScriptCommand enum ALSO declares variants only a game registrar wires: GiveItem,
GivePokemon, TakeItem, CheckFlag, StartBattle, ShowPokedexEntry.
LEAK: heal/animateHealingMachine/openShop/openNamingScreen/showPokedexEntry/
givePokemon are Pokemon-specific commands sitting in the "agnostic" enum.
Verdict: real for overworld events + cutscenes (dialogue/flow/movement/warp/
sprite/audio + start-battle). NO battle-scripting, menu-construction, or
inventory-beyond-flags API; no explicit camera-pan command.

---

## 4. Platform shells (brief)
- pokered-web (lib.rs 329): WASM/native winit+pixels(wgpu): window, GB-accurate
  pacing, keyboard, FPS overlay. Real; imports PokemonGame/GameVersion.
- pokered-android (lib.rs 351): android_main (winit+pixels/vulkan), JNI gamepad
  bridge, loading screen. Real; pokered-wired.
- pokered-ios (lib.rs 406 + audio_bridge.rs): C FFI (pokered_init/update/draw/
  audio_fill/save/load), lock-free audio ring buffer. Real; pokered-wired.
- pokered-debug-server (lib.rs 5 + server.rs 183 + protocol.rs 85): TCP JSON-line
  server (GetState/Position/Party/Bag/Flags, Warp, Press(Sequence), RunFrames,
  Save, SetFlag, GiveItem, GivePokemon). Real, channel-based, pokered protocol.
All shells reference pokered_app::PokemonGame + Pokemon types directly -- NOT
game-agnostic; a new game needs them rewritten.

---

## 5. Other game-agnostic crates (survey)
- dotzuki-renderer (large): fonts, textboxes/windows, sprites, tilemap drawing,
  battle scene + animations, mon_icon, party_hp_bar, transitions, input, full
  declarative JSON layout engine (border/divider/flex_list/group/image/list/
  text/tile + registry/deserialize). Real, partly Pokemon-flavoured.
- dotzuki-ui (large): bag, battle menus, dialog, flex_menu, mart, naming_screen,
  oak_speech, options, party_list, pokedex, save_menu, stats_screen, yes_no.
  Several widgets Pokemon-specific (pokedex/oak_speech/mart).
- dotzuki-audio: GB APU emulation (4 channels) + sequencer. GB-only, no general
  sample/stream mixer.
- dotzuki-app: native app harness (+ hot_reload, render_helpers).
- dotzuki-tui: terminal frontend.
- dotzuki-web: renamed/generic web entry.

---

## 6. What is MISSING or only abstraction-without-driver

Real abstractions, no engine-level driver/data:
1. Battle turn engine -- BattleProvider/BattleState/MoveEffect exist + tested,
   but NO turn loop / action-priority queue / RNG sequencing / status-tick
   scheduler. Game crate drives the battle.
2. Item-effect dispatch + bag wiring -- Inventory/ItemProvider/ShopProvider
   exist; effect catalogue and bag<->battle/overworld integration are the game.
3. Menu screens -- MenuSystem is a generic list-menu only; richer screens live
   in dotzuki-ui (Pokemon-specific).

Genuinely absent (no module):
4. Creature/party/stats/leveling model -- no creature instance with stats/level/
   EXP curves/learnsets/party/box; Species/Move/Item are bare IDs.
5. Quest/objective framework -- only EventFlags (string->bool).
6. Economy -- no money/wallet/buy-sell model (only ShopProvider prices).
7. Format-agnostic audio -- GB APU only; no sample/stream mixer.
8. N-colour/RGBA-native palette model -- base is GB 4-shade/SGB.
9. GPU/retained scene rendering -- immediate-mode CPU framebuffer + Painter only.
10. Generic input abstraction in core -- input structs are GB-button-shaped;
    real mapping lives in renderer/shells.
11. Scripting coverage gaps -- no battle scripting / menu construction / data-
    query; Pokemon-specific commands baked into ScriptCommand.
12. Networking/link/trade -- none.
13. Platform-shell decoupling -- shells hard-wired to PokemonGame/GameVersion.

Pokemon-isms leaking into "agnostic" crates: tile_meta::CollisionType (Grass/
Surf), palette::SgbPaletteId (PAL_* + per-species mon palettes), icon::IconKind,
and several ScriptCommand variants (heal/animateHealingMachine/openShop/
showPokedexEntry/givePokemon).

Stale docs: crates/dotzuki-template does not exist (it's dotzuki-template/ at root);
CLAUDE.md lists renderer/ui/audio/app/tui as pokered-* (now jrpg-*).

---

## 7. Bottom line
A strong overworld + scripting + presentation engine with real (but driver-less)
RPG-rules abstractions. Solid/reusable: tile/metatile/tilemap, tested overworld
grid + NPC/sprite movement + collisions + warps, camera, trigger manager, save
framework, dialog engine, Tiled importer, Boa async-JS bridge, and high-level
dotzuki-renderer/dotzuki-ui. The supposed "empty scaffolds" battle/items/menu are
~2,500 lines of real, tested abstractions; what they lack is an engine-level
driver/data layer (no turn executor, no creature/party/leveling/EXP model, no
economy/quest systems, no format-agnostic audio/palette/GPU). Notable Pokemon
leakage into agnostic crates; shells remain pokered-wired.
