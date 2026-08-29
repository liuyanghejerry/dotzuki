# Overworld Presentation Animations

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

The frame-counted animation state machines of
`dotzuki_engine::overworld::presentation` — teleport spins, elevator rumble,
water/flower tiles, fishing, boulder dust, the palette flash, and the ship
departure — with their durations, phases, and accessor contracts.

The module (`crates/dotzuki-engine/src/overworld/presentation.rs`) reproduces
the blocking visual effects classic JRPGs run on the
[overworld](./glossary.md) as pure, game-agnostic state machines. It is not
re-exported at `dotzuki_engine::overworld`; consumers use the full module
path. No code outside the module's own unit tests consumes it yet; it is a
game-facing API.

## The frame-driven model

Every state machine here follows the same contract:

- The game constructs the state when the effect starts, calls `tick()` once
  per frame while gameplay stays frozen, and the renderer reads the state
  through accessors each frame. (`TileAnimState` is the exception: it loops
  in the background during normal play.)
- All durations are frame counts, never seconds. Tick at a fixed rate.
- Sound cues are typed enums (`TeleportSpinSfx`, `EnterMapSpinSfx`,
  `ElevatorShakeSfx`, `ShipDepartureSfx`) returned from `tick()`; the game
  maps them to its own audio ids.
- States depend on `Direction`
  (`crates/dotzuki-engine/src/overworld/types.rs`), injected tuning data, and
  frame counters. All states derive `Debug`/`Clone`/`Copy`.

## Teleport spin-out: `TeleportSpinState`

The leave-map animation (teleport / escape item). Phases:
`TeleportSpinPhase::{SpinInPlace, SpinUp, Delay, Done}`.

| Constant | Value | Meaning |
|---|---|---|
| `SPIN_IN_PLACE_FRAMES` | 136 | 16 spins with delays 16,15,…,1 |
| `SPIN_UP_STEP_DELAY` | 3 | Frames between spin-up steps |
| `SPIN_UP_STEPS` | 5 | 16px rise steps |
| `SPIN_UP_STEP_PIXELS` | 16 | Pixels per rise step |
| `SPIN_POST_DELAY_FRAMES` | 10 | Tail delay after the rise |

`TeleportSpinState::new(current_facing, spin_order)` takes the facing cycle
the spin rotates through (the classic order is `[Down, Left, Up, Right]`); a
`current_facing` absent from the cycle falls back to index 0. The spin starts
by showing `current_facing`, then advances through the cycle.

`tick() -> Option<TeleportSpinSfx>` returns `SpinLoop` at the start of each
spin whose delay is a multiple of 4 (spins 0, 4, 8, 12 — four plays) and
`Rise` once at the start of the spin-up (frame 136). Accessors: `phase()`,
`is_done()`, `facing()`, `player_y_offset()` (≤ 0; the sprite rises off
screen during `SpinUp`, −80 at the end), and `player_visible()` (false once
the sprite has risen fully above the visible area).

Total length: 136 + 17 + 10 = 163 frames. When `is_done()` becomes true, the
caller starts the fade-out of the [warp](./glossary.md).

## Arrival spin-in: `EnterMapSpinState`

The counterpart of `TeleportSpinState` after a teleport-class warp arrival:
the player descends from off the top of the screen, then spins in place.
Phases: `EnterMapSpinPhase::{SpinDown, SpinInPlace, Done}`.

| Constant | Value | Meaning |
|---|---|---|
| `ENTER_MAP_SPIN_DOWN_STEPS` | 5 | 16px descent steps |
| `ENTER_MAP_SPIN_DOWN_STEP_DELAY` | 3 | Frames between descent steps |
| `ENTER_MAP_SPIN_DOWN_FRAMES` | 17 | Total spin-down frames |
| `ENTER_MAP_SPIN_DOWN_STEP_PIXELS` | 16 | Pixels per descent step |
| `ENTER_MAP_SPIN_IN_PLACE_FRAMES` | 36 | 8 spins with delays 0,1,…,7 (silent) |

`EnterMapSpinState::new(current_facing, spin_order, spin_in_place)` — pass
`spin_in_place: false` for arrivals on a warp pad or hole, which skip the
final spin and finish in exactly 17 frames.

The state starts hidden at `player_y_offset() == -80`: the game constructs it
at warp commit and starts ticking once the fade-in completes (the engine does
not drive the fade). `tick() -> Option<EnterMapSpinSfx>` returns `Descend` on
the first frame and `Land` when the spin-down completes. Accessors:
`phase()`, `is_done()`, `facing()`, `player_y_offset()`, `player_visible()`.
When `is_done()`, the caller restores the saved facing and Y position.

## Elevator rumble: `ElevatorShakeState`

`ElevatorShakeParams { iterations: u8, pixel_offset: u8 }` tunes the shake;
`total_frames()` is `iterations * 2`. `ElevatorShakeState::new(params)`
scrolls the background by `offset_y()`, which alternates −`pixel_offset` /
+`pixel_offset` per 2-frame iteration (the first iteration scrolls negative)
and returns 0 once done.

