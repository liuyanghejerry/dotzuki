# 战斗

> 本文是 `reference/battle-rules.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

`battle` 项目清单区块：配置、rules.ron 钩子、回合循环与 `check` 校验。

> - **Audience**: game authors, rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.1.0

项目通过顶层 `battle` 区块加入通用、数据驱动的战斗系统（队伍 + 战斗可用物品）
（所有键均可选；默认值如下）：

```json
"battle": {
  "party":      { "table": "heroes" },
  "enemies":    { "table": "monsters" },
  "encounters": { "table": "encounters" },
  "skills":   { "table": "spells", "field": "skills", "categoryField": "type", "costField": "mpCost" },
  "stats":    { "hp": "hp", "attack": "atk", "defense": "def", "speed": "spd" },
  "resource": "mp",
  "rules":    "data/rules.ron",
  "items":    { "table": "items", "healField": "healHp", "starting": { "potion": 3 } },
  "levels":   { "expField": "exp", "levelField": "level",
                "curve": { "base": 8, "exponent": 3 }, "growth": 0.05, "maxLevel": 100 }
}
```

## 配置

- `party` / `enemies` 指向 data 活动 `config.tables[]` 中的**数据表 id**（表的
  `dir` 存放记录）。战斗需要两者；引用的 id 若没有对应的已声明表，在*战斗真正
  开始*时是启动错误（从不战斗的项目不受影响）——并且无论如何都是一条
  `dotzuki check` 诊断信息。
- `encounters`（可选）指向一张 **encounter 表**：其记录描述敌人队伍和 trainer
  战斗——`{ "id": "gym-leader-1", "name": "Leader Kai", "enemies": ["slime",
  "bat"], "trainer": true, "money": 80 }`。`enemies` 是敌人表记录 id 的有序
  列表（战斗开始时，空列表或其中的未知 id 都是明确错误），`trainer` 默认为
  `false`，`money`（获胜奖励，只有 trainer encounter 才支付）默认为 0。缺失
  ⇒ 每场战斗都是单个野生敌人（v1 行为）。见下方 **Encounters**。
- `skills` 指向技能表及字段名：`field`（战斗者记录中的技能 id 列表，默认
  `"skills"`）、`categoryField`（默认 `"type"`）、`costField`（默认
  `"mpCost"`）。没有 `skills` 键 ⇒ 每个战斗者只有内置的 Attack。
- `stats` 把四个属性角色映射到记录字段名（默认 hp/atk/def/spd）。缺失/无效的
  属性字段按 1 读取。记录上可选的 `level` 字段（默认 1）供基于等级的 RON
  op/predicate 读取（`SetDamage`、`LevelGE`）——并且在有 `levels` 块时，还
  驱动属性成长（见下文）。
- `resource` 指向保存 MP 池的记录字段；缺失 ⇒ 没有资源门槛（所有技能免费）。
- `rules`（相对项目根目录，默认 `data/rules.ron`）**仅在文件存在时**用
  dotzuki-rules `Ruleset` 模型解析。它的 `type_chart` 提供效果倍率，并且——
  当它声明了 `effects` 时——那些记录是**生效的**：`kind: Move` 记录接管匹配的
  技能，`kind: Status` 记录定义状态，都通过引擎的效果栈解释器执行（见下方
  **RON 效果钩子**）；`kind: Ability`/`Item`/`Weather` 记录支撑战斗者特性、
  携带道具和场景预置的天气（见下方 **Abilities, held items & weather**）。
  解析*或编译*失败（hook 中出现未知的事件/op/属性/类型/资源/状态名）的规则
  文件在战斗开始时是启动错误，也是一条 `dotzuki check` 诊断信息。
- `items`（可选）启用战斗 **Item** 菜单：`table` 指向物品表，`healField`
  （默认 `"healHp"`）是那个数值为正即让物品可用于战斗的记录字段（即回复量），
  `starting` 是游戏启动时携带的背包（记录 id → 数量）。没有 `items` 键 ⇒ 没有
  Item 菜单。物品记录上的自由文本 `effect` 字段**仅用于显示**。
- `levels`（可选）启用 **EXP 与等级成长**（每个键均可选，默认值如上所示）。
  缺失 ⇒ 与当前行为一致：不获得 EXP，属性永不成长，记录的 `level` 字段只供
  RON 等级 op 使用。启用该块后：
  - **属性成长** —— 每个有效属性（双方都是，凡读取原始记录属性的地方：战斗
    构建、RON mirror、菜单 Party 视图）都按
    `floor(raw × (1 + growth × (level − 1)))` 计算，其中 `level` 来自记录的
    `levelField`（默认 `"level"`；缺失 ⇒ 1 ⇒ ×1，数值上与没有 levels 的项目
    完全一致）。5 级的敌人记录确实更强。
  - **EXP 奖励** —— 获胜时，每个未濒死的队伍成员获得所有被击败敌人的
    `expField` 值之和（记录缺少该字段时按 0 计），每场战斗一次，在获胜文本
    之后叙述（`"Aria gained 8 EXP!"`）。单敌人战斗的和就是该敌人的数值，与
    v1 一致。
  - **升级** —— 每个成员记录朝向下一级的 `exp` 进度；
    `exp_to_next(L) = curve.base × L^curve.exponent`（整数）。当
    `exp >= exp_to_next(level)` 且 `level < maxLevel` 时：升级，
    `exp -= exp_to_next(level)`（一次奖励可连升多级），并叙述
    （`"Aria grew to level 2!"`）。升级会用成长倍率重新计算成员的属性，并把
    最大 HP/MP 的**差值**补进当前池（2 级时最大 HP 60 → 63，当前 HP 增加 3；
    MP 同理）。
  - **持久化** —— 每名成员的 `level` + `exp` 随运行器的队伍状态和存档保存
    （`party[].level` / `party[].exp` 是可选字段；缺失 ⇒ 等级 1 / 0 EXP，所以
    存档版本保持 3，旧存档继续加载）。菜单 Party 视图显示 `Lv` 和一行
    `EXP <progress>/<need>`（仅在有该块时）。

`levels` 块的 schema 见[等级成长](data-tables/levels.md)。

## 记录

战斗者记录 schema 见[战斗者记录](data-tables/combatants.md)。

一个战斗者是一条 `<dataRoot>/<tableDir>/<id>.json` 记录：`name`（显示名，缺省
用 id）、四个属性字段、`resource` 字段、可选的 `element` 字符串（type chart
查询中的防守方），以及技能 id 列表。另外两个可选字段接入 RON 效果种类：
`ability`（一个 `kind: Ability` 记录 id）和 `heldItem`（一个 `kind: Item`
记录 id）——见下文。`startBattle("x")` 按此顺序解析：有 `encounters` 块时，
先解析 **encounter 记录** `x`（一个敌人队伍，见下文）；否则解析单个**敌人
记录** `x`（隐式为野生）；两张表都没有该 id 时，回退到第一个敌人记录并给出
警告。

## Encounters（敌人队伍 + trainer 战斗）

encounter 记录 schema 见[Encounter 记录](data-tables/encounters.md)。

有 `encounters` 块时，encounter 战斗的敌方是一个**队列**：当前敌人濒死时，下
一个敌人上场——叙述（`"Foe sent out Bat!"`）——作为全新的战斗者（有自己的
属性/等级，无状态；RON mirror 重建，旧敌人的 volatiles 丢弃），并且该回合
结束（替补上场的那一回合绝不行动；敌人 AI 不变，按当前战斗者逐个行动）。
**队列清空即获胜**；EXP 奖励是所有被击败敌人的 `expField` 之和（见上文）。
`trainer: true` 的 encounter 获胜时把它的 `money` 付给玩家的金钱——叙述
（`"Got 80 G for winning!"`）——并禁止逃跑（见下文）。玩家侧不变：队伍/换人/
物品/whiteout 与野怪战斗表现完全一致，即使敌人还有剩余，全员濒死的队伍仍然
输。

## 队伍

玩家的队伍是 **party 表的每一条记录**（按记录 id 排序；单记录队伍与 v1 表现
一致）。每场战斗开始时，基准属性都从记录重建，但每名成员的**当前 HP/MP 和
状态在战斗之间保持**——运行器持有这份队伍状态，在每场战斗结束时（胜、负和
逃跑）收割，并随存档文件（`party`）保存。0 HP 的成员保持濒死直到被治疗（目前
物品是唯一的治疗来源）。第一个存活成员带队；没有存活成员的队伍当场判负。战斗
中根菜单提供 **Fight**（技能菜单）、**Party**（成员列表，含 HP 和状态——切换
到一名存活且非当前成员会消耗玩家回合，敌人的行动随后对新成员结算）、**Item**
（配置了才出现）和 **Run**——野怪战斗中逃跑总是成功：旁白
`"Got away safely!"`，战斗以 `"run"` 结果结束（无 EXP、无金钱；队伍状态与任何
战斗结束后一样保留）。trainer 战斗中逃跑被禁止——`"Can't escape from a trainer
battle!"`——并且**不**消耗回合（菜单返回）。当前成员濒死时玩家**必须**选一名
替补：这是回合中的免费行动，之后敌人本回合剩余的行动仍然结算（若濒死先发生，
则对新成员结算）。没有存活成员时战斗判负。属性等级在换人上场时重置；成员的
状态随成员保留（切换时 RON mirror 从成员的当前状态重建，旧战斗者的 volatiles
丢弃）。

