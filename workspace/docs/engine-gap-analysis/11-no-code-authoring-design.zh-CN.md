# 战斗效果栈的无代码内容创作 — 设计

*本文档是 [11-no-code-authoring-design.md](11-no-code-authoring-design.md) 的简体中文翻译。代码、标识符与文件路径保持原文。*

> **范围。** 开发者如何**无需编写 Rust** 即可为 `dotzuki_engine::battle::stack` 定义
> **招式 / 特性 / 道具 / 天气 + 一套战斗规则集（ruleset）**——以声明式*数据*的形式，
> 绑定到一组由引擎随附的、封闭的效果原语词表。这是对三个相互竞争的设计方案
> （声明式数据、内嵌脚本、混合方案）外加对抗性评审的首席架构师综合定论；它
> 采纳了评审的建议，并将其落地到真实的引擎类型上。
>
> **配套文档。** 本文与 [`../BATTLE_ENGINE_GUIDE.md`](../BATTLE_ENGINE_GUIDE.md) 中
> 原生 `fn` 指针的内容创作路径配套（涉及概念：`Effect`、`Event`、`RelayVar`、
> `HandlerResult`、`comparePriority` 比较器、`effect!` 宏），并以其为前提。它与更宽泛的
> [`../DEVELOPER_GUIDE.md`](../DEVELOPER_GUIDE.md)（地图/NPC/脚本/渲染，来自 PR #50）
> 是一份**独立**文档；后者早于战斗栈，且**不**涉及战斗栈；与该指南唯一的交叉引用是
> 既有的**大地图（overworld）** Boa 脚本，作为一处刻意不复用的情形在 §4.3 讨论。
>
> **约束。** 仅限文档/设计。本工作流不对引擎或示例做任何编辑；本设计最终唯一需要的
> 那处*增量式*引擎接缝已被指出并在 §2.2 标记为 **ENGINE-WORK**，而推荐的首个交付物
> 对它**毫无需求**。

图例：**[ENGINE-WORK]** = 在 `crates/dotzuki-engine` 内部的改动。**[AUTHORING-WORK]**
= 仅游戏侧 / 数据侧，无需引擎编辑。推荐的 POC（§6）是 **100% [AUTHORING-WORK]**。

---

## 0. 一段话给出的建议

**将内容创作为绑定到封闭原语词表的声明式数据，而非脚本虚拟机。** 一套规则集就是一张
可（反）序列化的*效果记录（effect records）*表；每条记录的各个 hook 都是从一个封闭的、
由引擎随附的枚举中选取的**原语 op（primitive ops）**列表，每个 op 与一个既有的
`BattleCtx`/`RelayVar` 操作一一对应。一个泛型解释器 `fn` 指针使这些数据**可被既有的
`run_event` 折叠（fold）**。之所以推荐它而非内嵌 JS handler，是因为它是**三个设计中
唯一一个完全无需引擎编辑即可交付**的方案（通过下文的“Option A”），它**在构造上即保证
确定性安全**（这是 parity 核心不可让步的底线），它拥有**最小的攻击面**（一个封闭枚举，
没有 `eval`，没有代码生成），并且它是可序列化 + 可热重载的。内嵌 JS 路径作为**有文档记录
的逃生舱**被保留并完整设计，用于词表无法表达的、真正新颖的机制（§5、§7）——而*非*作为
默认方案。

为何不把内嵌 JS 作为默认：它需要最具侵入性的引擎接缝代价，放弃了封闭 `Event` 集的
审计保证，让确定性从一项结构性属性退化为一项*评审*负担；而且其“我们已经在仓库内有 Boa”
的优势在很大程度上是个假象——仓库内的 Boa 集成是**异步的**（见 §4.3），无法在同步的
`run_event` 折叠内部复用。

---

## 1. 内容创作格式

