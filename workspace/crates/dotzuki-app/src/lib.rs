//! dotzuki-app: generic desktop app wrapper around dotzuki-renderer's game loop.
//!
//! Provides a reusable game loop, file-watching hot-reload, and generic
//! rendering helpers. This crate has zero pokered-specific dependencies.

// `dotzuki_renderer::window` exists only off-wasm (it is gated on dotzuki-renderer's
// `gpu` feature, which is default-on, AND `not(target_arch = "wasm32")`). dotzuki-app
// has no features of its own, so gate this re-export on the target only — present on
// native desktop (where pokered-app uses it), absent on wasm (fixes E0432).
#[cfg(not(target_arch = "wasm32"))]
pub use dotzuki_renderer::window::{run, GameLoop, GameWindowConfig};
pub use dotzuki_renderer::input::{InputState, GbButton};
pub use dotzuki_renderer::*;

pub mod hot_reload;
pub mod render_helpers;
