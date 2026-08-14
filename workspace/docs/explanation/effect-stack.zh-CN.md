# 效果栈战斗引擎

> 本文是 `explanation/effect-stack.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

本页解释 `dotzuki_engine::battle::stack` 的设计——这个 Showdown 风格的效果栈战斗
引擎：它的执行模型、事件/效果/处理器架构、RNG 确定性，以及当前设计的局限。

> - **Audience**: battle authors, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

> **范围。** 本页介绍 **`dotzuki_engine::battle::stack`** 的设计——这个 Showdown 风格
> 的**效果栈**战斗引擎——以及它为什么是这个形态。编写的那一半——声明事件、效果与
> 处理器，编写 `rules.ron`，minimon 走读、克制表、资源消耗与测试——在
> [`how-to/battles.md`](../how-to/battles.md)。
>
> 战斗栈与更宽泛的引擎指南
> （[`archive/developer-guide-legacy.md`](../archive/developer-guide-legacy.md)）是
> **分开的主题**；后者覆盖地图、NPC、脚本、渲染、菜单、道具与存档。该指南早于战斗
> 栈，其 §6（"战斗与怪物系统"）只描述*旧版* `battle::driver`/`BattleProvider` 路径
> ——它**不**覆盖 `battle::stack`。战斗之外的一切读它；战斗读本页与 battles how-to。
>
> 设计背景：§06
> （栈设计）、§09
> （泛化设计）、§10
> （GO-WITH-NITS 结论）。

---

## 目录

1. [概览与心智模型](#1-概览与心智模型)
2. [核心概念](#2-核心概念)
3. [诚实的局限与路线图](#3-诚实的局限与路线图)

---

## 1. 概览与心智模型

战斗栈是一个 Showdown 风格的**效果栈**引擎（它是*模式 C*：原生 Rust 的**零捕获
`fn` 指针**处理器，而**不是**脚本 VM）。一句话概括整个设计：

> **一切都是订阅 `Event` 的 `Effect`。引擎排列事件顺序、折叠处理器；你的处理器
> 决定发生什么。**

引擎内部**没有 `Ability` 系统、没有 `Item` 系统、没有天气系统、没有陷阱（hazard）
系统**。它们每一个都*不过是托管在某处的一个 `Effect`*（在某个战斗者、某个侧边或场地
上），为它关心的事件注册处理器。引擎通过你在 provider trait 上实现的**带默认实现
的解析器方法**触达它们——仅此而已。

由此而来的结论：**物特分家**——通常是一个结构性的战斗决策——**零引擎改动**。属性是
一个以*你*的不透明属性枚举为键的泛型 `EnumMap<P::Stat, u16>`，伤害公式住在*你的*
`calculate_damage` 里。一个 Gen-1 游戏以 `{Hp,Atk,Def,Spe,Spc}` 为键；一个分家游戏
以 `{Hp,Atk,Def,SpA,SpD,Spe}` 为键，并按招式的 category 选取属性对。引擎从来看不
到 category——它把完整的战斗者状态交给你，拿回一个数字。

### 各部分所在位置

```
dotzuki_engine::battle::stack         the effect-stack engine (game-AGNOSTIC)
├── event       Event enum, RelayVar, HandlerResult, Effect/EventHook, HandlerFn
├── ctx         EffectProvider (the trait you implement), BattleCtx, EffectState,
│               EffectHost, MoveContext
├── dispatch    collect_handlers, compare, run_event / run_event_checked
├── driver      StackDriver (a built-in turn sequence), FirstMover, StackTurnResult
└── authoring   the `effect!` macro

dotzuki_engine::battle                BattleProvider (supertrait), BattleState,
│                                  BattlerState, BattlerRef, BattleAction, EnumMap
└── rng         BattleRng trait, ScriptedRng

