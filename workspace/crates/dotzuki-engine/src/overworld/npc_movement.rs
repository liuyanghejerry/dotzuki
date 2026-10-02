//! Generic NPC movement system for the overworld.
//!
//! Implements NPC movement: per-frame sprite updates for all NPCs and the
//! trainer-notice (emotion bubble) animation.
//!
//! All functions are generic over tileset and collision provider types.

use alloc::collections::VecDeque;

use crate::map::MapTrait;
use crate::tileset::TilesetTrait;

use super::collision::{CollisionProvider, SpritePosition};
use super::player_movement::direction_delta;
use super::types::{Direction, MapData, NpcMovementType, NpcWanderAxis};

// ── NPC Runtime State ──────────────────────────────────────────────

/// Runtime state for a single NPC on the current map.
///
/// Game-specific data (e.g., trainer flags, item drops) should be stored
/// in a separate parallel array and looked up by `npc_index`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NpcRuntimeState {
    pub npc_index: u8,
    pub sprite_id: u8,
    pub x: u16,
    pub y: u16,
    pub home_x: u16,
    pub home_y: u16,
    pub facing: Direction,
    pub scripted_frame: Option<u8>,
    pub movement_type: NpcMovementType,
    /// Axis restriction for Wander NPCs (classic GB movement byte 2).
    pub wander_axis: NpcWanderAxis,
    pub range: u8,
    pub walk_counter: u8,
    pub delay_counter: u16,
    pub text_id: u8,
    pub defeated: bool,
    pub visible: bool,
    pub scripted_path: VecDeque<(u16, u16)>,
}

// ── Constants ──────────────────────────────────────────────────────

/// Frames to walk one tile. The classic GB walkers take $10 frames per tile —
/// HALF the player's speed (WALKANIMATIONCOUNTER = $10, movement.asm:296-339).
pub const NPC_WALK_FRAMES: u8 = 16;
/// Mask for the delay between random NPC movements.
pub const NPC_MAX_DELAY: u8 = 127;

/// Selects the random direction and delay interpretation for wandering NPCs.
/// The default preserves the engine's existing low-bit direction selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NpcWanderPolicy {
    #[default]
    Default,
    /// Four equally sized direction intervals; restricted axes remap directions.
    /// A zero delay represents the wrapping eight-bit countdown of 256 frames.
    Classic,
}

impl NpcWanderPolicy {
    fn direction(self, random: u8, index: usize, axis: NpcWanderAxis) -> Option<Direction> {
        use Direction::{Down, Left, Right, Up};
        let bits = match self {
            Self::Default => random.wrapping_add(index as u8) & 3,
            Self::Classic => random >> 6,
        } as usize;
        if self == Self::Classic {
            return Some(match axis {
                NpcWanderAxis::Any => [Down, Up, Left, Right][bits],
                NpcWanderAxis::Horizontal => [Left, Right, Left, Right][bits],
                NpcWanderAxis::Vertical => [Down, Up, Up, Down][bits],
            });
        }
        let dir = [Down, Up, Left, Right][bits];
        match axis {
            NpcWanderAxis::Any => Some(dir),
            NpcWanderAxis::Horizontal if dir == Left || dir == Right => Some(dir),
            NpcWanderAxis::Vertical if dir == Up || dir == Down => Some(dir),
            _ => None,
        }
    }

