# Type relations (相克) purely in RON — firing the `Effectiveness` seam

> **Scope.** Make a type chart — a relation of *super-effective / resisted /
> immune* multipliers across attacker-type → defender-type — authorable
> **entirely as data in `rules.ron`, with zero game-author Rust**, by firing the
> already-declared-but-currently-inert `Event::Effectiveness`
> ([`event.rs:68`](../../crates/dotzuki-engine/src/battle/stack/event.rs)) and
> folding an **integer-rational** multiplier through the existing
> `RelayVar::scale(num, den)` pattern (`event.rs:207`). **No float ever touches
> the stack path.** The worked example is a 5-element 金木水火土 (Metal / Wood /
> Water / Fire / Earth) chart.
>
> **Constraint (this workflow).** Docs/design **only**. No engine or example code
> is edited here. Every proposed engine change is **additive + defaulted +
> game-agnostic** (no Pokémon types, no element literals, no `if-gen` branches) +
> **determinism-safe** (RNG only via `BattleRng`). All paths are absolute under
> `~/develop/pokered/workspace/`.
>
> **Companion docs.** Builds directly on
> [`11-no-code-authoring-design.md`](./11-no-code-authoring-design.md) — the
> declarative-data + closed-primitive-vocabulary + single `interpret` bridge.
> This doc is that design *applied to one concrete mechanic*: the type chart.
> Read §1.1 (primitive vocabulary), §2.2 (Option A loader bridge), and §3
> (Event/RelayVar/ordering mapping) of that doc first.

Legend: **[ENGINE-WORK]** = a one-time change inside `crates/dotzuki-engine`.
**[AUTHORING-WORK]** = game-side / RON-data only, no engine edit. The goal: after
a small fixed amount of [ENGINE-WORK], the *entire* 金木水火土 relation — the
wheel, every multiplier, and per-move types — is **100% [AUTHORING-WORK]**.

---

## 0. The goal in one paragraph

A game author writes a `type_chart` table in `rules.ron` (`[num, den]`
rationals: `[2,1]` = super-effective, `[1,2]` = resisted, `[0,1]` = immune) and
tags each move with a `type:`. **That is all the author writes — no Rust.** The
engine, one time, (a) **fires** the already-declared `Event::Effectiveness` at
the correct point in damage resolution and (b) gains two *defaulted*
game-agnostic provider seams so the chart is opaque integer indices the **game**
owns — the engine learns no element names. With no chart present every existing
game is byte-identical (the fire is provably inert = 1×). With a chart present,
the formula-computed damage is folded by `RelayVar::scale(num, den)` — exactly
the rational-multiplier discipline minimon's Sandstorm `×3/2` already uses
(`lib.rs:556`). Abilities (Levitate, Wonder Guard, Tinted Lens) and dual-typing
layer onto the **same integer fold** — which is precisely why `Effectiveness`
was designed as a *folding event* and not a boolean.

---

## 1. ENGINE WORK — minimal, additive, defaulted

### 1.0 The path trap (corrected from the first-pass design — READ THIS FIRST)

There are **two** code paths that resolve a damaging move, and they are
**separate**:

1. **The engine driver** — `Driver::resolve_action`
   ([`driver.rs:119-189`](../../crates/dotzuki-engine/src/battle/stack/driver.rs)),
   reached only through `execute_turn` (the only callers are the engine's own
   `stack/mod.rs:495,513`).
2. **minimon's own driver** — `Battle::fire_move`
   ([`examples/minimon/src/lib.rs:690-721`](../../examples/minimon/src/lib.rs)),
   which **every** minimon test calls directly (`tests.rs:41,51,84,117`).
   **minimon never enters `resolve_action`.**

The first-pass design claimed "extend minimon, no engine fork beyond §1/§3" and
asserted the worked numbers would appear. **That is false as stated:** an edit
to `driver.rs:resolve_action` is *dead code for every minimon test*, because the
minimon tests drive `fire_move`. The asserted 160 / 40 / 0 / 80 could never be
produced by a `driver.rs`-only change verified against the minimon test suite.

