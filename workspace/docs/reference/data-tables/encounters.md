# Encounter records

Encounter records: enemy parties, trainer battles, queues, trainer flag, and money reward.

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`encounters` (optional) names an **encounter table**: its records describe
enemy parties and trainer battles — `{ "id": "gym-leader-1", "name":
"Leader Kai", "enemies": ["slime", "bat"], "trainer": true, "money": 80 }`.

The record example from the spec, verbatim:

```json
{ "id": "gym-leader-1", "name": "Leader Kai", "enemies": ["slime", "bat"], "trainer": true, "money": 80 }
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | string | — | Record id; resolved by `startBattle(id)` and by random-encounter zone tables. |
| `name` | string | — | Present in the spec's example record. |
| `enemies` | array of enemy-table record ids | — | The ordered enemy queue. An empty list or an unknown id inside it is a clear error at battle start. |
| `trainer` | boolean | `false` | Trainer battle: pays `money` on a win and blocks the Run action. |
| `money` | number | `0` | The win reward, paid only by trainer encounters. |

Absent `encounters` block ⇒ every battle is a single wild enemy (v1
behavior) — see [battle rules](../battle-rules.md).

## Battle behavior

With an `encounters`
block, the enemy side of an encounter battle is a **queue**: when the active
enemy faints the next one is sent out — narrated (`"Foe sent out Bat!"`) —
as a fresh combatant (its own stats/level, no status; the RON mirror is
rebuilt and the old enemy's volatiles drop), and the round ends (the
replacement never acts the turn it comes in; the enemy AI is unchanged, per
active combatant). The battle is **won when the queue empties**; the EXP
award is the SUM of every defeated enemy's `expField` (see
[Level growth](levels.md)). A `trainer: true` encounter pays its `money` to
the player's money on a win — narrated (`"Got 80 G for winning!"`) — and
blocks the Run action (see [battle rules](../battle-rules.md)). The player
side is unchanged: party/switch/items/whiteout behave exactly as in a wild
battle, and an all-fainted party still loses even with enemies remaining.

## Schema validation

`dotzuki check` requires that an `encounters` block's table must declare an
`enemies` field.

The map-sidecar `encounters` block (wild encounters by tile zone) is a
different object — see [Maps](../../how-to/maps.md).
