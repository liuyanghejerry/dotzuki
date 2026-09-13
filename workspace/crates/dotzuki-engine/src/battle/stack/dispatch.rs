//! Handler collection, the Showdown `comparePriority` comparator, the speed-tie
//! draw, and the `run_event` dispatch fold (design §1.3, §3.4).

use core::cmp::Ordering;

use crate::battle::rng::BattleRng;
use crate::battle::BattlerRef;

use super::ctx::{BattleCtx, EffectHost, EffectProvider};
use super::event::{Effect, EffectId, Event, HandlerFn, HandlerResult, HookScope, RelayVar};

/// One collected, sortable handler invocation (design §1.3). The comparator
/// orders these by the exact Showdown lexical order.
pub struct CollectedHandler<P: EffectProvider + ?Sized> {
    /// `on<Event>Order`; default `u32::MAX` fires last; LOW first.
    pub order: u32,
    /// `on<Event>Priority`; HIGH first.
    pub priority: i32,
    /// The host battler's current speed; HIGH first (speed-sort).
    pub speed: u32,
    /// Effect-type sub-order; LOW first.
    pub sub_order: u8,
    /// Monotonic creation counter — the final deterministic tiebreak; LOW first.
    pub effect_order: u64,
    /// The event target.
    pub target: BattlerRef,
    /// The event source.
    pub source: BattlerRef,
    /// Which effect registered this handler.
    pub source_effect: EffectId,
    /// The native handler.
    pub call: HandlerFn<P>,
}

impl<P: EffectProvider + ?Sized> Clone for CollectedHandler<P> {
    fn clone(&self) -> Self {
        Self {
            order: self.order,
            priority: self.priority,
            speed: self.speed,
            sub_order: self.sub_order,
            effect_order: self.effect_order,
            target: self.target,
            source: self.source,
            source_effect: self.source_effect,
            call: self.call,
        }
    }
}

/// The exact Showdown `comparePriority` lexical order (design §1.3):
/// **order → priority → speed → sub_order → effect_order**.
///
/// `order`/`sub_order`/`effect_order` are ascending (LOW first);
/// `priority`/`speed` are descending (HIGH first).
pub fn compare<P: EffectProvider + ?Sized>(
    a: &CollectedHandler<P>,
    b: &CollectedHandler<P>,
) -> Ordering {
    a.order
        .cmp(&b.order)
        .then(b.priority.cmp(&a.priority))
        .then(b.speed.cmp(&a.speed))
        .then(a.sub_order.cmp(&b.sub_order))
        .then(a.effect_order.cmp(&b.effect_order))
}

/// Collect, from a single known effect, the hooks that subscribe to `ev`,
/// wrapping each with its host's speed and `effect_order` from the arena.
///
/// This compatibility path intentionally treats the explicitly supplied effect
/// as direct. Call [`collect_handlers`] when hooks from every live source and
/// their [`HookScope`] filters must participate in the dispatch.
pub fn collect_from_effect<P: EffectProvider>(
    ctx: &BattleCtx<'_, P>,
    eff: &'static Effect<P>,
    ev: Event,
    target: BattlerRef,
    source: BattlerRef,
    out: &mut Vec<CollectedHandler<P>>,
) {
    push_matching(
        ctx,
        eff,
        ev,
        EffectHost::Battler(source),
        target,
        source,
        target,
        true,
        out,
    );
}

/// Push every hook in `eff` that subscribes to `ev` into `out`, stamping each
/// with the comparator tiers. Shared by [`collect_from_effect`] (single-source,
/// the slice path) and [`collect_handlers`] (multi-source, §2.2) so both paths
/// produce **byte-identical** `CollectedHandler`s for the same effect.
fn push_matching<P: EffectProvider>(
    ctx: &BattleCtx<'_, P>,
    eff: &'static Effect<P>,
    ev: Event,
    host: EffectHost,
    event_target: BattlerRef,
    event_source: BattlerRef,
    direct_target: BattlerRef,
    force_direct: bool,
    out: &mut Vec<CollectedHandler<P>>,
) {
    let speed = match host {
        EffectHost::Battler(who) => P::handler_speed(ctx.state, who),
        EffectHost::Side(_) | EffectHost::Field => 0,
    };
    // effect_order: prefer the live arena entry; fall back to the effect id so
    // moves/abilities/items (no arena entry) still get a deterministic,
    // RNG-free tiebreak.
    let effect_order = ctx
        .effect(eff.id)
        .map(|s| s.effect_order)
        .unwrap_or(eff.id.0 as u64);

    for hook in eff.hooks {
        if hook.event != ev {
            continue;
        }
        let scope = P::hook_scope(eff, ev);
        if !force_direct && !scope_matches(scope, host, event_target, event_source) {
            continue;
        }
        let target = if scope == HookScope::Direct {
            direct_target
        } else {
            event_target
        };
        out.push(CollectedHandler {
            order: hook.order,
            priority: hook.priority,
            speed,
            sub_order: hook.sub_order.unwrap_or_else(|| eff.kind.sub_order()),
            effect_order,
            target,
            source: event_source,
            source_effect: eff.id,
            call: hook.call,
        });
    }
}

