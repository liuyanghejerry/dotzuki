# Item records

Item records: heal amount, shop price, display-only effect text, and the starting inventory.

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`items` (optional) arms the battle **Item menu**: `table` names the items
table, `healField` (default `"healHp"`) the record field whose positive
number makes an item battle-usable (the heal amount), and `starting` the
inventory (record id → count) the game boots with. No `items` key ⇒ no
Item menu. Free-text `effect` fields on item records are **display-only**.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | string | — | Record id: the inventory key and the id scenes pass to `openShop`. |
| `healField` | number | — | A positive number makes the item battle-usable: the heal amount. |
| `price` | number | `0` | Shop Buy price; Sell pays `floor(price / 2)`. |
| `effect` | string | — | Free-text, display-only. |

The spec documents the item record in prose and carries no JSON example
for an item record itself; the manifest wiring is the only verbatim JSON:

```json
"items":    { "table": "items", "healField": "healHp", "starting": { "potion": 3 } }
```

## In battle

With an `items` block, the runner owns a persistent
**inventory** (record id → count, initialized from `starting` at first boot,
carried in the save file). The Item menu lists the usable items (records
whose `healField` number is positive) that still have a count; using one
heals the ACTIVE member by that amount (capped at max HP), decrements the
count, and consumes the player's turn. An item at count 0 is no longer
listed.

## In shops

Item records are read through the `battle.items` table. **Buy** lists the
given items with their record `price` (default 0) and the player's money.
**Sell** lists the player's inventory entries with a positive count, each at
**`floor(price / 2)`** (there is no separate sellPrice field; items priced 0
sell for 0 — allowed). Unknown item ids on the shelf open as name=id, price
0. See [Shops](../project-manifest.md#shops).

## In the overworld Bag

Items whose record has a positive heal amount (the same
`battle.items.healField` convention as battle items) can be used: pick the
item, pick a party member — it heals (capped at max HP) and the count
decrements. A fainted member (0 HP) is **not** revived, a full-HP member
is not healed ("It won't have any effect."), and items without a positive
heal amount can't be used. Projects without a `battle.items` block list
their items as unusable.
