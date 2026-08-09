//! jrpg-engine-dsl — Game DSL compiler for JRPG content authoring.
//!
//! Compiles `.scene`, `.gui`, `.theme`, and `.style` files into
//! executable JavaScript (via Boa engine) and JSON (for UI data).

pub mod ast;
pub mod lexer;
pub mod parser;
pub mod sourcemap;
pub mod codegen;
pub mod compiler;
pub mod config_gen;
pub mod conflict;
pub mod error;
pub mod loader;
pub mod bridge;