一套规则集是一张扁平的**效果记录**表。每条记录 =
`{ id, kind, category?/power?/type?/accuracy?…, hooks: [...] }`。一个 hook 是
`{ on: <Event>, order?, priority?, chance?, do: [<op>…] }`。`do` 是一个来自封闭词表的
**原语 op** 列表；每个 op 仅由*数据*参数化。唯一的控制流是 `chance`（一个 RNG 门控）
和引擎既有的 `Fail`/`FailSilent`/`Set(fast_exit)` 短路——没有循环，除谓词守卫之外也没有
分支。五个经典 minimon 系统（参见
[`examples/minimon`](../../examples/minimon/src/lib.rs) 参考实现：物理/特殊分离 +
Intimidate + Clear Body 否决 + Leftovers + Sandstorm）以数据形式重新表达如下：

```ron
// rules.ron — 整套无代码规则集，可热重载、可序列化。
Ruleset(
  // 对引擎不透明；provider 在这些名字 ↔ P::Stat / P::Type 键之间做映射。
  stats: ["Hp","Atk","Def","SpA","SpD","Spe"],
  types: ["Normal","Rock","Fire"],
  effects: [
    // (split) 一个造成伤害的招式。物理/特殊分离无需任何引擎改动：
    // provider 的 calculate_damage 按 `category` 读取 Atk/Def 或 SpA/SpD，
    // 与 minimon 的 MinimonProvider::calculate_damage 完全一致（lib.rs:232）。
    Effect(id:"move.tackle", kind:Move, category:Physical, power:40, type:"Normal", accuracy:100,
      hooks:[ Hook(on:"ModifyDamage", do:[ DealMoveDamage ]) ]),         // provider 计算
    Effect(id:"move.ember",  kind:Move, category:Special,  power:40, type:"Fire",   accuracy:100,
      hooks:[
        Hook(on:"ModifyDamage", do:[ DealMoveDamage ]),
        Hook(on:"DamagingHit", order:10, chance:30, do:[                 // 30% 附加灼伤
          InflictStatus(status:"burn", target:Target) ]),
      ]),

    // (a) 一个由命中效果安装的状态 — 回合末扣血（chip）。
    Effect(id:"status.poison", kind:Status,
      hooks:[ Hook(on:"Residual", order:10, do:[                          // order 10 = 在 Leftovers 之前
        DamageFraction(num:1, den:8, of:MaxHp, target:Host) ]) ]),

    // (b) Intimidate — 登场时请求把对手 Atk 降 -1（可否决；见 §3）。
    Effect(id:"ability.intimidate", kind:Ability,
      hooks:[ Hook(on:"SwitchIn", order:10, do:[ Boost(stat:"Atk", stages:-1, target:Foe) ]) ]),
    // (c) Clear Body — 否决持有者身上任何负向能力变化。它与 Intimidate 的请求
    //     在同一次 TryBoost 分发中触发；order 5（先于后续折叠）。
    Effect(id:"ability.clearbody", kind:Ability,
      hooks:[ Hook(on:"TryBoost", order:5, do:[ VetoIf(cond:RelayIntLt(0)) ]) ]),

    // (d) Leftovers — 每回合末回复 1/16，在状态扣血之后。
    Effect(id:"item.leftovers", kind:Item,
      hooks:[ Hook(on:"Residual", order:20, do:[                          // order 20 = 在 poison 之后
        HealFraction(num:1, den:16, of:MaxHp, target:Host) ]) ]),

    // (e) Sandstorm — 对非 Rock 系扣 1/16；对 Rock 系 SpD ×1.5。挂载于 field。
    Effect(id:"weather.sandstorm", kind:Weather,
      hooks:[
        Hook(on:"FieldResidual",     order:50, do:[
          DamageFraction(num:1, den:16, of:MaxHp, target:Target, unless:HasType("Rock")) ]),
        Hook(on:"WeatherModifyStat", order:50, do:[
          ScaleRelay(num:3, den:2, when:[ HasType("Rock"), StatIs("SpD") ]) ]),
      ]),
  ],
)
```