examples/minimon                   the canonical "how a developer uses this"
```

一次派发的流程：

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

你的处理器**只能**通过 `&mut BattleCtx` 触碰战斗；它们无法捕获或别名化状态。重入
（一个想再触发另一个事件的处理器）由你的*驱动器代码*完成（它持有 provider），而
不在处理器内部——见[§2.9](#29-你实现的-provider-解析器)与
[Intimidate 配方](../how-to/battles.md#5-cookbook-cross-gen-mechanics--effect-stack-recipes)。
---

## 2. 核心概念

### 2.1 `Event` 分类法——触发什么、何时触发

事件是一个**没有载荷的封闭枚举键**（载荷放在类型化的
[`RelayVar`](#relayvar类型化折叠载荷) 里）。封闭枚举（而非字符串键的事件总线）让比
较器与一致性测试保持可审计；开放的尾部 `Event::Custom(u16)` 是逃生舱，让游戏永远
不会被*卡住*。

该分类法包含 6 组共 31 种命名事件，加上旧版 `Residual`，再加上 `Custom`。**重
要：** 引擎内置的 `StackDriver` 目前只*触发*其中一部分；其余以**订阅接缝**的形式
存在——在某个驱动器扩展触发它们之前保持惰性。你可以从自己的驱动器代码里经
`collect_handlers` + `run_event` 自行触发其中任何一个（minimon 对 `SwitchIn`、
`TryBoost`、`FieldResidual`、`WeatherModifyStat` 正是这么做的）。

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
    OnMiss,            // accuracy-miss reaction (fired by StackDriver's miss branch; Jump Kick crash)

    // ── Legacy (kept for the Gen-1 regression slices) ──
    Residual,          // PER-MOVER end-of-action residual (burn/psn → leech)

    // ── The open tail ──
    Custom(u16),       // a game-defined dispatch key the engine assigns no meaning
}
```

> **`Residual` 与 `FieldResidual`/`SideResidual` 的区别。** §1.4 的分类法把按行动者
> 结算的 `Residual` 并入 `ResidualOrder`/`FieldResidual`/`SideResidual`，但 88 个
> Gen-1 栈一致性回归切片直接触发 `Residual`，因此它保留为既有变体（增量式/不破坏
> 的约束压过了重命名）。minimon 在它道具/状态扣血排序的配方里使用旧版 `Residual`，
> 用 `FieldResidual` 处理 Sandstorm。新游戏可以优先使用 §1.4 的分类。

如果你想复现 Gen-1，必须遵守的驱动器触发不变式：在内置 `StackDriver` 中，
**`ModifyCritRatio` 必须先于 `Accuracy` 触发**，这样暴击字节先于命中率字节抽取
（与原始的 `MoveRandoms` 字段顺序一致）。这一顺序由一条常驻的抽取顺序守卫
（`crit_is_drawn_before_accuracy`）钉死；若想保持 Gen-1 忠实度，不要在自定义驱动
器中调换它们。见 `driver.rs:155-167`。

### 2.2 `Effect` / `EventHook`——注册处理器

一个 `Effect` 是一个 id + 一个类别 + 一张 `'static` 的稀疏钩子表。因为表是
`'static` 的，注册项都是零分配的 `const`/`static`。

```rust
pub struct Effect<P>   { pub id: EffectId, pub kind: EffectType, pub hooks: &'static [EventHook<P>] }
pub struct EventHook<P>{ pub event: Event, pub call: HandlerFn<P>,
                         pub order: u32, pub priority: i32, pub sub_order: Option<u8> }

pub struct EffectId(pub u32);                  // opaque arena key, you assign these
pub enum   EffectType { Move, Status, Condition }
// EffectType::sub_order() defaults: Condition = 2, Status = 4, Move = 6
```

编写一个 `Effect` 的顺手方式是 **`effect!` 宏**（在 crate 根部再导出为
`dotzuki_engine::effect`）：

```rust
// Syntax: effect!(<id expr>, <EffectType expr>, { <Event> [(<order>)] => <fn path>, ... })
//   - <Event> is BARE (e.g. DamagingHit) — the macro qualifies it.
//   - (<order>) is optional; omitted ⇒ order = u32::MAX (fires LAST).
//   - priority defaults to 0, sub_order defaults to None (derive from EffectType).

pub static LEFTOVERS: Effect<MinimonProvider> = effect!(EffectId(0xB1), EffectType::Condition, {
    Residual(20) => leftovers_residual::<MinimonProvider>,
});
```

当你想显式指定 `priority` 或 `sub_order` 时，也可以手写结构体字面量（宏总是使用
`priority: 0, sub_order: None`）：

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

### 2.3 处理器签名 + `HandlerResult` + `RelayVar` 折叠

处理器是一个**零捕获 `fn` 指针**。它进入战斗的唯一可变通路是 `ctx`；其余一切按值
接收。

