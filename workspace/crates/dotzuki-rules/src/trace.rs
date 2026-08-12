//! The two-layer-debugging trace (doc 11 §5, last bullet): "the interpreter
//! **must** log `(EffectId, Event, op, relay before/after)` from day one or the
//! data author is pushed back into Rust." A wrong outcome may be in the data OR
//! the primitive; this trace tells them apart.
//!
//! The trace is **opt-in** (a [`TraceSink`] installed thread-locally by a debug
//! flag) and records NO entropy — it never draws RNG, never reads a clock, never
//! affects draw order. It is a pure observer.

use std::cell::RefCell;

use dotzuki_engine::battle::stack::{EffectId, Event, RelayVar};

use crate::model::Op;

/// One recorded interpreter step (doc 11 §5).
#[derive(Debug, Clone, PartialEq)]
pub struct TraceEvent {
    /// The firing hook's synthesized id (the `source_effect`).
    pub effect: EffectId,
    /// The closed event being folded.
    pub event: Event,
    /// The op that ran (cloned for inspection).
    pub op: Op,
    /// The relay BEFORE the op.
    pub before: RelayVar,
    /// The relay AFTER the op (the op's `HandlerResult` applied locally).
    pub after: RelayVar,
}

/// A collector of [`TraceEvent`]s. Installed thread-locally by a debug flag so
/// the interpreter's hot path stays branch-light when tracing is off.
#[derive(Debug, Default, Clone)]
pub struct TraceSink {
    /// The recorded steps, in fold order.
    pub events: Vec<TraceEvent>,
}

thread_local! {
    static SINK: RefCell<Option<TraceSink>> = const { RefCell::new(None) };
}

/// Enable tracing for the current thread (the debug flag, doc 11 §5).
pub fn enable_trace() {
    SINK.with(|s| *s.borrow_mut() = Some(TraceSink::default()));
}

/// Disable tracing and take the recorded sink (`None` if tracing was off).
pub fn take_trace() -> Option<TraceSink> {
    SINK.with(|s| s.borrow_mut().take())
}

/// Record one step IFF tracing is enabled. Pure: no RNG, no clock, no draw-order
/// effect.
pub(crate) fn record(effect: EffectId, event: Event, op: &Op, before: RelayVar, after: RelayVar) {
    SINK.with(|s| {
        if let Some(sink) = s.borrow_mut().as_mut() {
            sink.events.push(TraceEvent {
                effect,
                event,
                op: op.clone(),
                before,
                after,
            });
        }
    });
}
