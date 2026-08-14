# 道具记录

> 本文是 `reference/data-tables/items.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

道具记录：治疗量、商店价格、仅作显示的 effect 文本，以及初始背包。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`items`（可选）开启战斗中的 **Item menu**：`table` 指定道具表，`healField`
（默认 `"healHp"`）指定记录中那个字段——正数即让道具在战斗中可用（也就是治
疗量），`starting` 指定游戏启动时的背包（记录 id → 数量）。没有 `items` 键 ⇒
没有 Item menu。道具记录上的自由文本 `effect` 字段**仅作显示**。

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | string | — | 记录 id：背包的键，也是场景传给 `openShop` 的 id。 |
| `healHp`（列名由项目清单的 `healField` 指定，默认 `"healHp"`） | number | — | 正数即让道具在战斗中可用：也就是治疗量。 |
| `price` | number | `0` | 商店 Buy 价格；Sell 支付 `floor(price / 2)`。 |
| `effect` | string | — | 自由文本，仅作显示。 |

spec 以文字描述道具记录，没有为道具记录本身附带 JSON 示例；项目清单的
wiring 是唯一的原文 JSON：

```json
"items":    { "table": "items", "healField": "healHp", "starting": { "potion": 3 } }
```

## 战斗中

存在 `items` 块时，运行器持有一个持久化的**背包**（记录 id → 数量，首次启动
时由 `starting` 初始化，随存档文件保存）。Item menu 会列出仍有剩余数量的可用
道具（`healField` 数值为正的记录）；使用一个会按该数值治疗**当前出战**成员
（上限为最大 HP）、扣减数量，并消耗玩家的回合。数量为 0 的道具不再列出。

## 商店中

道具记录通过 `battle.items` 表读取。**Buy** 列出给定道具及其记录 `price`（默
认 0）和玩家的金钱。**Sell** 列出玩家背包中数量为正的条目，每件按
**`floor(price / 2)`** 计价（没有单独的 sellPrice 字段；价格为 0 的道具按 0
出售——这是允许的）。货架上的未知道具 id 会以 name=id、price 0 的形式打开。
见[商店](../project-manifest.md#shops)。

## 大地图中的 Bag

记录带正治疗数值的道具（与战斗道具相同的 `battle.items.healField` 约定）可以
使用：选择道具，选择一名队伍成员——为其治疗（上限为最大 HP）并扣减数量。濒
死成员（0 HP）**不会**被复活，满 HP 成员不会被治疗（"It won't have any
effect."），没有正治疗数值的道具无法使用。没有 `battle.items` 块的项目会把自
己的道具列为不可用。
