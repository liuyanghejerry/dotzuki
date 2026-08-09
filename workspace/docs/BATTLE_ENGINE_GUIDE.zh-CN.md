# 战斗引擎开发者指南 —— 基于 effect-stack 进行编写

*本文档是 [BATTLE_ENGINE_GUIDE.md](BATTLE_ENGINE_GUIDE.md) 的简体中文翻译。代码、标识符与文件路径保持原文。*

> **范围。** 本指南覆盖 **`jrpg_engine::battle::stack`** —— 这是一个
> Showdown 风格的 **effect-stack（效果栈）** 战斗引擎 —— 以及如何在它之上构建一个
> Gen-1-to-Gen-6-*类似的* 战斗系统，且 **无需 fork 引擎**。
>
> 它是一份独立于
> [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) 的文档，后者是更宽泛的引擎指南（地图、
> NPC、脚本、渲染、菜单、道具、存档）。那份指南早于战斗栈出现，其 §6（"战斗与怪物系统"）只描述了 *遗留的*
> `battle::driver`/`BattleProvider` 路径 —— 它 **并未** 覆盖 `battle::stack`。
> 战斗之外的一切去读它；战斗相关的读本文。
>
> 全文引用的权威示范代码是
> [`examples/minimon/src/lib.rs`](../examples/minimon/src/lib.rs) 及其
> [`tests.rs`](../examples/minimon/src/tests.rs)：一个极小的 mock 游戏，它编写了
> 物理/特殊分裂（physical/special split）+ Intimidate + Clear Body + Leftovers + Sandstorm ——
> 外加一张 金木水火土 **相克表（type chart）**（[§4](#4-属性相克相克--type-charts)）、
> 一项带招式开销的 **MP 资源**（[§6](#6-资源mpsp与招式开销)），以及把同一套规则集
> 重新落地到 **`rules.ron`** 以便无代码编写
> （[`examples/minimon/rules.ron`](../examples/minimon/rules.ron)、
> [§5](#5-用-rulesron-无代码编写jrpg-rules-加载器)）—— 且 **零引擎改动**，仅依赖
> `jrpg-engine`（数据路径还会用到 `jrpg-rules`）。
>
> 设计背景：§06
> [`06-battle-engine-effect-stack-design.md`](./engine-gap-analysis/06-battle-engine-effect-stack-design.md)
> （栈设计）、§09
> [`09-battle-engine-generalization-design.md`](./engine-gap-analysis/09-battle-engine-generalization-design.md)
> （泛化设计）、§10
> [`10-generalization-result.md`](./engine-gap-analysis/10-generalization-result.md)
> （GO-WITH-NITS 结论）。

---

## 目录

1. [概览与心智模型](#1-概览与心智模型)
2. [核心概念](#2-核心概念)
3. [教程：搭建一个最小规则集（minimon 演练）](#3-教程搭建一个最小规则集minimon-演练)
4. [属性相克（相克 / type charts）](#4-属性相克相克--type-charts)
5. [用 `rules.ron` 无代码编写（jrpg-rules 加载器）](#5-用-rulesron-无代码编写jrpg-rules-加载器)
6. [资源（MP/SP）与招式开销](#6-资源mpsp与招式开销)
7. [菜谱：跨世代机制 → effect-stack 配方](#7-菜谱跨世代机制--effect-stack-配方)
8. [确定性与测试](#8-确定性与测试)
9. [诚实的局限与路线图](#9-诚实的局限与路线图)

---

## 1. 概览与心智模型

战斗栈是一个 Pokémon Showdown 风格的 **effect-stack（效果栈）** 引擎
（它属于 *模式 C*：原生 Rust 的 **零捕获 `fn` 指针** handler，**不是**
脚本 VM）。一句话即可道尽整个设计：

> **一切皆是订阅了 `Event` 的 `Effect`。引擎对事件排序并折叠（fold）这些 handler；
> 你的 handler 决定会发生什么。**

引擎内部 **没有 `Ability` 系统、没有 `Item` 系统、没有天气系统、没有
hazard 系统**。它们每一个都只是 *某处托管的一个 `Effect`*（托管在某个参战者、
某个阵营或场地上），并为它关心的事件注册 handler。引擎通过你在 provider trait 上实现的
**带默认实现的 resolver（解析器）方法** 触达它们 —— 仅此而已。

由此带来的结果是：**物理/特殊分裂** —— 通常是一个结构性的战斗决策 ——
需要 **零引擎改动**。属性是一个泛型 `EnumMap<P::Stat, u16>`，以 *你自己* 的不透明属性枚举为键，
而伤害公式则位于 *你自己* 的 `calculate_damage` 中。一个 Gen-1 游戏以
`{Hp,Atk,Def,Spe,Spc}` 为键；一个分裂游戏以 `{Hp,Atk,Def,SpA,SpD,Spe}` 为键，
并依据招式的类别（category）挑选属性对。引擎从不看到 category —— 它把整个参战者状态交给你，
再从你这里取回一个数字。

### 各部分位于何处

```
jrpg_engine::battle::stack         the effect-stack engine (game-AGNOSTIC)
├── event       Event enum, RelayVar, HandlerResult, Effect/EventHook, HandlerFn
├── ctx         EffectProvider (the trait you implement), BattleCtx, EffectState,
│               EffectHost, MoveContext
├── dispatch    collect_handlers, compare, run_event / run_event_checked
├── driver      StackDriver (a built-in turn sequence), FirstMover, StackTurnResult
└── authoring   the `effect!` macro

jrpg_engine::battle                BattleProvider (supertrait), BattleState,
│                                  BattlerState, BattlerRef, BattleAction, EnumMap
└── rng         BattleRng trait, ScriptedRng

examples/minimon                   the canonical "how a developer uses this"
```

一次 dispatch（分发）的流程：

```
your driver code             the engine                       your handlers
─────────────────            ─────────────────                ──────────────
collect_handlers(...)  ──►    walk EVERY live source           (a snapshot of
                             (source effect + both              fn-pointers, by value)
                              battlers' ability/item/
                              volatile/status + side + field)
run_event(ctx, hs, relay) ─► sort by comparePriority,
                             RNG-permute only the ties,
                             then FOLD:
                               for each handler:        ──►    fn(ctx, relay, ...)
                                 relay = handler(relay)         -> HandlerResult
                             return the final relay
```

你的 handler **只能** 通过 `&mut BattleCtx` 触碰战斗；它们无法捕获或别名化状态。
重入（一个 handler 想要触发另一个事件）是由你的 *driver 代码*（它持有 provider）来完成的，
而不是在 handler 内部 —— 参见 [§2.9](#29-你需要实现的-provider-resolver) 与 Intimidate 配方。

---

## 2. 核心概念

### 2.1 `Event` 分类学 —— 什么会触发，以及何时触发

事件是一个 **无负载的闭合 key 枚举**（负载搭载在一个有类型的
[`RelayVar`](#23-relayvar--有类型的-fold-负载) 上）。采用闭合枚举（而非以字符串为 key 的总线）
能让比较器与一致性测试保持可审计；开放尾项 `Event::Custom(u16)` 则是逃生口，
让游戏永远不会被 *卡死*。

该分类学包含 6 组共 33 个具名种类，外加遗留的 `Residual`，再加上
`Custom`。**重要：** 引擎内置的 `StackDriver` 如今只 *触发* 其中一个子集；
其余的作为 **订阅接缝（subscription seams）** 存在 —— 在某个 driver 扩展触发它们之前处于惰性状态。
你可以在自己的 driver 代码里通过 `collect_handlers` + `run_event` 亲自触发它们当中的任意一个
（这正是 minimon 对 `SwitchIn`、`TryBoost`、`FieldResidual`、`WeatherModifyStat` 所做的）。

```rust
pub enum Event {
    // ── Group A — Turn lifecycle ──
    BeforeTurn, ResidualOrder, AfterTurn,

    // ── Group B — Action / move pipeline ──
    BeforeMove,        // pre-move status gate (sleep/freeze/para/flinch/recharge) — the veto point
    ModifyMove,        // mutate the move in flight (multi-hit count, Normalize)
    ModifyType,        // per-hit type override (Pixilate/Aerilate)
    ModifyCritRatio,   // crit-threshold fold; CRIT IS DRAWN HERE — before Accuracy
    Accuracy,          // accuracy fold (the Gen-1 1/256 miss)
    Invulnerability,   // Fly/Dig gate
    ModifyDamage,      // final-damage fold (the damage roll; Life Orb, weather, STAB)
    Effectiveness,     // type-effectiveness fold (Levitate, Wonder Guard)
    AfterMove,         // per-action cleanup (Hyper Beam recharge set, Life Orb recoil)

    // ── Group C — Hit / damage application ──
    TryHit,            // pre-damage veto/redirect (Protect, Substitute, Magic Bounce)
    Damage,            // damage-application fold (Substitute absorb, Sturdy floor-to-1)
    DamagingHit,       // a hit connected — secondaries, Counter/Bide read, recoil, drain
    Heal,              // healing fold (Heal Block veto, Big Root)
    AfterFaint,        // post-KO (Moxie, Aftermath, Destiny Bond)

    // ── Group D — Status & stat changes ──
    TrySetStatus,      // veto a non-volatile status (Immunity, Safeguard)
    AfterSetStatus,    // status applied (Synchronize, Toxic Orb)
    TryBoost,          // veto/modify a stat-stage change (Clear Body, Hyper Cutter)
    AfterBoost,        // stat change applied (Defiant)
    ModifyStat,        // persistent stat fold for damage-formula reads (Huge Power, burn ÷2 atk)
    WeatherModifyStat, // weather/ability stat mults that layer AFTER ModifyStat (Swift Swim)

    // ── Group E — Lifecycle / presence ──
    Start, End, Faint,
    SwitchIn,          // a battler entered — Intimidate, Drizzle, Stealth Rock damage
    SwitchOut,         // a battler is leaving — Regenerator, Natural Cure, Baton Pass

    // ── Group F — Field / side ──
    SetWeather,        // veto/replace a weather change (Air Lock)
    FieldResidual,     // field-hosted end-of-turn tick (weather chip, Trick Room countdown)
    SideResidual,      // side-hosted end-of-turn tick (Spikes, Wish, screen countdown)

    // ── Legacy (kept for the Gen-1 regression slices) ──
    Residual,          // PER-MOVER end-of-action residual (burn/psn → leech)

    // ── The open tail ──
    Custom(u16),       // a game-defined dispatch key the engine assigns no meaning
}
```

> **`Residual` 与 `FieldResidual`/`SideResidual` 的对比。** §1.4 的分类学把
> 逐参战者（per-mover）的 `Residual` 折叠进 `ResidualOrder`/`FieldResidual`/`SideResidual`，
> 但 88 个 Gen-1 栈一致性切片直接触发 `Residual`，所以它作为既有变体被保留下来
> （加性/不破坏的约束压倒了重命名）。
> minimon 在其道具/状态 chip 排序配方中使用遗留的 `Residual`，
> 并用 `FieldResidual` 处理 Sandstorm。新游戏可能更倾向于 §1.4 的种类。

如果你要复现 Gen-1，必须遵守的 driver 触发不变式：在内置的
`StackDriver` 中，**`ModifyCritRatio` 必须在 `Accuracy` 之前触发**，使得 crit 字节
在 accuracy 字节之前被抽取（与原版 `MoveRandoms` 字段顺序一致）。这一排序由一项常驻的抽取顺序守卫
（`crit_is_drawn_before_accuracy`）固定；如果你想要 Gen-1 的保真度，不要在自定义 driver 中调换它们。
参见 `driver.rs:155-167`。

### 2.2 `Effect` / `EventHook` —— 注册 handler

一个 `Effect` 是 id + 类别 + 一张 `'static` 的稀疏 hook 表。由于该表是
`'static` 的，注册是零分配的 `const`/`static`。

```rust
pub struct Effect<P>   { pub id: EffectId, pub kind: EffectType, pub hooks: &'static [EventHook<P>] }
pub struct EventHook<P>{ pub event: Event, pub call: HandlerFn<P>,
                         pub order: u32, pub priority: i32, pub sub_order: Option<u8> }

pub struct EffectId(pub u32);                  // opaque arena key, you assign these
pub enum   EffectType { Move, Status, Condition }
// EffectType::sub_order() defaults: Condition = 2, Status = 4, Move = 6
```

编写一个 `Effect` 最符合人体工学的方式是 **`effect!` 宏**（在 crate 根部以
`jrpg_engine::effect` 重导出）：

```rust
// Syntax: effect!(<id expr>, <EffectType expr>, { <Event> [(<order>)] => <fn path>, ... })
//   - <Event> is BARE (e.g. DamagingHit) — the macro qualifies it.
//   - (<order>) is optional; omitted ⇒ order = u32::MAX (fires LAST).
//   - priority defaults to 0, sub_order defaults to None (derive from EffectType).

pub static LEFTOVERS: Effect<MinimonProvider> = effect!(EffectId(0xB1), EffectType::Condition, {
    Residual(20) => leftovers_residual::<MinimonProvider>,
});
```

当你想显式指定 `priority` 或 `sub_order` 时，也可以手写结构体字面量
（该宏总是使用 `priority: 0, sub_order: None`）：

```rust
pub static INTIMIDATE: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA1),
    kind: EffectType::Condition,
    hooks: &[EventHook {
        event: Event::SwitchIn,
        call: intimidate_switch_in::<MinimonProvider>,
        order: 10, priority: 0, sub_order: None,
    }],
};
```

### 2.3 handler 签名 + `HandlerResult` + `RelayVar` fold

一个 handler 是 **零捕获的 `fn` 指针**。它进入战斗的唯一可变路径是
`ctx`；其余一切都是按值传入。

```rust
pub type HandlerFn<P> = fn(
    ctx: &mut BattleCtx<'_, P>,   // the ONLY mutable path into the battle
    relay: RelayVar,              // the typed fold value in flight
    target: BattlerRef,          // event target
    source: BattlerRef,          // event source
    source_effect: EffectId,     // which Effect registered this handler
) -> HandlerResult;
```

handler 返回一个裁决（verdict），它对应 Showdown 的 `undefined / value / false /
null`：

| 变体 | 含义 | 对 fold 的影响 |
|---|---|---|
| `Unchanged` | relay 原样透传，继续 | Showdown `undefined` |
| `Set(RelayVar)` | relay 变为此值，继续（若 `fast_exit` 则返回） | Showdown 返回一个值 |
| `Fail` | 停止，"but it failed!" | fold 返回 `RelayVar::Bool(false)` |
| `FailSilent` | 停止，无消息 | fold 返回 `RelayVar::Unit` |

#### `RelayVar` —— 有类型的 fold 负载

事件不携带负载；负载搭载在 `RelayVar` 上：

```rust
pub enum RelayVar { Unit, Int(i64), Damage(u16), Accuracy(u8), Bool(bool) }
```

有类型的访问器是 **有损的**（取错车道会得到 `0`/`false`），而 `scale` 则是
那个 `×num/den` 的修饰形态，它让 relay 保持在自己的车道内（并通过
`den.max(1)` 防护 `/0`）：

```rust
fn as_int(self) -> i64;        fn as_damage(self) -> u16;
fn as_accuracy(self) -> u8;    fn as_bool(self) -> bool;
fn scale(self, num: u32, den: u32) -> RelayVar;   // e.g. ×1.5 == relay.scale(3, 2)
```

一个贡献 ×1.5 增益的 handler 只需返回 `Set(relay.scale(3, 2))`；一个
veto（否决）返回 `Fail`；一个只产生副作用的观察者（residual chip、recoil）
通过 `ctx` 进行变更并返回 `Unchanged`。

### 2.4 排序 —— `order` / `priority` 与 comparePriority 旋钮

当你 fold 时，`run_event` 按这个 **确切的** 字典序对收集到的 handler 排序，
然后只对相等（tied）的连续段进行 RNG 排列（permute）：

```
order  →  priority  →  speed  →  sub_order  →  effect_order
asc        desc        desc      asc            asc
(LOW 1st)  (HIGH 1st)  (HIGH)    (LOW 1st)      (LOW 1st)
```

每个 `EventHook` 你可以控制的：

- **`order`**（`u32`，默认 `u32::MAX` = 最后触发）—— **主要的、
  跨来源（cross-source）** 排序旋钮。这是你最常用的那个。minimon 在
  `Residual(10)` 处的 poison chip 与 `Residual(20)` 处的 Leftovers 治疗，
  让 chip-before-heal（先 chip 后治疗）跨越两个 *不同的* 效果来源成立
  （一个状态效果与一个道具效果在同一次 dispatch 中被收集）。
- **`priority`**（`i32`，默认 `0`，高者先）—— 在相等 `order` 内的次级分组。
- **`sub_order`**（`Option<u8>`，`None` ⇒ 从 `EffectType` 推导）。

由引擎控制的层级：

- **`speed`** 目前总是 `0`（引擎无法从不透明的 `P::Stat` 命名出一个"speed"属性）。
  如果你需要速度层级，请在自己的 driver 里亲自排序它
  （例如以最快者优先的顺序遍历参战者）。
- **`effect_order`** 是 arena 创建计数器，对于没有 arena 条目的招式/特性/道具，
  回退到效果的 `id`。
- 完全相等（exact ties）由 **每对相邻者一个 RNG 字节**（`< 128` 翻转）打破 ——
  这是唯一的 handler 顺序随机性（`speed_sort_tiebreak`，`dispatch.rs:241`）。

### 2.5 handler 上下文 `BattleCtx`

交给每个 handler 的分裂借用（split-borrow）句柄。公开字段：

```rust
pub struct BattleCtx<'a, P> {
    pub state:   &'a mut BattleState<P>,        // the two party Vecs
    pub effects: &'a mut Vec<EffectState<P>>,   // the per-effect-instance arena, sorted by id
    pub mv:      &'a mut MoveContext,           // per-move scratch
    pub rng:     &'a mut dyn BattleRng,         // the ONLY randomness source
}
```

访问器：

```rust
fn battler(&self, r: BattlerRef)            -> &BattlerState<P>;
fn battler_mut(&mut self, r: BattlerRef)    -> &mut BattlerState<P>;
fn pair_mut(&mut self, a, b: BattlerRef) -> (&mut BattlerState<P>, &mut BattlerState<P>); // two disjoint refs
fn effect(&self, id: EffectId)              -> Option<&EffectState<P>>;      // binary search
fn effect_mut(&mut self, id: EffectId)      -> Option<&mut EffectState<P>>;
```

`pair_mut` 是引擎唯一的热路径 `unsafe`：跨阵营的引用会索引两个
不同的 `Vec`（可证明不相交），所以它返回两个由裸指针派生的
`&mut`；同阵营时它使用安全的 `split_at_mut`。它会 `debug_assert!` `a != b`。
这就是那个借用检查器（borrow checker）技巧，让一个 Counter 形态的 handler 能够
**在读取 `source` 的同时变更 `target`**，且无需 `RefCell`/`Rc`。

`BattlerState` 暴露 `hp: u16`、`max_hp: u16`、`stats: EnumMap<P::Stat, u16>`、
`stat_stages: EnumMap<P::Stat, i8>`、`status: Option<P::Status>`，以及
`take_damage(amount)` 与 `heal(amount)`。

### 2.6 `MoveContext` —— 逐招式的临时区（scratch）

```rust
pub struct MoveContext {
    pub is_critical: bool,   // whether the in-flight move is a crit
    pub damage: u16,         // the rolled/precomputed damage the driver applies
    pub move_missed: bool,   // whether it missed
    pub last_damage: u16,    // the last damage actually dealt (the canonical Counter/Bide read)
}
```

这是在一次招式的事件链中共享的临时区。内置 driver 把伤害预先计算进
`mv.damage`，然后 `ModifyDamage` 的 handler 对它进行 fold，接着 driver 应用它并在
触发 `DamagingHit` 之前写入 `mv.last_damage`（`driver.rs:173-188`）。`DamagingHit` 上的
recoil/drain handler 读取 `ctx.mv.last_damage`。

### 2.7 `EffectState` arena + `EffectHost`

一个活跃效果的逐实例可变状态存放在一个 **arena**（`Vec<EffectState<P>>`，
按 id 保持有序以便二分查找）中：

```rust
pub struct EffectState<P> {
    pub id: EffectId,                    // arena key
    pub host: BattlerRef,                // the battler this effect is attached to
    pub effect_order: u64,               // monotonic creation tiebreak (RNG-free)
    pub kind: P::EffectStateKind,        // YOUR typed per-effect counter enum
}
impl EffectState<P> { fn host_scope(&self) -> EffectHost; }
```

`P::EffectStateKind` 是你游戏中有类型的计数器枚举（例如一个 Toxic 计数器、一个
Substitute hp 值、一个多回合锁定计数器）。编译器会检查每一个
计数器 —— 没有按位置编号的槽位袋（positional slot bag）。通过
`ctx.effect_mut(id)` 读写它：

```rust
if let Some(es) = ctx.effect_mut(EffectId(7)) {
    if let MyKind::Toxic { counter } = &mut es.kind { *counter = counter.saturating_add(1); }
}
```

`EffectHost` 是引擎用以路由的三向作用域：

```rust
pub enum EffectHost { Battler(BattlerRef), Side(u8) /* 0=player,1=opponent */, Field }
```

**一个重要的不破坏（non-breaking）细节：** `EffectState.host` 保持为 `BattlerRef`（这样
每个既有 Gen-1 切片的结构体字面量都能逐字编译通过），而且 arena 状态在 **今天总是托管于参战者** 上 ——
`host_scope()` 返回 `EffectHost::Battler`。阵营托管与场地托管的状态 *不* 存储在 arena 中；
它存活于 **你的游戏** 中，你通过
`side_effects`/`field_effects` resolver 暴露其效果（参见 [§2.9](#29-你需要实现的-provider-resolver)）。
`From<BattlerRef>` 与 `PartialEq` 的跨实现（cross-impl）让路由代码可以把一个
`BattlerRef` 与一个 `EffectHost::Battler` 互换看待。

### 2.8 `BattleRng` —— 唯一的随机性，以及确定性

引擎 **不** 链接任何 rng crate。所有随机性都流经 `BattleRng`
trait，因此 *你的游戏* 拥有生成器，从而拥有 **确切的抽取顺序**
（这对于 Gen-1 怪癖至关重要）。

```rust
pub trait BattleRng {
    fn next_u8(&mut self) -> u8;                               // required, the 8-bit primitive
    fn range(&mut self, bound: u32) -> u32 { /* defaulted */ } // override for exact modulo bias
    fn chance(&mut self, num: u32, den: u32) -> bool { /* defaulted: range(den) < num */ }
}
```

对于测试，`ScriptedRng::new(bytes)` 回放一段固定的字节脚本（耗尽后重复最后一个字节）
并暴露 `consumed() -> usize` 以便进行抽取顺序的一致性断言。

### 2.9 你需要实现的 provider resolver

你需要实现 **`EffectProvider`**（它扩展自 `BattleProvider`）。这就是
"abilities/items/weather/side-conditions 都只是 Effect" 这一整套机制：一组
resolver + 收集（collection）过程。这里 **没有 `Ability` dispatcher**。

```rust
pub trait EffectProvider: BattleProvider + 'static {
    type EffectStateKind: Clone;   // your typed per-effect counter enum

    // ── Required ──
    fn effect_for_move  (&self, m: &Self::Move)   -> Option<&'static Effect<Self>>;
    fn effect_for_status(&self, s: &Self::Status) -> Option<&'static Effect<Self>>;
    fn turn_order_rank(&self, state: &BattleState<Self>, who: BattlerRef,
                       action: &Self::Move) -> (i32, i32);   // RNG-FREE; lower acts first

    // ── Defaulted to None/empty → the broadened collector reduces to single-source ──
    fn effect_for_volatile(&self, kind: &Self::EffectStateKind) -> Option<&'static Effect<Self>> { None }
    fn effect_for_ability (&self, b: &BattlerState<Self>)       -> Option<&'static Effect<Self>> { None }
    fn effect_for_item    (&self, b: &BattlerState<Self>)       -> Option<&'static Effect<Self>> { None }
    fn side_effects (&self, ctx: &BattleCtx<'_, Self>, side: u8) -> &[&'static Effect<Self>] { &[] }
    fn field_effects(&self, ctx: &BattleCtx<'_, Self>)          -> &[&'static Effect<Self>] { &[] }

    // ── Cross-turn lock-in (Thrash/Hyper Beam/Fly): swap one action for another ──
    fn forced_action(&self, effects: &[EffectState<Self>], actor: BattlerRef,
                     chosen: &BattleAction<Self>) -> Option<BattleAction<Self>> { None }
}
```

因为全部五个收集 resolver 都默认为 `None`/`&[]`，一个没有
abilities/items/weather/side-conditions 的游戏，会看到加宽后的收集器 **精确地** 退化为
单一来源（single-source）行为 —— 零新增 handler、零行为
变化、完全相同的 `consumed()` 抽取顺序。你通过实现某个系统的 resolver 来点亮它。

`BattleProvider`（其超 trait）绑定关联类型
`Monster / Move / Ability / Status / Stat / Species / Type / Item` 并拥有
伤害公式：

```rust
fn calculate_damage(&self, move_: &Self::Move, attacker: &BattlerState<Self>,
                    defender: &BattlerState<Self>, random: u8, is_critical: bool) -> DamageResult;
// DamageResult { damage: u16, effectiveness: f32, is_miss: bool }
```

**物理/特殊分裂就活在这里** —— 无需任何引擎改动。

### 2.10 Dispatch 原语（你的 driver 会调用的东西）

```rust
// Gather hooks subscribing to `ev` from EVERY live source into an owned snapshot:
//   1. the source effect (the move/volatile that triggered the dispatch)
//   2. live volatiles on target & source (arena scan → effect_for_volatile)
//   3. each relevant battler's ability + item (effect_for_ability / effect_for_item)
//   4. both sides' side_effects
//   5. field_effects
fn collect_handlers<P>(ctx: &BattleCtx<P>, provider: &P, src_eff: Option<&'static Effect<P>>,
                       ev: Event, target: BattlerRef, source: BattlerRef,
                       out: &mut Vec<CollectedHandler<P>>);

// Sort by compare, RNG-permute ties, then fold the relay through each handler:
fn run_event<P>(ctx: &mut BattleCtx<P>, hs: Vec<CollectedHandler<P>>, relay: RelayVar,
                fast_exit: bool) -> RelayVar;
fn run_event_checked<P>(...) -> RelayVar;   // + a per-step liveness re-check (skip a dead target)
fn compare<P>(a, b: &CollectedHandler<P>) -> Ordering;
```

- `collect_handlers` 只接受 `&BattleCtx`（共享）并填充一个 **拥有所有权（owned）** 的
  `CollectedHandler` `Vec`（按值持有 fn 指针 + 各 id + 各 `BattlerRef`）。没有任何对 arena 的借用
  能存活进入 fold 阶段 —— 这就是那种 collect-then-fold（先收集后折叠）的借用纪律，
  它让零捕获 handler 与可重入 dispatch 得以在没有 `RefCell` 的情况下共存。
- `fast_exit: true` 在第一个 `Set` 处返回（重定向 / 先发制人形态，例如
  `TryHit` 的目标重定向）。
- 当一次 fold 可能 KO 掉后续某个 handler 的目标时（例如
  多目标天气 chip），使用 `run_event_checked`：它在每次调用前重新读取 `hp > 0` 并跳过
  已死亡的目标。普通的 `run_event` **不会** 重新检查。

### 2.11 叙述一个回合 —— `TurnLog`

`StackDriver::execute_turn` 只返回 `StackTurnResult { first, second_cancelled }`
—— 足以 *排序* 一个回合，但不足以 *叙述* 它。一个要渲染战斗的前端（文本、血条
下降、濒死动画）需要知道 **发生了什么**。这就是 `execute_turn_logged`：

```rust
let (result, log): (StackTurnResult, TurnLog<P>) =
    StackDriver::execute_turn_logged(provider, state, effects, actions, rng);
for ev in &log.events { /* …渲染… */ }
```

`TurnLog<P>` 是一个有序的 `Vec<TurnEvent<P>>`。其词汇表是通用的 JRPG 回合表面，
以引擎既有的泛型关联类型（`P::Move` / `P::Status` / `P::Stat`）+ `BattlerRef` 为键：

```rust
pub enum TurnEvent<P: BattleProvider + ?Sized> {
    MoveUsed   { actor: BattlerRef, move_: P::Move },   // 通过门控+开销 → 执行
    Missed     { actor: BattlerRef },                   // 命中/免疫未中
    Blocked    { actor: BattlerRef },                   // 在执行前被阻止（见下）
    Crit       { actor: BattlerRef },                   // 打出会心一击
    Damaged    { target: BattlerRef, amount: u16 },
    Healed     { target: BattlerRef, amount: u16 },
    StatusInflicted { target: BattlerRef, status: P::Status },
    StatusCured     { target: BattlerRef, status: P::Status },
    StatChanged     { target: BattlerRef, stat: P::Stat, delta: i8 },
    Fainted    { who: BattlerRef },
}
```

**它是 增量 + 默认惰性 的。** `execute_turn` 就是丢弃了 log 的 `execute_turn_logged`；
无 log 路径不观测任何东西，且 **逐字节一致**（相同的 `rng` 抽取顺序、相同的最终
`BattleState`、相同的 `StackTurnResult`）。log 是在 driver 既有的事件点上以结构化
**快照+差分** 记录的 —— 引擎绝不为了记录而改变一个回合。

两条让引擎保持游戏无关的设计准则：

- **引擎报告 结构性事实；游戏提供 呈现。** log 携带伤害的 *数值*，但不携带克制的
  *类别*（"效果拔群"）—— 那是一个游戏概念（有些游戏没有属性克制），所以前端从招式
  属性 vs 防守方属性 自行 **重新推导**（§4）。文案、动画选择、语言同理。
- **`Blocked` 是通用的。** 当一个 `BeforeMove` 门控阻止了招式（睡眠/冰冻/完全麻痹/
  混乱自伤）或 actor 付不起开销（§6.3），driver 记录 `Blocked { actor }` 且 **不记**
  `MoveUsed`。引擎只报告招式 *被阻止* 这一事实；游戏从 actor 的状态/易变状态推导
  *原因*（"陷入了睡眠！"）。正是这个事件，让前端能显示一个回合本会沉默的"无法行动"那行。

一个游戏侧的 **翻译器** 把 log 变成前端消费的东西（文本行、动画队列）。配方见 §7，
pokered 的案例研究见
[`POKERED_BATTLE_ON_ENGINE.md`](./POKERED_BATTLE_ON_ENGINE.md)。

---

## 3. 教程：搭建一个最小规则集（minimon 演练）

[`examples/minimon`](../examples/minimon) 在栈上编写了一个 Gen-4 形态的战斗系统 ——
phys/special split + Intimidate + Clear Body + Leftovers + Sandstorm —— 且 **零引擎改动**。
它唯一的依赖就是引擎：

```toml
# examples/minimon/Cargo.toml
[dependencies]
jrpg-engine = { path = "../../crates/jrpg-engine" }
```

### Step 1 —— 定义 id 枚举（6 属性分裂形态）

引擎以一个不透明的 key 来索引 `EnumMap<P::Stat>`，所以选择分裂
形态是一个纯粹的数据决策。minimon 定义了六个属性，以及用于
type/status/ability/item 的不透明 id，外加一个携带身份信息的 `Species` 结构体
（`BattlerState` 没有 ability/item 字段）：

```rust
pub enum Stat { Hp, Atk, Def, SpA, SpD, Spe }      // a Gen-1 game would use {Hp,Atk,Def,Spe,Spc}
pub enum MType { Normal, Rock }
pub enum Status { Poisoned }
pub enum Ability { None, Intimidate, ClearBody }   // opaque — the engine never reads their meaning
pub enum Item { None, Leftovers }
pub struct Species { pub ability: Ability, pub item: Item, pub mtype: MType }

pub enum Category { Physical, Special }             // the per-move split flag the engine never sees
pub struct Move { pub power: u8, pub category: Category, pub id: u32 }
```

这里有类型的逐效果状态（per-effect-state）枚举只是一个惰性标记，因为这个验证
不托管任何有状态的 volatile：

```rust
pub enum Kind { None }
```

### Step 2 —— 实现 `BattleProvider` + `EffectProvider`

`calculate_damage` **就是** 整个物理/特殊分裂。引擎把
整个参战者状态交过来并取回一个数字；它从不知道读取了哪些属性：

```rust
fn calculate_damage(&self, move_: &Self::Move, attacker: &BattlerState<Self>,
                    defender: &BattlerState<Self>, _random: u8, _is_critical: bool) -> DamageResult {
    let (atk_stat, def_stat) = match move_.category {
        Category::Physical => (Stat::Atk, Stat::Def),
        Category::Special  => (Stat::SpA, Stat::SpD),
    };
    let atk = read_effective_stat(attacker, atk_stat).max(1);
    let def = read_effective_stat(defender, def_stat).max(1);
    let dmg = (move_.power as u32 * atk as u32 / def as u32) as u16;
    DamageResult { damage: dmg.max(1), effectiveness: 1.0, is_miss: false }
}
```

`EffectProvider` 提供 `EffectStateKind = Kind` 以及那些把
不透明 id 映射到所编写的 `&'static Effect` 的 resolver —— 这就是 "abilities/items/weather 都只是
托管在某处的 Effect"：

```rust
impl EffectProvider for MinimonProvider {
    type EffectStateKind = Kind;

    fn effect_for_move(&self, m: &Self::Move) -> Option<&'static Effect<Self>> {
        match m.id { MOVE_TACKLE_ID | MOVE_EMBER_ID => Some(&MOVE_DAMAGE_EFFECT), _ => None }
    }
    fn effect_for_status(&self, s: &Self::Status) -> Option<&'static Effect<Self>> {
        match s { Status::Poisoned => Some(&POISON_EFFECT) }
    }
    fn effect_for_ability(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> {
        match b.species.ability {
            Ability::Intimidate => Some(&INTIMIDATE),
            Ability::ClearBody  => Some(&CLEAR_BODY),
            Ability::None       => None,
        }
    }
    fn effect_for_item(&self, b: &BattlerState<Self>) -> Option<&'static Effect<Self>> {
        match b.species.item { Item::Leftovers => Some(&LEFTOVERS), Item::None => None }
    }
    fn field_effects(&self, _ctx: &BattleCtx<'_, Self>) -> &[&'static Effect<Self>] {
        if self.weather_on { &SANDSTORM_LIST } else { &[] }
    }
    fn turn_order_rank(&self, _s: &BattleState<Self>, _w: BattlerRef, _a: &Self::Move) -> (i32, i32) {
        (0, 0)
    }
}
```

（其余所有 resolver 都保持默认。）

### Step 3 —— 把这 5 个系统编写为 `Effect`

每个 handler 都是一个零捕获的 `fn(&mut BattleCtx, RelayVar, target, source,
source_effect) -> HandlerResult`。

**(a) 招式伤害** —— 每个造成伤害的招式共享一个搭载在
`ModifyDamage` 上的效果。伤害数字由 driver（它持有
`&P`）预先计算进 `ctx.mv.damage`；hook 是订阅点：

```rust
pub static MOVE_DAMAGE_EFFECT: Effect<MinimonProvider> = Effect {
    id: EffectId(MOVE_TACKLE_ID), kind: EffectType::Move,
    hooks: &[EventHook { event: Event::ModifyDamage, call: move_damage_hook::<MinimonProvider>,
                         order: u32::MAX, priority: 0, sub_order: None }],
};
```

**(b) Intimidate** —— 一个 `SwitchIn` handler 无法持有 `&P`，而这个削减必须
是可否决（vetoable）的，所以 handler 记录 *意图*（在逐动作临时区里放一个哨兵值）
而由 driver 触发真正的 `TryBoost`：

```rust
fn intimidate_switch_in<P: EffectProvider + ?Sized>(ctx: &mut BattleCtx<'_, P>, ..) -> HandlerResult {
    ctx.mv.damage = INTIMIDATE_PENDING;   // 0xABCD — a boost request is pending
    HandlerResult::Unchanged
}
pub static INTIMIDATE: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA1), kind: EffectType::Condition,
    hooks: &[EventHook { event: Event::SwitchIn, call: intimidate_switch_in::<MinimonProvider>,
                         order: 10, priority: 0, sub_order: None }],
};
```

**(c) Clear Body veto（否决）** —— 监听 *同一次* `TryBoost` dispatch；一个负
delta 返回 `Fail`，它折叠为 `Bool(false)`，于是 driver 跳过这次 boost：

```rust
fn clear_body_try_boost<P: EffectProvider + ?Sized>(_c: &mut BattleCtx<'_, P>, relay: RelayVar, ..) -> HandlerResult {
    if relay.as_int() < 0 { HandlerResult::Fail } else { HandlerResult::Unchanged }
}
pub static CLEAR_BODY: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA2), kind: EffectType::Condition,
    hooks: &[EventHook { event: Event::TryBoost, call: clear_body_try_boost::<MinimonProvider>,
                         order: 5, priority: 0, sub_order: None }],
};
```

**(d) Leftovers** —— `Residual(20)` 在 `Residual(10)` 处的 poison chip *之后* 治疗。
跨来源排序正是 `order` 层级存在的意义所在：

```rust
fn leftovers_residual<P: EffectProvider<Stat = Stat> + ?Sized>(ctx: &mut BattleCtx<'_, P>, _r, host, ..) -> HandlerResult {
    let amt = (ctx.battler(host).max_hp / 16).max(1);
    ctx.battler_mut(host).heal(amt);
    HandlerResult::Unchanged
}
pub static LEFTOVERS: Effect<MinimonProvider> = effect!(EffectId(0xB1), EffectType::Condition, {
    Residual(20) => leftovers_residual::<MinimonProvider>,
});
pub static POISON_EFFECT: Effect<MinimonProvider> = effect!(EffectId(0xC1), EffectType::Status, {
    Residual(10) => poison_residual::<MinimonProvider>,   // chips max_hp/8
});
```

**(e) Sandstorm** —— 场地托管，两个 hook：`FieldResidual` 削减非 Rock 系，
`WeatherModifyStat` 在 `ModifyStat` *之后* 把一个 ×1.5 的 SpD 增益叠加到 relay 上：

```rust
fn sandstorm_spd_boost<P: ...>(ctx, relay, target, ..) -> HandlerResult {
    if ctx.battler(target).species.mtype == MType::Rock {
        return HandlerResult::Set(relay.scale(3, 2));     // ×1.5 SpD
    }
    HandlerResult::Unchanged
}
pub static SANDSTORM: Effect<MinimonProvider> = effect!(EffectId(0xF1), EffectType::Condition, {
    FieldResidual     => sandstorm_chip::<MinimonProvider>,
    WeatherModifyStat => sandstorm_spd_boost::<MinimonProvider>,
});
pub static SANDSTORM_LIST: [&Effect<MinimonProvider>; 1] = [&SANDSTORM];   // what field_effects borrows
```

### Step 4 —— 通过 driver 重入模式接线（wire）各效果

你的 driver 辅助函数拥有可重入的 dispatch：它们持有 `&P`，通过
`collect_handlers` 构建一个拥有所有权的快照，然后通过
`run_event`/`run_event_checked` 进行 fold。handler 保持零捕获，只触碰 `ctx`。`switch_in` 是权威
范例 —— 触发 `SwitchIn`，如果 Intimidate 设置了哨兵值，就在敌方触发一次真正的
`TryBoost`，此时 Clear Body 会在同一次 dispatch 上被收集，从而能够
否决（veto）：

```rust
pub fn switch_in(&mut self, who: BattlerRef) {
    let foe = opposing(who);
    self.mv.damage = 0;
    {
        let provider = &self.provider;
        let mut ctx = BattleCtx { state: &mut self.state, effects: &mut self.effects,
                                  mv: &mut self.mv, rng: &mut self.rng };
        let mut hs = Vec::new();
        collect_handlers(&ctx, provider, None, Event::SwitchIn, who, who, &mut hs);
        run_event(&mut ctx, hs, RelayVar::Unit, false);
    }
    if self.mv.damage == INTIMIDATE_PENDING {
        self.mv.damage = 0;
        let vetoed = self.try_boost(foe, who, Stat::Atk, -1);   // collects Clear Body too
        if !vetoed { /* apply -1 stage */ }
    }
}

pub fn try_boost(&mut self, target, source: BattlerRef, _stat: Stat, delta: i64) -> bool {
    let provider = &self.provider;
    let mut ctx = BattleCtx { state: &mut self.state, effects: &mut self.effects,
                              mv: &mut self.mv, rng: &mut self.rng };
    let mut hs = Vec::new();
    collect_handlers(&ctx, provider, None, Event::TryBoost, target, source, &mut hs);
    let out = run_event(&mut ctx, hs, RelayVar::Int(delta), false);
    matches!(out, RelayVar::Bool(false) | RelayVar::Unit)       // Fail/FailSilent ⇒ vetoed
}
```

注意这个不相交字段的借用：`&self.provider` 与一个由 *其余四个* 字段构建的
`BattleCtx` 并排借用。这就是一个零捕获 handler 契约与可重入 dispatch 如何
共存的方式 —— driver 持有 `&P`，handler 从不持有。

`end_of_turn_residual` 把状态效果作为该次 dispatch 的 *source* 效果传入，
同时收集器也会一并收集道具，于是 `order` 比较器会把它们交错排列；
`weather_residual` 用 `run_event_checked` 对两个 active 都循环触发 `FieldResidual`；
`effective_spd_with_weather` 先以
`RelayVar::Int(base_spd)` 播种，然后 fold `WeatherModifyStat`。

### Step 5 —— 运行一个回合并断言结果

测试是手工推导的 `BattleState` oracle（Showdown 风格）：

```rust
phys.fire_move(BattlerRef::PLAYER, &TACKLE);
assert_eq!(100 - phys.battler_ref(BattlerRef::OPPONENT).hp, 80);   // 40*100/Def(50)
spec.fire_move(BattlerRef::PLAYER, &EMBER);
assert_eq!(100 - spec.battler_ref(BattlerRef::OPPONENT).hp, 40);   // 40*100/SpD(100)
```

> **改用内置的 `StackDriver` 而非手写辅助函数。** minimon 编写了
> 它自己的辅助函数以便孤立地演练单个事件，但引擎
> 自带一个完整的回合定序器（turn sequencer）：
> ```rust
> let result: StackTurnResult = StackDriver::execute_turn(
>     &provider, &mut state, &mut effects,
>     [BattleAction::Fight { move_: tackle }, BattleAction::Fight { move_: ember }],
>     &mut rng);
> ```
> 它解析顺序（`turn_order_rank` + 一个 tie 字节），触发逐 actor 的招式
> 流水线（`BeforeMove → ModifyCritRatio → Accuracy → ModifyDamage → DamagingHit`），
> 然后是逐参战者的 `Residual`，并带有先手者倒下（first-mover-faint）的短路
> （`StackTurnResult { first, second_cancelled }`）。当你想要那种
> 权威的 Gen-1 形态回合时使用它；当你想要触发单个事件时使用手写辅助函数。

---

## 4. 属性相克（相克 / type charts）

相克表 **不是** 一个引擎概念。它就是
[`Event::Effectiveness`](#21-event-分类学--什么会触发以及何时触发) 折叠（fold）
把一个 **整数** 有理数乘数与 provider 已经摇出的伤害组合起来。内置的 `StackDriver`
如今会在招式流水线内部 *触发* 这个折叠；在无订阅者时它是一个可证明的恒等空操作（identity no-op），
因此每个既有游戏都保持逐字节一致。

### 4.1 折叠在哪里触发，以及它如何组合

在 `resolve_action` 中，`Effectiveness` 在 **`ModifyDamage` 之后** 触发
（这样护盾/道具/天气乘数先于相克表），且在 **`DamagingHit` 之前** 触发
（这样命中后的反应看到的是经过相克之后的数字）。这个折叠是围绕单一真相来源
`ctx.mv.damage` 的三步 **lift → fire → write-back（提升 → 触发 → 回写）**
（`driver.rs:206-208`）：

```rust
let eff_in = RelayVar::Damage(ctx.mv.damage);
let eff_out = Self::fire(&mut ctx, eff, Event::Effectiveness, target, actor, eff_in);
ctx.mv.damage = eff_out.as_damage(); // non-Damage relay ⇒ 0 (event.rs as_damage)
```

随后这个数字原样存活在 `ctx.mv.damage` 中，在下一行被应用
（`driver.rs:213`）：

```rust
ctx.battler_mut(target).take_damage(dmg);
```

需要遵守的两个推论：

- **默认惰性。** 在没有任何 handler 订阅 `Effectiveness` 时，
  空 handler 的 `run_event` 原样返回 relay，回写是恒等的，
  抽取序列保持不变（`driver.rs:196-205`、
  `event.rs:179-185`）。
- **停留在 `Damage` 车道。** 对任何 **非 `Damage`** relay，`as_damage()` 返回 `0`
  （`event.rs:179-185`）。一个把 relay 丢出 `Damage` 车道的 handler 会把招式归零。
  请使用 `relay.scale(num, den)`，它让 relay 保持在自己的车道内。

### 4.2 乘数仅为整数

`RelayVar::scale` 是 **纯整数运算** —— 没有任何浮点触碰伤害
路径。`Damage(v)` 分支计算 `(v as u64) * num / den` 并钳制到
`u16::MAX`；`den` 用 `den.max(1)` 防护（`event.rs:207-224`）：

```rust
pub fn scale(self, num: u32, den: u32) -> RelayVar {
    let den = den.max(1);
    match self {
        RelayVar::Damage(v) => {
            let scaled = (v as u64) * (num as u64) / (den as u64);
            RelayVar::Damage(scaled.min(u16::MAX as u64) as u16)
        }
        // Int / Accuracy arms keep their own lanes; non-numeric relays pass through.
        other => other,
    }
}
```

所以 2× 是 `relay.scale(2, 1)`，½× 是 `relay.scale(1, 2)`，而 0× 免疫是
`relay.scale(0, 1)`。把整张相克表的乘积折叠进 **一个** 预先合并好的
有理数，并 **恰好应用一次** `scale` —— 逐条边折叠会在每一步发生截断。

### 4.3 原生编写：一张 const 表 + 一个 handler

minimon 以一张扁平的 `(atk_index, def_index, num, den)` 行 const 表来交付
金木水火土（Metal/Wood/Water/Fire/Earth）相生相克轮（`lib.rs:120-135`）：

```rust
pub const TYPE_CHART: &[(usize, usize, u32, u32)] = &[
    (0, 1, 2, 1), // 金克木  Metal → Wood
    (1, 4, 2, 1), // 木克土  Wood  → Earth
    (4, 2, 2, 1), // 土克水  Earth → Water
    (2, 3, 2, 1), // 水克火  Water → Fire
    (3, 0, 2, 1), // 火克金  Fire  → Metal
    (1, 0, 1, 2), // Wood  → Metal  (1/2×)
    // … the other reverse edges …
    (2, 1, 0, 1), // 水→木  Water → Wood (0× immunity)
];
```

一个纯辅助函数把相克表 **乘积** 在防御方属性上折叠为一个
有理数（`lib.rs:141-153`）；于是双属性只是一处纯数据改动，而不是代码
改动：

```rust
pub fn type_chart_mult(move_index: usize, defender_indices: &[usize]) -> (u32, u32) {
    let (mut num, mut den) = (1u32, 1u32);
    for &def in defender_indices {
        let (n, d) = TYPE_CHART
            .iter()
            .find(|(a, b, _, _)| *a == move_index && *b == def)
            .map(|(_, _, n, d)| (*n, *d))
            .unwrap_or((1, 1));   // omitted pair ⇒ 1×
        num *= n;
        den *= d;
    }
    (num, den)
}
```

这个 handler 精确匹配 `HandlerFn`。它从 `source_effect`（经由
`move_type_for_effect`，`lib.rs:576-582`）恢复正在飞行中的招式的属性，
从 `Species.mtype` 读取防御方的属性，并返回携带合并有理数的 **一个** `Set`
（`lib.rs:556-572`）：

```rust
fn effectiveness_chart_hook(
    ctx: &mut BattleCtx<'_, MinimonProvider>,
    relay: RelayVar,
    target: BattlerRef,
    _source: BattlerRef,
    source_effect: EffectId,
) -> HandlerResult {
    let move_index = match move_type_for_effect(source_effect) {
        Some(t) => t.chart_index(),
        None => return HandlerResult::Unchanged, // untyped ⇒ neutral
    };
    let def_indices = [ctx.battler(target).species.mtype.chart_index()];
    let (num, den) = type_chart_mult(move_index, &def_indices);
    HandlerResult::Set(relay.scale(num, den)) // ONE scale on the combined rational
}
```

它在每个元素的招式效果中以 `order: 100` 订阅 `Event::Effectiveness` ——
`MOVE_DAMAGE_EFFECT`（Normal/无属性 ⇒ 中性恒等）、
`MOVE_METAL_EFFECT`、`MOVE_WATER_EFFECT`（`lib.rs:587-651`）：

```rust
EventHook {
    event: Event::Effectiveness,
    call: effectiveness_chart_hook,
    order: 100, priority: 0, sub_order: None,
},
```

### 4.4 改以 RON 数据编写

同一张相克表 **无需 Rust** 即可在 `rules.ron` 中以 `type_chart:`
的 `( atk:, def:, mult: [n, d] )` 行列表来表达，由 `Effectiveness` hook 上的
`ApplyTypeChart` 原语 op 应用（`rules.ron:39-54`，见
[§5](#5-用-rulesron-无代码编写jrpg-rules-加载器)）：

```ron
type_chart: [
    ( atk: "Metal", def: "Wood",  mult: [2, 1] ),   // 金克木
    ( atk: "Water", def: "Fire",  mult: [2, 1] ),   // 水克火
    ( atk: "Water", def: "Wood",  mult: [0, 1] ),   // 水→木 immunity
],
// … and on the move:
Hook(on: "Effectiveness", order: 100, do: [ ApplyTypeChart ]),
```

### 4.5 断言的结果（160 / 80 / 40 / 0）

用一柄威力 80 的金系刀刃，四种相克结果都是精确整数 ——
那个一致性 oracle（`tests.rs:338`）：

```rust
assert_eq!((super_eff, neutral, resisted, immune), (160, 80, 40, 0));
```

`160 = 80 ×2/1`（金克木，效果拔群）、`80 = 80 ×1/1`（省略的属性对 ⇒
中性）、`40 = 80 ×1/2`（被抵抗）、`0 = 80 ×0/1`（水→木 的免疫）。原生 const-表
路径与 RON 数据路径产生 **相同的** 数字。

> **设计背景：** §12
> [`12-typechart-ron-design.md`](./engine-gap-analysis/12-typechart-ron-design.md)。

---

## 5. 用 `rules.ron` 无代码编写（jrpg-rules 加载器）

[`crates/jrpg-rules`](../crates/jrpg-rules/src/) 是 effect-stack 之上一层薄薄的
编写层：它把一个 `rules.ron` 文件解析为运行时的 `Effect`，于是你可以
**零 Rust** 地新增 **招式、特性、道具、属性与资源开销**。它就是
**Option A** —— 一个以 `EffectId` 为键的 `interpret()` 单函数，被注册为每个生成的
`Effect` 的 `call`。它 **零引擎改动**：引擎本就把
`source_effect: eff.id` 串给每个 handler（`dispatch.rs:128`），而
`interpret` 不过是又一个 `HandlerFn`。

### 5.1 数据模型 —— 效果记录 + 一套闭合的原语词汇表

顶层形状是
`Ruleset( stats: […], resources: […], types: […], type_chart: […], effects: […] )`
（`rules.ron:20-123`；`Ruleset::from_ron` 启用 RON 的 `IMPLICIT_SOME`，
`model.rs:436-440`）。每个效果是一个 `EffectRecord`，带一个 `kind`
（`EffectKind { Move, Status, Ability, Item, Weather }`，`model.rs:184-196`）、
可选的 `category`/`power`/`type`/`accuracy`/`cost`，以及一份 hook 列表。每个
hook 的 `do:` 是从 **闭合原语 op 词汇表** 中取出的列表
（`enum Op`，`model.rs:319`）—— 这个闭合集合就是全部的表达力预算。随着 pokered
的 Gen-1 迁移需要更多原语，它从最初的 12 个增长到了 **16 个**（新增 `SetHp`、
`SetDamage`、`DamageCurrentHpFraction`、`RepeatHits`）—— 全部仍是闭合、且与游戏无关：

```rust
pub enum Op {                                        // model.rs:319
    DealMoveDamage,                                  // ModifyDamage 标记（provider 算出的数）
    DamageFraction { num, den, of, target, unless }, // 按分数扣血（反伤、沙暴）
    HealFraction   { num, den, of, target, unless }, // 按分数回血（吸血、自我恢复、剩饭）
    InflictStatus  { status, target },               // 命中附加的非易变状态
    Boost          { stat, stages, target },          // 能力等级增减
    ScaleRelay     { num, den, when },               // 有理数缩放 relay（天气、道具）
    SetRelay(i64), AddRelay(i64), ClampRelay { lo, hi },
    VetoIf         { cond, silent },                 // cond 成立时 Fail（恶意 / 白雾）
    ApplyTypeChart,                                  // 把双属性乘积折进 relay
    PayResource    { resource, amount, target },     // MP/SP 开销门控（付不起则 Fail）
    // ── pokered Gen-1 迁移新增（仍闭合、仍与游戏无关）──
    SetHp          { target, value, when },          // 绝对设定 HP（一击必杀 / 自爆）
    SetDamage      { value, of },                    // 固定/等级/随机伤害，绕过属性克制
    DamageCurrentHpFraction { num, den, target },    // 按当前 HP 的百分比（愤怒门牙）
    RepeatHits     { count, target, final_hit },     // Gen-1 连击循环（游戏侧，无引擎接缝）
}
```

配套的闭合枚举：
- `Selector { Target, Foe, Host, Source }`（`model.rs:201`）。
- `FractionOf { MaxHp, CurHp, LastDamage }`（默认 `MaxHp`；`LastDamage` = 刚造成的
  伤害，吸血/反伤的基数；`model.rs:214`）。
- `Predicate { HasType(String), StatIs(String), RelayIntLt(i64), HasVolatile(String),
  MoveTypeIsDefenderType, TargetHasStatus(String), LevelGE }`（`model.rs:268`）—— 供
  `unless` / `when` / `cond` 守卫使用。（后四个为迁移新增：附加状态的替身/同属性否决、
  食梦的睡眠门控、一击必杀的等级门控。）
- `DamageValue { Const(u16), UserLevel, RngScaledLevel { num, den } }` —— `SetDamage`
  的取值来源（音爆 20 / 龙之怒 40 / 地球上投 = 等级 / 念力波；`model.rs:249`）。
- `HitCount { Fixed(u8), TwoToFive }` + `FinalHitRider` —— `RepeatHits` 的次数来源
  与最后一击的附加效果（`model.rs:510`）。

### 5.2 一段真实的 `rules.ron` 摘录

minimon 的整套规则集都是数据。一个招式声明它的分裂（`category`/`power`）、
它的元素（`type`）、一个可选的 `cost:`，以及订阅它的那些 hook
（`rules.ron:63-89`）：

```ron
Effect(id: "move.tackle", kind: Move, category: "Physical", power: 40, type: "Normal", accuracy: 100,
    hooks: [
        Hook(on: "ModifyDamage",  do: [ DealMoveDamage ]),
        Hook(on: "Effectiveness", order: 100, do: [ ApplyTypeChart ]),
    ]),
```

一个状态 chip 与一处 Leftovers 治疗展示了跨来源的 `order` 交错 —— 同时也表明
一个特性/道具/天气只是又一个以 `kind` 为键的记录
（`rules.ron:93-121`）：

```ron
Effect(id: "status.poison", kind: Status,
    hooks: [ Hook(on: "Residual", order: 10, do: [
        DamageFraction(num: 1, den: 8, of: MaxHp, target: Host) ]) ]),
Effect(id: "item.leftovers", kind: Item,
    hooks: [ Hook(on: "Residual", order: 20, do: [
        HealFraction(num: 1, den: 16, of: MaxHp, target: Host) ]) ]),
Effect(id: "ability.clearbody", kind: Ability,
    hooks: [ Hook(on: "TryBoost", order: 5, do: [
        VetoIf(cond: RelayIntLt(0)) ]) ]),
```

### 5.3 Option A —— 以 `EffectId` 为键的 `interpret()`

加载器为 **每个 `(effect, event)` hook 铸造一个独立的 `EffectId`**，并把
每个注册为它自己的小 `Effect`，其 `call` 是 `interpret::<P>`
（`registry.rs:286-308`，`build_effects`，泄漏（leak）为 `&'static`）。`interpret` 精确匹配
`HandlerFn<P>`（`interp.rs:30-56`）：

```rust
pub fn interpret<P: RulesProvider>(
    ctx: &mut BattleCtx<'_, P>,
    relay: RelayVar,
    target: BattlerRef,
    source: BattlerRef,
    source_effect: EffectId,
) -> HandlerResult
```

它按 `source_effect`（`host.hook(source_effect)`）查找编译后的 hook，
施加 `chance` 门控（**唯一的** rng，`ctx.rng.chance(num, den)`，
**无条件** 抽取，以便抽取顺序是 op 列表的纯函数），随后
`run_ops`。无需任何引擎改动。

公开 API（从 `lib.rs:62-70` 重导出）：`Ruleset`、`RuleSource`、
`interpret`、`run_ops`、`CompiledRuleset`、`CompiledHook`、`ResolverKind`、
`RulesHost`、`RulesProvider`、`RuleBindings`，外加各模型类型（`Op`、
`Predicate`、`Selector`、`EffectKind`、`EffectRecord`、`HookRecord`、
`ResourceCost`、`TypeChartEntry`、`Rational`、`FractionOf`、`StatRef`、
`TypeName`、`LoadError`、`parse_event`、`parse_kind`）。

### 5.4 加载期校验 —— 绝不在战斗期给你惊喜

每个名字都在 **编译期** 绑定到闭合词汇表（在
`CompiledRuleset::compile`，`registry.rs:153-265`，+ `validate_op`，
`registry.rs:313-370`）。一个未知名字是一个 `LoadError`，在规则集
加载时抛出 —— 绝不在战斗中途（`model.rs:37-63`）：

```rust
pub enum LoadError {
    Ron(String),
    UnknownEvent(String),
    UnknownType(String),
    BadChance(u32, u32),
    UnknownStatus(String),
    UnknownStat(String),
    UnknownResource(String),
}
```

### 5.5 双模式单一真相来源 —— 烘焙（baked，发布版）vs 热重载（dev）

**同一份** `rules.ron` 以两种模式作为单一真相来源
（`source.rs`），且两者都经由 **同一个** `Ruleset::from_ron`，所以同一文件的
烘焙构建与磁盘构建产出逐字节一致的规则集 ——
即 **baked==disk parity（烘焙==磁盘一致）** 不变式：

```rust
pub enum RuleSource {
    Baked { text: &'static str },
    Disk {
        path: PathBuf,
        #[cfg(feature = "hot-reload")]
        watcher: Option<watch::Watcher>,
    },
}
```

- **烘焙（baked）= 默认（发布版）。** 该特性是 **关闭** 的；调用方传入
  `include_str!` 来的文本。零文件 IO。`RuleSource::baked(text: &'static str)`
  （`source.rs:57`）。
- **磁盘（Disk）= 开发版。** `RuleSource::from_path(path: impl Into<PathBuf>)`
  （`source.rs:65`）。在 `notify` 支撑的 watcher 之后（这个 cargo 特性恰好叫
  **`hot-reload`**，`source.rs:136-210`），编辑会被实时观察到。
- 两者都经由 `pub fn load(&self) -> Result<Ruleset, LoadError>`
  （`source.rs:81`）加载。
- `RuleSource::poll_changed(&mut self) -> bool`（`source.rs:98`）—— 一个 **烘焙**
  来源永远返回 `false`；一个带该特性的磁盘来源在文件变更时返回 `true`。
  还有 `is_hot_reloadable(&self) -> bool`（`source.rs:112`）。

**回合之间重载是安全的。** 当 `poll_changed` 返回 `true` 时，游戏
重新 `load` 并在 **回合之间** 重建注册表。它在战斗中途之所以安全，
是因为效果以 `EffectId` 寻址，且 **活状态存活在引擎的
`EffectState` arena 里，而非数据中** —— 重载只是替换效果的 *定义*，
而不触碰活的逐实例状态（`source.rs:6-14`、`lib.rs:42-51`）。

> **这就是 **无需 Rust** 编写招式/特性/属性/开销的路径。** 设计
> 背景：§11
> [`11-no-code-authoring-design.md`](./engine-gap-analysis/11-no-code-authoring-design.md)、
> §14 [`14-ron-loader-result.md`](./engine-gap-analysis/14-ron-loader-result.md)。

---

## 6. 资源（MP/SP）与招式开销

一个通用的、**与 P 无关** 的可消耗资源系统，让一个招式可以消耗 MP / SP /
mana / charge。它是完全加性的：默认为空、默认惰性，且
消耗 **零** 随机性。

### 6.1 `BattlerState` 上的 `ResourcePool`

一个 `ResourcePool` 是一个以 `u16` 为键的 `(resource_id, current, max)` 三元组
口袋，id 是 **不透明、由游戏指派** 的（引擎从不知道某个资源是 "MP"）。它
默认为 **空**（`battle/mod.rs:137-222`）：

```rust
#[derive(Default)]
pub struct ResourcePool {
    entries: Vec<(u16, u16, u16)>,   // (resource_id, current, max)
}
```

关键方法：`new()`、`set(id, current, max)`、`current(id) -> Option<u16>`、
`max(id)`、`can_pay(id, amount) -> bool`（`0` 开销总是可支付的；针对一个未声明 id 的
正开销 **不** 可支付）、`pay(id, amount) -> bool`
（饱和式，纯算术）、`restore`、`len`、`is_empty`。

它是 `BattlerState` 上的一个字段（`battle/mod.rs:716-737`），在
`BattlerState::new` 中初始化为 `ResourcePool::new()` —— 所以构造函数签名
**保持不变**：

```rust
pub resources: ResourcePool,
```

带 builder/辅助函数（`battle/mod.rs:773-788`）：

```rust
pub fn with_resource(mut self, id: u16, max: u16) -> Self;   // sets current = max
pub fn can_pay_resource(&self, id: u16, amount: u16) -> bool;
pub fn pay_resource(&mut self, id: u16, amount: u16) -> bool;
```

> **为什么用一个以 `u16` 为键的资源池，而不是 `EnumMap<P::Resource>`？** 一个 *带默认值* 的
> 关联类型在 stable Rust 上是不稳定的（`E0658`），所以加性的选择就是
> 与 P 无关、以整数为键的资源池（`battle/mod.rs:580-602` 文档；引擎
> 不赋予这些 id 任何含义）。

### 6.2 带默认实现的 provider hook

开销通过一个带默认实现的 `BattleProvider` 方法到达引擎
（`battle/mod.rs:600-602`）。默认的 `&[]` 让门控惰性，于是所有 16 个
既有的 `impl BattleProvider` 块都能不改动地编译通过：

```rust
fn move_cost(&self, _move_: &Self::Move) -> &[(u16, u16)] {
    &[]
}
```

### 6.3 `BeforeMove` 开销门控

在 `resolve_action` 中，门控在 `BeforeMove` 状态门控 **之后**
（`driver.rs:147-150`）、在任何暴击/命中率/伤害抽取 **之前**
（`driver.rs:152-171`）触发：

```rust
let costs = provider.move_cost(&move_);
if !costs.is_empty() {
    let actor_b = ctx.battler(actor);
    if !costs.iter().all(|(id, amt)| actor_b.can_pay_resource(*id, *amt)) {
        return; // cannot pay → move prevented (no rng consumed)
    }
    for (id, amt) in costs {
        ctx.battler_mut(actor).pay_resource(*id, *amt);
    }
}
```

策略：**支付不起 ⇒ 提前 `return`**（招式被阻止，形态上与一个被完全麻痹的
`BeforeMove` 中止相同，且暴击/命中率/伤害字节
从不被抽取）；**支付得起 ⇒ 扣除**。整个块是 **纯算术** ——
它不消耗 rng —— 而在空开销 / 空资源池时它是一个惰性空
循环，所以每个既有战斗与栈一致性的抽取序列都保持
逐字节一致。

### 6.4 在 RON 中编写一项开销

一个招式经由 `cost:` 字段声明其开销 —— `Vec<ResourceCost>`，其中
`ResourceCost { resource: String, amount: u16 }`（RON 写作 `Cost(...)`，
`model.rs:131-153`）。编译器把每个 `resource:` 名字内联（intern）为一个 id；一个
未知名字在加载期成为 `LoadError::UnknownResource`（`registry.rs:204`、
`registry.rs:368`）。编译后的 `move_costs` 映射
（`CompiledRuleset.move_cost(source_id) -> &[(usize, u16)]`，`registry.rs:108`、
`276-278`）就是一个游戏接线进 `BattleProvider::move_cost` 的东西。还有一个
`PayResource { resource, amount, target }` op（`model.rs:347-354`，在
`interp.rs:219-233` 解释：若 `!bindings.can_pay_resource(...)` 则 `Fail`，否则
`bindings.pay_resource(...)`），用于把一个 `BeforeMove` 开销表达为数据：

```ron
Effect(id: "move.blade", kind: Move, category: "Physical", power: 80, type: "Metal", accuracy: 100,
    cost: [ Cost(resource: "MP", amount: 3) ],
```

并在顶层声明一次该资源（`rules.ron:28`）：

```ron
resources: ["MP"],
```

### 6.5 minimon 的 MP 示例

minimon 声明了单一资源 `Mp`，映射到不透明 id `0`
（`lib.rs:279-305`）：

```rust
pub enum Resource { Mp }
impl Resource { pub const fn id(self) -> u16 { match self { Resource::Mp => 0 } } }
pub const MP: u16 = Resource::Mp.id();

const BLADE_COST:   &[(u16, u16)] = &[(MP, 3)];
const TORRENT_COST: &[(u16, u16)] = &[(MP, 5)];
const NO_COST:      &[(u16, u16)] = &[];
```

`MinimonProvider::move_cost`（`lib.rs:403-412`）按招式 id 把这些交还回去；
Tackle 与 Ember 返回 `NO_COST`。断言的结果（`tests.rs`）：

- `special_move_costs_mp_and_deducts_it`（第 377 行）：10 MP − BLADE 3 ⇒
  `current(MP) == Some(7)`。
- MP 不足：2 MP < BLADE 3 ⇒ 招式被阻止，防御方
  毫发无伤，且 `current(MP) == Some(2)` 保持不变。
- `physical_move_with_no_cost_is_unaffected_by_mp`（第 410 行）：0 MP 时 Tackle
  仍造成 80，且 `current(MP) == Some(0)`。
- `torrent_costs_5_mp_exact_balance_is_payable`（第 427 行）：恰好 5 MP 足以负担
  Torrent ⇒ `current(MP) == Some(0)`。

> **两条不同的策略 —— 不要混为一谈。** **引擎** 门控
> （`driver.rs:163-171`）把针对一个 **未声明** 资源的任何正开销都视为
> **支付不起**（招式被阻止）。minimon 的 **原生** `pay_move_cost`
> （`lib.rs:1007-1027`）刻意有所不同：一个 **不** 声明该资源的参战者把招式视为
> **免费**（跳过门控）。上面断言的 minimon 测试演练的是原生的 `Battle`
> 路径；`data_mode` 标志（`lib.rs:404`）让原生的 `move_cost` 返回 `NO_COST`，
> 这样数据驱动器就改从 `rules.ron` 提供开销。设计背景：§13
> [`13-jrpg-battle-concepts-audit.md`](./engine-gap-analysis/13-jrpg-battle-concepts-audit.md)。

---

## 7. 菜谱：跨世代机制 → effect-stack 配方

每个配方背后的那一个模式：一个机制 **从不** 是一个引擎概念。
它是一个 **托管于 X 上**（某个参战者/阵营/场地，由一个 resolver 接线）的 `Effect`，
其 handler **订阅事件 Y**、**做 Z**、**经由 `order=N` 排序**。

| 机制 | 把它托管于 X（resolver） | 订阅事件 Y | 在你的 handler 中，做 Z | 顺序 `N` |
|---|---|---|---|---|
| **造成伤害的招式** | 该动作（`effect_for_move`） | `ModifyDamage` | 伤害来自你的 `calculate_damage`；这个 hook 是招式的接缝。对于 roll/增益，通过 `Set(relay.scale(n,d))` 缩放。 | `u32::MAX` |
| **命中附带的状态副作用** | 该动作（`effect_for_move`） | `DamagingHit` | roll `ctx.rng.next_u8() < threshold`；成功时记录意图 / 通过你的 driver 触发一个 `TrySetStatus`。仅产生副作用 ⇒ 返回 `Unchanged`。 | default |
| **属性等级（stat-stage）招式** | 该动作（`effect_for_move`） | `DamagingHit`（或命中后） | 记录一个 boost 请求；你的 driver 触发 `TryBoost`（relay = `Int(delta)`），让各 veto 有投票权，然后把存活下来的 delta 应用到 `stat_stages`。 | default |
| **Recoil / drain（反伤 / 吸取）** | 该动作（`effect_for_move`） | `DamagingHit` | 读取 `ctx.mv.last_damage`；recoil = 对 `source` 执行 `take_damage(last_damage/N)`；drain = 对 `source` 执行 `heal(last_damage/2)`。 | default |
| **特性：被动属性增益**（Huge Power） | 该参战者（`effect_for_ability`） | `ModifyStat` | 如果 relay 携带的是被增益的那个属性且 `target` 是持有者，`Set(relay.scale(2,1))`。会折叠进伤害公式的属性读取。 | `ModifyStat`-层 |
| **特性：免疫**（Levitate / Wonder Guard） | 该参战者（`effect_for_ability`） | `Effectiveness`（乘数）**或** `TryHit`（硬否决） | 在 `Effectiveness` 上，`Set(relay.scale(0,1))` 将其归零；在 `TryHit` 上，返回 `Fail`/`FailSilent` 以在伤害前取消。 | low（伤害之前） |
| **特性：登场触发**（Intimidate） | 该参战者（`effect_for_ability`） | `SwitchIn` | handler 无法持有 `&P`，所以在 `ctx.mv` 中 **记录意图**；你的 `switch_in` 辅助函数（持有 `&P`）会重入并触发真正的 `TryBoost`，此时 Clear Body 可以否决。 | `10` |
| **持有道具：回合末治疗**（Leftovers） | 该参战者（`effect_for_item`） | `Residual`（或 `SideResidual`/`FieldResidual`） | 对 `host` 执行 `heal((max_hp/16).max(1))`，排序在状态 chip **之后**。 | `20`（chip = `10`） |
| **持有道具：伤害增益**（Life Orb / Choice Band） | 该参战者（`effect_for_item`） | `ModifyDamage`（Choice Band 用 `ModifyStat`） | 如果 `source` 是持有者，`Set(relay.scale(13,10))`（×1.3）。 | mid |
| **持有道具：濒死触发**（Sitrus / Salac） | 该参战者（`effect_for_item`） | `DamagingHit` / `AfterMove` | 如果 `ctx.battler(host).hp` 跌破最大值的 ½，`heal(...)` / 触发一个 `TryBoost`，然后在你的状态里标记为已消耗。 | high（在该次命中尘埃落定之后） |
| **天气：伤害乘数**（Rain→Water） | 该场地（`field_effects`） | `ModifyDamage`（属性乘数用 `WeatherModifyStat`） | 从 `ctx` 检视招式/持有者的属性；`Set(relay.scale(3,2))`。`WeatherModifyStat` 叠加在 `ModifyStat` **之后**。 | `WeatherModifyStat` 在 `ModifyStat` 之后 |
| **天气：回合末削减**（Sandstorm） | 该场地（`field_effects`） | `FieldResidual` | 对每个 active 的 `target`，若不免疫则 `take_damage((max_hp/16).max(1))`。用 `run_event_checked` 驱动，以免一次 KO 触发了陈旧的 handler。 | residual-层 |
| **入场 hazard**（Spikes / Stealth Rock） | 该阵营（`side_effects`） | `SwitchIn` | 当一个参战者进入该阵营时，按存储的层数（state 在你阵营托管的结构体里）缩放 `take_damage`。 | low（入场时） |
| **多回合 / 锁定招式**（Thrash / Hyper Beam） | 一个参战者 volatile（`effect_for_volatile`）+ `forced_action` | volatile 监听 `BeforeMove`/`End`；锁定是 `forced_action` | 在前一回合设置的一个 volatile 让 `forced_action(effects, actor, chosen)` 返回 `Some(locked_move)`，劫持本回合的输入。`BeforeMove` 做门控（跳过 recharge）；`End` 触发 Thrash 的自我混乱。 | n/a（一个接缝，不是 fold） |
| **相克表 / 属性相克**（相克） | 该动作（`effect_for_move`） | `Effectiveness` | 从 `source_effect` 恢复招式的元素，读取防御方属性，把相克表 **乘积** 折叠进一个有理数，`Set(relay.scale(num, den))`。仅整数；0× = 免疫。停留在 `Damage` 车道。参见 [§4](#4-属性相克相克--type-charts)。 | `100`（在 `ModifyDamage` 之后） |
| **资源开销**（MP / SP / mana） | 该 actor（`move_cost` hook） | 在 `BeforeMove` 处门控（引擎 `StackDriver`） | 从 `move_cost` 返回 `&[(resource_id, amount)]`；若支付不起，门控阻止招式，否则扣除。纯算术，无 rng，`&[]` 时惰性。或者在数据中，用一个 `cost:` 字段 / `PayResource` op。参见 [§6](#6-资源mpsp与招式开销)。 | n/a（一个门控，不是 fold） |
| **无代码编写**（在 RON 中写招式/特性/道具/属性/开销） | `jrpg-rules` 加载器（以 `EffectId` 为键的 `interpret`） | 任何 `Hook(on: …)` 命名的事件 | 在 `rules.ron` 中写一个 `EffectRecord`，其 hook 的 `do:` 是一份闭合原语 `Op` 列表；加载器把每个注册为一个调用 `interpret` 的 `Effect`。双模式 烘焙 / 热重载。参见 [§5](#5-用-rulesron-无代码编写jrpg-rules-加载器)。 | 逐 hook 的 `order:` |
| **非易变状态的回合末伤害**（烧伤/中毒 chip） | 该 actor 的状态（`effect_for_status`） | `Residual` | 对 `host` `take_damage((max_hp/16).max(1))`；无 rng；对 0 血宿主自我守卫。driver 的逐 mover residual 先触发 `effect_for_status`，**再**按 arena id 顺序触发每个易变状态的 `effect_for_volatile`。当某个易变状态拥有该 tick 时（如剧毒递增），跳过这次平摊 chip。 | `10`（在寄生种子之前） |
| **行动前"无法行动"门控**（睡眠/冰冻/麻痹/混乱） | 一个 `BeforeMove` hook（pokered 里：挂在每个招式 effect 上；或在你的 driver 里从状态/易变状态聚合） | `BeforeMove` | 读取 actor 的状态/易变状态；返回 `Fail` 以中止（**仅在该状态存在时** 抽取其 rng 字节）。`run_event` 在第一个 `Fail` 处短路，所以把各门控的 `order` 设为原始抽取顺序（如混乱 `70` < 麻痹 `90`）。driver 随后记录 `Blocked`（§2.11），让前端能显示原因。 | 逐状态 `order` |
| **回合叙述**（战斗文本/动画） | n/a —— 调用 `execute_turn_logged` | —（消费 `TurnLog`） | 遍历返回的 `TurnLog<P>`，把每个 `TurnEvent` 映射到你的前端（一行文本、一次血条下降、一段濒死动画）。在游戏侧重新推导呈现（克制文案、`Blocked` 原因）。增量：`execute_turn` 不变。参见 [§2.11](#211-叙述一个回合--turnlog)。 | n/a |

### 完全 **无需任何引擎改动** 的机制

- **物理/特殊分裂。** `calculate_damage` 由 provider 提供，且属性
  是 `EnumMap<P::Stat>`。定义 `{Hp,Atk,Def,SpA,SpD,Spe}` 并依据招式的 category
  挑选属性对。引擎从不看到 category。（已在 minimon 中证明。）

### 关于各配方接缝的说明

- `forced_action` 是 **锁定招式机制，而不是一个事件** —— 它返回
  `Some(BattleAction)` 来替换所选的动作。引擎不命名任何 Pokémon
  volatile；所有锁定语义都活在你的实现里。（在引擎测试
  `forced_action_default_is_inert` 与 `forced_action_overrides_chosen_action` 中
  证明了默认惰性、实现后即生效。）
- 登场重入的注意事项是 **真实存在的**：`HandlerFn` 给出 `&mut
  BattleCtx` 但 **不给 `&P`**，所以一个 handler **无法重入 dispatch**（重入
  需要 provider 来运行各 resolver）。因此 "一个特性触发另一个可否决事件"
  是一个 **driver 编排（driver-orchestration）** 模式 —— 在 handler 中记录意图，
  由持有 `&P` 的 driver 辅助函数来触发该子事件。

---

## 8. 确定性与测试

确定性在这里是一等属性：引擎 **仅** 通过 `ctx.rng` 抽取随机性，
而你的游戏拥有生成器，所以每个结果都是 `(initial state, byte script)`
的纯函数。

### 断言结果

使用 `ScriptedRng` 来固定确切的字节，然后对 `BattleState` 进行断言
（Showdown 风格的手工推导 oracle）。minimon 的分裂测试：

```rust
let mut phys = Battle::new(MinimonProvider::default(), split_attacker(vec![TACKLE]), split_defender());
phys.fire_move(BattlerRef::PLAYER, &TACKLE);
assert_eq!(100 - phys.battler_ref(BattlerRef::OPPONENT).hp, 80);
```

排序证明依赖于 *数学是非对称的*，于是顺序仅凭结果即可证明。
Leftovers：满 HP 状态下 chip-then-heal（先削后治）得到 **94**（100 −
12 + 6）；heal-first（先治）在满 HP 时是无操作，随后 chip → **88**。所以 `94`
*证明了* chip-before-heal：

```rust
// holder is Poisoned and holds Leftovers
b.end_of_turn_residual(BattlerRef::PLAYER);
assert_eq!(b.battler_ref(BattlerRef::PLAYER).hp, 94);   // 88 would mean wrong order
```

### 直接断言收集与抽取顺序

`collect_handlers` + `compare` 让你能断言 *哪些* 来源被收集了
以及以何种顺序，而无需运行 fold：

```rust
let mut hs = Vec::new();
collect_handlers(&ctx, provider, None, Event::TryBoost, BattlerRef::OPPONENT, BattlerRef::PLAYER, &mut hs);
hs.sort_by(jrpg_engine::battle::stack::compare);
let orders: Vec<u32> = hs.iter().map(|h| h.order).collect();
assert_eq!(orders, vec![5]);                 // Clear Body (order 5) collected on the foe's TryBoost
assert_eq!(hs[0].target, BattlerRef::OPPONENT);   // hosted on the TARGET (cross-battler collection)
```

### 抽取顺序一致性

`ScriptedRng::consumed()` 让你能断言引擎以你预期的顺序抽取了你预期的字节 ——
这是固定 Gen-1 RNG 怪癖的凭据。引擎自己的测试会断言，例如，一个相等（tied）的
handler 段抽取 **恰好一个** 字节、而一个互异（distinct）的段抽取 **零** 个字节
（`speed_tiebreak_draws_only_on_tie`），以及 crit 在 accuracy 之前被抽取
（`crit_is_drawn_before_accuracy`）。运行这些测试套件：

```bash
cargo test -p jrpg-engine            # engine: comparator, pair_mut, multi-source, forced_action
cargo test -p minimon                # the 5-system authoring proof + controls
```

---

## 9. 诚实的局限与路线图

**已证明** —— 单场战斗（1v1），在 `examples/minimon` 中端到端编写，
**除加性/带默认实现的接缝之外零 `jrpg-engine` 改动**；结论为
**GO-WITH-NITS**，见
[`10-generalization-result.md`](./engine-gap-analysis/10-generalization-result.md)：

- 物理/特殊分裂（provider 的 `calculate_damage` + `P::Stat`）。
- `SwitchIn` 上的一个特性（Intimidate）与 `TryBoost` 上的一个特性 **否决**
  （Clear Body）—— 两个特性，托管于 *不同的* 参战者上，在 **一次** dispatch 中
  以比较器顺序被收集。
- 一个持有道具的 residual，经由 `order` 排序在状态 chip **之后**（跨来源
  residual 排序 —— 这正是 `order` 层级存在的那个用例）。
- 场地托管的天气（Sandstorm），带有 `FieldResidual` chip **以及**
  `ModifyStat → WeatherModifyStat` 的属性 fold 叠加，托管于 `EffectHost::Field`。
- 借用安全：collect-then-fold 的拥有所有权快照 + 逐步存活性重检，
  **无 `RefCell`/`Rc`**，恰好 **一处** `unsafe`（跨阵营的 `pair_mut`）。那
  88 个 Gen-1 一致性切片保持全绿不变（加性已证明）。

**自最初的 GO-WITH-NITS 以来已完成**（每一项都是加性的、惰性时逐字节
一致；三者都已在 minimon 中端到端编写，并由一致性测试证明）：

- **属性相克 / 相克表。** ✅ `Effectiveness` 折叠如今会在招式路径中被 *触发*
  （`driver.rs:206-208` + minimon 的 `fire_move`）；一个整数
  `RelayVar::scale` 有理数与 provider 伤害组合。可原生编写（一张
  const 表 + handler）**或** 作为 RON `type_chart:` 数据（`ApplyTypeChart`）。
  结果 `(160, 80, 40, 0)` 已断言。参见 [§4](#4-属性相克相克--type-charts)
  与 §12
  [`12-typechart-ron-design.md`](./engine-gap-analysis/12-typechart-ron-design.md)。
- **无代码 RON 编写（双模式）。** ✅ `jrpg-rules` 加载器经由一个以
  `EffectId` 为键的 `interpret()` 单函数（Option A，零引擎改动），在一套闭合原语 op 词汇表之上，
  把 `rules.ron` 解析为运行时的 `Effect`，
  带加载期校验，以及一个 **烘焙（`include_str!`，发布版）/
  从磁盘热重载（`hot-reload` cargo 特性，dev）** 的真相来源，
  它保证 baked==disk 一致以及回合之间安全重载。参见
  [§5](#5-用-rulesron-无代码编写jrpg-rules-加载器) 与 §11
  [`11-no-code-authoring-design.md`](./engine-gap-analysis/11-no-code-authoring-design.md)、
  §14 [`14-ron-loader-result.md`](./engine-gap-analysis/14-ron-loader-result.md)。
- **MP / 资源与招式开销。** ✅ `BattlerState` 上一个与 P 无关、以 `u16` 为键的
  `ResourcePool`，一个带默认实现的 `BattleProvider::move_cost` hook，以及一个
  `BeforeMove` 开销门控（支付不起 ⇒ 招式被阻止，否则扣除；不消耗
  rng；空开销/空资源池时惰性），外加一个 RON `cost:` 字段 + `PayResource`
  原语 + `LoadError::UnknownResource`。参见 [§6](#6-资源mpsp与招式开销)
  与 §13
  [`13-jrpg-battle-concepts-audit.md`](./engine-gap-analysis/13-jrpg-battle-concepts-audit.md)。
- **回合叙述 —— `TurnLog`。** ✅ `StackDriver::execute_turn_logged` 返回一个通用的
  `TurnLog<P>`，内含一串 `TurnEvent`（招式使用 / 未中 / **被阻止** / 会心 / 伤害 /
  治疗 / 状态 / 能力变化 / 濒死），供前端渲染。增量 + 默认惰性：`execute_turn` 就是
  无 log 路径且逐字节一致（在既有事件点用结构化快照+差分记录）。引擎报告结构性事实，
  游戏自行重新推导呈现。参见 [§2.11](#211-叙述一个回合--turnlog) 与
  [`POKERED_BATTLE_ON_ENGINE.md`](./POKERED_BATTLE_ON_ENGINE.md) 的 pokered 案例研究。

**仍待处理**（数据模型的空缺，不是回归）：

- **嵌套否决（nested-veto）原语。** Intimidate ↔ Clear Body 那个可否决级联仍然是
  **driver 编排**（记录意图 → driver 触发子 `TryBoost`）；它
  尚不能纯粹以数据表达。RON 的 `Boost`/`VetoIf` op 直接应用；
  两个记录之间嵌套的 `TryBoost`/`TrySetStatus` 级联不是一个
  原语（doc 11 §3，Phase 2）。
- **新颖的逐效果计数器状态。** 拥有自己运行计数器的效果
  （Counter / Bide / Substitute hp）需要有类型的 `EffectStateKind` arena 状态，而
  RON 词汇表尚不能铸造它们 —— 它们仍是原生 Rust 效果。
- **双打 / 网格。** 一种不同的战斗模型（多目标、重定向）；
  与下文相同，未变。

**已记录的小毛病（nit，不是否决信号）。** `HandlerFn` 给出 `&mut BattleCtx` 但
**不给 `&P`**，所以一个 handler **无法重入 dispatch**。"一个特性触发另一个
可否决事件" 是一个 **driver 编排** 模式（记录意图 → driver
触发该子事件）。设计 §09 §4.2b 那个从 handler 内部调用 `try_boost(ctx, …)`
的草图在这一点上过于乐观；参见 §10 中的 "one nit"。

**后续 —— 明确超出范围，并非回归（regressions）**（依据 §10）：

- **双打 / 多目标。** 存在一个 `redirect_target` 接缝，但它 **默认、
  惰性且未经证明**；minimon 是 1v1。Follow Me / Lightning Rod 的重定向
  （`TryHit` + redirect）原则上可表达，但未被演练。
- **完整内容表 / 多段命中 / 命中率 / 暴击 RNG。** minimon 编写了 **2
  个招式**，使用确定性的 `power*atk/def` 公式（无 roll），以便结果可手工核对。
  `Accuracy`、`ModifyCritRatio`、`ModifyMove`（多段命中）以及
  许多 Group D/E/F 事件作为 **订阅接缝** 存在，但尚未被任何已发布的 driver 触发。
- **接入 pokered 的生产循环是分阶段的，尚未完成。** Gen-1 保真度
  仍然是一个 **回归凭据**（经由遗留的
  `battle::driver` 的那 88 个切片），而不是在新栈上的生产替换。AI、切换策略
  与 RNG 驱动的副作用尚未在栈上被演练。
- **`EffectHost` 是加性的，不是一个被加宽的字段。** `EffectState.host` 保持
  `BattlerRef`（这样所有 Gen-1 切片都能逐字编译）；阵营/场地状态通过
  `Side`/`Field` 分支 + `side_effects`/`field_effects` resolver 寻址，
  而这些由游戏拥有。设计 §09 §3.1 的 "经由 `From` 加宽该字段" 并 **未** 成立
  （Rust 的字段初始化会忽略 `From`）—— 参见 `ctx.rs` 中的 NO-GO 说明。

---

### 另见

- [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) —— 更宽泛的引擎指南（地图、
  NPC、脚本、渲染、菜单、道具、存档）。其 §6 覆盖的是 *遗留的*
  战斗 driver，而不是本栈。
- [`engine-gap-analysis/06-battle-engine-effect-stack-design.md`](./engine-gap-analysis/06-battle-engine-effect-stack-design.md) —— effect-stack 设计。
- [`engine-gap-analysis/09-battle-engine-generalization-design.md`](./engine-gap-analysis/09-battle-engine-generalization-design.md) —— 泛化设计（systems-as-effects、事件分类学、分裂）。
- [`engine-gap-analysis/10-generalization-result.md`](./engine-gap-analysis/10-generalization-result.md) —— GO-WITH-NITS 结论（已证明 vs 后续）。
- [`engine-gap-analysis/11-no-code-authoring-design.md`](./engine-gap-analysis/11-no-code-authoring-design.md) —— 无代码 RON 编写设计（Option A、闭合 op 词汇表、双模式）。
- [`engine-gap-analysis/12-typechart-ron-design.md`](./engine-gap-analysis/12-typechart-ron-design.md) —— 相克表 / `Effectiveness`-折叠设计。
- [`engine-gap-analysis/13-jrpg-battle-concepts-audit.md`](./engine-gap-analysis/13-jrpg-battle-concepts-audit.md) —— JRPG 概念审计（MP/资源与招式开销）。
- [`engine-gap-analysis/14-ron-loader-result.md`](./engine-gap-analysis/14-ron-loader-result.md) —— RON 加载器结果。
- 代码：[`examples/minimon/src/lib.rs`](../examples/minimon/src/lib.rs)、
  [`examples/minimon/src/tests.rs`](../examples/minimon/src/tests.rs)、
  [`examples/minimon/rules.ron`](../examples/minimon/rules.ron)、
  [`crates/jrpg-rules/src/`](../crates/jrpg-rules/src/)、
  [`crates/jrpg-engine/src/battle/stack/`](../crates/jrpg-engine/src/battle/stack/)、
  [`crates/jrpg-engine/src/battle/rng.rs`](../crates/jrpg-engine/src/battle/rng.rs)。
