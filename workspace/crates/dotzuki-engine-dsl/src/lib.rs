//! dotzuki-engine-dsl — Game DSL compiler for JRPG content authoring.
//!
//! Compiles `.scene`, `.gui`, `.theme`, and `.style` files into
//! executable JavaScript (via Boa engine) and JSON (for UI data).

pub mod ast;
pub mod bridge;
pub mod codegen;
pub mod compiler;
pub mod config_gen;
pub mod conflict;
pub mod disk_loader;
pub mod error;
pub mod interpreter;
pub mod lexer;
pub mod loader;
pub mod parser;
pub mod sourcemap;