## 战斗中的物品

物品记录 schema 见[物品记录](data-tables/items.md)。

有 `items` 块时，运行器持有一份持久化的**背包**（记录 id → 数量，首次启动时
从 `starting` 初始化，随存档文件保存）。Item 菜单列出仍有数量的可用物品
（`healField` 数值为正的记录）；使用一个会按该数值治疗当前成员（上限为最大
HP），数量减一，并消耗玩家回合。数量为 0 的物品不再列出。

## 技能

技能记录 schema 见[技能记录](data-tables/skills.md)。

一条技能记录：`name`、`power`（默认 0）、`accuracy`（默认 100）、可选的
`element`、`stat`（buff/debuff 移动哪个属性——一个 `stats` 键，如
`"attack"`/`"defense"`，默认 attack）、category 字段（不区分大小写：
`attack`/`damage` → 伤害，`heal` → 回复自身 `power` 点 HP，上限为最大 HP，
`buff` → 自身属性等级 +1，`debuff` → 目标属性等级 −1，无法识别 → attack），
以及 cost 字段（默认 0）。战斗者列表中未知的技能 id 会跳过并给出警告；空/缺失
的列表（或根本没有技能表）得到内置的 **Attack**（power 40，accuracy 100，
无消耗）。

## 标准公式

每次造成伤害的攻击，使用整数运算：
`base = power × eff_atk / max(1, eff_def)`，其中有效属性 = 原始属性 × 等级
倍率（等级限制在 −4..+4：0 以上为 ×(4+stage)/4，0 以下为 ×4/(4−stage)——+1 =
×1.25，−1 = ×0.8）；然后是浮动 ×(85+rng%16)/100；再是 1/16 的会心
（rng%16 == 0）×1.5；最后是 type chart 倍率（技能的 `element` 对防守方的
`element`，无克制 ⇒ 1×）。`damage = max(1, …)`。命中：当且仅当
`rng % 100 < accuracy` 时命中。每次使用技能消耗一个 accuracy 字节；伤害类
技能随后再消耗浮动和会心字节。

