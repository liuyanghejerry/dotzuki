# 技能记录

> 本文是 `reference/data-tables/skills.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

技能记录：伤害、治疗、增益、减益招式；`power`、`accuracy`、`element`、类别与消耗。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

一条技能记录包含：`name`、`power`（默认 0）、`accuracy`（默认 100）、可选的
`element`、`stat`（增益/减益招式作用的属性——一个 `stats` 键，如
`"attack"`/`"defense"`，默认 attack）、类别字段（category field，大小写不敏
感：`attack`/`damage` → 伤害，`heal` → 按 `power` 回复自身 HP、上限为最大
值，`buff` → 自身属性等级 +1，`debuff` → 目标属性等级 −1，无法识别 → 按
attack 处理），以及消耗字段（cost field，默认 0）。

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `name` | string | — | 技能名，出现在叙述中（`"Slime used Tackle!"`）。 |
| `power` | number | `0` | 伤害数值；对 `heal` 招式而言是治疗数值。 |
| `accuracy` | number | `100` | 当且仅当 `rng % 100 < accuracy` 时命中。 |
| `element` | string | — | 克制表查询：技能的 `element` 对防守方的 `element`。 |
| `stat` | string | `attack` | 增益/减益招式作用的属性（一个 `stats` 键，如 `"attack"`/`"defense"`）。 |
| 类别字段 | string | — | 大小写不敏感：`attack`/`damage` → 伤害，`heal` → 按 `power` 回复自身 HP、上限为最大值，`buff` → 自身属性等级 +1，`debuff` → 目标属性等级 −1，无法识别 → 按 attack 处理。 |
| 消耗字段 | number | `0` | MP 消耗，以 `battle.resource` 为门槛。 |

combatant 列表中未知的技能 id 会被跳过并给出警告；列表为空/缺失（或根本没有
skills 表）时，将退回到内置的 **Attack**（power 40、accuracy 100、无消耗）。

## 接线

`skills` 指定 skills 表以及若干字段名：`field`（combatant 记录上的技能 id 列
表，默认 `"skills"`）、`categoryField`（默认 `"type"`）、`costField`（默认
`"mpCost"`）。没有 `skills` 键 ⇒ 每个 combatant 只有内置的 Attack。

来自 spec 的 `battle` 示例中的项目清单 wiring，原文照录：

```json
"skills":   { "table": "spells", "field": "skills", "categoryField": "type", "costField": "mpCost" }
```

spec 以文字描述技能记录，没有为技能记录本身附带 JSON 示例；上面的 wiring 块
是 skills 唯一的原文 JSON。

## RON 覆盖

当规则文件声明了一条 `id` 与技能 id 匹配的 `kind: Move` 记录时，这条 RON 记
录会**接管**该技能：其 `power`/`type`/`accuracy`/`cost` 字段覆盖数据表记录
（缺失的字段回落到数据表记录），且该行动改走效果栈，而不再走内置的类别行
为。简言之：**RON 记录 > 数据表记录 > 内置类别**。没有匹配 RON 记录的技能与
v1 表现完全一致，即使所在项目的规则文件里有效果。见[战斗规则](../battle-rules.md)。