    fn delay(self, random: u8) -> u16 {
        match (self, random & NPC_MAX_DELAY) {
            (Self::Classic, 0) => 256,
            (_, delay) => delay as u16,
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────

/// Determine direction from `from` toward `to`.
///
/// Uses the axial heuristic: if dx.abs() > dy.abs(), horizontal;
/// otherwise vertical. Returns `None` if both positions are the same.
pub fn direction_toward(from_x: u16, from_y: u16, to_x: u16, to_y: u16) -> Option<Direction> {
    let dx = to_x as i32 - from_x as i32;
    let dy = to_y as i32 - from_y as i32;
    if dx == 0 && dy == 0 {
        return None;
    }
    if dx.abs() > dy.abs() {
        Some(if dx > 0 {
            Direction::Right
        } else {
            Direction::Left
        })
    } else {
        Some(if dy > 0 {
            Direction::Down
        } else {
            Direction::Up
        })
    }
}

// ── Scripted Movement ──────────────────────────────────────────────

/// Start an NPC walking a fixed path of tile coordinates.
pub fn start_scripted_move(npc: &mut NpcRuntimeState, path: &[(u8, u8)]) {
    npc.scripted_path.clear();
    for &(x, y) in path {
        npc.scripted_path.push_back((x as u16, y as u16));
    }
}

/// Returns `true` when the NPC has finished its scripted path and is idle.
pub fn is_scripted_move_done(npc: &NpcRuntimeState) -> bool {
    npc.scripted_path.is_empty() && npc.walk_counter == 0
}

// ── Position Utilities ─────────────────────────────────────────────

/// Collect tile positions of all visible NPCs for collision checks.
pub fn get_npc_positions(npcs: &[NpcRuntimeState]) -> Vec<SpritePosition> {
    npcs.iter()
        .filter(|n| n.visible)
        .map(|n| SpritePosition { x: n.x, y: n.y })
        .collect()
}

// ── NPC Lookup ─────────────────────────────────────────────────────

/// Find a visible NPC at the given tile position.
pub fn npc_at_position(npcs: &[NpcRuntimeState], x: u16, y: u16) -> Option<&NpcRuntimeState> {
    npcs.iter().find(|n| n.visible && n.x == x && n.y == y)
}

/// Mutable version of [`npc_at_position`].
pub fn npc_at_position_mut(
    npcs: &mut [NpcRuntimeState],
    x: u16,
    y: u16,
) -> Option<&mut NpcRuntimeState> {
    npcs.iter_mut().find(|n| n.visible && n.x == x && n.y == y)
}

// ── NPC Update Loop ────────────────────────────────────────────────

/// Update all NPC movement for one frame.
///
/// This is the main entry point called every frame from the overworld loop
/// (equivalent to `DoMovementForAllSprites` in the original game).
///
/// Each NPC that is visible, not mid-step, and not on a scripted path is
/// updated based on its movement type (Stationary, Wander, FacePlayer, or FixedPath).
///
/// # Parameters
/// - `npcs` — mutable slice of NPC runtime states
/// - `player_x`, `player_y` — player's current tile position
/// - `player_dest` — player's destination if mid-step (for collision avoidance)
/// - `map_width_blocks`, `map_height_blocks` — map dimensions in blocks
/// - `rng_value` — random value for wander direction/delay
/// - `blocks` — block data for the current map
/// - `tileset` — current tileset
/// - `provider` — collision provider for tile passability
pub fn update_npc_movement<T: TilesetTrait>(
    npcs: &mut [NpcRuntimeState],
    player_x: u16,
    player_y: u16,
    player_dest: Option<(u16, u16)>,
    map_width_blocks: u8,
    map_height_blocks: u8,
    rng_value: u8,
    blocks: &[u8],
    tileset: T,
    provider: &impl CollisionProvider<T>,
) {
    update_npc_movement_with_policy(
        npcs,
        player_x,
        player_y,
        player_dest,
        map_width_blocks,
        map_height_blocks,
        rng_value,
        blocks,
        tileset,
        provider,
        NpcWanderPolicy::Default,
    );
}

/// Updates NPCs with an explicitly selected random-wandering policy.
pub fn update_npc_movement_with_policy<T: TilesetTrait>(
    npcs: &mut [NpcRuntimeState],
    player_x: u16,
    player_y: u16,
    player_dest: Option<(u16, u16)>,
    map_width_blocks: u8,
    map_height_blocks: u8,
    rng_value: u8,
    blocks: &[u8],
    tileset: T,
    provider: &impl CollisionProvider<T>,
    policy: NpcWanderPolicy,
) {
    let max_x = (map_width_blocks as u16) * 2;
    let max_y = (map_height_blocks as u16) * 2;

    // Build the occupied-tile set: current position of each visible NPC,
    // plus its destination if it is mid-step (to avoid inter-NPC collisions).
    let occupied: Vec<(u16, u16)> = npcs
        .iter()
        .filter(|n| n.visible)
        .flat_map(|n| {
            let cur = (n.x, n.y);
            if n.walk_counter > 0 {
                let (dx, dy) = direction_delta(n.facing);
                let dest = (
                    (n.x as i32 + dx as i32).max(0) as u16,
                    (n.y as i32 + dy as i32).max(0) as u16,
                );
                vec![cur, dest]
            } else {
                vec![cur]
            }
        })
        .collect();

    for i in 0..npcs.len() {
        let npc = &mut npcs[i];
        if !npc.visible {
            continue;
        }

        // ── Finish current step ──────────────────────────────────
        if npc.walk_counter > 0 {
            npc.walk_counter -= 1;
            if npc.walk_counter == 0 {
                let (dx, dy) = direction_delta(npc.facing);
                npc.x = (npc.x as i32 + dx as i32).max(0) as u16;
                npc.y = (npc.y as i32 + dy as i32).max(0) as u16;

                // Advance scripted path if we reached the next waypoint
                if !npc.scripted_path.is_empty() {
                    let &(tx, ty) = npc.scripted_path.front().unwrap();
                    if npc.x == tx && npc.y == ty {
                        npc.scripted_path.pop_front();
                    }
                    if let Some(&(ntx, nty)) = npc.scripted_path.front() {
                        if let Some(dir) = direction_toward(npc.x, npc.y, ntx, nty) {
                            npc.facing = dir;
                            npc.walk_counter = NPC_WALK_FRAMES;
                        }
                    }
                }
            }
            continue;
        }

        // ── Scripted path: start next step ───────────────────────
        if !npc.scripted_path.is_empty() {
            let &(tx, ty) = npc.scripted_path.front().unwrap();
            if npc.x == tx && npc.y == ty {
                npc.scripted_path.pop_front();
                if npc.scripted_path.is_empty() {
                    continue;
                }
                let &(tx, ty) = npc.scripted_path.front().unwrap();
                if let Some(dir) = direction_toward(npc.x, npc.y, tx, ty) {
                    npc.facing = dir;
                    npc.walk_counter = NPC_WALK_FRAMES;
                }
            } else if let Some(dir) = direction_toward(npc.x, npc.y, tx, ty) {
                npc.facing = dir;
                npc.walk_counter = NPC_WALK_FRAMES;
            }
            continue;
        }

        // ── Autonomous movement by type ──────────────────────────
        match npc.movement_type {
            NpcMovementType::Stationary => {}
            NpcMovementType::Wander => {
                if npc.delay_counter > 0 {
                    npc.delay_counter -= 1;
                    continue;
                }

                let Some(dir) = policy.direction(rng_value, i, npc.wander_axis) else {
                    npc.delay_counter = policy.delay(rng_value);
                    continue;
                };

                let (dx, dy) = direction_delta(dir);
                let tx = (npc.x as i32 + dx as i32) as u16;
                let ty = (npc.y as i32 + dy as i32) as u16;

                // Bounds check. (No radial leash: classic random walkers have
                // none — they walk until blocked.)
                if tx >= max_x || ty >= max_y {
                    npc.facing = dir;
                    npc.delay_counter = policy.delay(rng_value);
                    continue;
                }

                // Check occupied tiles (other NPCs)
                let blocked = occupied
                    .iter()
                    .any(|&(ox, oy)| !(ox == npc.x && oy == npc.y) && ox == tx && oy == ty);
                let player_blocked = (tx == player_x && ty == player_y)
                    || player_dest.map_or(false, |(px, py)| tx == px && ty == py);

                if blocked || player_blocked {
                    npc.facing = dir;
                    npc.delay_counter = policy.delay(rng_value);
                    continue;
                }

                // Check tile passability
                let target_tile =
                    provider.get_tile_at_position(tileset, blocks, map_width_blocks, tx, ty);
                if !provider.is_tile_passable(tileset, target_tile) {
                    npc.facing = dir;
                    npc.delay_counter = policy.delay(rng_value);
                    continue;
                }

                npc.facing = dir;
                npc.walk_counter = NPC_WALK_FRAMES;
                npc.delay_counter = policy.delay(rng_value);
            }
            NpcMovementType::FacePlayer => {
                let dx = player_x as i32 - npc.x as i32;
                let dy = player_y as i32 - npc.y as i32;

                if dx.abs() >= dy.abs() {
                    npc.facing = if dx > 0 {
                        Direction::Right
                    } else {
                        Direction::Left
                    };
                } else {
                    npc.facing = if dy > 0 {
                        Direction::Down
                    } else {
                        Direction::Up
                    };
                }
            }
            NpcMovementType::FixedPath => {}
        }
    }
}

// ── NPC-in-Front Check ─────────────────────────────────────────────

/// Find the NPC the player is facing, accounting for counter tiles.
///
/// In the original game, pressing A on a counter tile extends the
/// interaction range by one tile to allow talking to NPCs across
/// counters (e.g. shopkeepers in Poké Marts).
pub fn npc_in_front_of_player<'a, M: MapTrait, T: TilesetTrait, Mus>(
    npcs: &'a [NpcRuntimeState],
    player_x: u16,
    player_y: u16,
    facing: Direction,
    map: Option<&MapData<M, T, Mus>>,
    provider: &impl CollisionProvider<T>,
) -> Option<&'a NpcRuntimeState> {
    let (dx, dy) = direction_delta(facing);
    let target_x = (player_x as i32 + dx as i32) as u16;
    let target_y = (player_y as i32 + dy as i32) as u16;

    if let Some(npc) = npc_at_position(npcs, target_x, target_y) {
        return Some(npc);
    }

    // Counter tile extension: if the tile in front is a counter,
    // check one more tile in the same direction for an NPC behind it.
    if let Some(map_data) = map {
        let tile = provider.get_tile_at_position(
            map_data.tileset,
            &map_data.blocks,
            map_data.width,
            target_x,
            target_y,
        );
        if provider.is_counter_tile(map_data.tileset, tile) {
            let extended_x = (target_x as i32 + dx as i32) as u16;
            let extended_y = (target_y as i32 + dy as i32) as u16;
            return npc_at_position(npcs, extended_x, extended_y);
        }
    }

    None
}

#[cfg(test)]
mod wander_policy_tests {
    use super::*;
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    struct Floor;
    impl TilesetTrait for Floor {
        fn id(&self) -> u8 {
            0
        }
        fn name(&self) -> &'static str {
            "floor"
        }
    }
    struct OpenFloor;
    impl CollisionProvider<Floor> for OpenFloor {
        fn is_tile_passable(&self, _: Floor, _: u8) -> bool {
            true
        }
        fn check_tile_pair_collision(&self, _: Floor, _: u8, _: u8, _: bool) -> bool {
            false
        }
        fn check_ledge_jump(&self, _: Floor, _: u8, _: u8, _: u8, _: u8) -> bool {
            false
        }
        fn is_counter_tile(&self, _: Floor, _: u8) -> bool {
            false
        }
        fn get_tile_at_position(&self, _: Floor, _: &[u8], _: u8, _: u16, _: u16) -> u8 {
            0
        }
        fn uses_warp_tile_in_front_check(&self, _: Floor) -> bool {
            false
        }
        fn check_extra_warp_special(&self, _: Floor, _: u8) -> Option<bool> {
            None
        }
        fn is_door_tile(&self, _: Floor, _: u8) -> bool {
            false
        }
        fn is_warp_tile(&self, _: Floor, _: u8) -> bool {
            false
        }
        fn is_warp_carpet_tile_in_front(&self, _: Floor, _: u8, _: u8) -> bool {
            false
        }
    }
    fn walker(axis: NpcWanderAxis) -> NpcRuntimeState {
        NpcRuntimeState {
            npc_index: 0,
            sprite_id: 1,
            x: 5,
            y: 5,
            home_x: 5,
            home_y: 5,
            facing: Direction::Down,
            scripted_frame: None,
            movement_type: NpcMovementType::Wander,
            wander_axis: axis,
            range: 0,
            walk_counter: 0,
            delay_counter: 0,
            text_id: 0,
            defeated: false,
            visible: true,
            scripted_path: VecDeque::new(),
        }
    }
    fn tick(npc: &mut NpcRuntimeState, random: u8, policy: NpcWanderPolicy) {
        update_npc_movement_with_policy(
            core::slice::from_mut(npc),
            0,
            0,
            None,
            10,
            10,
            random,
            &[],
            Floor,
            &OpenFloor,
            policy,
        );
    }
    #[test]
    fn classic_axis_rolls_all_start_a_walk() {
        use Direction::{Down, Left, Right, Up};
        for (axis, expected) in [
            (NpcWanderAxis::Any, [Down, Up, Left, Right]),
            (NpcWanderAxis::Horizontal, [Left, Right, Left, Right]),
            (NpcWanderAxis::Vertical, [Down, Up, Up, Down]),
        ] {
            for random in 0..=255u8 {
                let mut npc = walker(axis);
                tick(&mut npc, random, NpcWanderPolicy::Classic);
                assert_eq!(npc.facing, expected[(random >> 6) as usize]);
                assert_eq!(npc.walk_counter, NPC_WALK_FRAMES);
            }
        }
    }
    #[test]
    fn classic_zero_delay_waits_256_frames_after_finishing_walk() {
        let mut npc = walker(NpcWanderAxis::Vertical);
        tick(&mut npc, 0, NpcWanderPolicy::Classic);
        for _ in 0..NPC_WALK_FRAMES {
            tick(&mut npc, 1, NpcWanderPolicy::Classic);
        }
        assert_eq!((npc.x, npc.y), (5, 6));
        assert_eq!(npc.delay_counter, 256);
        for remaining in (0..256).rev() {
            tick(&mut npc, 1, NpcWanderPolicy::Classic);
            assert_eq!(npc.walk_counter, 0);
            assert_eq!(npc.delay_counter, remaining);
        }
        tick(&mut npc, 1, NpcWanderPolicy::Classic);
        assert_eq!(npc.walk_counter, NPC_WALK_FRAMES);
    }
    #[test]
    fn default_keeps_axis_rejection_and_zero_delay() {
        let mut npc = walker(NpcWanderAxis::Horizontal);
        tick(&mut npc, 0, NpcWanderPolicy::Default);
        assert_eq!(npc.walk_counter, 0);
        assert_eq!(npc.delay_counter, 0);
        tick(&mut npc, 2, NpcWanderPolicy::Default);
        assert_eq!(npc.walk_counter, NPC_WALK_FRAMES);
        assert_eq!(npc.facing, Direction::Left);
    }
}