fn scope_matches(
    scope: HookScope,
    host: EffectHost,
    target: BattlerRef,
    source: BattlerRef,
) -> bool {
    match (scope, host) {
        (HookScope::Any, _) => true,
        (HookScope::Direct, EffectHost::Battler(who)) => who == target || who == source,
        (HookScope::Direct, EffectHost::Side(side)) => side == target.side || side == source.side,
        (HookScope::Direct, EffectHost::Field) => true,
        (HookScope::Source, EffectHost::Battler(who)) => who == source,
        (HookScope::Source, _) => false,
        (HookScope::Foe, EffectHost::Battler(who)) => who.side != target.side,
        (HookScope::Foe, EffectHost::Side(side)) => side != target.side,
        (HookScope::Foe, EffectHost::Field) => false,
        (HookScope::Ally, EffectHost::Battler(who)) => who.side == target.side,
        (HookScope::Ally, EffectHost::Side(side)) => side == target.side,
        (HookScope::Ally, EffectHost::Field) => false,
    }
}

#[cfg(test)]
mod scope_tests {
    use super::{scope_matches, EffectHost, HookScope};
    use crate::battle::BattlerRef;

    #[test]
    fn hook_scopes_match_battler_side_and_field_hosts() {
        let target = BattlerRef::new(0, 0);
        let source = BattlerRef::new(1, 0);
        let ally = EffectHost::Battler(BattlerRef::new(0, 1));
        let foe = EffectHost::Battler(BattlerRef::new(1, 1));

        assert!(scope_matches(
            HookScope::Any,
            EffectHost::Field,
            target,
            source
        ));
        assert!(scope_matches(
            HookScope::Direct,
            target.into(),
            target,
            source
        ));
        assert!(!scope_matches(HookScope::Direct, ally, target, source));
        assert!(scope_matches(
            HookScope::Source,
            source.into(),
            target,
            source
        ));
        assert!(!scope_matches(
            HookScope::Source,
            target.into(),
            target,
            source
        ));
        assert!(scope_matches(HookScope::Ally, ally, target, source));
        assert!(!scope_matches(HookScope::Ally, foe, target, source));
        assert!(scope_matches(HookScope::Foe, foe, target, source));
        assert!(!scope_matches(HookScope::Foe, ally, target, source));
        assert!(scope_matches(
            HookScope::Ally,
            EffectHost::Side(0),
            target,
            source
        ));
        assert!(scope_matches(
            HookScope::Foe,
            EffectHost::Side(1),
            target,
            source
        ));
        assert!(!scope_matches(
            HookScope::Ally,
            EffectHost::Field,
            target,
            source
        ));
    }
}