```rust
pub type HandlerFn<P> = fn(
    ctx: &mut BattleCtx<'_, P>,   // the ONLY mutable path into the battle
    relay: RelayVar,              // the typed fold value in flight
    target: BattlerRef,          // event target
    source: BattlerRef,          // event source
    source_effect: EffectId,     // which Effect registered this handler
) -> HandlerResult;
```

处理器返回一个判定结果，对应 Showdown 的 `undefined / value / false / null`：

| 变体 | 含义 | 对折叠的影响 |
|---|---|---|
| `Unchanged` | relay 原样通过，继续 | Showdown 的 `undefined` |
| `Set(RelayVar)` | relay 变成这个值，继续（若 `fast_exit` 则返回） | Showdown 返回一个值 |
| `Fail` | 停止，"但失败了！" | 折叠返回 `RelayVar::Bool(false)` |
| `FailSilent` | 停止，不显示消息 | 折叠返回 `RelayVar::Unit` |

#### `RelayVar`——类型化折叠载荷

事件不携带载荷；载荷放在 `RelayVar` 里：

```rust
pub enum RelayVar { Unit, Int(i64), Damage(u16), Accuracy(u8), Bool(bool) }
```

类型化访问器是**有损**的（用错通道得到 `0`/`false`），`scale` 是 `×num/den` 的修
正器形态，让 relay 留在自己的通道里（并通过 `den.max(1)` 防止 `/0`）：

```rust
fn as_int(self) -> i64;        fn as_damage(self) -> u16;
fn as_accuracy(self) -> u8;    fn as_bool(self) -> bool;
fn scale(self, num: u32, den: u32) -> RelayVar;   // e.g. ×1.5 == relay.scale(3, 2)
```

一个贡献 ×1.5 强化的处理器只需返回 `Set(relay.scale(3, 2))`；否决返回 `Fail`；只产
生副作用的观察者（残留效果扣血、反伤）通过 `ctx` 修改状态并返回 `Unchanged`。

### 2.4 排序——`order` / `priority` 与 comparePriority 旋钮

折叠时，`run_event` 按以下**精确的**字典序排列收集到的处理器，然后只对打平的连续
段做 RNG 洗牌：

```
order  →  priority  →  speed  →  sub_order  →  effect_order
asc        desc        desc      asc            asc
(LOW 1st)  (HIGH 1st)  (HIGH)    (LOW 1st)      (LOW 1st)
```

每个 `EventHook` 上你能控制的：

- **`order`**（`u32`，默认 `u32::MAX` = 最后触发）——**首要的、跨来源的**排序旋钮。
  这是你最常用到的。minimon 的中毒扣血用 `Residual(10)`、Leftovers 治疗用
  `Residual(20)`，让先扣血后治疗在两个*不同*的效果来源（同一次派发收集到的一个
  状态效果与一个道具效果）之间保持成立。
- **`priority`**（`i32`，默认 `0`，高者先）——相同 `order` 内的次级分组。
- **`sub_order`**（`Option<u8>`，`None` ⇒ 从 `EffectType` 推导）。

引擎控制的层级：

- **`speed`** 目前恒为 `0`（引擎无法从不透明的 `P::Stat` 中命名出一个"速度"属性）。
  若你需要速度层级，在驱动器里自行排序（例如按速度从快到慢迭代战斗者）。
- **`effect_order`** 是 arena 的创建计数器；对没有 arena 条目的招式/特性/道具，
  回退到效果的 `id`。
- 完全打平的用**每对相邻处理器一个 RNG 字节**（`< 128` 即交换）决胜——这是唯一的
  处理器顺序随机性（`speed_sort_tiebreak`，`dispatch.rs:241`）。

### 2.5 处理器上下文 `BattleCtx`