`kind`（`Move`/`Status`/`Ability`/`Item`/`Weather`）映射到 `EffectType`
（`event.rs:250`），**并且**决定由哪个 provider 解析器（resolver）来宿主该效果
（`effect_for_move`/`_status`/`_ability`/`_item`/`field_effects`/`side_effects`，
`ctx.rs:30-177`）。`category` 是一个逐招式的标志，供 provider 的伤害公式读取——引擎
已经对一个不透明的 `EnumMap<P::Stat>` 建立了索引，因此物理/特殊分离**纯属 provider +
数据**，零引擎改动。

### 1.1 原语词表（全部表达力预算）

一个由引擎随附（或在 Option A 下由游戏随附）的封闭枚举。下面是一组代表性集合，
每个都与 `BattleCtx`/`RelayVar` 上已存在的某个 op 一一对应：

| 原语 | 参数 | 映射到（已落地） |
|---|---|---|
| `DealMoveDamage` | — | 由 provider 公式写入 `ctx.mv.damage`（`mv` 是 `MoveContext`，`ctx.rs:278`） |
| `DamageFraction` / `HealFraction` | `num,den,of,target,unless?` | `battler_mut(t).take_damage / heal`（minimon `lib.rs:488,511`） |
| `InflictStatus` | `status,target` | 触发嵌套的 `TrySetStatus`，然后设置状态 |
| `Boost` | `stat,stages,target` | 触发嵌套的 `TryBoost`，若未被否决则应用（minimon 的 Intimidate→TryBoost→Clear-Body 模式） |
| `ScaleRelay` | `num,den,when?` | `RelayVar::scale(num,den)` → `HandlerResult::Set`（`event.rs:207`；minimon Sandstorm `lib.rs:556`） |
| `SetRelay` / `AddRelay` / `ClampRelay` | ints | 通过 `RelayVar::as_int()` 等进行数值折叠（`event.rs:170-200`） |
| `VetoIf` | `cond` | `HandlerResult::Fail` / `FailSilent`（minimon Clear Body `lib.rs:446`） |

`Target`/`Foe`/`Host`/`Source` 是一个小型**选择器枚举**，针对 hook 的
`target`/`source` `BattlerRef` 解析。条件（`HasType`、`StatIs`、`RelayIntLt`）是一个
封闭的谓词枚举。**那个封闭集合就是上限**（§5）。

---

## 2. 运行时效果桥接 — 让数据可被 `run_event` 折叠

### 2.1 确切的缺口

折叠唯一的 handler 调用点是一个**零捕获 `fn` 指针**，按值拷贝：
`CollectedHandler.call: HandlerFn<P>`（`dispatch.rs:32`），以
`(h.call)(ctx, relay, h.target, h.source, h.source_effect)`（`dispatch.rs:286,
334`）的形式调用，而 `EventHook`/`CollectedHandler` 是 `Copy` 的，配以 `'static`
的零分配 hook 表（`event.rs:300-323`、`authoring.rs`）。**数据无法*成为*一个 `fn`
指针。** 桥接方式是：一个泛型解释器 `fn`，所有数据 hook 都指向它；在每次调用时，它
通过引擎**已经穿线（thread）**给每个 handler 的 `source_effect`（`dispatch.rs:128`）
所携带的 `EffectId` 来查找自身的 op 列表。

```rust
// GAME-SIDE registry (NOT engine), keyed by EffectId, parsed from rules.ron:
struct DataHook { event: Event, order: u32, priority: i32, chance: Option<(u32,u32)>, ops: Vec<Op> }

// THE bridge: a single zero-capture fn every data hook's `call` field points at.
fn interpret<P: EffectProvider + ?Sized>(
    ctx: &mut BattleCtx<'_, P>, relay: RelayVar,
    target: BattlerRef, source: BattlerRef, source_effect: EffectId,
) -> HandlerResult {
    let ops = P::ops_for(source_effect);      // &[Op] for the firing hook (Option A: keyed directly)
    run_ops(ctx, relay, target, source, ops)  // a pure interpreter over ctx + the closed op enum
}
```