/// **Multi-source** handler collection (design §2.2) — the broadened collector.
///
/// Gathers the hooks subscribing to `ev` from **every live source**, not just
/// the one effect the driver passes:
///
/// 1. the **source effect** (the move/volatile that triggered the dispatch),
/// 2. every **live volatile** (arena scan →
///    `effect_for_volatile`),
/// 3. every active battler's **ability** and **held item**
///    (`effect_for_ability` / `effect_for_item`),
/// 4. the **side** effects of `target`'s and `source`'s sides (`side_effects`),
/// 5. the **field** effects (`field_effects`).
///
/// ## Reduces to identity (the non-breaking guarantee)
///
/// Steps 3–5 go through the four resolvers that **default to `None`/empty**
/// (§2.4); step 2 goes through `effect_for_volatile` (defaulted `None`). So for
/// a game with no abilities/items/weather/side-conditions and no live volatiles
/// — i.e. every existing Gen-1 slice scenario that fires a move event with an
/// empty arena — this collector pushes **exactly** what `push_matching(src_eff)`
/// alone pushes, in the same order, with byte-identical comparator tiers. The
/// broadened gather adds **read fan-out, never new handlers**, until a game
/// implements a resolver.
///
/// ## Borrow safety (design §2.3)
///
/// Takes only `&BattleCtx` (shared) and fills an **owned** `Vec` whose entries
/// hold the `HandlerFn` pointer + `EffectId` + `BattlerRef`s **by value** — no
/// borrows into the arena or battlers. Once collected, the snapshot is
/// independent of `ctx`, so the fold can hand each handler a `&mut BattleCtx`
/// without aliasing the iterator. No `RefCell`, no new `unsafe`.
pub fn collect_handlers<P: EffectProvider>(
    ctx: &BattleCtx<'_, P>,
    provider: &P,
    src_eff: Option<&'static Effect<P>>,
    ev: Event,
    target: BattlerRef,
    source: BattlerRef,
    out: &mut Vec<CollectedHandler<P>>,
) {
    // 1. The source effect (the move/volatile the driver resolved), if any.
    if let Some(eff) = src_eff {
        push_matching(
            ctx,
            eff,
            ev,
            EffectHost::Battler(source),
            target,
            source,
            target,
            true,
            out,
        );
    }

    // 2. Every live volatile (arena scan → effect_for_volatile). Scope filtering
    //    below keeps direct hooks on target/source while allowing Any/Ally/Foe
    //    hooks hosted by other active battlers to participate.
    //    Walk the arena in its stable `id` order so the gather is deterministic
    //    and RNG-free. We only *read* the arena here (shared borrow); the owned
    //    snapshot in `out` decouples this read from any later mutation.
    for e in ctx.effects.iter() {
        if let Some(eff) = provider.effect_for_volatile(&e.kind) {
            push_matching(
                ctx,
                eff,
                ev,
                e.host.into(),
                target,
                source,
                target,
                false,
                out,
            );
        }
    }

    // 3. Ability + held item on every active battler. Direct scope reduces this
    //    to target/source; broader scopes can observe allies, foes, or everyone.
    for side in 0..=1 {
        let battler_count = if side == 0 {
            ctx.state.player_battlers.len()
        } else {
            ctx.state.opponent_battlers.len()
        };
        for slot in 0..battler_count.min(u8::MAX as usize + 1) {
            let who = BattlerRef::new(side, slot as u8);
            let b = ctx.battler(who);
            if b.hp == 0 {
                continue;
            }
            if let Some(eff) = provider.effect_for_ability(b) {
                push_matching(ctx, eff, ev, who.into(), target, source, who, false, out);
            }
            if let Some(eff) = provider.effect_for_item(b) {
                push_matching(ctx, eff, ev, who.into(), target, source, who, false, out);
            }
        }
    }

    // 4. Side effects of target's & source's sides. Defaulted ⇒ empty.
    for &eff in provider.side_effects(ctx, target.side) {
        push_matching(
            ctx,
            eff,
            ev,
            EffectHost::Side(target.side),
            target,
            source,
            target,
            false,
            out,
        );
    }
    if source.side != target.side {
        for &eff in provider.side_effects(ctx, source.side) {
            push_matching(
                ctx,
                eff,
                ev,
                EffectHost::Side(source.side),
                target,
                source,
                target,
                false,
                out,
            );
        }
    }

    // 5. Field effects. Defaulted ⇒ empty.
    for &eff in provider.field_effects(ctx) {
        push_matching(
            ctx,
            eff,
            ev,
            EffectHost::Field,
            target,
            source,
            target,
            false,
            out,
        );
    }
}

/// Whether `who` is still on the field (hp > 0). Game-agnostic: reads `hp` only.
fn is_alive<P: EffectProvider + ?Sized>(ctx: &BattleCtx<'_, P>, who: BattlerRef) -> bool {
    ctx.battler(who).hp > 0
}