## 优先级（v2-a）

当规则文件声明了一个 `id` 与某技能 id 匹配的 `kind: Move` 记录时，RON 记录
**接管**该技能：它的 `power`/`type`/`accuracy`/`cost` 字段覆盖表记录（缺失
字段回退到表记录），并且行动通过效果栈运行，而非内置的 category 行为。简言
之：**RON 记录 > 表记录 > 内置 category**。没有匹配 RON 记录的技能与 v1 表现
完全一致，即使在规则文件带 effects 的项目中也是如此。

## RON 效果钩子（v2-a）

钩子在规则文件的 `effects` 记录中编写，使用 dotzuki-rules 封闭的
`Op`/`Predicate` 词汇表（`workspace/crates/dotzuki-rules/src/model.rs`——
`Boost`、`InflictStatus`、`DamageFraction`、`HealFraction`、`ScaleRelay`、
`VetoIf`、`ApplyTypeChart`、`PayResource`、`InflictVolatile`、`SetHp`、
`SetDamage`、`RepeatHits`、`RemoveStatus`，以及 `HasType`/
`TargetHasStatus`/`SourceHasStatus`/`SelfHpBelow`/`LevelGE`/… predicates）。
命名约定：

- RON 的 `stats` 名称是项目清单 `battle.stats` 的**键**
  （`"hp"|"attack"|"defense"|"speed"`；常用的 `atk`/`def`/`spd` 别名也能解析），
  所以 `Boost { stat: "attack" }` 不需要任何游戏专属代码。
- RON 的 `resources` 名称是项目清单 `battle.resource` 的字段名（如 `"mp"`）；
  移动记录的 `cost: [Cost(resource: "mp", amount: N)]` 与表 cost 一样经过同一
  个 MP 门槛（菜单标记 + 结算时复查），`PayResource` op 读取同一个池。
