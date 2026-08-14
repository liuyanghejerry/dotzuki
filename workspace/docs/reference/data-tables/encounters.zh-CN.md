# Encounter 记录

> 本文是 `reference/data-tables/encounters.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

Encounter 记录：敌方队伍、trainer 战斗、队列、trainer 标志和金钱奖励。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

`encounters`（可选）指定一张 **encounter 表**：其中的记录描述敌方队伍与
trainer 战斗——
`{ "id": "gym-leader-1", "name": "Leader Kai", "enemies": ["slime", "bat"], "trainer": true, "money": 80 }`。

来自 spec 的记录示例，原文照录：

```json
{ "id": "gym-leader-1", "name": "Leader Kai", "enemies": ["slime", "bat"], "trainer": true, "money": 80 }
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | string | — | 记录 id；由 `startBattle(id)` 与随机 encounter 区域表解析。 |
| `name` | string | — | 出现在 spec 的示例记录中。 |
| `enemies` | array of enemy-table record ids | — | 有序的敌人队列。空列表或其中包含未知 id 是战斗开始时的明确错误。 |
| `trainer` | boolean | `false` | Trainer 战斗：胜利时支付 `money`，并封锁 Run 行动。 |
| `money` | number | `0` | 胜利奖励，仅由 trainer encounter 支付。 |

缺少 `encounters` 块 ⇒ 每场战斗都是一个单独的野怪敌人（v1 行为）——见[战斗规则](../battle-rules.md)。

## 战斗行为

存在 `encounters` 块时，encounter 战斗中敌方一侧是一个**队列**：当前敌人濒死
后，下一个敌人被派出——以叙述呈现（`"Foe sent out Bat!"`）——作为一名全新的
combatant（拥有自己的属性/等级，无状态；RON 镜像会重建，旧敌人的 volatile 全
部丢弃），且该回合结束（替补登场的那一回合从不行动；敌方 AI 不变，按当前
combatant 处理）。**队列清空即获胜**；EXP 奖励是所有被击败敌人的 `expField`
的总和（见[等级成长](levels.md)）。`trainer: true` 的 encounter 在胜利时把它
的 `money` 支付给玩家的金钱——以叙述呈现（`"Got 80 G for winning!"`）——并封
锁 Run 行动（见[战斗规则](../battle-rules.md)）。玩家一侧不变：队伍/换人/道具/
whiteout 的表现与野怪战斗完全一致，即使敌人仍有剩余，队伍全部濒死依然判负。

## Schema 校验

`dotzuki check` 要求 `encounters` 块中的表必须声明 `enemies` 字段。

地图伴生文件里的 `encounters` 块（按 tile 区域划分的野怪 encounter）是另一个
对象——见[地图](../../how-to/maps.md)。