交给每个处理器的拆分借用句柄。公开字段：

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
fn pair_mut(&mut self, a: BattlerRef, b: BattlerRef) -> (&mut BattlerState<P>, &mut BattlerState<P>); // two disjoint refs
fn effect(&self, id: EffectId)              -> Option<&EffectState<P>>;      // binary search
fn effect_mut(&mut self, id: EffectId)      -> Option<&mut EffectState<P>>;
```

`pair_mut` 是引擎唯一一处热路径 `unsafe`：跨侧引用索引两个不同的 `Vec`（可证明不
相交），因此它返回两个由裸指针派生的 `&mut`；同侧时它使用安全的 `split_at_mut`。
它用 `debug_assert!` 断言 `a != b`。这是借用检查器的技巧，让 Counter 形态的处理器
**在读取 `source` 的同时修改 `target`**，无需 `RefCell`/`Rc`。

`BattlerState` 暴露 `hp: u16`、`max_hp: u16`、`stats: EnumMap<P::Stat, u16>`、
`stat_stages: EnumMap<P::Stat, i8>`、`status: Option<P::Status>`，外加
`take_damage(amount)` 与 `heal(amount)`。

### 2.6 `MoveContext`——每次招式的临时区

```rust
pub struct MoveContext {
    pub is_critical: bool,   // whether the in-flight move is a crit
    pub damage: u16,         // the rolled/precomputed damage the driver applies
    pub move_missed: bool,   // whether it missed
    pub last_damage: u16,    // the last damage actually dealt (the canonical Counter/Bide read)
}
```

这是同一次招式的整条事件链共享的临时区。内置驱动器把伤害预先算好写入
`mv.damage`，然后 `ModifyDamage` 处理器折叠它，随后驱动器应用它并在触发
`DamagingHit` 之前写入 `mv.last_damage`（`driver.rs:173-188`）。`DamagingHit` 上的
反伤/吸血处理器读 `ctx.mv.last_damage`。

### 2.7 `EffectState` arena 与 `EffectHost`

一个存活效果的逐实例可变状态住在**arena**（`Vec<EffectState<P>>`，按 id 排序以便
二分查找）里：

```rust
pub struct EffectState<P> {
    pub id: EffectId,                    // arena key
    pub host: BattlerRef,                // the battler this effect is attached to
    pub effect_order: u64,               // monotonic creation tiebreak (RNG-free)
    pub kind: P::EffectStateKind,        // YOUR typed per-effect counter enum
}
impl EffectState<P> { fn host_scope(&self) -> EffectHost; }
```

`P::EffectStateKind` 是你游戏里带类型的计数器枚举（例如剧毒计数器、替身 HP 值、
多回合锁定计数器）。编译器检查每一个计数器——没有按位置的槽位袋子。通过
`ctx.effect_mut(id)` 读写它：

```rust
if let Some(es) = ctx.effect_mut(EffectId(7)) {
    if let MyKind::Toxic { counter } = &mut es.kind { *counter = counter.saturating_add(1); }
}
```

`EffectHost` 是引擎据以路由的三路作用域：

```rust
pub enum EffectHost { Battler(BattlerRef), Side(u8) /* 0=player,1=opponent */, Field }
```

**重要的不破坏细节：** `EffectState.host` 保持 `BattlerRef`（这样每个既有 Gen-1 切
片的结构体字面量都原样编译通过），且 arena 状态**目前总是托管在战斗者上**——
`host_scope()` 返回 `EffectHost::Battler`。托管在侧边与场地上的状态*不*存在 arena
里；它住在**你的游戏**里，你通过 `side_effects`/`field_effects` 解析器把它的效果
暴露出来（见 [§2.9](#29-你实现的-provider-解析器)）。`From<BattlerRef>` 与
`PartialEq` 的交叉实现让路由代码可以互换使用 `BattlerRef` 与
`EffectHost::Battler`。

### 2.8 `BattleRng`——唯一随机源与确定性

引擎**不**链接任何 rng crate。所有随机性都流经 `BattleRng` trait，因此*你的游戏*
拥有生成器，从而拥有**精确的抽取顺序**（对 Gen-1 的怪癖至关重要）。

```rust
pub trait BattleRng {
    fn next_u8(&mut self) -> u8;                               // required, the 8-bit primitive
    fn range(&mut self, bound: u32) -> u32 { /* defaulted */ } // override for exact modulo bias
    fn chance(&mut self, num: u32, den: u32) -> bool { /* defaulted: range(den) < num */ }
}
```

对测试而言，`ScriptedRng::new(bytes)` 重放一段固定的字节脚本（耗尽后重复最后一个
字节），并暴露 `consumed() -> usize` 用于抽取顺序的一致性断言。

### 2.9 你实现的 provider 解析器

你实现 **`EffectProvider`**（它扩展 `BattleProvider`）。这就是"特性/道具/天气/侧边
状态不过是 Effect"机制的全部：一组解析器 + 收集过程。**没有 `Ability` 派发器**。

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

因为五个收集解析器全部默认为 `None`/`&[]`，没有特性/道具/天气/侧边状态的游戏会看
到扩展后的收集器**精确地**退化为单来源行为——零新增处理器、零行为变化、相同的
`consumed()` 抽取顺序。你实现某个系统的解析器，就是点亮这个系统。

`BattleProvider`（父 trait）绑定关联类型
`Monster / Move / Ability / Status / Stat / Species / Type / Item`，并拥有伤害公
式：

```rust
fn calculate_damage(&self, move_: &Self::Move, attacker: &BattlerState<Self>,
                    defender: &BattlerState<Self>, random: u8, is_critical: bool) -> DamageResult;
