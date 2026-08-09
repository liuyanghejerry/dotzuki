//! Battle animation system — subanimations, frame blocks, and special effects.
//!
//! Faithful port of the original pokered battle animation engine:
//!   - `engine/battle/animations.asm` — PlayAnimation / PlaySubanimation / DrawFrameBlock,
//!     the Animation* special-effect routines and ShareMoveAnimations
//!   - `data/moves/animations.asm` — per-move animation command sequences
//!   - `data/battle_anims/subanimations.asm` — 86 subanimation definitions
//!   - `data/battle_anims/frame_blocks.asm` — 122 frame block OAM tile layouts
//!     (stored as pixel offsets, matching the `dbsprite` byte expansion)
//!   - `data/battle_anims/base_coords.asm` — 177 (Y,X) base coordinate pairs
//!   - `data/battle_anims/special_effects.asm` — per-animation-id frame hooks
//!     (AnimationIdSpecialEffects), evaluated after every drawn frame block
//!   - `effects.rs` — the framebuffer special-effect (SE) state machines
//!     shared by the pokered frontends (substitute doll, minimize blob,
//!     squish, HUD shake, spiral/shoot balls, petals/leaves/droplets, …)
//!
//! This is NOT a hardware OAM emulator. We model the animation data at a
//! higher level: each "OAM tile" becomes a positioned sprite tile in the
//! framebuffer, and special effects are translated to palette/scroll/sprite
//! operations on our `FrameBuffer` / `SpriteLayer` abstractions.

mod data;
mod effects;
mod player;
mod types;

pub use data::*;
pub use effects::*;
pub use player::*;
pub use types::*;
