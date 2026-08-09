//! jrpg-app: generic desktop app wrapper around jrpg-renderer's game loop.
//!
//! Provides a reusable game loop, file-watching hot-reload, and generic
//! rendering helpers. This crate has zero pokered-specific dependencies.

// `jrpg_renderer::window` exists only off-wasm (it is gated on jrpg-renderer's
// `gpu` feature, which is default-on, AND `not(target_arch = "wasm32")`). jrpg-app
// has no features of its own, so gate this re-export on the target only — present on
// native desktop (where pokered-app/firered-app use it), absent on wasm (fixes E0432).
#[cfg(not(target_arch = "wasm32"))]
pub use jrpg_renderer::window::{run, GameLoop, GameWindowConfig};
pub use jrpg_renderer::input::{InputState, GbButton};
pub use jrpg_renderer::*;

pub mod hot_reload;
pub mod render_helpers;