`run_ops` **只通过 `ctx`** 进行变更（`battler_mut`、`pair_mut`、`effect_mut`，
`ctx.rs:304-371`），且不捕获任何东西，因此“收集 → 拥有式快照 → 折叠”的借用纪律
（`dispatch.rs:160-164`）**毫发无损**：没有 `RefCell`，没有 `Rc`，也没有新的
`unsafe`。难点在于：`interpret` 只拿到 `EffectId`，而非*哪个* `EventHook` 触发了。
有两种解决办法：

### 2.2 解析“哪一份 op 列表”的两种方式

- **Option A — 为每个 `(effect, event)` hook 合成一个 `EffectId`。[AUTHORING-WORK，
  零引擎改动 — 推荐首选]。** 加载器为每个 hook 程序铸造一个独立的 `EffectId`，并*通过
  既有的解析器*把每个 hook 注册为各自独立的微型运行时 `Effect`（多源收集器本就能从
  单个源处收集多个效果，`dispatch.rs:165-227`）。每个这样的 `Effect` 都有一个
  `EventHook`，其 `call` 是 `interpret::<P>`，其 `id` 作为 op 列表的键。**这在今天就
  能用，无需任何引擎编辑**——它只是利用了引擎本就在做的 `source_effect` 穿线
  （`dispatch.rs:128`）以及带默认实现的解析器
  （`effect_for_*`/`side_effects`/`field_effects`）。`Event::Custom(u16)` 也可作为
  数据触达（`on:"Custom(7)"`，`event.rs:148`），因此一个游戏可以完全无需引擎改动就
  新增一个交互点。它承认的代价：`EffectId` 空间膨胀，以及每次分发在 `dispatch.rs:183`
  处的**线性 arena 扫描**——在 minimon 规模下没问题，迁移的触发点是全图鉴（full-roster）
  规模（§7）。

- **Option B — 一处带默认实现的运行时 hook 接缝。[ENGINE-WORK：一个增量式、带默认实现
  的方法]。** 新增一个可选的 `EffectProvider` 方法（形状与四个既有的带默认实现的解析器
  相同，`ctx.rs:131-177`），当某个效果没有 `&'static hooks` 时返回一份运行时 hook 列表；
  收集器会查询它。这保持了 id↔effect 的一一对应，避免了 id 膨胀。它是**一个增量式的、
  带默认实现的方法**：所有当前游戏以及 88 个 Gen-1 切片都保持逐字节一致，因为默认实现
  返回“没有运行时 hook”，把收集器退回到今天的 `push_matching` 路径
  （`dispatch.rs:97-132`）。当 A 的 arena 成本开始咬人时迁移到 B。

> 顺便备案*另外两个*设计的桥接方式：内嵌 JS 设计把 `EventHook.call` 从一个 `fn` 指针
> 扩宽为一个枚举（`HandlerImpl{ Native(fn) | Script{module,func} }` 或
> `HandlerBody{ Native | Runtime(Arc<dyn>) }`），外加一个带默认实现的 `script_runtime()`
> provider 方法。**基于索引的**枚举（带 `module/func` 索引的 `HandlerImpl`）是正确的形状
> ——它保留了 `Copy`/零分配;而 `Arc<dyn RuntimeHandler>` 变体**不是 `Copy`**，且会强制
> 每个 hook 一次堆分配，使 `'static`-const hook 表模型退化（`event.rs:312`）。若日后真要
> 接上 §7 的逃生舱，请使用索引枚举，而非 `Arc`。

无论哪种方式，运行时效果都是通过**既有的**解析器注册的——引擎永远不会得知“数据存在”。
解释器是唯一知道 op 列表的东西;引擎看到的只是一个带 `fn` 指针 hook 的普通 `Effect`。

---

