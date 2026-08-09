//! dotzuki-engine-script — JavaScript scripting engine for Pokémon Red/Blue.
//!
//! Provides an async/await-based scripting system using Boa (a pure-Rust JS engine)
//! that replaces the hardcoded ScriptAction queue. Map scripts are written in
//! JavaScript and can `await` game operations like showText(), moveNpc(), etc.
//!
//! # Architecture
//!
//! ```text
//! JS Script (async fn)
//!     │
//!     ├─ await game.showText("...")  ──► ScriptCommand::ShowText
//!     │       ↑ Rust resolves promise when text dismissed
//!     │
//!     ├─ game.getFlag("GOT_STARTER") ──► synchronous bool return
//!     │
//!     └─ await game.startBattle("RIVAL") ──► ScriptCommand::StartBattle
//!             ↑ Rust resolves promise with battle result
//! ```
//!
//! The game loop calls `ScriptEngine::tick()` each frame:
//! 1. If a pending command was resolved by Rust, `run_jobs()` drains the JS
//!    microtask queue so the async function continues to its next `await`.
//! 2. If the script issues a new command, it's returned to the caller for dispatch.
//! 3. If no script is active, returns `None`.

pub mod api_registrar;
pub mod command;
pub mod config;
pub mod cutscene;
pub mod engine;
pub mod game_api;
pub mod loader;

#[cfg(feature = "embedded-scripts")]
mod embedded_scripts {
    include!(concat!(env!("OUT_DIR"), "/embedded_scripts.rs"));
}

#[cfg(test)]
mod tests;

pub use api_registrar::ScriptApiRegistrar;
pub use command::{CommandResult, ScriptCommand};
pub use config::MapScriptConfig;
pub use cutscene::CutsceneManager;
pub use engine::{BridgeView, ScriptEngine, ScriptEngineError};
pub use loader::{ScriptLoader, ScriptLoaderError};
