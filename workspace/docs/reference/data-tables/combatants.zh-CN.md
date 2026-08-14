# Combatant 记录

> 本文是 `reference/data-tables/combatants.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

Combatant 记录 schema：名称、属性、资源、元素、技能，以及可选的 RON 钩子字段。

> - **Audience**: game authors
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

一名 combatant 就是一条 `<dataRoot>/<tableDir>/<id>.json` 记录：`name`（显示名，
缺省则用 id）、四个属性字段、`resource` 字段、一个可选的 `element` 字符串（克制
表查询中的防守方），以及技能 id 列表。另外两个可选字段接入 RON 效果种类：
`ability`（一条 `kind: Ability` 记录 id）和 `heldItem`（一条 `kind: Item` 记录
id）——见[战斗规则](../battle-rules.md)。

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `name` | string | the record id | 显示名。 |
| 属性字段 | number | `1` | 四个属性角色经 `battle.stats` 映射到记录字段名（默认 `hp`/`atk`/`def`/`spd`）。缺失或非法的属性字段按 1 读取。 |
| 资源字段 | number | — | MP 池，字段名由 `battle.resource` 指定。缺少 `resource` 键 ⇒ 无资源门槛（所有技能免费）。 |
| `element` | string | — | 克制表查询中的防守方。 |
| 技能列表 | array of skill ids | empty | 字段名由 `battle.skills.field` 指定（默认 `"skills"`）。 |
| `ability` | string | — | 规则文件中的一条 `kind: Ability` 记录 id。 |
| `heldItem` | string | — | 规则文件中的一条 `kind: Item` 记录 id。 |
| `level` | number | `1` | 供基于等级的 RON op/谓词读取（`SetDamage`、`LevelGE`）；搭配 `levels` 块时还会驱动属性成长。 |

源 spec 以文字描述 combatant 记录，没有为它附带 JSON 示例。

## 属性字段

`stats` 把四个属性角色映射到记录字段名（默认 hp/atk/def/spd）。缺失或非法的属
性字段按 1 读取。记录上还有一个可选的 `level` 字段（默认 1），供基于等级的
RON op/谓词读取（`SetDamage`、`LevelGE`）——并且搭配 `levels` 块时，还会驱动
属性成长（见[等级成长](levels.md)）。

## 资源字段

`resource` 指定持有 MP 池的记录字段名；缺失 ⇒ 无资源门槛（所有技能免费）。

## 技能列表

技能 id 列表存放在由 `battle.skills.field` 命名的记录字段中（默认
`"skills"`）。combatant 列表中未知的技能 id 会被跳过并给出警告；列表为空/缺失
（或根本没有 skills 表）时，将退回到内置的 **Attack**（power 40、accuracy
100、无消耗）。技能记录的 schema 见[技能记录](skills.md)。

## `startBattle(id)` 的解析

`startBattle("x")` 按以下顺序解析：存在 `encounters` 块时，先解析一条
**encounter 记录** `x`（一个敌方队伍，见[Encounter 记录](encounters.md)）；否
则解析单条**敌人记录** `x`（隐式为野怪）；两张表中都没有的 id 会退回第一条敌
人记录并给出警告。

玩家的队伍是**队伍表的每一条记录**（按记录 id 排序；只有一条记录的队伍与 v1
行为一致）——队伍机制见[战斗规则](../battle-rules.md)。