/// Permute *only* the tied runs (`compare == Equal`) by drawing one byte from
/// the rng per tie — the single source of true handler-order randomness
/// (design §1.3, mirroring pokered's order coin-flip, bug #22).
///
/// `hs` must already be sorted by [`compare`]. Within each maximal run of equal
/// entries, adjacent pairs are conditionally swapped on a `byte < 128` flip —
/// the same comparison shape as `turn_order.rs:41`.
pub fn speed_sort_tiebreak<P: EffectProvider + ?Sized>(
    hs: &mut [CollectedHandler<P>],
    rng: &mut dyn BattleRng,
) {
    let mut i = 0;
    while i < hs.len() {
        let mut j = i + 1;
        while j < hs.len() && compare(&hs[i], &hs[j]) == Ordering::Equal {
            j += 1;
        }
        // [i, j) is a tied run. For a run of length >= 2, flip each adjacent
        // pair (bubble one pass) using a coin per comparison — the same
        // single-byte `< 128` flip pokered uses for the order tie.
        if j - i >= 2 {
            for k in i..(j - 1) {
                if rng.next_u8() >= 128 {
                    hs.swap(k, k + 1);
                }
            }
        }
        i = j;
    }
}

/// The dispatch fold (design §3.4) — the workhorse.
///
/// Collects handlers (already done by the caller via `collect_from_effect` into
/// `hs`), sorts by [`compare`], permutes ties via the rng, then folds each
/// handler over the `relay`. The loop **owns `hs`** (collected before the fold),
/// so no handler can invalidate another mid-fold. Handlers take `&mut BattleCtx`
/// — never borrowed battler refs — so the `&mut` borrow lives only inside each
/// call. No `RefCell`, no `unsafe` here (the only `unsafe` is the
/// provably-disjoint cross-side `pair_mut`).
///
/// `fast_exit` returns on the first `Set` (redirection / first-blood, the
/// `priority_event` shape).
pub fn run_event<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    mut hs: Vec<CollectedHandler<P>>,
    mut relay: RelayVar,
    fast_exit: bool,
) -> RelayVar {
    hs.sort_by(compare);
    speed_sort_tiebreak(&mut hs, ctx.rng);
    for h in hs {
        match (h.call)(ctx, relay, h.target, h.source, h.source_effect) {
            HandlerResult::Unchanged => {}
            HandlerResult::Set(v) => {
                relay = v;
                if fast_exit {
                    return relay;
                }
            }
            HandlerResult::Fail => return RelayVar::Bool(false),
            HandlerResult::FailSilent => return RelayVar::Unit,
        }
    }
    relay
}

/// The dispatch fold **with the §2.3 per-step liveness re-check** — the
/// multi-source variant.
///
/// Identical to [`run_event`] (same sort, same tie-break draw, same `fast_exit`
/// fold) except that **before each handler fires** it re-checks that the
/// handler's `target` is still alive — because a multi-source fold can collect
/// handlers from several effects, and an earlier handler (e.g. a weather chip,
/// or a contact-ability) can KO the `target` an later handler was about to act
/// on. The re-check is a pure **read** between calls while the loop holds the
/// sole `&mut`, so it never aliases the snapshot.
///
/// Source-effect removal mid-fold (a handler removing another live volatile) is
/// left to each game handler's own post-mutation guard, matching the existing
/// slice contract (`driver.rs`: "each game handler is responsible for its own
/// post-faint guard") — `CollectedHandler` carries no arena borrow, so a
/// removed source effect simply means `ctx.effect(source_effect)` returns
/// `None`, which the handler reads defensively.
///
/// `run_event` is kept separate and unchanged so the 88 Gen-1 slices' fold is
/// byte-identical; this variant is for the broadened multi-source path.
pub fn run_event_checked<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<'_, P>,
    mut hs: Vec<CollectedHandler<P>>,
    mut relay: RelayVar,
    fast_exit: bool,
) -> RelayVar {
    hs.sort_by(compare);
    speed_sort_tiebreak(&mut hs, ctx.rng);
    for h in hs {
        // §2.3 re-check: a prior handler may have KO'd this handler's target.
        if !is_alive(ctx, h.target) {
            continue;
        }
        match (h.call)(ctx, relay, h.target, h.source, h.source_effect) {
            HandlerResult::Unchanged => {}
            HandlerResult::Set(v) => {
                relay = v;
                if fast_exit {
                    return relay;
                }
            }
            HandlerResult::Fail => return RelayVar::Bool(false),
            HandlerResult::FailSilent => return RelayVar::Unit,
        }
    }
    relay
}