- RON 的 `types` 名称是记录上的 `element` 字符串（与 chart 一贯要求一致），
  匹配时不区分大小写。
- 状态词汇表是规则集 `kind: Status` 记录的 id；
  `InflictStatus { status: "poison" }` 施加一个状态，其 `Residual` 钩子 在
  **中毒战斗者的每次行动之后**运行（中毒扣血），并叙述
  （`"Aria was afflicted with poison!"`、`"Slime is hurt by poison!"`、
  `"Aria is no longer poison!"`）。

对于被接管的技能，每次行动运行器都会按以下事件序列走效果栈（minimon/wuxia
harness 的顺序）：MP 门槛 → accuracy → `BeforeMove` 门槛（仅当记录订阅时；
`VetoIf`/`PayResource` 的 `Fail` 阻断行动）→ 伤害预计算（标准公式，写入
`ctx.mv.damage`）→ `ModifyDamage` → `Effectiveness` → `Damage` → 结算 →
`DamagingHit`（任何落地的攻击之后，无论是否造成伤害——power 为 0 的状态技能
附加效果在此触发）→ `AfterMove`。当记录订阅 `Effectiveness` 时，钩子 全权
负责倍率——在 `Effectiveness` hook 里编写 `ApplyTypeChart` 来获得 type chart；
当它**不**订阅时，v1 的直接 chart 应用发生在预计算中（因此只覆盖
`power`/`type` 的记录保留你期望的 chart 行为）。

## 特性、携带道具与天气

其余 RON 种类均已生效，由记录字段和一条场景命令接入——无需改动项目清单：

- **特性**（`kind: Ability` 记录，由战斗者记录上可选的 `ability` 字段指定）。
  当前战斗者的特性 钩子 在战斗开始和每次换人上场（玩家主动/被迫换人、
  encounter 派出）时于 `SwitchIn` 事件触发——后备成员的特性不生效。换人上场
  触发时，在常规的增减文本（`"Slime's Attack fell!"`）之前先叙述一行介绍
  （`"Aria's Intimidate!"`——对记录 id 做了美化，因为记录没有显示名）。特性
  钩子 也会加入行动战斗者的每次行动事件序列：挂接
  `ModifyDamage`/`DamagingHit`/… 的特性与技能自身的 钩子 一起触发，`Source`
  （行动者）和 `Target`（对手）相同。
- **携带道具**（`kind: Item` 记录，由战斗者记录上可选的 `heldItem` 字段指定）。
  它们的触发与特性完全一样，另外其 `Residual` 钩子 会在持有者每次行动之后
  运行（Leftovers 风格的 `HealFraction`）。携带道具是**持久性标志——没有东西
  会消耗它们**（树果/消耗品不在范围内）；`healField` 为 0 的 `heldItem` id
  绝不会出现在 Item 菜单中。
- **天气**（`kind: Weather` 记录，由场景预置）。
  `game.setWeather("sandstorm")` 为**下一场**战斗预置一条天气记录，
  `game.clearWeather()` 取消之前预置的天气（两者都像 flag 命令一样立即生效）。
  天气是**战斗内局部的**：战斗开始时会叙述天气（`"A sandstorm rages!"`，取自
  记录 id），其 `FieldResidual` 钩子 在生效期间每回合在每个战斗者的残留效果上
  触发（按 op 的 `target` 作用于双方），战斗结束时丢弃——从不保存。预置的 id
  若没有对应的已编译记录则警告并忽略。**不**支持在战斗中途设置天气（通过移动
  op）——`Op` 词汇表中没有天气 op；场景是唯一的触发途径。

接入的限制：只有行动战斗者的特性/携带道具 钩子 加入它的每次行动序列（防守方
的特性在它自己的换人/残留效果上触发，不会进入攻击方的那一轮），并且残留效果
（状态、携带道具、天气）在战斗者自己的行动之后触发——在换人/物品回合中只有
敌人的残留效果运行，与状态相同。

## 回合循环