## 3. 映射到 Events / RelayVar / HandlerResult / 排序

- **Events。** 一个 hook 的 `on:` 在**加载期**直接解析为封闭的 `Event` 枚举
  （`event.rs:34-149`）;未知的名字在加载期失败（这个封闭集合是契约，使比较器和
  parity 测试保持可审计，`event.rs:21-27`）。`Custom(u16)` 是开放的尾部
  （`on:"Custom(7)"`）。
- **RelayVar。** 数值 op 使用类型化访问器和 `scale`（`event.rs:170-225`）。
  `ScaleRelay → Set(relay.scale(n,d))`;`AddRelay → Set(Int(relay.as_int()+k))`。
  `scale` 保留通道（lane）（`Int`/`Damage`/`Accuracy`），因此一个数据 `ModifyDamage`
  op 会与同一通道内的原生折叠组合——这正是 minimon 的 Sandstorm `WeatherModifyStat`
  对 `Int` SpD relay 进行缩放的方式（`lib.rs:556`）。
- **HandlerResult。** 每个 op 解析为四种裁决之一（`event.rs:230`）：
  `VetoIf(true)→Fail`（显示 "but it failed!"）或 `FailSilent`;一个数值 op→`Set`;
  一个带副作用的 op（`DamageFraction`）→`Unchanged`。一份 op 列表会在第一个
  `Fail`/`Set(+fast_exit)` 处短路，与原生折叠完全一致（`dispatch.rs:285-297`）。
- **排序。** 数据中的 `order`/`priority` 逐字进入合成的 `EventHook`/`CollectedHandler`，
  因此一个数据效果会在同一次 `comparePriority` 排序下与原生效果交错：**order → priority
  → speed → sub_order → effect_order**（`dispatch.rs:56-66`）。Leftovers（`order:20`）
  对 poison 扣血（`order:10`）的跨源排序，由原生 minimon 所证明的*同一个*比较器层级强制
  保证（`lib.rs:496,517`;`tests.rs:171` 断言 100 − 12 + 6 = 94）。`sub_order` 从
  `kind` 的 `EffectType` 派生（`event.rs:262`）;`effect_order` 回退到 id
  （`dispatch.rs:111-114`），使平局保持无 RNG 且确定。
- **再入告诫（三个设计共有）。** `HandlerFn` 给出 `&mut BattleCtx` 但**不给 `&P`**，
  因此一个 handler 自身无法再入分发。Intimidate→`TryBoost`→Clear-Body-否决 这条级联是
  一种**驱动器编排（driver-orchestration）**模式：`Boost` 原语*记录意图*，由游戏的
  驱动器触发那次嵌套的 `TryBoost`，在其中两个贡献者被收集并按比较器顺序折叠——这正是
  minimon 的做法（`lib.rs:617-685`）。数据层必须把嵌套分发*作为一个原语*暴露（`Boost`、
  `InflictStatus`），绝不可作为自由形式的再入。这是一个限制，而非缺陷（§5）。

---

## 4. 确定性与安全

### 4.1 RNG 只通过 `BattleRng`
引擎**不链接任何 `rand`**（`rng.rs:5`）;所有熵都来自
`ctx.rng: &mut dyn BattleRng`（`ctx.rs:299`），而抽取次数/顺序对 Gen-1 parity 是承载性的
（1/256 失手、暴击掷骰，以及 `dispatch.rs:241-262` 处逐平局速度排序的那个字节）。
`chance:(n,d)` 门控编译为 `ctx.rng.chance(n,d)`（`rng.rs:61`）。**解释器没有任何其它
熵源**——没有 `rand`，没有时钟，没有指针哈希——因此抽取次数与顺序是 op 列表的*纯函数*。
一个 `ScriptedRng`（`rng.rs:76`）能逐一相同地重放一套数据规则集：确定性是一项**结构性
保证，而非评审义务**。这是相较 JS 路径（§4.3）唯一的决定性优势。

