# Level growth

`battle.levels` block: stat growth, EXP awards, level-up curve, and per-member persistence.

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`levels` (optional) arms **EXP and level growth** (every key optional, the
defaults shown):

```json
"levels":   { "expField": "exp", "levelField": "level",
              "curve": { "base": 8, "exponent": 3 }, "growth": 0.05, "maxLevel": 100 }
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `expField` | string | `"exp"` | The record field holding the EXP a defeated enemy pays (0 when a record lacks it). |
| `levelField` | string | `"level"` | The record field holding the level (missing ⇒ 1 ⇒ ×1). |
| `curve.base` | number | `8` | Base in `exp_to_next(L) = curve.base × L^curve.exponent` (integer). |
| `curve.exponent` | number | `3` | Exponent in the exp-to-next curve. |
| `growth` | number | `0.05` | Stat growth multiplier: `floor(raw × (1 + growth × (level − 1)))`. |
| `maxLevel` | number | `100` | The level cap. |

Absent ⇒ today's exact behavior: no EXP is earned, stats never grow, and a
record's `level` field only feeds RON level-ops. With the block:

- **Stat growth** — every effective stat (both sides, wherever raw record
  stats are read: battle build, the RON mirror, the menu Party view) is
  `floor(raw × (1 + growth × (level − 1)))`, with `level` from the
  record's `levelField` (default `"level"`; missing ⇒ 1 ⇒ ×1, numerically
  identical to a no-levels project). A level-5 enemy record is genuinely
  stronger.
- **EXP award** — on a win, each NON-fainted party member gains the
  SUM of every defeated enemy's `expField` value (0 when a record lacks
  it), once per battle, narrated after the win text (`"Aria gained 8
  EXP!"`). A single-enemy battle's sum is its enemy's value, identical to
  v1.
- **Level-ups** — each member tracks `exp` progress toward the next
  level; `exp_to_next(L) = curve.base × L^curve.exponent` (integer).
  While `exp >= exp_to_next(level)` and `level < maxLevel`: level up,
  `exp -= exp_to_next(level)` (multiple level-ups from one award
  supported), narrated (`"Aria grew to level 2!"`). A level-up recomputes
  the member's stats with the growth multiplier and heals the max-HP/MP
  **delta** into the current pools (max HP 60 → 63 at level 2 raises
  current HP by 3; MP likewise).
- **Persistence** — per-member `level` + `exp` ride the runner's party
  state and the save (`party[].level` / `party[].exp` are OPTIONAL fields;
  absent ⇒ level 1 / 0 EXP, so the save version stays 3 and older saves
  keep loading). The menu Party view shows `Lv` and an
  `EXP <progress>/<need>` line (only with the block).

`levels` is a manifest config block, not a data table: the records it
reads are combatant and enemy records in the party and enemy tables. The
battle-side behavior lives in [battle rules](../battle-rules.md); the save
versioning lives in
[Save compatibility](../../explanation/save-compatibility.md).