// DamageResult { damage: u16, effectiveness: f32, is_miss: bool }
```

**物特分家就在这里**——无需引擎改动。

### 2.10 派发原语（你的驱动器调用的东西）

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
fn run_event_checked<P: EffectProvider + ?Sized>(ctx: &mut BattleCtx<'_, P>, mut hs: Vec<CollectedHandler<P>>,
                                               mut relay: RelayVar, fast_exit: bool) -> RelayVar;   // + a per-step liveness re-check (skip a dead target)
fn compare<P: EffectProvider + ?Sized>(a: &CollectedHandler<P>, b: &CollectedHandler<P>) -> Ordering;
```

- `collect_handlers` 只接受 `&BattleCtx`（共享借用），并把 **owned** 的
  `CollectedHandler` `Vec`（fn 指针 + id + 按值传递的 `BattlerRef`）填满。没有指向
  arena 的借用存活到折叠阶段——这正是先收集后折叠的借用纪律，让零捕获处理器与可
  重入派发无需 `RefCell` 就能共存。
- `fast_exit: true` 在第一个 `Set` 处返回（重定向/一血形态，例如 `TryHit` 的目标重
  定向）。
- 当一次折叠可能 KO 后续处理器的目标时（例如多目标天气扣血），使用
  `run_event_checked`：它在每次调用前重新检查 `hp > 0`，跳过已倒下的目标。普通
  `run_event` **不**重新检查。

### 2.11 叙述一个回合——`TurnLog`

`StackDriver::execute_turn` 只返回 `StackTurnResult { first, second_cancelled }`
——足以*编排*一个回合，不足以*叙述*它。渲染战斗的前端（文本、HP 条流失、倒下动
画）需要知道**发生了什么**。这就是 `execute_turn_logged`：

```rust
let (result, log): (StackTurnResult, TurnLog<P>) =
    StackDriver::execute_turn_logged(provider, state, effects, actions, rng);
for ev in &log.events { /* … render … */ }
```

`TurnLog<P>` 是一个有序的 `Vec<TurnEvent<P>>`。这套词汇是通用 JRPG 回合表层，以引
擎既有的泛型关联类型（`P::Move` / `P::Status` / `P::Stat`）加 `BattlerRef` 为键：

```rust
pub enum TurnEvent<P: EffectProvider + ?Sized> {
    MoveUsed   { actor: BattlerRef, move_: P::Move },   // passed the gate + cost → executes
    Missed     { actor: BattlerRef },                   // accuracy / immunity miss
    Blocked    { actor: BattlerRef },                   // PREVENTED before it ran (see below)
    Crit       { actor: BattlerRef },                   // landed a critical hit
    Damaged    { target: BattlerRef, amount: u16, cause: Option<HpChangeCause<P>> },
    Healed     { target: BattlerRef, amount: u16, cause: Option<HpChangeCause<P>> },
    StatusInflicted { target: BattlerRef, status: P::Status },
    StatusCured     { target: BattlerRef, status: P::Status },
    StatChanged     { target: BattlerRef, stat: P::Stat, delta: i8 },
    Fainted    { who: BattlerRef },
}
```

**它是增量式 + 带默认值的。** `execute_turn` 就是丢弃日志的 `execute_turn_logged`；
无日志路径不观察任何东西，且**字节级一致**（相同的 `rng` 抽取顺序、相同的最终
`BattleState`、相同的 `StackTurnResult`）。日志在驱动器既有的事件点位通过结构性的
**快照 + 差异**记录——引擎从不为了记录日志而改变回合。

两条让引擎保持游戏无关的设计规则：