### 4.2 不执行代码
数据*选择 + 参数化*预先审计过的 Rust op;没有 `eval`，没有代码生成，没有 FFI。攻击面
就是那个封闭的原语枚举，可被穷尽单元测试（每个原语测一次，而非每个招式测一次）。一条
畸形记录在**加载期**失败，绝不会在战斗中途失败。解析到已濒死/不存在参战者的选择器会被
跳过（镜像 `run_event_checked` 的存活性复检，`dispatch.rs:331`）;分数中的除零会钳制为
`/1`（正如 `RelayVar::scale` 已经做的，`event.rs:208`）。重载会在回合之间替换 provider
的注册表;因为效果是以 `EffectId` 寻址的，且活动状态保存在引擎的 `EffectState` arena 中
（`ctx.rs:236`）而非数据里，所以重载不会使进行中的战斗状态失效。

### 4.3 Boa 边界 — 为何不复用既有脚本基础设施
仓库内的 Boa 集成（大地图地图脚本，`dotzuki-engine-script`）在**构造上是异步的**：
`await game.showText(...)` 铸造一个 `JsPromise`，存储一个 `PendingResolve`，由
`ScriptEngine::tick()` 在**之后某一帧**解析它。`run_event` 恰恰相反——一个**同步的、
可再入的折叠，必须当场返回 `HandlerResult`**（`dispatch.rs:285-297`）。因此那条异步的
ScriptCommand/promise 桥**无法**复用于战斗效果。推荐的声明式数据层对 Boa **毫无需求**。
逃生舱（§7）会复用 Boa *依赖*但**不**复用其*集成*——它需要一个全新的*同步* host-call
门面（从 realm 中删除 `Math.random`/`Date`;所有 RNG 都路由经 `ctx.rng`;禁止
`await`/promises;对每次调用的指令数设上限，把超额当作 `Unchanged` 处理）。因此“我们
已经有 Boa”的优势在很大程度上是个假象。地图过场动画这条线是 §4.3 与
`DEVELOPER_GUIDE.md` 交叉引用的唯一理由：*地图过场 = 异步命令;战斗效果 = 同步*。

---

## 5. 诚实的局限

- **只能表达词表所预见的内容。** Counter（反射 `mv.last_damage`，`ctx.rs:286`）、
  Bide 蓄力累积、Substitute 的 HP 记账、Trick Room 的比较器反转、Future Sight
  （延迟回合的调度）、Disguise/Sturdy 的“伤害下限保留 1 HP”，以及任何需要**新颖的
  逐效果计数器状态**的机制，在没有用 Rust 添加一个原语之前都是**触达不到的**：
  `P::EffectStateKind` 是一个游戏在编译期提供的枚举（`ctx.rs:26,249`），数据**无法
  扩展**它。数据层是词表的*消费者*，是*内容*的摊销器，**而非**机制的*扩展者*。
- **添加一个原语仍然是一次 Rust 改动**（外加一个测试）。胜在摊销：一个
  `InflictStatus` 就覆盖了数以百计的附加效果招式;你只在面对真正全新的*机制*时才落到
  Rust，而非面对新*内容*时。
- **没有任意控制流。** 只有 `chance`、`unless/when` 谓词，以及原生短路。多步有状态序列
  （通过 `forced_action` 实现的蓄力回合锁定，`ctx.rs:99`;多段攻击循环）需要一个专门的
  参数化原语或原生代码。
- **没有 handler 级再入。** 嵌套分发是一个*原语* + 驱动器编排（§3），绝不是从 op 内部
  发起的自由形式再入。
- **两层调试。** 一个错误结果可能出在数据*或*原语中;解释器**必须**从第一天起就记录
  `(EffectId, Event, op, relay before/after)`，否则数据作者就会被推回 Rust——那就背离了
  整个初衷。
- **Option A 的 arena 成本。** 每个 hook 合成一个 id 会使 id 空间和线性 arena 扫描
  （`dispatch.rs:183`）膨胀——这是迁移到 Option B 的触发点。