每回合：玩家选择一个根菜单操作——**Fight** 打开技能菜单（名称 + 消耗；付不起
的技能会被标记且不可选），**Party** 换人（消耗回合），**Item** 使用一个物品
（消耗回合），**Run** 结束野怪战斗（trainer 战斗中禁止，不消耗回合）；敌人 AI
选择它能负担的最高威力技能（回退：第一个能负担的技能，再否则是内置 Attack）。
Fight 回合中较快的一方（有效速度）先行动，平局时玩家先动；换人/物品回合玩家
先动。每个行动复查 MP 门槛，掷 accuracy，结算（v1 category 或 RON 钩子）并
叙述（`"Slime used Tackle!"`、`"Critical hit!"`、`"It's super effective!"`、
`"48 damage!"`、`"Aria's Attack rose!"`、`"Come back, Aria!"`、`"Go, Bryn!"`、
`"Aria used Potion!"`）；随后行动方的状态残留效果触发。敌人 0 HP 时派出队列中
的下一个敌人（encounters）或战斗以胜利结束；当前成员 0 HP 时，只要队伍还有
存活成员就强制换人，否则战斗判负；成功逃跑立刻结束战斗：场景以 `"win"`、
`"lose"` 或 `"run"` 恢复。这个循环是运行器自己的阶段机，不是引擎的
`StackDriver`；RON 钩子 按事件经由效果栈解释器触发（`collect_handlers` +
`run_event`），即 minimon/wuxia harness 模式。

## 场景集成

`result = startBattle("slime")`（或 `@command("startBattle", "slime")`）挂起
场景，运行战斗，并以 `result == "win" | "lose" | "run"` 恢复——照常用 `@if`
分支并设置 flags；场景结束时收割 flags。**`"run"` 结果是一项契约变更**：按
`result == "win"` 分支的场景把逃跑视为未获胜（走它们的 `@else` 分支）；显式的
`@if (result == "run")` 分支可以把它与战败区分开。逃跑不给 EXP 和金钱，队伍
状态与任何战斗结束后一样保留。`startWildBattle(species, level)` 表现相同（v1
忽略 `level`）。`setWeather(id)` / `clearWeather()` 预置或取消下一场战斗的天气
（见上方 **Abilities, held items & weather**）。**没有** `battle` 区块的项目会
警告并以 `"win"` 自动完成（保持不败继续，与任何未实现的命令一样）。战败把
`"lose"` 返回给场景（播放它的战败文本），然后触发 **game-over whiteout**（见
[游戏结束](project-manifest.md#game-over)）：队伍回复，玩家回到入口出生点。

## 无场景战斗（随机 encounters）

走路触发的战斗（objects 伴生文件的 `encounters` 块——见
[地图](../how-to/maps.md)）没有场景可恢复，因此它的结果直接回到大地图：**胜利**
或**逃跑**原地返回 `Mode::Overworld`（玩家从 encounter tile 继续行走；
EXP/升级/trainer 金钱和队伍状态/背包的收割与场景战斗结束后完全一致），**战败**
直接触发 game-over whiteout（没有战败文本——没有场景来播放它）。其余所有战斗
语义——抽中 id 的解析顺序（encounter 记录 → 单个敌人记录）、trainer 战斗禁止
逃跑、EXP 求和、特性/天气——都与场景触发的战斗相同。

## 剩余限制

现在每种 RON `EffectKind` 都会触发（Move / Status / Ability / Item / Weather）；
剩余的部分：volatiles 仅支持安装与读取（`InflictVolatile` 安装、`HasVolatile`
读取——没有东西会清除它们）；RON 技能的 HP/MP 被限制在引擎的 `u16` 池中；
物品只能治疗（没有解状态/复活/战斗专属效果），携带道具从不消耗；防守方的
特性/携带道具 钩子 不加入攻击方的每次行动；天气只能由场景预置（没有战斗中
的 op 可以设置）。后续 PR：迁移到 `StackDriver`、回复点系统（whiteout 总是在
入口出生点重生）。

## `dotzuki check` 的校验

当项目清单带 `battle` 区块时，`check` 还会校验它：引用的表 id
（party/enemies/encounters/skills/items）必须存在于 data 活动的
`config.tables[]` 中，引用的属性/技能字段和物品的 `healField` 必须存在于表
schema 中，`encounters` 块的表必须声明 `enemies` 字段，并且规则文件（磁盘上
存在时）必须能按 dotzuki-rules `Ruleset` 模型解析，且能对着封闭词汇表编译
通过——hook 中未知的事件、op，或属性/类型/资源/状态名都会产生诊断信息，就像
它会在战斗开始时成为启动错误一样。
战斗诊断信息与 DSL 诊断信息一样打印，并让退出码失败。
记录 JSON 不会被加载——项目清单的表定义就够了。