- **引擎报告结构事实；游戏提供呈现。** 日志携带伤害*数值*而非克制*类别*（"效果绝
  佳"）——那是一个游戏概念（有些游戏没有克制表），因此前端从招式属性对防守方属性
  重新推导它（[battles how-to §2](../how-to/battles.md#2-type-effectiveness-相克--type-charts)）。
  措辞、动画选择与语言同理。
- **`Blocked` 是通用的。** 当 `BeforeMove` 门槛中止招式（睡着/冰冻/完全麻痹/混乱
  自伤）或行动者付不起消耗时（见 [battles how-to §4.3](../how-to/battles.md#43-the-beforemove-cost-gate)），
  驱动器记录 `Blocked { actor }` 且**没有 `MoveUsed`**。引擎只报告招式*被阻止*这一
  事实；游戏从行动者的状态/易变状态推导*原因*（"睡得很香！"）。正是这个事件让前端
  可以显示"无法行动"那一行——否则这一回合将无声无息。

游戏侧的**翻译器**把日志转换成前端消费的任何东西（文本行、动画队列）。配方见
[battles how-to §5](../how-to/battles.md#5-cookbook-cross-gen-mechanics--effect-stack-recipes)；
pokered 案例研究在 pokered 游戏仓库（分拆后），而不在本仓库。
---

## 3. 诚实的局限与路线图

**已证明**——单场战斗（1v1），在 `examples/minimon` 中端到端编写，除增量式/带默认
值的接缝外**零 `dotzuki-engine` 改动**；GO-WITH-NITS 结论的依据是：

- 物特分家（provider 的 `calculate_damage` + `P::Stat`）。
- `SwitchIn` 上的一个特性（Intimidate）与 `TryBoost` 上的一个特性**否决**（Clear
  Body）——两个特性托管在*不同*的战斗者上，按比较器顺序在同**一**次派发中被收集。
- 一个携带道具的残留效果经 `order` 排在一个状态扣血**之后**（跨来源残留效果排序——`order`
  层级存在的意义正是这种场景）。
- 托管在场地的天气（Sandstorm），带 `FieldResidual` 扣血**和**
  `ModifyStat → WeatherModifyStat` 属性折叠叠加，挂在 `EffectHost::Field` 上。
- 借用安全：先收集后折叠的自有快照 + 逐步存活复查，**没有 `RefCell`/`Rc`**，恰好
  **一处** `unsafe`（跨侧的 `pair_mut`）。88 个 Gen-1 一致性切片原样保持全绿（增量
  性得证）。

**自最初的 GO-WITH-NITS 以来已完成**（每一项都是增量式的，惰性时字节级一致；三项
都在 minimon 中端到端编写并由一致性测试证明）：

- **克制倍率 / 克制表。** ✅ `Effectiveness` 折叠现在会在招式路径中*被触发*
  （`driver.rs:206-208` + minimon 的 `fire_move`）；一个整数 `RelayVar::scale` 有
  理数与 provider 伤害合成。既可以用原生方式编写（一张常量表 + 一个处理器），**也
  可以**写成 RON 的 `type_chart:` 数据（`ApplyTypeChart`）。结果
  `(160, 80, 40, 0)` 已断言。见
  [battles how-to §2](../how-to/battles.md#2-type-effectiveness-相克--type-charts)
  与 §12
- **无代码 RON 编写（双模式）。** ✅ `dotzuki-rules` 加载器经由一个以 `EffectId` 为
  键的 `interpret()` 把 `rules.ron` 解析成运行时 `Effect`（方案 A，零引擎改动），构
  建于封闭的原语 op 词汇表之上，带加载期校验，以及**内置（`include_str!`，
  release）/ 从磁盘热重载（`hot-reload` cargo feature，dev）**的单一事实来源，保证
  内置==磁盘一致与回合之间安全重载。见
  [battles how-to §3](../how-to/battles.md#3-no-code-authoring-with-rulesron-the-dotzuki-rules-loader)
  与 §11
- **MP / 资源与招式消耗。** ✅ `BattlerState` 上一个与 P 无关、以 `u16` 为键的
  `ResourcePool`，一个带默认实现的 `BattleProvider::move_cost` 钩子，以及一个
  `BeforeMove` 消耗门槛（付不起 ⇒ 招式被阻止，否则扣减；不消耗 rng；消耗/资源池为
  空时惰性），外加 RON 的 `cost:` 字段 + `PayResource` 原语 +
  `LoadError::UnknownResource`。见
  [battles how-to §4](../how-to/battles.md#4-resources-mpsp--move-costs)
  与 §13
- **回合叙述——`TurnLog`。** ✅ `StackDriver::execute_turn_logged` 返回一个泛型
  `TurnLog<P>`，由 `TurnEvent`（招式使用 / 未命中 / **被阻止** / 暴击 / 伤害 / 治
  疗 / 状态 / 属性变化 / 倒下）组成，供前端渲染。增量式 + 带默认值：
  `execute_turn` 是无日志路径，且字节级一致（在既有事件点位通过结构性的快照 + 差
  异记录）。引擎报告结构事实；游戏侧重新推导呈现。见
  [§2.11](#211-叙述一个回合turnlog)；pokered 案例研究在 pokered 游戏仓库（分拆后）。

**仍待完成**（数据模型缺口，不是回归）：

- **嵌套否决原语。** Intimidate ↔ Clear Body 的可否决级联仍是**驱动器编排**（记录
  意图 → 驱动器触发子 `TryBoost`）；它还不能纯粹用数据表达。RON 的 `Boost`/
  `VetoIf` op 直接应用；两条记录之间的嵌套 `TryBoost`/`TrySetStatus` 级联不是原语
  （doc 11 §3，Phase 2）。
- **新颖的逐效果计数器状态。** 带自身运行计数器的效果（Counter / Bide / 替身 HP）
  需要类型化的 `EffectStateKind` arena 状态，RON 词汇表尚不能铸造这种状态——它们仍
  是原生 Rust 效果。
- **双打 / 网格。** 一种不同的战斗模型（多目标、重定向）；与下文所述一致，未变。

**已记录的小瑕疵（不是致命问题）。** `HandlerFn` 给出 `&mut BattleCtx` 但**不给
`&P`**，因此处理器**无法重入派发**。"一个特性触发另一个可被否决的事件"是一种**驱
动器编排**模式（记录意图 → 驱动器触发子事件）。设计 §09 §4.2b 的"从处理器内部调
用 `try_boost(ctx, …)`"草图在这一点上过于乐观；见 §10 的 "one nit"。

**后续事项——明确不在范围内，不是回归**（依据 §10）：

- **双打 / 多目标。** `redirect_target` 接缝存在，但**带默认值、惰性且未经验证**；
  minimon 是 1v1。Follow Me / Lightning Rod 的重定向（`TryHit` + 重定向）原则上可
  表达，但尚未演练。
- **完整内容表 / 多段攻击 / 命中率 / 暴击 RNG。** minimon 用确定性的
  `power*atk/def` 公式编写了 **2 个招式**（无掷骰），因此结果可以手工核对。
  `Accuracy`、`ModifyCritRatio`、`ModifyMove`（多段攻击）以及许多 D/E/F 组事件以
  **订阅接缝**的形式存在，但尚无发布的驱动器触发它们。
- **接入 pokered 生产循环是分阶段的，尚未完成。** Gen-1 忠实度仍是**回归凭证**
  （经由旧版 `battle::driver` 的 88 个切片），而不是新栈上的生产替换。AI、换人策略
  与 RNG 驱动的追加效果尚未在栈上演练。
- **`EffectHost` 是增量式的，不是加宽的字段。** `EffectState.host` 保持
  `BattlerRef`（这样所有 Gen-1 切片都原样编译通过）；侧边/场地状态经由
  `Side`/`Field` 分支 + `side_effects`/`field_effects` 解析器寻址，它们归游戏所
  有。设计 §09 §3.1 的"经 `From` 加宽字段"**没有**成立（Rust 字段初始化忽略
  `From`）——见 `ctx.rs` 中的 NO-GO 注释。

---

### 另见

- [`archive/developer-guide-legacy.md`](../archive/developer-guide-legacy.md)——
  更宽泛的引擎指南（地图、NPC、脚本、渲染、菜单、道具、存档）。它的 §6 覆盖*旧版*
  战斗驱动器，而不是这个栈。
- 代码：[`crates/dotzuki-engine/src/battle/stack/`](../../crates/dotzuki-engine/src/battle/stack/)、
  [`crates/dotzuki-engine/src/battle/rng.rs`](../../crates/dotzuki-engine/src/battle/rng.rs)。