**The fix.** Both paths share the *same convention* — damage lives in
`ctx.mv.damage`, and both fire `ModifyDamage` then apply (`driver.rs:173-188`;
`fire_move` lib.rs:708-717). So the Effectiveness fold is **the same four lines**
in both. The POC (§5) adds the fire **to whichever path the test actually
drives** (minimon's `fire_move`), and the engine adds it to `resolve_action` for
real games. The two are line-identical; the lesson is **assert against the path
the test exercises, not the path that reads cleanest.**

> Because the POC vehicle (minimon) drives `fire_move`, the POC's "fold lives in
> `fire_move`" is technically an *example-code edit*, not an engine edit. The
> doc is honest about this (it is a one-time edit mirroring the engine's, in the
> example whose role is to demonstrate the engine). The *engine* change proper
> (§1.1) is the `resolve_action` insertion, which real games using `execute_turn`
> get for free.

### 1.1 Where it fires (`resolve_action`, the engine path)

Today `resolve_action` carries the number in `ctx.mv.damage` (a `u16`), **not**
as a relay through `ModifyDamage` — line 173 passes `RelayVar::Unit`. To compose
the chart multiplier with the formula result, the new fire must **read
`ctx.mv.damage`, lift it into `RelayVar::Damage`, fold, and write back** —
between `ModifyDamage` (line 173) and the apply at line 176. This preserves the
existing convention (the number lives in `mv.damage`) and adds nothing to the
`ModifyDamage` relay protocol.

Insert exactly between current lines 173 and 175:

```rust
//   driver.rs, immediately after the existing ModifyDamage fire (line 173):
Self::fire(&mut ctx, eff, Event::ModifyDamage, target, actor, RelayVar::Unit);

// ── NEW: Effectiveness fold. Inert at 1× when no handler subscribes. ─────────
//   - lift the formula-computed number into the Damage lane,
//   - let handlers fold it via RelayVar::scale (chart 2×, 0.5×; 0× = immunity),
//   - write back so the existing apply at the next line stays the single
//     source of truth (number still lives in ctx.mv.damage).
let eff_in  = RelayVar::Damage(ctx.mv.damage);
let eff_out = Self::fire(&mut ctx, eff, Event::Effectiveness, target, actor, eff_in);
ctx.mv.damage = eff_out.as_damage();  // non-Damage relay ⇒ 0 (as_damage, event.rs:179)

// Apply the (possibly folded) damage. Unchanged below this point:
let dmg = ctx.mv.damage;              // driver.rs:176, now post-effectiveness
if dmg > 0 {
    ctx.battler_mut(target).take_damage(dmg);
    ctx.mv.last_damage = dmg;
}
Self::fire(&mut ctx, eff, Event::DamagingHit, target, actor, RelayVar::Damage(dmg));
```

The identical block goes into minimon's `fire_move` (for the POC) between its
`ModifyDamage` `run_event` (lib.rs:711) and its apply (lib.rs:713). Same lift,
same `scale`, same write-back.

### 1.2 Why this point, and how it composes with the formula

- **Composition with the formula.** `calculate_damage` already produced
  `ctx.mv.damage` (minimon stashes it in `fire_move`, lib.rs:696-698; the
  provider's formula is `power * atk / def` with `effectiveness: 1.0` hardcoded
  at lib.rs:247). The chart multiplier applies *on top of* that number via
  `scale(num, den)` — **formula × chart = `base * num / den`**, integer-
  truncated, exactly like Sandstorm's `×3/2` (lib.rs:556). The float
  `DamageResult.effectiveness` field (`mod.rs:121`) stays **unread by the stack**
  (it always was) — the chart lives entirely in the **integer relay**.
- **After `ModifyDamage`** so screen / item / weather damage-modifiers (which
  conventionally fold damage there) precede the type chart, matching Showdown's
  `modifyDamage → typeMod` order.
- **Before `DamagingHit`** so on-hit reactions see the post-effectiveness number.

### 1.3 Inertness (the critical invariant)

`fire` (driver.rs:192) → `collect_from_effect` → `run_event`. With **no
subscriber**, `run_event` (dispatch.rs:277-299) iterates an empty `hs` and
returns the relay unchanged (verified: the `for h in hs` loop body never runs),
so `eff_out == RelayVar::Damage(ctx.mv.damage)` and the write-back is an identity
no-op. Every existing game (minimon, pokered Gen-1) registers no `Effectiveness`
hook today (grep-confirmed never fired), so this is **provably inert = default
1×**. No engine test changes. The crit-before-accuracy draw-order guard
(driver.rs:156-163, pinned by `crit_is_drawn_before_accuracy`) is untouched
because we insert **after** the accuracy fire. This satisfies the
"non-breaking variant addition" contract (event.rs:13-19) — and here the variant
already *exists*; we are only *firing* it.

**This is the entire core engine change: ~4 lines in `resolve_action`.** No new
types, no new trait *required* for the core fire, no float, no Pokémon names.

---

## 2. RON FORMAT — `type_chart` as integer rationals

The chart is **data the loader reads**, never Rust the author writes.
Multipliers are `[num, den]` rationals; immunity is `[0, 1]`; omitted pairs
default to `[1, 1]` (neutral). The 金木水火土 wheel uses the classical
*overcoming* cycle (相克): each element conquers the next, and is resisted by the
element that conquers it.

```ron
// rules.ron — the author writes ONLY this. No Rust.
(
    types: ["Metal", "Wood", "Water", "Fire", "Earth"],   // 金 木 水 火 土

    // Overcoming cycle (相克): 金克木, 木克土, 土克水, 水克火, 火克金.
    // Each entry: ( atk, def, [num, den] ).  Omitted pairs default to [1, 1] = 1×.
    type_chart: [
        // ── super-effective (2×) — the 克 edges ──────────────────────────────
        ( atk: "Metal", def: "Wood",  mult: [2, 1] ),   // 金克木
        ( atk: "Wood",  def: "Earth", mult: [2, 1] ),   // 木克土
        ( atk: "Earth", def: "Water", mult: [2, 1] ),   // 土克水
        ( atk: "Water", def: "Fire",  mult: [2, 1] ),   // 水克火
        ( atk: "Fire",  def: "Metal", mult: [2, 1] ),   // 火克金

        // ── resisted (0.5×) — the reverse edges (defender overcomes attacker) ─
        ( atk: "Wood",  def: "Metal", mult: [1, 2] ),
        ( atk: "Earth", def: "Wood",  mult: [1, 2] ),
        ( atk: "Water", def: "Earth", mult: [1, 2] ),
        ( atk: "Fire",  def: "Water", mult: [1, 2] ),
        ( atk: "Metal", def: "Fire",  mult: [1, 2] ),

        // ── immunity (0×) — one demonstrative no-effect pair ─────────────────
        // 水生木 (the generating cycle, "water nourishes wood"): here water
        // simply cannot damage wood, the worked immunity case.
        ( atk: "Water", def: "Wood",  mult: [0, 1] ),
    ],
)
```

### 2.1 A move gains ONE new field: `type`

The chart needs the **move's** type. In minimon, type lives on `Species`
(`mtype`, lib.rs:123) and `Move` has no type field (lib.rs:162-169). So the
author tags each move — still pure data, no handler on the move:

```ron
moves: [
    ( id: "blade", power: 80, category: Physical, type: "Metal" ),
    // ...
]
```

### 2.2 Driving the fold WITHOUT per-move handlers — the choice

Two candidates:

- **(A) Per-move handler.** Every move registers its own `Effectiveness` hook.
  **Rejected:** that is exactly the per-move Rust the goal forbids, and it
  duplicates the chart lookup N times.
- **(B) ONE chart relation, installed by the loader, reading the chart.**
  ✅ **Chosen.** Effectiveness is intrinsically `attacker-type → defender-type`;
  it is a *global relation*, not a per-move property. The loader, when it sees
  `type_chart`, makes the chart fold available to every typed move via a single
  shared handler body. The move record stays pure data (only a `type:` field).

> **Honest framing correction.** The first-pass design called (B) "ONE shared
> `Effect`." Strictly, because the firing handler needs *this move's* type, the
> loader mints **one op-list per move-type** (or bakes `move_type` into the
> per-move effect's op record) — the *handler body / chart scan is shared*, but
> the bound `move_type` parameter differs per type. That is fine and still data,
> but it is "one shared chart-scan parameterized by move-type," not literally one
> `Effect` instance. The correctness claim (chart is a single relation; authors
> write no Rust) holds; the "exactly one Effect" phrasing was imprecise.

---

## 3. PRIMITIVE / BRIDGE — fit to the `interpret` bridge (doc 11 §2)

The closed no-code vocabulary (11-no-code-authoring-design.md §1.1) has **no**
effectiveness primitive today — only `HasType` as a *predicate*. We add **one
closed primitive op** plus the loader-installed handler, riding the existing
`interpret::<P>` bridge (doc 11 §2, dispatch keyed by `source_effect`).

### 3.1 New primitive op (one closed variant)

```rust
// Added to the closed primitive vocabulary (doc 11 §1.1 enum). One variant.
PrimOp::ApplyTypeChart {
    move_type: usize,   // the in-flight move's type; loader resolves "Metal" → index
}
```

`run_ops` interprets it with zero captures, mutating only through `ctx`
(doc 11 §2.2):

```rust
// inside run_ops' match, the ApplyTypeChart arm. P exposes the chart as DATA.
PrimOp::ApplyTypeChart { move_type } => {
    // Defender's type(s) from state; chart lookup is pure data, no RNG.
    let (num, den) = P::type_chart_mult(ctx, *move_type, target);  // → one rational
    HandlerResult::Set(relay.scale(num, den))                      // RelayVar::Damage fold
}
```

### 3.2 The two new agnostic provider seams (additive, defaulted — the doc 11 §2.2 Option-B shape, mirroring `effect_for_volatile`)

```rust
// On EffectProvider (ctx.rs). Both DEFAULTED ⇒ existing games byte-identical;
// the engine learns NO element names — the chart is opaque indices the GAME owns.
trait EffectProvider: BattleProvider + 'static {
    /// The defender's type(s) for the chart fold, as opaque indices.
    /// Default: no chart ⇒ empty ⇒ the lookup below returns 1×.
    /// (A slice, NOT Option<usize>, to make dual-typing additive — see §5.3.)
    fn defender_types(&self, _b: &BattlerState<Self>) -> &[usize]
        where Self: Sized { &[] }

    /// Chart fold: (attacker_type, defender) → ONE already-combined rational.
    /// The provider folds the dual-type PRODUCT into a single (num, den) so the
    /// caller does exactly ONE `scale` (avoids per-step truncation — see §5.3).
    /// Default 1× ⇒ inert, identical to today.
    fn type_chart_mult(
        &self,
        _ctx: &BattleCtx<'_, Self>,
        _move_type: usize,
        _defender: BattlerRef,
    ) -> (u32, u32)
        where Self: Sized { (1, 1) }
}
```

The loader fills `type_chart_mult` from the RON `[num, den]` table; element
*names* are strings in RON → interned to `usize` indices at load → the engine
sees only integers and rationals. **Agnosticism: total** — no `if Pokemon`, no
element literal, no gen branch in any engine crate.

> **Why a slice, not `Option<usize>` (correction).** The first-pass design used
> `battler_type → Option<usize>` (single type). Real charts multiply over *all*
> defender types. Making the seam a slice from day one means dual-typing is a
> pure data change with **zero further engine edits** (§5.3). `type_chart_mult`
> returning a single *pre-combined* rational (not the caller chaining `scale`)
> is the other half of that correction (truncation-safety, §5.3).

### 3.3 Loader installs the handler (doc 11 §2.2 Option A — ZERO further engine change)

Per doc 11 §2.2 Option A, the loader synthesizes an `EffectId` for the
(chart, `Effectiveness`) pairing per move-type, registers a static `Effect`
whose one `EventHook { event: Effectiveness, call: interpret::<P>, order: <fixed>, .. }`
resolves to `[ApplyTypeChart { move_type }]` via `P::ops_for(source_effect)`. The
driver's new fire (§1.1) reaches it through `effect_for_move` — the loader
attaches the chart hook to every typed move's effect. **Determinism: no RNG** —
the chart lookup is pure data; `ctx.rng` is never touched (doc 11 §4.1 satisfied
trivially).

### 3.4 Smallest correct version (skip the primitive for v0)

For v0 the `ApplyTypeChart` primitive + `interpret` bridge are **optional**. A
hand-written shared `Effectiveness` handler that calls the `ctx`-resolved
`type_chart_mult` and returns `Set(relay.scale(num, den))` is fewer moving parts
and proves the seam. The no-code `PrimOp` is the natural follow-up once doc 11's
interpreter lands. The *load-bearing* engine surface is identical either way:
the §1.1 fire + the two §3.2 defaulted seams.

---

## 4. WORKED EXAMPLE — full RON, asserted numbers

15 moves (3 per element), the §2 chart, and four asserted matchups. minimon's
formula is `power * atk / def` (lib.rs:246). **For the assertions assume
`atk == def`** so base damage `== power`, isolating the chart fold
(`base * num / den`, integer-truncated like Sandstorm).

```ron
// rules.ron (moves section) — 3 moves per element, all pure data.
moves: [
    // 金 Metal
    ( id: "blade",      power: 80, category: Physical, type: "Metal" ),
    ( id: "iron_press", power: 60, category: Physical, type: "Metal" ),
    ( id: "rust_ray",   power: 90, category: Special,  type: "Metal" ),
    // 木 Wood
    ( id: "vine",       power: 80, category: Physical, type: "Wood"  ),
    ( id: "root_bind",  power: 50, category: Physical, type: "Wood"  ),
    ( id: "leaf_storm", power: 95, category: Special,  type: "Wood"  ),
    // 水 Water
    ( id: "torrent",    power: 80, category: Special,  type: "Water" ),
    ( id: "drip",       power: 40, category: Special,  type: "Water" ),
    ( id: "tide_crush", power: 90, category: Physical, type: "Water" ),
    // 火 Fire
    ( id: "ember",      power: 80, category: Special,  type: "Fire"  ),
    ( id: "flare",      power: 55, category: Special,  type: "Fire"  ),
    ( id: "inferno",    power: 95, category: Physical, type: "Fire"  ),
    // 土 Earth
    ( id: "boulder",    power: 80, category: Physical, type: "Earth" ),
    ( id: "tremor",     power: 60, category: Physical, type: "Earth" ),
    ( id: "quagmire",   power: 85, category: Special,  type: "Earth" ),
]
```

### 4.1 Asserted outcomes (data test, §5.2)

| Matchup | Move (power, type) | Defender type | Chart edge | Fold | Damage |
|---|---|---|---|---|---|
| **Super-effective** | `blade` (80, Metal) | Wood  | 金克木 `[2,1]` | `80 * 2 / 1` | **160** |
| **Resisted**        | `blade` (80, Metal) | Fire  | `[1,2]`       | `80 * 1 / 2` | **40**  |
| **Immune**          | `torrent` (80, Water) | Wood | 水→木 `[0,1]` | `80 * 0 / 1` | **0**   |
| **Neutral (control)** | `blade` (80, Metal) | Earth | omitted ⇒ `[1,1]` | `80 * 1 / 1` | **80** |

The **neutral control** is load-bearing: it proves an *omitted* pair defaults to
`[1,1]` and that the fold is a true identity at 1× (i.e. the fire is correct, not
just absent).

### 4.2 The immune case — semantics chosen, limit flagged

With `[0,1]`, the fold yields `dmg == 0` → the driver's `if dmg > 0`
(driver.rs:177) skips `take_damage`, and **`DamagingHit` still fires with
`Damage(0)`** (driver.rs:181). For v0 this is **immunity-as-zero-damage**, the
simplest reading and the one the worked numbers assert. Its limit (on-hit
reactions still see the hit) and the alternative *immunity-as-miss* knob are in
§5.3.

---

## 5. LEDGER + POC + HONEST LIMITS

### 5.1 Engine-vs-authoring ledger

| Concern | Engine (Rust, one-time, additive/defaulted) | Game author (RON only) |
|---|---|---|
| Fire `Effectiveness` between `ModifyDamage` & apply | ✅ ~4 lines, driver.rs:174 | — |
| `RelayVar::Damage` lane + `scale(num,den)` | ✅ already exists (event.rs:207) | — |
| `defender_types` / `type_chart_mult` provider seams | ✅ 2 defaulted methods (like `effect_for_volatile`) | — |
| `ApplyTypeChart` primitive op (optional, doc 11 path) | ✅ 1 enum variant + 1 `run_ops` arm | — |
| Loader: parse `type_chart`, intern names, install handler | ✅ generic loader code | — |
| Element names, the 相克 wheel, every multiplier, move types | — | ✅ `types:` + `type_chart:` + move `type:` |
| Dual-typing (more types per battler) | — (slice seam already supports it) | ✅ data only |

### 5.2 POC spec (extend minimon)

Because minimon drives `fire_move` (§1.0), the POC fold goes in **`fire_move`**,
and the POC asserts against `fire_move`.

1. **Expand types.** Add `Wood`, `Water`, `Fire`, `Earth` to `MType` (lib.rs:76;
   today only `Normal`/`Rock`) — rename/add for the 5 elements, or (cleaner)
   make minimon's loader read `types:`. Minimal POC: add the 5 variants.
2. **Tag moves.** Add a `type` field to minimon `Move` (lib.rs:162) and define a
   const chart `&[(usize, usize, u32, u32)]` (atk, def, num, den).
3. **Implement the seams.** `defender_types` reads `Species.mtype` (lib.rs:123)
   as a 1-element slice; `type_chart_mult` linear-scans the const, folds the
   product over `defender_types` into a **single** `(num, den)`, default
   `(1, 1)`.
4. **Fire it.** Insert the §1.1 fold block into `fire_move` (lib.rs:711-713),
   and (for real games) into `resolve_action` (driver.rs:173-175).
5. **Register** the shared `Effectiveness` handler (hand-written for v0, §3.4),
   or the `ApplyTypeChart` op via `interpret`.
6. **Data test** asserting the four §4 rows:
   ```rust
   #[test] fn metal_super_effective_doubles() {       // 金克木
       let r = run_one_hit("blade", /*def_type*/ Wood);   // atk == def setup
       assert_eq!(r.damage_dealt, 160);
   }
   // + resisted("blade", Fire)  ⇒ 40
   // + immune("torrent", Wood)  ⇒ 0
   // + neutral("blade", Earth)  ⇒ 80   (omitted pair defaults [1,1])
   ```
   This mirrors the existing Sandstorm `scale(3,2)` test discipline and the
   crit-draw-order guard pattern.

**What the POC MUST prove (the trap, per the critique):**

- **(a) The fold executes on the path the test drives.** Assert the *path*, not
  just the number — a `driver.rs`-only edit verified by `fire_move` tests would
  silently never run. (This is the single biggest correction from the critique.)
- **(b) All four §4 rows**, including the neutral control (omitted ⇒ `[1,1]`).
- **(c) Inertness** — a no-`type_chart` build (or the existing minimon
  Sandstorm / Intimidate tests) yields **byte-identical** damage and identical
  `ScriptedRng` draw counts to pre-change.
- **(d) Dual-type product via the single-rational fold** — e.g. ×2 then ×0.5 on
  one defender = exactly neutral (160 → 80, *not* 160→320→160 with intermediate
  truncation; and not 80→40 from a stray order).
- **(e) The `crit_is_drawn_before_accuracy` guard still passes** (insertion is
  after the accuracy fire; nothing draws RNG in the chart path).

### 5.3 Honest limits & how they layer on the SAME fold

- **Truncation floor on resist (latent bug — corrected from first pass).**
  `scale` truncates: a `power=1` move resisted → `1 * 1 / 2 = 0` → silently
  *immune*. minimon clamps `dmg.max(1)` (lib.rs:247) **inside
  `calculate_damage`, before the chart**; the chart fold runs *after* and can
  re-introduce 0. **Decide a min-damage policy explicitly:** either (i) accept
  Gen-1-style chip-to-0 on resist of a 1-damage hit, or (ii) re-apply
  `.max(1)` *after* the fold *unless* the multiplier was a true `[0,1]` immunity
  (immunity must stay 0). Recommendation: (ii), distinguishing `den`-truncation
  from `num == 0`. The first-pass design never addressed this; it is a real knob,
  not a footnote.

- **Dual-typing product — must be one rational, not chained `scale`.** Folding
  `80 × 1/2 × 1/2` as two chained `scale` calls = `80→40→20`; grouped
  `80 × 1/4 = 20` (equal here), but `80 × 3/2 × 1/2` chained = `80→120→60` vs
  grouped `80 × 3/4 = 60` (equal here too) — **and** `80 × 2/1 × 1/2` chained
  = `160→80` is fine, but small bases drift: `5 × 1/2 × 2/1` chained = `5→2→4` vs
  grouped `5 × 2/2 = 5`. **Per-step truncation diverges from the true product.**
  Therefore `type_chart_mult` **folds the product into a single
  `(num = Π numᵢ, den = Π denᵢ)` and the caller does exactly ONE `scale`.** This
  is why the §3.2 seam returns one pre-combined rational and why
  `defender_types` is a slice. `scale`'s u64/u128 widening (event.rs:211-219)
  won't overflow for realistic products. (The legacy float
  `TypeChart::effectiveness(atk, &[Type])` at `mod.rs:733` already takes a
  slice — this brings that N-vs-many shape onto the integer stack path.)

- **Ability-based immunity / modifiers (Levitate, Wonder Guard, Tinted Lens,
  Scrappy — exactly what `event.rs:66-68` names).** These layer as **additional
  `Effectiveness` subscribers** with their own `order`/`priority`
  (event.rs:293-295) firing *after* the chart handler, composing on the **same
  relay fold** — no new seam, because that is precisely why `Effectiveness` is a
  folding event and not a boolean:
  - Levitate (vs a Ground move) → `Set(Damage(0))` (or `Fail`, below).
  - Tinted Lens → `scale(2, 1)` *only when* the chart already returned `< 1×`.
  - Wonder Guard → `Fail` / `FailSilent` unless the chart result was
    super-effective.
  - Scrappy → suppresses an immunity edge (effectively forces `[1,1]`).
  The chart handler installs at a fixed `order`; abilities pick `order` around
  it. The dual-type product (single rational) must be folded *before* these
  ability subscribers run so they see the combined type result.

- **Immunity-as-miss vs immunity-as-zero.** §4 uses **zero-damage** (`dmg == 0`
  skips `take_damage`). True Gen-1 immunity is a *miss* ("doesn't affect", no
  `DamagingHit`, no on-hit reactions). As written, `[0,1]`-as-zero **still fires
  `DamagingHit` with `Damage(0)`** (driver.rs:181) — so a recoil / contact /
  Static-style on-hit reaction would *wrongly trigger on an immune hit*. To get
  true no-effect: the handler returns `HandlerResult::Fail` on `num == 0`;
  `Fail` maps to `RelayVar::Bool(false)` in `run_event` (dispatch.rs:294); the
  driver then needs **one extra branch** after the Effectiveness fire —
  `if matches!(eff_out, RelayVar::Bool(false)) { ctx.mv.move_missed = true; return; }`
  — to suppress `take_damage` *and* `DamagingHit`. That is a **second, optional**
  engine line, deliberately kept out of §1's minimal core and flagged here as
  the fidelity knob. **Pick one immunity semantics and wire it fully** — don't
  leave 0×-as-zero firing on-hit reactions by accident.

- **The chart cannot extend mechanics, only content.** Per doc 11 §5: the data
  layer authors the *relation*; any genuinely new *mechanic* (e.g. a move that
  inverts the chart, à la Inverse Battle) still needs a Rust primitive. The
  chart is a consumer of the `Effectiveness` fold, not an extender of it.

---

## 6. Net

One ~4-line fold (firing an **already-declared** event,
`Event::Effectiveness`), two **defaulted, game-agnostic** provider seams
(`defender_types` → slice, `type_chart_mult` → one pre-combined rational), an
optional one-variant primitive, and a generic loader — after which the **entire
金木水火土 relation, the 相克 wheel, every multiplier, and per-move types are
pure RON**, with **abilities and dual-typing layering on the identical integer
fold** and **no float ever touching the stack path**. The non-obvious
corrections that make it actually work: **fire on the path the test drives**
(minimon's `fire_move`, not only `resolve_action`); **fold the dual-type product
as one rational before a single `scale`** (per-step truncation drifts); **decide
the post-chart min-damage and the immunity (zero vs miss) semantics explicitly**.

### See also
- [`11-no-code-authoring-design.md`](./11-no-code-authoring-design.md) — the
  declarative-data + closed-primitive + `interpret` bridge this rides on.
- Code (read, **not modified**):
  [`crates/dotzuki-engine/src/battle/stack/event.rs`](../../crates/dotzuki-engine/src/battle/stack/event.rs)
  (`Event::Effectiveness`, `RelayVar::scale`, `HandlerResult`),
  [`.../stack/driver.rs`](../../crates/dotzuki-engine/src/battle/stack/driver.rs)
  (`resolve_action`, the insertion site 173-188, the crit-draw-order guard),
  [`.../stack/dispatch.rs`](../../crates/dotzuki-engine/src/battle/stack/dispatch.rs)
  (`run_event` inertness, `Fail` → `Bool(false)` at 294),
  [`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs)
  (`fire_move` 690-721 — the path the POC drives; `calculate_damage` 232-248;
  `MType` 76; `Move` 162; Sandstorm `scale(3,2)` 556),
  [`examples/minimon/src/tests.rs`](../../examples/minimon/src/tests.rs)
  (the `fire_move` callers the POC must assert against).
