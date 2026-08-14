# 在效果栈上编写战斗

> 本文是 `how-to/battles.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

本页教战斗作者如何在 `dotzuki_engine::battle::stack` 上构建一套战斗系统：声明事件、效果和
处理器（handler），编写 `rules.ron`，并对照 minimon 示例验证结果。

> - **Audience**: game authors, rust developers
> - **Type**: how-to
> - **Status**: active
> - **Last verified**: v0.1.0

开始前，请先阅读 [`explanation/effect-stack.md`](../explanation/effect-stack.md)，了解
效果栈的执行模型以及事件/效果/处理器架构。

> **范围。** 本页介绍如何在**不分叉引擎**的前提下，在 **`dotzuki_engine::battle::stack`**
> ——这个 Showdown 风格的**效果栈**战斗引擎——上构建一套 Gen-1 到 Gen-6 *风格*的战斗系统。
> 设计与理由见 [`explanation/effect-stack.md`](../explanation/effect-stack.md)。
>
> 全文引用的权威示例代码是 [`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs)
> 及其 [`tests.rs`](../../examples/minimon/src/tests.rs)：一个迷你的模拟游戏，编写了物特分家
> （physical/special split）+ Intimidate + Clear Body + Leftovers + Sandstorm——外加一张
> 金木水火土**属性克制表**（[§2](#2-属性克制相克--type-charts)）、一个带招式消耗的 **MP
> 资源**（[§4](#4-资源mpsp与招式消耗)），以及把同一套规则集搬到 **`rules.ron`** 里实现无代码
> 编写（[`examples/minimon/rules.ron`](../../examples/minimon/rules.ron)、
> [§3](#3-用-rulesron-无代码编写dotzuki-rules-加载器)）——全程**零引擎改动**，只依赖
> `dotzuki-engine`（数据路径再依赖 `dotzuki-rules`）。

---

## 目录

1. [教程：搭起一套最小规则集（minimon 走读）](#1-教程搭起一套最小规则集minimon-走读)
2. [属性克制（相克 / type charts）](#2-属性克制相克--type-charts)
3. [用 `rules.ron` 无代码编写（dotzuki-rules 加载器）](#3-用-rulesron-无代码编写dotzuki-rules-加载器)
4. [资源（MP/SP）与招式消耗](#4-资源mpsp与招式消耗)
5. [Cookbook：跨世代机制 → 效果栈配方](#5-cookbook跨世代机制--效果栈配方)
6. [确定性与测试](#6-确定性与测试)

---

## 1. 教程：搭起一套最小规则集（minimon 走读）

[`examples/minimon`](../../examples/minimon) 在效果栈上编写了一套 Gen-4 形态的战斗系统——
物特分家 + Intimidate + Clear Body + Leftovers + Sandstorm——并且**零引擎改动**。它唯一的
依赖就是引擎：

```toml
# examples/minimon/Cargo.toml
[dependencies]
dotzuki-engine = { path = "../../crates/dotzuki-engine" }
```

### 步骤 1 —— 定义 id 枚举（六属性分家形态）

引擎用一个不透明的键索引 `EnumMap<P::Stat>`，所以选择分家形态纯粹是一次数据决策。minimon
定义了六项属性，以及属性/状态/特性/道具的不透明 id，外加一个承载身份的 `Species` 结构体
（`BattlerState` 没有特性/道具字段）：

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

这里的按效果状态分类的枚举仅仅是一个惰性标记，因为这个证明程序没有承载任何有状态的易变
状态：

```rust
pub enum Kind { None }
```

### 步骤 2 —— 实现 `BattleProvider` + `EffectProvider`

`calculate_damage` **就是**整个物特分家。引擎把完整的战斗者状态交给它、拿回一个数字；引擎
从不知道它读了哪些属性：

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

`EffectProvider` 提供 `EffectStateKind = Kind` 和一组解析器（resolver），把不透明 id 映射到
编写好的 `&'static Effect`——这正是"特性/道具/天气不过是托管在某处的 Effect"：

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

（其余解析器保持默认实现。）

### 步骤 3 —— 把 5 个系统编写为 `Effect`

每个处理器都是一个零捕获的 `fn(&mut BattleCtx, RelayVar, target, source, source_effect) -> HandlerResult`。

**(a) 招式伤害**——所有造成伤害的招式共享同一个搭载在 `ModifyDamage` 上的效果。伤害数值由
驱动器（它持有 `&P`）预先算好写入 `ctx.mv.damage`；钩子就是订阅点：

```rust
pub static MOVE_DAMAGE_EFFECT: Effect<MinimonProvider> = Effect {
    id: EffectId(MOVE_TACKLE_ID), kind: EffectType::Move,
    hooks: &[EventHook { event: Event::ModifyDamage, call: move_damage_hook::<MinimonProvider>,
                         order: u32::MAX, priority: 0, sub_order: None }],
};
```

**(b) Intimidate**——`SwitchIn` 处理器无法持有 `&P`，而且这次下降必须可被否决，所以处理器只
记录*意图*（单次行动临时区里的一个哨兵值），由驱动器触发真正的 `TryBoost`：

```rust
<!-- not verified: elided parameters, illustrative only -->
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

**(c) Clear Body 否决**——监听*同一次* `TryBoost` 派发；负增量返回 `Fail`，折叠为
`Bool(false)`，于是驱动器跳过这次强化：

```rust
<!-- not verified: elided parameters, illustrative only -->
fn clear_body_try_boost<P: EffectProvider + ?Sized>(_c: &mut BattleCtx<'_, P>, relay: RelayVar, ..) -> HandlerResult {
    if relay.as_int() < 0 { HandlerResult::Fail } else { HandlerResult::Unchanged }
}
pub static CLEAR_BODY: Effect<MinimonProvider> = Effect {
    id: EffectId(0xA2), kind: EffectType::Condition,
    hooks: &[EventHook { event: Event::TryBoost, call: clear_body_try_boost::<MinimonProvider>,
                         order: 5, priority: 0, sub_order: None }],
};
```

**(d) Leftovers**——`Residual(20)` 的治疗发生在中毒扣血的 `Residual(10)` *之后*。跨来源排序
正是 `order` 层级存在的意义：

```rust
<!-- not verified: elided parameters, illustrative only -->
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

**(e) Sandstorm**——由场地托管，两个钩子：`FieldResidual` 对非 Rock 型扣血，
`WeatherModifyStat` 在 `ModifyStat` *之后*把 ×1.5 SpD 的强化叠加到 relay 上：

```rust
<!-- not verified: elided parameters, illustrative only -->
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

### 步骤 4 —— 通过驱动器重入模式接线效果

你的驱动器辅助函数负责可重入派发：它们持有 `&P`，通过 `collect_handlers` 构建一份自有的
快照，再用 `run_event`/`run_event_checked` 折叠。处理器保持零捕获，只触碰 `ctx`。
`switch_in` 就是权威示例——触发 `SwitchIn`，若 Intimidate 设置了哨兵值，就对对手触发一次
真正的 `TryBoost`；Clear Body 在同一次派发中被收集进来，得以行使否决：

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

pub fn try_boost(&mut self, target: BattlerRef, source: BattlerRef, _stat: Stat, delta: i64) -> bool {
    let provider = &self.provider;
    let mut ctx = BattleCtx { state: &mut self.state, effects: &mut self.effects,
                              mv: &mut self.mv, rng: &mut self.rng };
    let mut hs = Vec::new();
    collect_handlers(&ctx, provider, None, Event::TryBoost, target, source, &mut hs);
    let out = run_event(&mut ctx, hs, RelayVar::Int(delta), false);
    matches!(out, RelayVar::Bool(false) | RelayVar::Unit)       // Fail/FailSilent ⇒ vetoed
}
```

注意这种不相交字段借用：`&self.provider` 与一个由*其余四个*字段构建的 `BattleCtx` 一起被
借用。零捕获处理器契约与可重入派发就是这样共存的——驱动器持有 `&P`，处理器从不持有。

`end_of_turn_residual` 把状态效果作为这次派发的*来源*效果传入，而收集器同时收集道具，于是
`order` 比较器把它们交错排序；`weather_residual` 遍历两个在场单位，用 `run_event_checked`
触发 `FieldResidual`；`effective_spd_with_weather` 先播种 `RelayVar::Int(base_spd)`，再折叠
`WeatherModifyStat`。

### 步骤 5 —— 跑一个回合并断言结果

测试是手工推导的 `BattleState` 基准值（oracle，Showdown 风格）：

```rust
phys.fire_move(BattlerRef::PLAYER, &TACKLE);
assert_eq!(100 - phys.battler_ref(BattlerRef::OPPONENT).hp, 80);   // 40*100/Def(50)
spec.fire_move(BattlerRef::PLAYER, &EMBER);
assert_eq!(100 - spec.battler_ref(BattlerRef::OPPONENT).hp, 40);   // 40*100/SpD(100)
```

> **使用内置的 `StackDriver` 代替手写辅助函数。** minimon 手写自己的辅助函数是为了单独演练
> 各个事件，但引擎自带完整的回合排序器：
> ```rust
> let result: StackTurnResult = StackDriver::execute_turn(
>     &provider, &mut state, &mut effects,
>     [BattleAction::Fight { move_: tackle }, BattleAction::Fight { move_: ember }],
>     &mut rng);
> ```
> 它解析出手顺序（`turn_order_rank` + 一个平局决胜字节），触发每个行动者的招式管线
> （`BeforeMove → ModifyCritRatio → Accuracy → ModifyDamage → DamagingHit`），然后按行动者
> 逐个执行 `Residual`，并带先行动者倒下即短路的逻辑
> （`StackTurnResult { first, second_cancelled }`）。想要权威的 Gen-1 形态回合就用它；只想
> 触发单个事件时用手写辅助函数。
---

## 2. 属性克制（相克 / type charts）

属性克制表**不是**引擎概念。它是 [`Event::Effectiveness`](../explanation/effect-stack.md#21-the-event-taxonomy--what-fires-and-when)
折叠——把一个**整数**有理数倍率与 provider 已经掷好的伤害合成。内置的 `StackDriver` 现在会
在招式管线内部*触发*这个折叠；没有订阅者时它是个可证明的恒等空操作，因此每个既有游戏保持
字节级一致。

### 2.1 折叠在哪里触发、如何合成

在 `resolve_action` 中，`Effectiveness` 在 **`ModifyDamage` 之后**触发（这样光墙（screen）/
道具/天气倍率先于克制表），在 **`DamagingHit` 之前**触发（这样命中后的反应看到的是克制
结算后的数值）。这个折叠是围绕单一事实来源 `ctx.mv.damage` 的三步式**提升（lift）→ 触发 →
回写**（`driver.rs:206-208`）：

```rust
let eff_in = RelayVar::Damage(ctx.mv.damage);
let eff_out = Self::fire(&mut ctx, eff, Event::Effectiveness, target, actor, eff_in);
ctx.mv.damage = eff_out.as_damage(); // non-Damage relay ⇒ 0 (event.rs as_damage)
```

这个数值随后原样留在 `ctx.mv.damage` 里，在下一行被应用（`driver.rs:213`）：

```rust
ctx.battler_mut(target).take_damage(dmg);
```

有两条推论需要遵守：

- **默认惰性。** 没有处理器订阅 `Effectiveness` 时，空处理器的 `run_event` 原样返回 relay，
  回写是恒等的，抽取序列不受影响（`driver.rs:196-205`、`event.rs:179-185`）。
- **待在 `Damage` 通道里。** 对任何**非 `Damage`** 的 relay，`as_damage()` 返回 `0`
  （`event.rs:179-185`）。把 relay 带出 `Damage` 通道的处理器会把这次招式归零。请用
  `relay.scale(num, den)`——它会让 relay 留在自己的通道里。

### 2.2 倍率只用整数

`RelayVar::scale` 是**纯整数运算**——伤害路径上不接触任何浮点数。`Damage(v)` 分支计算
`(v as u64) * num / den` 并截断（clamp）到 `u16::MAX`；`den` 用 `den.max(1)` 做了保护
（`event.rs:207-224`）：

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

于是 2× 就是 `relay.scale(2, 1)`，½× 是 `relay.scale(1, 2)`，0× 免疫是
`relay.scale(0, 1)`。把整张克制表的乘积折叠成**一个**预先合并的有理数，并**只应用一次**
`scale`——逐条边折叠会在每一步发生截断。

### 2.3 原生编写：一张常量表 + 一个处理器

minimon 把金木水火土（Metal/Wood/Water/Fire/Earth）相克环做成一张扁平的常量表，行是
`(atk_index, def_index, num, den)`（`lib.rs:120-135`）：

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

一个纯函数辅助把克制表的**乘积**按防守方的属性折叠成一个有理数（`lib.rs:141-153`）；双
属性因此纯粹是一次数据改动，而不是代码改动：

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

这个处理器与 `HandlerFn` 完全匹配。它从 `source_effect` 找回进行中招式的元素（经
`move_type_for_effect`，`lib.rs:576-582`），从 `Species.mtype` 读出防守方的元素，并返回
**一个**携带合并有理数的 `Set`（`lib.rs:556-572`）：

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

它在每个元素的招式效果里以 `order: 100` 订阅 `Event::Effectiveness`——
`MOVE_DAMAGE_EFFECT`（Normal/无类型 ⇒ 中性恒等）、`MOVE_METAL_EFFECT`、
`MOVE_WATER_EFFECT`（`lib.rs:587-651`）：

```rust
EventHook {
    event: Event::Effectiveness,
    call: effectiveness_chart_hook,
    order: 100, priority: 0, sub_order: None,
},
```

### 2.4 改用 RON 数据编写

同一张克制表可以**不用 Rust**，在 `rules.ron` 里表达为一张 `type_chart:` 列表，行形如
`( atk:, def:, mult: [n, d] )`，由 `Effectiveness` 钩子上的 `ApplyTypeChart` 原语 op 应用
（`rules.ron:39-54`，见 [§3](#3-用-rulesron-无代码编写dotzuki-rules-加载器)）：

```ron
type_chart: [
    ( atk: "Metal", def: "Wood",  mult: [2, 1] ),   // 金克木
    ( atk: "Water", def: "Fire",  mult: [2, 1] ),   // 水克火
    ( atk: "Water", def: "Wood",  mult: [0, 1] ),   // 水→木 immunity
],
// … and on the move:
Hook(on: "Effectiveness", order: 100, do: [ ApplyTypeChart ]),
```

### 2.5 断言的结果（160 / 80 / 40 / 0）

用威力 80 的 Metal blade 招式，克制表的四种结果都是精确整数——一致性基准测试
（`tests.rs:338`）：

```rust
assert_eq!((super_eff, neutral, resisted, immune), (160, 80, 40, 0));
```

`160 = 80 ×2/1`（金克木，效果绝佳 super-effective），`80 = 80 ×1/1`（表中省略的对 ⇒ 效果
一般），`40 = 80 ×1/2`（效果不佳），`0 = 80 ×0/1`（水→木免疫）。原生常量表路径与 RON 数据
路径产出**完全相同**的数字。

> **设计背景：** §12
---

## 3. 用 `rules.ron` 无代码编写（dotzuki-rules 加载器）

[`crates/dotzuki-rules`](../../crates/dotzuki-rules/src/) 是效果栈之上的一层薄薄的编写层：
它把 `rules.ron` 文件解析成运行时的 `Effect`，于是你可以**零 Rust** 地添加**招式、特性、
道具、属性和资源消耗**。它就是**方案 A**——单个以 `EffectId` 为键的 `interpret()` 函数，
注册为每个生成的 `Effect` 的 `call`。**引擎零改动**：引擎本就把 `source_effect: eff.id`
传给每个处理器（`dispatch.rs:128`），而 `interpret` 不过是另一个 `HandlerFn`。

### 3.1 数据模型——效果记录 + 封闭的原语词汇表

顶层形态是 `Ruleset( stats: […], resources: […], types: […], type_chart: […], effects: […] )`（`rules.ron:20-123`；`Ruleset::from_ron` 启用 RON 的 `IMPLICIT_SOME`，
`model.rs:436-440`）。每个效果是一条 `EffectRecord`，带一个 `kind`
（`EffectKind { Move, Status, Ability, Item, Weather }`，`model.rs:184-196`）、可选的
`category`/`power`/`type`/`accuracy`/`cost` 以及一串钩子。每个钩子的 `do:` 是一张取自
**封闭原语 op 词汇表**的列表（`enum Op`，`crates/dotzuki-rules/src/model.rs:396`）——这个
封闭集合就是全部的表达力预算。它随着 pokered Gen-1 迁移需要更多原语而从最初的 12 个增长
到**18 个 op**（`SetHp`、`SetDamage`、`DamageCurrentHpFraction`、`RepeatHits`、
`InflictVolatile`、`RemoveStatus`）——依旧全部封闭、游戏无关：

```rust
pub enum Op {                                        // dotzuki-rules/src/model.rs:396
    DealMoveDamage,                                  // ModifyDamage marker (provider number)
    DamageFraction { num: u32, den: u32, of: FractionOf, target: Selector, unless: Option<Predicate> },
    HealFraction   { num: u32, den: u32, of: FractionOf, target: Selector, unless: Option<Predicate> },
    InflictStatus  { status: String, target: Selector, amount: AmountSpec },
    InflictVolatile { kind: String, target: Selector, amount: AmountSpec },
    Boost          { stat: String, stages: i8, target: Selector },
    ScaleRelay     { num: u32, den: u32, when: Vec<Predicate> },
    SetRelay(i64), AddRelay(i64), ClampRelay { lo: i64, hi: i64 },
    VetoIf         { cond: Predicate, silent: bool },   // Fail when cond holds (Clear Body / Mist)
    ApplyTypeChart,                                  // fold the dual-type product into the relay
    PayResource    { resource: String, amount: u16, target: Selector }, // MP/SP cost gate
    // ── added by the pokered Gen-1 migration (still closed, still game-agnostic) ──
    SetHp          { target: Selector, value: u16, when: Vec<Predicate> }, // absolute HP set
    SetDamage      { value: DamageValue, of: Selector }, // fixed / level / rng damage
    DamageCurrentHpFraction { num: u32, den: u32, target: Selector }, // % of CURRENT hp
    RepeatHits     { count: HitCount, target: Selector, final_hit: FinalHitRider },
    RemoveStatus   { target: Selector },
}
```

配套的封闭枚举：

- `Selector { Target, Foe, Host, Source }`（`model.rs:201`）。
- `FractionOf { MaxHp, CurHp, LastDamage }`（默认 `MaxHp`；`LastDamage` = 刚刚打出的伤害
  ——吸血/反伤的基数；`model.rs:214`）。
- `Predicate { HasType(String), StatIs(String), RelayIntLt(i64), HasVolatile(String),
  MoveTypeIsDefenderType, TargetHasStatus(String), LevelGE }`（`model.rs:268`）——由
  `unless` / `when` / `cond` 守卫使用。（最后四个是为迁移添加的：侧面状态的
  Substitute/同属性否决、Dream Eater 的睡眠门槛、OHKO 的等级门槛。）
- `DamageValue { Const(u16), UserLevel, RngScaledLevel { num, den } }`——`SetDamage` 的数值
  来源（Sonic Boom 20 / Dragon Rage 40 / Seismic Toss = 等级 / Psywave；`model.rs:249`）。
- `HitCount { Fixed(u8), TwoToFive }` + `FinalHitRider`——`RepeatHits` 的连击次数来源 +
  最后一击的附加效果（`model.rs:510`）。

### 3.2 一段真实的 `rules.ron` 摘录

minimon 的整套规则集就是数据。一个招式声明它的分家（`category`/`power`）、它的元素
（`type`）、可选的 `cost:` 以及订阅它的钩子（`rules.ron:63-89`）：

```ron
Effect(id: "move.tackle", kind: Move, category: "Physical", power: 40, type: "Normal", accuracy: 100,
    hooks: [
        Hook(on: "ModifyDamage",  do: [ DealMoveDamage ]),
        Hook(on: "Effectiveness", order: 100, do: [ ApplyTypeChart ]),
    ]),
```

一次状态扣血和一次 Leftovers 治疗展示了跨来源的 `order` 交错——也展示了特性/道具/天气不过
是另一条以 `kind` 为键的记录（`rules.ron:93-121`）：

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

### 3.3 方案 A——以 `EffectId` 为键的 `interpret()`

加载器为**每个 `(effect, event)` 钩子铸造一个独立的 `EffectId`**，并把每个钩子注册为它
自己的迷你 `Effect`，其 `call` 是 `interpret::<P>`（`registry.rs:286-308`，
`build_effects`，泄漏为 `&'static`）。`interpret` 与 `HandlerFn<P>` 完全匹配
（`interp.rs:30-56`）：

```rust
pub fn interpret<P: RulesProvider>(
    ctx: &mut BattleCtx<'_, P>,
    relay: RelayVar,
    target: BattlerRef,
    source: BattlerRef,
    source_effect: EffectId,
) -> HandlerResult
```

它按 `source_effect` 查找编译好的钩子（`host.hook(source_effect)`），应用 `chance` 门槛
（**唯一**的 rng，`ctx.rng.chance(num, den)`，**无条件**抽取，于是抽取顺序是 op 列表的纯
函数），然后 `run_ops`。不需要任何引擎改动。

公开 API（从 `lib.rs:62-70` 再导出）：`Ruleset`、`RuleSource`、`interpret`、`run_ops`、
`CompiledRuleset`、`CompiledHook`、`ResolverKind`、`RulesHost`、`RulesProvider`、
`RuleBindings`，加上模型类型（`Op`、`Predicate`、`Selector`、`EffectKind`、
`EffectRecord`、`HookRecord`、`ResourceCost`、`TypeChartEntry`、`Rational`、
`FractionOf`、`StatRef`、`TypeName`、`LoadError`、`parse_event`、`parse_kind`）。

### 3.4 加载期校验——绝不在战斗期出其不意

每个名字都在**编译时**绑定到封闭词汇表（在 `CompiledRuleset::compile` 中，
`registry.rs:153-265`，以及 `validate_op`，`registry.rs:313-370`）。未知的名字是一个
`LoadError`，在规则集加载时抛出——从不在战斗中途（`model.rs:37-63`）：

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

### 3.5 双模式单一事实来源——内置（release）vs 热重载（dev）

**同一份** `rules.ron` 在两种模式下都是单一事实来源（`source.rs`），且两种模式都走**同一
个** `Ruleset::from_ron`，因此同一文件的内置构建与磁盘构建产出字节级一致的规则集——这就
是**内置==磁盘一致**不变量：

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

- **内置 = 默认（release）。** 该 feature **关闭**；调用方传入 `include_str!` 过的文本。零
  文件 IO。`RuleSource::baked(text: &'static str)`（`source.rs:57`）。
- **磁盘 = 开发环境。** `RuleSource::from_path(path: impl Into<PathBuf>)`
  （`source.rs:65`）。在 `notify` 支撑的 watcher 下（cargo feature 正是
  **`hot-reload`**，`source.rs:136-210`），编辑会被实时观察到。
- 两种模式都通过 `pub fn load(&self) -> Result<Ruleset, LoadError>` 加载
  （`source.rs:81`）。
- `RuleSource::poll_changed(&mut self) -> bool`（`source.rs:98`）——**内置**来源永远返回
  `false`；带 feature 的磁盘来源在文件变化时返回 `true`。还有
  `is_hot_reloadable(&self) -> bool`（`source.rs:112`）。

**回合之间重载是安全的。** 当 `poll_changed` 返回 `true` 时，游戏在**回合之间**重新
`load` 并重建注册表。这在战斗中途是安全的，因为效果以 `EffectId` 寻址，且**存活状态放在
引擎的 `EffectState` arena 中，而不在数据中**——重载只替换效果*定义*，不触碰存活的逐实例
状态（`source.rs:6-14`、`lib.rs:42-51`）。

> **这就是不用 Rust 编写招式/特性/属性/消耗的路径。** 设计背景：§11
---

## 4. 资源（MP/SP）与招式消耗

一套通用的、**与 P 无关的**可消耗资源系统让招式可以消耗 MP / SP / mana / charge。它是
完全增量式的：默认为空、默认惰性，而且**不**消耗任何随机性。

### 4.1 `BattlerState` 上的 `ResourcePool`

`ResourcePool` 是一个以 `u16` 为键的 `(resource_id, current, max)` 三元组袋子，id **不
透明、由游戏指定**（引擎从不知道某个资源是"MP"）。它默认**为空**（`battle/mod.rs:137-222`）：

```rust
#[derive(Default)]
pub struct ResourcePool {
    entries: Vec<(u16, u16, u16)>,   // (resource_id, current, max)
}
```

关键方法：`new()`、`set(id, current, max)`、`current(id) -> Option<u16>`、`max(id)`、
`can_pay(id, amount) -> bool`（`0` 消耗永远可支付；未声明 id 上的正消耗**不可**支付）、
`pay(id, amount) -> bool`（饱和运算、纯算术）、`restore`、`len`、`is_empty`。

它是 `BattlerState` 上的一个字段（`battle/mod.rs:716-737`），在 `BattlerState::new` 里
初始化为 `ResourcePool::new()`——因此构造函数签名**不变**：

```rust
pub resources: ResourcePool,
```

配套的 builder/辅助方法（`battle/mod.rs:773-788`）：

```rust
pub fn with_resource(mut self, id: u16, max: u16) -> Self;   // sets current = max
pub fn can_pay_resource(&self, id: u16, amount: u16) -> bool;
pub fn pay_resource(&mut self, id: u16, amount: u16) -> bool;
```

> **为什么用 `u16` 键的资源池，而不是 `EnumMap<P::Resource>`？** *带默认实现的*关联类型在
> stable Rust 上还不稳定（`E0658`），所以增量式的选择是与 P 无关的整数键资源池
> （`battle/mod.rs:580-602` 文档；引擎不给这些 id 赋予任何含义）。

### 4.2 带默认实现的 provider 钩子

消耗通过一个带默认实现的 `BattleProvider` 方法进入引擎（`battle/mod.rs:600-602`）。默认
的 `&[]` 让门槛保持惰性，于是既有的全部 16 个 `impl BattleProvider` 块原样编译通过：

```rust
fn move_cost(&self, _move_: &Self::Move) -> &[(u16, u16)] {
    &[]
}
```

### 4.3 `BeforeMove` 消耗门槛

在 `resolve_action` 中，这个门槛在 `BeforeMove` 状态门槛**之后**（`driver.rs:147-150`）、
在任何暴击/命中率/伤害抽取**之前**（`driver.rs:152-171`）触发：

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

策略是：**付不起 ⇒ 提前 `return`**（招式被阻止，形态上与完全麻痹的 `BeforeMove` 中止
一致，暴击/命中率/伤害字节从不抽取）；**付得起 ⇒ 扣减**。整个代码块是**纯算术**——不消耗
rng——在消耗为空/资源池为空时它是一个惰性的空循环，于是每场既有战斗和效果栈一致性抽取
序列保持字节级一致。

### 4.4 在 RON 里编写消耗

招式通过 `cost:` 字段声明消耗——`Vec<ResourceCost>`，其中
`ResourceCost { resource: String, amount: u16 }`（RON 写法 `Cost(...)`，
`model.rs:131-153`）。编译器把每个 `resource:` 名称驻留（intern）成一个 id；未知名字在
加载时是 `LoadError::UnknownResource`（`registry.rs:204`、`registry.rs:368`）。编译好的
`move_costs` 映射（`CompiledRuleset.move_cost(source_id) -> &[(usize, u16)]`，
`registry.rs:108`、`276-278`）就是游戏接进 `BattleProvider::move_cost` 的东西。还有一个
`PayResource { resource, amount, target }` op（`model.rs:347-354`，在
`interp.rs:219-233` 解释：若 `!bindings.can_pay_resource(...)` 则 `Fail`，否则
`bindings.pay_resource(...)`），用于把 `BeforeMove` 消耗表达为数据：

```ron
<!-- not verified: excerpt, not loadable standalone -->
Effect(id: "move.blade", kind: Move, category: "Physical", power: 80, type: "Metal", accuracy: 100,
    cost: [ Cost(resource: "MP", amount: 3) ],
```

资源在顶层声明一次（`rules.ron:28`）：

```ron
resources: ["MP"],
```

### 4.5 minimon 的 MP 示例

minimon 声明了单一资源 `Mp`，映射到不透明 id `0`（`lib.rs:279-305`）：

```rust
pub enum Resource { Mp }
impl Resource { pub const fn id(self) -> u16 { match self { Resource::Mp => 0 } } }
pub const MP: u16 = Resource::Mp.id();

const BLADE_COST:   &[(u16, u16)] = &[(MP, 3)];
const TORRENT_COST: &[(u16, u16)] = &[(MP, 5)];
const NO_COST:      &[(u16, u16)] = &[];
```

`MinimonProvider::move_cost`（`lib.rs:403-412`）按招式 id 返回这些值；Tackle 和 Ember 返回
`NO_COST`。断言的测试结果（`tests.rs`）：

- `special_move_costs_mp_and_deducts_it`（第 377 行）：10 MP − BLADE 3 ⇒
  `current(MP) == Some(7)`。
- MP 不足：2 MP < BLADE 3 ⇒ 招式被阻止、防守方毫发无损，且 `current(MP) == Some(2)`
  保持不变。
- `physical_move_with_no_cost_is_unaffected_by_mp`（第 410 行）：0 MP 的 Tackle 仍然打出
  80 点伤害，且 `current(MP) == Some(0)`。
- `torrent_costs_5_mp_exact_balance_is_payable`（第 427 行）：恰好 5 MP 付得起 Torrent ⇒
  `current(MP) == Some(0)`。

> **两种不同的策略——不要混为一谈。** **引擎**门槛（`driver.rs:163-171`）把**未声明**资源
> 上的任何正消耗视为**不可支付**（招式被阻止）。minimon 的**原生** `pay_move_cost`
> （`lib.rs:1007-1027`）刻意不同：没有声明该资源的战斗者把这个招式视为**免费**（跳过
> 门槛）。上面断言的 minimon 测试走的是原生 `Battle` 路径；`data_mode` 标志
> （`lib.rs:404`）让原生 `move_cost` 返回 `NO_COST`，于是数据驱动器改由 `rules.ron` 提供
> 消耗。设计背景：§13
---

## 5. Cookbook：跨世代机制 → 效果栈配方

每条配方背后的同一个模式：机制**从来不是**引擎概念。它是一个**托管在 X 上**的 `Effect`
（战斗者/侧边/场地，由解析器接线），它的处理器**订阅事件 Y**、**执行动作 Z**、**用
`order=N` 排序**。

| 机制 | 托管在 X 上（解析器） | 订阅事件 Y | 在处理器里执行 Z | `order` 层级 `N` |
|---|---|---|---|---|
| **伤害招式** | 行动本身（`effect_for_move`） | `ModifyDamage` | 伤害来自你的 `calculate_damage`；这个钩子就是招式的接缝。掷骰/强化用 `Set(relay.scale(n,d))` 缩放。 | `u32::MAX` |
| **命中附带的追加状态** | 行动本身（`effect_for_move`） | `DamagingHit` | 掷 `ctx.rng.next_u8() < threshold`；成功则记录意图 / 经你的驱动器触发 `TrySetStatus`。有副作用 ⇒ 返回 `Unchanged`。 | 默认 |
| **能力阶级招式** | 行动本身（`effect_for_move`） | `DamagingHit`（或命中后） | 记录一次强化请求；你的驱动器触发 `TryBoost`（relay = `Int(delta)`），让否决方有投票权，再把存活的增量应用到 `stat_stages`。 | 默认 |
| **反伤 / 吸血** | 行动本身（`effect_for_move`） | `DamagingHit` | 读 `ctx.mv.last_damage`；反伤 = 对 `source` 执行 `take_damage(last_damage/N)`；吸血 = 对 `source` 执行 `heal(last_damage/2)`。 | 默认 |
| **特性：被动属性强化**（Huge Power） | 战斗者（`effect_for_ability`） | `ModifyStat` | 若 relay 携带被强化的属性且 `target` 是持有者，则 `Set(relay.scale(2,1))`。折叠进伤害公式的属性读取。 | `ModifyStat` 层级 |
| **特性：免疫**（Levitate / Wonder Guard） | 战斗者（`effect_for_ability`） | `Effectiveness`（倍率）**或** `TryHit`（硬否决） | 在 `Effectiveness` 上，`Set(relay.scale(0,1))` 将其归零；在 `TryHit` 上，返回 `Fail`/`FailSilent` 在伤害之前取消。 | 低（伤害之前） |
| **特性：登场时**（Intimidate） | 战斗者（`effect_for_ability`） | `SwitchIn` | 处理器无法持有 `&P`，所以在 `ctx.mv` 里**记录意图**；你的 `switch_in` 辅助函数（持有 `&P`）重入并触发真正的 `TryBoost`，Clear Body 在那里行使否决。 | `10` |
| **携带道具：回合末残余治疗**（Leftovers） | 战斗者（`effect_for_item`） | `Residual`（或 `SideResidual`/`FieldResidual`） | 对 `host` 执行 `heal((max_hp/16).max(1))`，排在状态扣血**之后**。 | `20`（扣血 = `10`） |
| **携带道具：伤害强化**（Life Orb / Choice Band） | 战斗者（`effect_for_item`） | `ModifyDamage`（Choice Band 用 `ModifyStat`） | 若 `source` 是持有者，则 `Set(relay.scale(13,10))`（×1.3）。 | 中 |
| **携带道具：低血量触发**（Sitrus / Salac） | 战斗者（`effect_for_item`） | `DamagingHit` / `AfterMove` | 若 `ctx.battler(host).hp` 跌到最大值的 ½ 以下，则 `heal(...)` / 触发一次 `TryBoost`，然后在你的状态里标记为已消耗。 | 高（命中落定之后） |
| **天气：伤害倍率**（Rain→Water） | 场地（`field_effects`） | `ModifyDamage`（属性倍率再加 `WeatherModifyStat`） | 从 `ctx` 检查招式/持有者的属性；`Set(relay.scale(3,2))`。`WeatherModifyStat` 在 `ModifyStat` **之后**叠加。 | `WeatherModifyStat` 在 `ModifyStat` 之后 |
| **天气：回合末扣血**（Sandstorm） | 场地（`field_effects`） | `FieldResidual` | 对每个在场 `target`，若不免疫则 `take_damage((max_hp/16).max(1))`。用 `run_event_checked` 驱动，让 KO 不会触发过期处理器。 | 残余层级 |
| **入场陷阱**（Spikes / Stealth Rock） | 侧边（`side_effects`） | `SwitchIn` | 当战斗者进入那一侧时，按已存储的层数缩放执行 `take_damage`（状态放在你的侧边托管结构体里）。 | 低（入场时） |
| **多回合 / 锁招**（Thrash / Hyper Beam） | 战斗者的易变状态（`effect_for_volatile`）+ `forced_action` | 易变状态监听 `BeforeMove`/`End`；锁招靠 `forced_action` | 上一回合设置的易变状态让 `forced_action(effects, actor, chosen)` 返回 `Some(locked_move)`，劫持本回合的输入。`BeforeMove` 把关（跳过硬直）；`End` 触发 Thrash 的自身混乱。 | 不适用（是接缝，不是折叠） |
| **属性克制表 / 克制倍率**（相克） | 行动本身（`effect_for_move`） | `Effectiveness` | 从 `source_effect` 找回招式的元素，读出防守方属性，把克制表的**乘积**折叠成一个有理数，`Set(relay.scale(num, den))`。只用整数；0× = 免疫。待在 `Damage` 通道里。见 [§2](#2-属性克制相克--type-charts)。 | `100`（`ModifyDamage` 之后） |
| **资源消耗**（MP / SP / mana） | 行动者（`move_cost` 钩子） | 在 `BeforeMove` 处把关（引擎 `StackDriver`） | 从 `move_cost` 返回 `&[(resource_id, amount)]`；付不起则门槛阻止招式，否则扣减。纯算术、无 rng、`&[]` 时惰性。或者用数据形式：`cost:` 字段 / `PayResource` op。见 [§4](#4-资源mpsp与招式消耗)。 | 不适用（是门槛，不是折叠） |
| **无代码编写**（用 RON 写招式/特性/道具/属性/消耗） | `dotzuki-rules` 加载器（以 `EffectId` 为键的 `interpret`） | `Hook(on: …)` 点名的任何事件 | 在 `rules.ron` 里写一条 `EffectRecord`，钩子的 `do:` 是一串封闭原语 `Op`；加载器把每个注册为调用 `interpret` 的 `Effect`。内置 / 热重载双模式。见 [§3](#3-用-rulesron-无代码编写dotzuki-rules-加载器)。 | 每个钩子的 `order:` |
| **非易变状态残余**（烧伤 / 中毒扣血） | 行动者的状态（`effect_for_status`） | `Residual` | 对 `host` 执行 `take_damage((max_hp/16).max(1))`；无 rng；对 0 HP 宿主做自我保护。驱动器按行动者的残余结算先触发 `effect_for_status`，**然后**按 arena-id 顺序触发每个存活易变状态的 `effect_for_volatile`。当易变状态接管这一拍（tick）时（例如剧毒递增）跳过固定扣血。 | `10`（吸血之前） |
| **招式前"无法行动"门槛**（睡眠 / 冰冻 / 麻痹 / 混乱） | 一个 `BeforeMove` 钩子（在 pokered 中：挂在每个招式效果上；或在你的驱动器里从状态/易变状态聚合） | `BeforeMove` | 读行动者的状态 / 易变状态；返回 `Fail` 中止（**仅当存在时**才抽取该状态的 rng 字节）。`run_event` 在第一个 `Fail` 处短路，所以把每个门槛的 `order` 设成原始抽取序列（例如混乱 `70` < 麻痹 `90`）。驱动器随后记录 `Blocked`（§2.11），前端据此显示原因。 | 每个状态一个 `order` |
| **回合叙述**（战斗文本 / 动画） | 不适用——调用 `execute_turn_logged` | ——（消费 `TurnLog`） | 遍历返回的 `TurnLog<P>`，把每个 `TurnEvent` 映射到你的前端（一行文本、HP 条的流失、倒下动画）。呈现层在游戏侧重新推导（克制的措辞、`Blocked` 的原因）。增量式的：`execute_turn` 保持不变。见[设计页 §2.11](../explanation/effect-stack.md#211-narrating-a-turn--the-turnlog)。 | 不适用 |

### 完全**不需要引擎改动**的机制

- **物特分家。** `calculate_damage` 由 provider 提供，属性是 `EnumMap<P::Stat>`。定义
  `{Hp,Atk,Def,SpA,SpD,Spe}`，按招式的 category 选取属性对。引擎从来看不到 category。
  （已在 minimon 中验证。）

### 配方接缝的注意事项

- `forced_action` 是**锁招机制，不是事件**——它返回 `Some(BattleAction)` 来替换所选
  行动。引擎不命名任何游戏专属的易变状态；所有锁定语义都在你的实现里。（引擎测试
  `forced_action_default_is_inert` 与 `forced_action_overrides_chosen_action` 验证了
  默认惰性、实现后生效。）
- 登场重入的注意事项是**真实存在的**：`HandlerFn` 给出 `&mut BattleCtx` 但**不给 `&P`**，
  所以处理器**无法重入派发**（重入需要 provider 来跑解析器）。"特性触发另一个可被否决的
  事件"因此是一种**驱动器编排**模式——在处理器里记录意图，从持有 `&P` 的驱动器辅助函数
  触发子事件。
---

## 6. 确定性与测试

确定性在这里是一等性质：引擎**只**通过 `ctx.rng` 抽取随机性，生成器归你的游戏所有，因此
每个结果都是 `(initial state, byte script)` 的纯函数。

### 断言结果

用 `ScriptedRng` 钉死确切的字节，再对 `BattleState` 断言（Showdown 风格的手工推导基准
值）。minimon 的分家测试：

```rust
let mut phys = Battle::new(MinimonProvider::default(), split_attacker(vec![TACKLE]), split_defender());
phys.fire_move(BattlerRef::PLAYER, &TACKLE);
assert_eq!(100 - phys.battler_ref(BattlerRef::OPPONENT).hp, 80);
```

顺序证明依赖*数学上的不对称性*，这样仅凭结果就能证明顺序。Leftovers：满 HP 时先扣血再
治疗得到 **94**（100 − 12 + 6）；先治疗在满 HP 时是空操作，然后扣血 → **88**。于是 `94`
*证明了*先扣血后治疗：

```rust
// holder is Poisoned and holds Leftovers
b.end_of_turn_residual(BattlerRef::PLAYER);
assert_eq!(b.battler_ref(BattlerRef::PLAYER).hp, 94);   // 88 would mean wrong order
```

### 直接断言收集与抽取顺序

`collect_handlers` + `compare` 让你断言收集到了*哪些*来源、以什么顺序，而不必运行折叠：

```rust
let mut hs = Vec::new();
collect_handlers(&ctx, provider, None, Event::TryBoost, BattlerRef::OPPONENT, BattlerRef::PLAYER, &mut hs);
hs.sort_by(dotzuki_engine::battle::stack::compare);
let orders: Vec<u32> = hs.iter().map(|h| h.order).collect();
assert_eq!(orders, vec![5]);                 // Clear Body (order 5) collected on the foe's TryBoost
assert_eq!(hs[0].target, BattlerRef::OPPONENT);   // hosted on the TARGET (cross-battler collection)
```

### 抽取顺序一致性

`ScriptedRng::consumed()` 让你断言引擎按你期望的顺序抽取了你期望的字节——这是锁定 Gen-1
rng 特点的凭证。引擎自己的测试断言了，例如，平局处理器的运行恰好抽取**一个**字节、无
平局的运行抽取**零个**字节（`speed_tiebreak_draws_only_on_tie`），以及暴击先于命中率抽取
（`crit_is_drawn_before_accuracy`）。跑一遍测试套件：

```bash
cargo test -p dotzuki-engine            # engine: comparator, pair_mut, multi-source, forced_action
cargo test -p minimon                # the 5-system authoring proof + controls
```

---

### 另见

- 代码：[`examples/minimon/src/lib.rs`](../../examples/minimon/src/lib.rs)、
  [`examples/minimon/src/tests.rs`](../../examples/minimon/src/tests.rs)、
  [`examples/minimon/rules.ron`](../../examples/minimon/rules.ron)、
  [`crates/dotzuki-rules/src/`](../../crates/dotzuki-rules/src/)。
