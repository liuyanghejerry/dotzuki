# Generic overworld actor layer (engine "完善" — render- & map-agnostic)

## Problem
The engine's `jrpg-engine::overworld` is faithfully **Game-Boy-shaped**: movement is
generic over `MapTrait + TilesetTrait` with `u8` coords + 4×4 blocks, and
`overworld/sprites` is pure GB hardware (OAM, 8×8 tiles, a 32-entry facing table).
The full-color examples don't fit that map/coord/sprite model, so **firered and
wuxia each hand-roll their own overworld loop** — movement *and* draw — duplicating
"held → step → collide → advance → walk-anim → draw a facing/walk frame". The
`draw_player` the user saw in `wuxia/game.rs` is that duplication.

## Target (this is the long-term shape, not a patch)
One **render- and map-model-agnostic** overworld actor in the engine that *every*
game drives, differing only in (a) a map-data adapter and (b) which sprite painter.

- `jrpg-engine::overworld::actor` (pure logic, no pixels, no GB assumptions):
  - `trait OverworldCollision { fn is_blocked(&self, x: i32, y: i32) -> bool; }`
    — the *minimum* the mover needs. `i32` coords (covers GB u8 maps **and** wuxia's
    source-direct grid). Out-of-bounds = blocked. NPC occupancy / warps stay
    caller-side (fold NPCs into `is_blocked`; check warps on the returned arrival tile).
  - `struct OverworldActor` — tile pos + smooth pixel interpolation + facing + the
    walk-cycle state machine (8 frames/tile step, idle/step1/step2). `update(held,
    &map) -> Option<(i32,i32)>` advances one frame and reports the tile a step just
    completed on. `facing()`, `walk_frame() -> 0|1|2`, `px()/py()`, `teleport()`.
- `jrpg-renderer::walk_sprite::WalkSprite` (the full-color **render backend**): an
  RGBA sheet sliced `rows × cols` (row = facing down/up/left/right, col = walk frame),
  with `draw_on_tile(fb, row, col, foot_x, foot_y, tile)` (transparent, bottom-centred
  on the foot tile). `from_rgba` always; `load` behind a small `image-assets` feature.

The actor returns *indices*, never pixels — so its consumer's renderer is free:
wuxia/firered use `WalkSprite`; pokered (later) keeps its GB-OAM painter. A formal
`ActorPainter` trait unifying them is only needed when pokered converges (so it's not
built yet — that would be premature abstraction).

## Rollout (each step a permanent brick, nothing thrown away)
1. **Land the layer + migrate wuxia** (this pass): actor in jrpg-engine, WalkSprite in
   jrpg-renderer, `CharacterSprite` deleted from `wuxia-data`. `wuxia/game.rs` drops
   its hand-rolled `Direction`/movement/anim/`draw_player` and becomes glue: an
   `OverworldCollision` view over `(WuxiaMap + npcs)`, `actor.update`, warp-check on
   arrival, `WalkSprite::draw_on_tile`. Wuxia is the **reference impl on a non-GB map**.
2. **firered** onto the same actor (second witness — its GB-tile player draw stays,
   proving the actor is render-agnostic).
3. ~~**pokered** converge onto the generic actor~~ — **CANCELLED after inspection
   (2026-06-18).** pokered does NOT hand-roll or duplicate: it already drives the
   engine's rich overworld (`jrpg-engine::overworld::{player_movement, collision,
   map_transitions, sprites}`; `pokered-core::overworld::player_movement` is a ~6-line
   re-export + one `is_on_grass` helper). That rich tier models ledge jumps, warps,
   map-edge connections, tileset collision, OAM sprites, NPC scripts, wild encounters
   — a strict SUPERSET of the simple actor. Forcing pokered onto the simple actor
   would LOSE fidelity and risk its 4,400 tests for zero benefit. So the engine is
   already "complete" here: a deliberate **two-tier** design — simple `actor`
   (wuxia/firered) and rich GB movement (pokered), both engine-owned, sharing
   `Direction`. Documented in `overworld/mod.rs`. **No pokered code change.**

## Non-goals / guardrails
Keep `OverworldCollision` tiny (don't drag tilesets/blocks/warps into the engine
contract). Don't touch pokered or the GB `overworld/sprites` in steps 1–2. No
gold-plating: the actor is ~80 lines; resist adding biking/surfing/ledges until a
game needs them.