---

## 6. POC vs 完整版 — 分阶段计划

**POC（小、100% [AUTHORING-WORK]、无引擎编辑 — Option A）。** 把**恰好是 minimon 的
那五个系统**重新表达为一份 `rules.ron` + 那个泛型 `interpret` `fn` 指针 + 一个约 15 个
op 的解释器，通过既有解析器注册。然后断言数据驱动的 `Battle` 产生与原生 minimon 测试
（`examples/minimon/src/tests.rs`）**逐字节一致的 `BattleState` 结果以及一致的
`ScriptedRng` 抽取次数**。**唯一必须通过**的断言是跨源 residual 排序——在同一次
`compare` 排序下，**poison 扣血（order 10）先于 Leftovers 回复（order 20）**
（`tests.rs:171`：100 − 12 + 6 = 94）——因为它证明数据 hook 与比较器的交错*与原生完全
相同*。如果数据版本重放出相同的抽取与相同的 HP 结果，桥接即获证明。在同一个 POC 中
就把 `(EffectId, Event, op, relay)` 追踪构建进解释器。

**Phase 2 [ENGINE-WORK]。** 当 A 的 arena 扫描在更完整的图鉴下开始咬人时，迁移到
Option B 的那个带默认实现的运行时 hook 方法;依据*实际的* Gen-1 招式列表（而非演示用的
那五个）来确定原语集合的规模，使词表上限是被有意触及，而非措手不及。

**Phase 3（完整内容）[AUTHORING-WORK + 偶尔 ENGINE-WORK]。** 把 Gen-1 的
招式/特性/道具/天气表创作为数据;每个真正全新的机制添加一个经审计的原语（Rust + 测试），
随后便解锁所有重组它的内容。

**Phase 4（逃生舱，可选）[ENGINE-WORK]。** 若某机制即便添加新原语也触达不到，就把同步
Boa 门面接在基于索引的 `HandlerImpl` 枚举 + 带默认实现的 `script_runtime()` 之后
（§2.2 备注、§4.3）——留给长尾，并使其远离性能关键的 parity 核心。

---

## 7. 哪些保持原生（以及逃生舱）

保持原生（`BATTLE_ENGINE_GUIDE.md` 路径）：**Gen-1 parity 核心**（抽取顺序承载性、
性能关键），以及任何需要新颖 `EffectStateKind` 或 handler 级再入的机制。面向触达不到的
长尾，**有文档记录的逃生舱**是接在索引 `HandlerImpl` 枚举之后的同步 Boa 门面（§4.3）
——在此设计，*不*推荐作为默认，且**仅靠评审**保证确定性安全（一个漏网的 `Math.random`
会无声地破坏重放）。当词表确实触达不到某机制时再用它;其余一切皆为数据。

---

### 另见
- [`../BATTLE_ENGINE_GUIDE.md`](../BATTLE_ENGINE_GUIDE.md) — 本层所依托的姊妹篇
  **原生 `fn` 指针**内容创作指南。
- [`09-battle-engine-generalization-design.md`](./09-battle-engine-generalization-design.md)、
  [`10-generalization-result.md`](./10-generalization-result.md) — 系统即效果 + GO-WITH-NITS 结论。
- 并行的*混合*设计（在同一套 schema 中声明式原语 + JS 逃生舱）曾被考虑，最终
  未采纳，选择了本文档记载的"声明式数据优先"方案。
- 代码（只读，未修改）：[`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs)、
  [`examples/minimon/src/tests.rs`](../../examples/minimon/src/tests.rs)、
  [`crates/dotzuki-engine/src/battle/stack/{event,dispatch,ctx,authoring}.rs`](../../crates/dotzuki-engine/src/battle/stack/)、
  [`crates/dotzuki-engine/src/battle/rng.rs`](../../crates/dotzuki-engine/src/battle/rng.rs)。
