# Combatant records

Combatant record schema: name, stats, resource, element, skills, and optional RON-hook fields.

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

A combatant is one `<dataRoot>/<tableDir>/<id>.json` record:
`name` (display, else the id), the four stat fields, the `resource` field,
an optional `element` string (the defending side of type-chart lookups), and
the skill-id list. Two more optional fields hook the RON effect kinds:
`ability` (a `kind: Ability` record id) and `heldItem` (a `kind: Item`
record id) — see [battle rules](../battle-rules.md).

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `name` | string | the record id | Display name. |
| stat fields | number | `1` | The four stat roles map to record field names through `battle.stats` (defaults `hp`/`atk`/`def`/`spd`). A missing/invalid stat field reads as 1. |
| resource field | number | — | The MP pool, named by `battle.resource`. Absent `resource` key ⇒ no resource gate (every skill is free). |
| `element` | string | — | The defending side of type-chart lookups. |
| skill list | array of skill ids | empty | Named by `battle.skills.field` (default `"skills"`). |
| `ability` | string | — | A `kind: Ability` record id from the rules file. |
| `heldItem` | string | — | A `kind: Item` record id from the rules file. |
| `level` | number | `1` | Read by level-based RON ops/predicates (`SetDamage`, `LevelGE`) and, with a `levels` block, drives stat growth. |

The source spec documents the combatant record in prose and carries no JSON
example for it.

## Stat fields

`stats` maps the four stat roles to record field names (defaults
hp/atk/def/spd). A missing/invalid stat field reads as 1. An optional
`level` field on records (default 1) is read by level-based RON
ops/predicates (`SetDamage`, `LevelGE`) — and, with a `levels` block,
also drives stat growth (see [Level growth](levels.md)).

## Resource field

`resource` names the record field holding the MP pool; absent ⇒ no
resource gate (every skill is free).

## Skill list

The skill-id list lives in the record field named by
`battle.skills.field` (default `"skills"`). Unknown skill ids in a
combatant's list are skipped with a warning; an empty/missing list (or no
skills table at all) yields the built-in **Attack** (power 40, accuracy
100, no cost). The skill record schema lives in
[Skill records](skills.md).

## Resolution of `startBattle(id)`

`startBattle("x")` resolves in this order: with an
`encounters` block, an **encounter record** `x` (an enemy party, see
[Encounter records](encounters.md)); else a single **enemy record** `x`
(implicitly wild); an id in neither table falls back to the first enemy
record with a warning.

The player's party is **every record of the party table**
(sorted by record id; a 1-record party behaves like v1) — party mechanics
live in [battle rules](../battle-rules.md).