`tick() -> Option<ElevatorShakeSfx>` returns `Rattle` at the start of each
iteration and `Arrive` on the final frame.

## Water/flower tiles: `TileAnimState`

The looping background-tile animation (water rotation / flower frames).
`set_tileset(TileAnimKind)` adopts a tileset's animation kind —
`TileAnimKind::{None, Water, WaterFlower}` — and resets the per-frame counter
only: the water-update counter and the accumulated water shift persist across
map loads, mirroring classic WRAM behavior. `tick()` is a no-op when the kind
is `None`.

Timing: the per-frame counter increments every frame; at 20 the water tile
rotates one pixel; at 21 (`WaterFlower` only) the flower tile advances and
the counter resets. Water-only tilesets reset right after the water update,
so the water period is 20 frames, or 21 frames with flowers.

The water-update counter increments per water update, masked to 0..=7; its
bit 2 picks the rotation direction — right while the bit is 0 (counter values
1,2,3,0), left while the bit is 1 (4,5,6,7) — so the net shift over 8 updates
runs 1,2,3,2,1,0,−1,0. The flower frame comes from the counter's low two
bits: 0/1 → frame 1, 2 → frame 2, 3 → frame 3.

Accessors: `water_shift() -> i8` (positive = right; renderers sample source
column `(x - shift) mod 8`), `flower_frame() -> Option<u8>` (`None` before
the first flower update — the tileset's base flower tile shows), and
`kind()`.

## Fishing rod: `FishingAnimState`

Phases: `FishingAnimPhase::{CastDelay, RodOut, Shake, Bubble, Done}`.

| Constant | Value | Meaning |
|---|---|---|
| `FISHING_CAST_DELAY_FRAMES` | 10 | Pause before the rod appears |
| `FISHING_ROD_OUT_FRAMES` | 100 | Rod out, waiting for a bite |
| `FISHING_SHAKE_ITERATIONS` | 10 | Shake iterations on a bite |
| `FISHING_SHAKE_STEP_FRAMES` | 3 | Frames per shake iteration |
| `FISHING_BUBBLE_FRAMES` | 60 | "!" emotion-bubble duration |
| `FISHING_ANIM_FRAMES` | 200 | Total: 10 + 100 + 30 + 60 |

`FishingAnimState::new(facing, bite)` takes the bite roll as a constructor
input — the game decides the outcome up front. A no-bite run ends right after
`RodOut`, at frame 110; a bite adds `Shake` and `Bubble`.

Accessors: `phase()`, `is_done()`, `facing()`, `pose_active()` (true during
`RodOut`/`Shake`/`Bubble`), `rod_visible()` (false during `CastDelay`, and
false during `Bubble` when facing `Up` so the rod does not overlap the
bubble), `bubble_active()`, and `player_shake_offset()` (toggles 1/0 per
3-frame iteration during `Shake`). When `is_done()`, the caller queues the
result text.

`FishingAnimState::rod_piece(facing) -> (dx, dy, tile, x_flip)` gives the
rod's OAM piece as an offset from the player sprite's top-left; sheet tile 0
covers Down/Up, tile 1 covers Left/Right (X-flipped for Right):

| Facing | `(dx, dy, tile, x_flip)` |
|---|---|
| `Down` | `(20, 35, 0, false)` |
| `Up` | `(20, -12, 0, false)` |
| `Left` | `(0, 16, 1, false)` |
| `Right` | `(48, 16, 1, true)` |

## Boulder dust: `BoulderDustState`

The 2×2 smoke-puff block kicked up when a pushed boulder slides one tile:
8 steps (`BOULDER_DUST_STEPS`) of 3 frames (`BOULDER_DUST_STEP_FRAMES`) — 24
frames. `BoulderDustState::new(facing, anchor_x, anchor_y)` anchors the puff
to the player's map tile at push time; the anchor never tracks the player
afterward. `BoulderDustState::inactive()` is a permanently finished state for
"no dust showing", and `tick()` is a no-op once the animation has finished.
The state derives `PartialEq`/`Eq`.

Accessors: `is_active()`, `facing()`, `anchor()`, `step()` (0..=7),
`base_offset()` (the block's top-left offset from the player sprite's
top-left), `drift_px()` (1px per step against the push direction — the puff
lingers as the boulder slides away), `tile_drifts() -> [(i32, i32); 4]` (the
per-step pixel delta of the upper-left, upper-right, lower-left, lower-right
8×8 tiles; horizontal pushes leave the upper-left tile in place), and
`palette_flipped()` (true on odd steps, flashing the two gray shades of the
smoke sprite).

| Facing | `base_offset()` | `drift_px()` |
|---|---|---|
| `Down` | `(8, 52)` | `(0, -1)` |
| `Up` | `(8, -12)` | `(0, 1)` |
| `Left` | `(-24, 20)` | `(1, 0)` |
| `Right` | `(40, 20)` | `(-1, 0)` |

## Palette flash: `FLASH_WHITE_FRAMES`

`pub const FLASH_WHITE_FRAMES: u8 = 3` — the frame count of the
all-palettes-white flash when a dark area lights up. There is no palette
state machine; the game counts these frames itself.

## Ship departure: `ShipDepartureState`

The departure cutscene. Phases: `ShipDeparturePhase::{InitialPause,
WaterFill, Scroll, Erase, Done}`; construct with
`ShipDepartureState::new()` / `Default`.

| Constant | Value | Meaning |
|---|---|---|
| `SHIP_DEPARTURE_INITIAL_PAUSE_FRAMES` | 120 | Ship at the dock while the music plays |
| `SHIP_DEPARTURE_WATER_FILL_FRAMES` | 3 | Water-fill commit |
| `SHIP_DEPARTURE_SCROLL_ITERATIONS` | 8 | View-scroll iterations |
| `SHIP_DEPARTURE_ITERATION_FRAMES` | 128 | Frames per iteration (16 substeps × 8 frames) |
| `SHIP_DEPARTURE_ERASE_FRAMES` | 120 | Final pause after the erase |
| `SHIP_DEPARTURE_TOTAL_FRAMES` | 1267 | Whole cutscene |
| `SHIP_DEPARTURE_SCROLL_PX_PER_ITERATION` | 16 | View scroll per iteration |
| `SHIP_DEPARTURE_SUBSTEPS_PER_ITERATION` | 16 | Smoke-drift substeps per iteration |
| `SHIP_DEPARTURE_SUBSTEP_FRAMES` | 8 | Frames per substep |
| `SHIP_DEPARTURE_PUFF_SPACING_PX` | 16 | Spawn spacing between puffs |
| `SHIP_DEPARTURE_PUFF_DRIFT_PX_PER_SUBSTEP` | 2 | Puff drift per substep |
| `SHIP_DEPARTURE_SMOKESTACK_TILE_X` | 16 | Smokestack map position, tiles |
| `SHIP_DEPARTURE_SMOKESTACK_TILE_Y` | 10.5 | Smokestack map position, tiles |
| `SHIP_DEPARTURE_PUFF_START_SCREEN_X` | 88 | First puff's screen X |

`tick() -> Option<ShipDepartureSfx>` fires `ShipDepartureSfx::Horn` twice: on
the first `Scroll` frame (frame 123) and on the first `Erase` frame (frame
1147).

The state machine does not mutate the map. The game applies the ship's
map-block erase and the dock→ship warp removal at the `Erase` transition;
`ship_erased()` returns true during `Erase` and `Done`, covering the same
frame for renderers that draw before the mutation lands.

Scroll accessors: `frame()`, `scroll_iteration()` (0..=7),
`scroll_substep()` (0..=127 across all iterations), and `scroll_px()`
(0..=128; the view advances 16px per iteration plus one more pixel per
8-frame substep, and the erase phase keeps the fully scrolled position).

Smoke puffs: `puff_count()` (≤ 8, one new puff per iteration),
`puff_x_offset(i)` (puff `i` spawns at screen X = 88 − 16i and drifts +2px
per substep from its spawn substep; renderers rebase onto their own view by
adding `smokestack_screen_x - SHIP_DEPARTURE_PUFF_START_SCREEN_X`), and
`puff_screen_y()` (= 84, the smokestack row).

## Example

Driving a teleport spin to completion and collecting its sound cues:

```rust
use dotzuki_engine::overworld::presentation::{
    TeleportSpinSfx, TeleportSpinState, SPIN_IN_PLACE_FRAMES,
};
use dotzuki_engine::overworld::Direction;

fn main() {
    let spin_order = [
        Direction::Down,
        Direction::Left,
        Direction::Up,
        Direction::Right,
    ];
    let mut spin = TeleportSpinState::new(Direction::Down, spin_order);

    let (mut loops, mut rises, mut frames) = (0, 0, 0u16);
    while !spin.is_done() {
        match spin.tick() {
            Some(TeleportSpinSfx::SpinLoop) => loops += 1,
            Some(TeleportSpinSfx::Rise) => {
                rises += 1;
                // The rise cue fires at the spin-up start.
                assert_eq!(frames, SPIN_IN_PLACE_FRAMES);
            }
            None => {}
        }
        frames += 1;
    }
    assert_eq!((loops, rises), (4, 1));
    assert_eq!(frames, 136 + 17 + 10); // in-place + spin-up + tail delay
}
```

*Verified by `spin_sfx_schedule` in
`crates/dotzuki-engine/src/overworld/presentation.rs`.*

## Cross-cutting notes

- Tick every state at a fixed frame rate and freeze gameplay while a
  one-shot animation runs; the counts are frames, not seconds.
- `EnterMapSpinState` starts hidden; the game starts ticking it once the
  arrival fade-in completes.
- `ShipDepartureState` never mutates the map; the game applies the erase and
  warp removal when `ship_erased()` flips to true.
- The water-tile sign convention is `(x - shift) mod 8` on the source column.
