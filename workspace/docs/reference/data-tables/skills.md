# Skill records

Skill records: damage, heal, buff, debuff moves; `power`, `accuracy`, `element`, category, cost.

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

A skill record: `name`, `power` (default 0), `accuracy`
(default 100), optional `element`, `stat` (which stat a buff/debuff moves —
a `stats` key like `"attack"`/`"defense"`, default attack), the category
field (case-insensitive: `attack`/`damage` → damage, `heal` → restore own HP
by `power` capped at max, `buff` → own stat stage +1, `debuff` → target stat
stage −1, unrecognized → attack), and the cost field (default 0).

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `name` | string | — | Skill name, shown in narration (`"Slime used Tackle!"`). |
| `power` | number | `0` | Damage amount; heal amount for `heal` moves. |
| `accuracy` | number | `100` | The hit lands iff `rng % 100 < accuracy`. |
| `element` | string | — | Type-chart lookups: skill `element` vs defender `element`. |
| `stat` | string | `attack` | Which stat a buff/debuff moves (a `stats` key like `"attack"`/`"defense"`). |
| category field | string | — | Case-insensitive: `attack`/`damage` → damage, `heal` → restore own HP by `power` capped at max, `buff` → own stat stage +1, `debuff` → target stat stage −1, unrecognized → attack. |
| cost field | number | `0` | MP cost, gated against `battle.resource`. |

Unknown skill ids in a combatant's list are skipped with a warning; an
empty/missing list (or no skills table at all) yields the built-in
**Attack** (power 40, accuracy 100, no cost).

## Wiring

`skills` names the skills table plus field names: `field` (the combatant
record's skill-id list, default `"skills"`), `categoryField` (default
`"type"`), `costField` (default `"mpCost"`). No `skills` key ⇒ every
combatant has only the built-in Attack.

The manifest wiring from the spec's `battle` example, verbatim:

```json
"skills":   { "table": "spells", "field": "skills", "categoryField": "type", "costField": "mpCost" }
```

The spec documents the skill record in prose and carries no JSON example
for a skill record itself; the wiring block above is the only verbatim
JSON for skills.

## RON override

When the rules file declares a `kind: Move` record
whose `id` matches a skill id, the RON record **takes over** the skill: its
`power`/`type`/`accuracy`/`cost` fields override the table record (absent
fields fall back to the table record), and the action runs through the
effect stack instead of the built-in category behavior. In short: **RON
record > table record > built-in category**. Skills with NO matching RON
record behave exactly as v1, even in a project whose rules file has effects.
See [battle rules](../battle-rules.md).
