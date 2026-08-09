//! # jrpg-rules — no-code RON authoring for the battle effect-stack (Phase 1)
//!
//! A **game-side** loader (doc
//! [`docs/engine-gap-analysis/11-no-code-authoring-design.md`]) that turns a
//! declarative `rules.ron` into runtime [`Effect`](jrpg_engine::battle::stack::Effect)s
//! dispatched through **ONE** zero-capture interpreter-bridge `fn`
//! ([`interpret`]) plus a **closed** primitive-op interpreter ([`run_ops`]).
//!
//! ## What this crate is (and is NOT)
//!
//! * It depends on the game-agnostic [`jrpg_engine`] **only** — zero
//!   pokered / pokered-core / pokered-data / minimon, zero concrete game type in
//!   non-test code, no `rand`.
//! * It is a **consumer** of the engine's closed primitive vocabulary
//!   (doc 11 §1.1 + doc 12 §3). It **amortizes content** (one `InflictStatus`
//!   covers every secondary-status move) — it does **not extend mechanics**.
//!   A genuinely new mechanic still needs a Rust primitive + test (doc 11 §5).
//!
//! ## The bridge (doc 11 §2 — Option A, ZERO engine change)
//!
//! The fold's only handler call site is a zero-capture `fn` pointer
//! ([`HandlerFn`](jrpg_engine::battle::stack::HandlerFn)); **data cannot *be* a
//! `fn` pointer**. So every data hook points its `call` field at the single
//! generic [`interpret`] `fn`, which on each call looks up its op-list **by the
//! [`EffectId`] the engine already threads as `source_effect`**
//! (`dispatch.rs:128`). The loader mints one distinct `EffectId` per
//! `(effect, event)` hook and registers each as its own tiny runtime
//! [`Effect`](jrpg_engine::battle::stack::Effect) **through the existing
//! defaulted resolvers** — exactly the Option-A shape doc 11 §2.2 recommends,
//! and the shape minimon already proves with `effectiveness_chart_hook`. **No
//! engine edit, no new trait method on an engine trait.**
//!
//! ## Determinism (doc 11 §4)
//!
//! The interpreter has **NO entropy except `ctx.rng`** (a `&mut dyn BattleRng`).
//! The `chance` gate compiles to `ctx.rng.chance(num, den)`; there is no clock,
//! no pointer hashing, no `HashMap` iteration affecting draw order. A
//! [`ScriptedRng`](jrpg_engine::battle::rng::ScriptedRng) replays a data ruleset
//! identically (same draw count and order) as the native path — a **structural**
//! guarantee, proved by [`tests::scripted_rng_replays_identically`].
//!
//! ## Dual-mode sourcing (Phase 2, doc 11 §4.2)
//!
//! [`RuleSource`] yields the **same** runtime [`Ruleset`] from either a **baked**
//! `include_str!`'d text (RELEASE; the default build, zero file IO) or a **disk**
//! path (DEV; behind the `hot-reload` feature it also watches the file and
//! [`RuleSource::poll_changed`] signals an edit so the game rebuilds the registry
//! **between turns**). A mid-battle reload is safe because effects are addressed
//! by [`EffectId`](jrpg_engine::battle::stack::EffectId) and live state lives in
//! the engine's `EffectState` arena, not the data — the reload swaps the
//! *vocabulary*, never the *in-flight state*.

#![forbid(unsafe_code)]

mod bindings;
mod interp;
mod model;
mod registry;
mod source;
mod trace;

#[cfg(feature = "compile-time")]
pub use jrpg_rules_macro::rules_ron;

pub use bindings::RuleBindings;
pub use interp::{interpret, run_ops};
pub use model::{
    parse_event, parse_kind, DamageValue, EffectKind, EffectRecord, FinalHitRider, FractionOf,
    HitCount, HookRecord, LoadError, Op, Predicate, Rational, ResourceCost, Ruleset, Selector,
    StatRef, TypeChartEntry, TypeName,
};
pub use registry::{CompiledHook, CompiledRuleset, ResolverKind, RulesHost, RulesProvider};
pub use source::RuleSource;
pub use trace::{enable_trace, take_trace, TraceEvent, TraceSink};

#[cfg(test)]
mod tests;
