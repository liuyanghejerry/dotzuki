# 通用 JRPG 道具系统设计文档

> 为 `jrpg-engine` 设计一个通用、可扩展的道具系统
> 设计原则：「引擎提供机制，游戏提供策略」（engine provides mechanism, game provides policy）

---

## 1. 设计目标

### 1.1 核心目标

为 `jrpg-engine` 设计一个通用 JRPG 道具系统，满足以下 7 类道具需求：

| # | 道具类别 | 代表例子 | 核心行为 |
|---|----------|----------|----------|
| 1 | 恢复道具 | Potion, Antidote, Ether | HP/PP/状态恢复 |
| 2 | 永久属性增强道具 | Protein, Iron, Rare Candy | 永久提升属性 |
| 3 | 关键/剧情道具 | 徽章、钥匙、自行车 | 不可出售、不可丢弃 |
| 4 | 进化道具 | Fire Stone, Thunder Stone | 触发进化 |
| 5 | 装备道具 | 武器、防具、饰品 | 可穿戴、提供属性加成 |
| 6 | 货币道具 | Nugget, Pearl, Star Piece | 出售换钱 |
| 7 | 技能学习道具 | TM, HM | 教会怪物新技能 |

> **注**：精灵球/捕获装置等游戏特化机制通过 `Custom(Id)` 扩展点实现，不作为引擎内置类别。

### 1.2 设计约束

- **遵循现有 Provider 模式**：所有类型通过关联类型泛型化，与 `MonsterProvider`、`EvolutionProvider`、`BattleRng` 一致
- **引擎拥有机制**：背包管理、装备/卸装、购买/出售流程由引擎控制
- **游戏拥有策略**：道具具体效果、数值、条件由游戏层实现
- **向后兼容**：所有新类型必须与现有 `ItemProvider` 和 `ShopProvider` 无缝集成，不破坏现有代码
- **零成本抽象**：不使用的功能（如装备系统）不应产生运行时开销

### 1.3 非目标

- 不定义具体道具数据（归属于游戏层，如 `examples/pokered/`）
- 不实现 UI 渲染（归属于游戏层的菜单系统）
- 不处理网络交易（属于未来 link 模块）

---

## 2. 现状分析

### 2.1 当前代码结构

```
crates/jrpg-engine/src/items/
├── mod.rs                  # 555 行 — ItemResult, BagCategory, Inventory<I>,
│                           #   ItemProvider trait, ShopProvider trait
└── use_driver.rs           # 678 行 — UsageContext, ItemUseResult,
                            #   use_item(), buy(), sell()
```

### 2.2 现有类型摘要

**`ItemResult`** (`mod.rs:30-41`) — 道具使用结果枚举：
```rust
pub enum ItemResult {
    Used,        // 使用成功，消耗道具
    NotUsable,   // 当前上下文不可用
    NotOwned,    // 背包中没有此道具
    NoEffect,    // 使用成功但无效果（如满血使用回复药）
}
```

**`Inventory<I>`** (`mod.rs:66-128`) — 泛型背包，存储 `(item, quantity)` 对，支持 `add` / `remove` / `contains`。

**`ItemProvider`** (`mod.rs:143-216`) — 道具数据 Provider trait：
```rust
pub trait ItemProvider {
    type Item: Copy + Eq + Hash + Debug;
    type Effect;
    type Monster;

    fn item_name(&self, item: &Self::Item) -> &str;
    fn item_description(&self, item: &Self::Item) -> &str;
    fn item_effect(&self, item: &Self::Item) -> Self::Effect;
    fn item_price(&self, item: &Self::Item) -> u32;
    fn can_use_outside_battle(&self, item: &Self::Item) -> bool;
    fn can_use_in_battle(&self, item: &Self::Item) -> bool;
    fn use_on_monster(&self, item: &Self::Item, monster: &mut Self::Monster) -> ItemResult;
    fn consume(&self, item: &Self::Item) -> bool;

    // P0e 新增（带默认实现）
    fn usable_in(&self, item: &Self::Item) -> UsageContext { ... }
    fn apply_effect<M: MonsterProvider>(...) -> ItemUseResult { ... }
}
```

**`ShopProvider`** (`mod.rs:218-272`) — 商店 Provider trait：
```rust
pub trait ShopProvider {
    type Item: Copy + Eq + Hash + Debug;
    type ShopId: Copy + Eq + Hash + Debug;

    fn shop_inventory(&self, shop_id: &Self::ShopId) -> Vec<(Self::Item, u32)>;
    fn shop_name(&self, shop_id: &Self::ShopId) -> &str;
    fn buy_price(&self, item: &Self::Item) -> u32 { 0 }
    fn sell_price(&self, item: &Self::Item) -> u32 { self.buy_price(item) / 2 }
    fn can_sell(&self, item: &Self::Item) -> bool { true }
}
```

**`UsageContext`** (`use_driver.rs:31-40`)：
```rust
pub enum UsageContext {
    FieldOnly,
    BattleOnly,
    FieldAndBattle,
    None,
}
```

**`ItemUseResult`** (`use_driver.rs:70-88`)：
```rust
pub enum ItemUseResult {
    Applied { consume: bool, message_key: Option<String> },
    NoEffect,
    Caught,
    Failed,
}
```

### 2.3 相关外部系统

| 系统 | 位置 | 关键类型 |
|------|------|----------|
| Party | `party/mod.rs` | `MonsterProvider`, `MonsterInstance<P>`, `ExpProvider`, `EvolutionProvider` |
| Battle | `battle/mod.rs` | `BattleProvider`, `BattleRng`, `BattleAction::UseItem` |
| Save | `save/mod.rs` | `SaveData`, `SaveManager` |

**`EvolutionProvider`** 的 `EvolutionTrigger` 已经泛型化为接受道具 ID：
```rust
pub enum EvolutionTrigger<Item> {
    LevelUp,
    Item(Item),  // 进化道具
    Trade,
}
```

### 2.4 现有痛点

1. **`ItemProvider` 缺少道具分类**：`BagCategory` 存在于引擎层，但没有被 `ItemProvider` 引用，游戏层无法声明道具属于哪个分类
2. **`Inventory` 能力不足**：缺少容量限制、过滤、排序等基本功能
3. **缺少装备系统**：完全无法表示可穿戴道具
4. **没有永久属性增强**：Stat-boost 道具（Protein 等）无法通过现有 API 优雅表示
5. **`ItemProvider::Monster` 关联类型与 `MonsterProvider` 脱节**：`apply_effect` 已经使用 `MonsterInstance<M>`，但旧 API `use_on_monster` 仍在用独立的 `Monster` 类型
6. **商店系统不完善**：缺少折扣系统、库存限制、限时商品
7. **特殊道具类别缺乏区分**：Key item、TM/HM、evolution item 没有类型安全的分发

---

## 3. 架构设计

### 3.1 模块结构

```
crates/jrpg-engine/src/items/
├── mod.rs              # 现有文件：ItemResult, BagCategory, Inventory (增强)
├── use_driver.rs       # 现有文件：UsageContext, ItemUseResult, use_item, buy, sell (增强)
├── kind.rs             # [新增] ItemKind 分类枚举
├── equip.rs            # [新增] 装备系统：EquipSlot, EquipmentSlots
└── provider.rs         # [新增] 增强后的 ItemProvider / ShopProvider trait（可选，或用 mod.rs）
```

### 3.2 类型依赖图

```
ItemKind ────────────► ItemProvider (通过 method 查询)
EquipSlot ───────────► EquipmentSlots<I, S>
UsageContext ────────► use_item()
ItemUseResult ◄──────► apply_effect()
Inventory<I> ◄───────► buy() / sell()

MonsterProvider       EvolutionProvider
     ▲                       ▲
     │                       │
     └─────── apply_effect handles ───────► EvolutionTrigger<Item>
```

### 3.3 与现有系统的集成点

```
apply_effect<M: MonsterProvider>(...)
    │
    ├── 调用 M::EvolutionProvider::evolution_target()  → 进化
    ├── 修改 MonsterInstance<M>::stats                 → 属性增强
    ├── 修改 MonsterInstance<M>::current_hp            → 恢复
    ├── 修改 MonsterInstance<M>::status                → 状态治疗
    └── 调用 MonsterInstance<M>::gain_exp()            → Rare Candy
```

---

## 4. 核心类型

### 4.1 `ItemKind` — 道具分类枚举

游戏层声明每个道具属于哪个类别，引擎据此决定默认行为（如 Key Item 不能出售）。

```rust
/// Universal classification of item types in a JRPG.
///
/// Each variant represents a category with distinct engine-level behavior.
/// The game declares `ItemKind` per item via [`ItemProvider::item_kind`];
/// the engine uses it to gate sellability, discardability, stacking, and
/// UI placement.
///
/// # Engine-level defaults (overridable via [`ItemProvider`] methods)
///
/// | Variant      | Sellable | Discardable | Stackable | Consumed on use |
/// |-------------|----------|-------------|-----------|-----------------|
/// | Consumable  | Yes      | Yes         | Yes       | Yes             |
/// | Equipment   | Yes      | Yes         | No        | No              |
/// | KeyItem     | No       | No          | No        | No              |
/// | Evolution   | No       | Yes         | Yes       | Yes             |
/// | StatBoost   | Yes      | Yes         | Yes       | Yes             |
/// | Currency    | Yes*     | Yes         | Yes       | Yes*            |
/// | TeachMove   | No       | Yes         | No**      | Yes             |
/// | Custom(I)   | Game     | Game        | Game      | Game            |
///
/// * Currency items are "sellable" but the engine's sell flow treats them
///   specially (direct monetary value rather than barter).
/// ** TMs/HMs are typically one-time-use in Gen 1, but some games make
///    TMs reusable. The game can override via [`ItemProvider::consume`].
///
/// # Game-specific extensions
///
/// Mechanics that are NOT universal to JRPGs should use `Custom(Id)`:
/// - **Capture devices** (Poké Balls, Monster Traps) → `Custom(GameKind::Ball)`
/// - **Summon stones**, **contract items**, etc. → `Custom(GameKind::Summon)`
///
/// The engine treats `Custom(Id)` as fully game-controlled: all defaults
/// are optimistic (sellable, stackable, consumable), and the game overrides
/// via [`ItemProvider`] methods as needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemKind<Id: Copy + Eq + Hash + Debug> {
    /// Consumable recovery items (Potions, Antidotes, Ethers, etc.).
    Consumable,
    /// Equippable gear (weapons, armor, accessories).
    Equipment,
    /// Plot / key / story items that cannot be sold or discarded.
    KeyItem,
    /// Evolution-triggering items (Fire Stone, Thunder Stone, etc.).
    /// Covers any "form change" mechanic: evolution, job change, awakening.
    Evolution,
    /// Permanent stat-boosting items (Proteins, Rare Candy, etc.).
    StatBoost,
    /// Items whose primary purpose is being sold for money.
    Currency,
    /// Move-teaching items (TMs, HMs, Skill Scrolls, Spell Books).
    TeachMove,
    /// Game-specific categories not covered above.
    ///
    /// Examples: capture devices, summon stones, crafting materials.
    Custom(Id),
}

impl<Id: Copy + Eq + Hash + Debug> ItemKind<Id> {
    /// Whether items of this kind can be sold to shops by default.
    ///
    /// Key items, evolution items, and teach-move items default to
    /// non-sellable. The game can override via
    /// [`ShopProvider::can_sell`].
    pub fn default_sellable(&self) -> bool {
        match self {
            ItemKind::KeyItem | ItemKind::Evolution | ItemKind::TeachMove => false,
            ItemKind::Custom(_) => true, // game decides; override can_sell
            _ => true,
        }
    }

    /// Whether items of this kind can be discarded from the bag by default.
    pub fn default_discardable(&self) -> bool {
        !matches!(self, ItemKind::KeyItem)
    }

    /// Whether multiple units of this item stack in a single inventory slot.
    pub fn default_stackable(&self) -> bool {
        !matches!(self, ItemKind::Equipment | ItemKind::KeyItem | ItemKind::TeachMove)
    }

    /// Whether using this item consumes one unit from the bag by default.
    pub fn default_consumed_on_use(&self) -> bool {
        match self {
            ItemKind::Equipment | ItemKind::KeyItem => false,
            ItemKind::Custom(_) => true,
            _ => true,
        }
    }
}
```

### 4.2 `EquipSlot` — 装备槽位枚举

```rust
/// Equipment slot identifiers.
///
/// Games define which slots their characters/monsters have. The engine
/// uses this to manage equip/unequip operations and to compute aggregate
/// stat bonuses from all equipped items.
///
/// # Examples
///
/// A typical JRPG might use:
/// - Humanoid characters: Weapon, Head, Body, Accessory1, Accessory2
/// - Monster / creature: HeldItem (single slot)
/// - Pokémon: HeldItem (single slot, Gen 2+)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EquipSlot<Id: Copy + Eq + Hash + Debug> {
    /// Main-hand weapon (sword, staff, gun, etc.).
    Weapon,
    /// Helmet / hat / headgear.
    Head,
    /// Chest armor / robe / vest.
    Body,
    /// Primary accessory slot.
    Accessory1,
    /// Secondary accessory slot.
    Accessory2,
    /// Held item (single general-purpose slot, e.g. Pokémon).
    HeldItem,
    /// Game-specific slots not covered above.
    Custom(Id),
}

impl<Id: Copy + Eq + Hash + Debug> EquipSlot<Id> {
    /// All standard (non-custom) slots.
    pub const fn standard() -> &'static [EquipSlot<Id>] {
        &[
            EquipSlot::Weapon,
            EquipSlot::Head,
            EquipSlot::Body,
            EquipSlot::Accessory1,
            EquipSlot::Accessory2,
            EquipSlot::HeldItem,
        ]
    }

    /// Human-readable label for this slot.
    pub fn label(&self) -> &str {
        match self {
            EquipSlot::Weapon => "Weapon",
            EquipSlot::Head => "Head",
            EquipSlot::Body => "Body",
            EquipSlot::Accessory1 => "Accessory",
            EquipSlot::Accessory2 => "Accessory",
            EquipSlot::HeldItem => "Held Item",
            EquipSlot::Custom(_) => "Custom",
        }
    }
}
```

### 4.3 增强的 `UsageContext`

```rust
/// Where / whether an item may be used.
///
/// Enhanced from the current 4-variant enum to include `MenuOnly` (usable
/// only from the bag menu, not in battle or field directly) and `Never`
/// (replaces the old `None` with a more descriptive name).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UsageContext {
    /// Usable only from the field (overworld / party menu).
    FieldOnly,
    /// Usable only inside battle.
    BattleOnly,
    /// Usable both in the field and in battle.
    FieldAndBattle,
    /// Usable only from a specific menu (e.g. the bag's "Use" on a TM
    /// opens the learn-move interface; cannot be used in a battle directly).
    MenuOnly,
    /// Not usable at all (e.g. a plain key item with no effect).
    Never,
}
```

### 4.4 增强的 `Inventory` — 带容量、过滤、排序

```rust
/// A filtering / sorting / capacity-bounded item inventory.
///
/// Generic over the item identifier type `I`. Items with the same identity
/// are stacked into a single slot unless [`ItemKind::default_stackable`]
/// says otherwise.
///
/// # Type parameters
///
/// * `I` — Item identifier type (`Copy + Eq + Hash + Debug`).
/// * `K` — Item kind type (typically [`ItemKind`] parameterized with a
///   game-specific custom-id type).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inventory<I: Copy + Eq + Hash + Debug, K> {
    /// Item slots as `(item, quantity)` pairs.
    items: Vec<(I, u32)>,
    /// Maximum distinct slots (0 = unlimited).
    max_slots: usize,
    /// Maximum quantity per slot (0 = unlimited).
    max_per_slot: u32,
    /// Phantom for the kind parameter (used by filter methods).
    _kind: std::marker::PhantomData<K>,
}

impl<I: Copy + Eq + Hash + Debug, K> Inventory<I, K> {
    /// Create an empty inventory with no capacity limits.
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            max_slots: 0,
            max_per_slot: 0,
            _kind: std::marker::PhantomData,
        }
    }

    /// Create an inventory with slot and per-slot capacity limits.
    ///
    /// `max_slots` = maximum distinct item types; 0 = unlimited.
    /// `max_per_slot` = maximum quantity of each item; 0 = unlimited.
    pub fn with_capacity(max_slots: usize, max_per_slot: u32) -> Self {
        Self {
            items: Vec::new(),
            max_slots,
            max_per_slot,
            _kind: std::marker::PhantomData,
        }
    }

    // ── Query ──────────────────────────────────────────────────────────

    /// Number of distinct item slots.
    pub fn count(&self) -> usize {
        self.items.len()
    }

    /// Returns `true` if the inventory holds at least `quantity` of `item`.
    pub fn contains(&self, item: &I, quantity: u32) -> bool {
        self.items.iter().any(|(i, q)| i == item && *q >= quantity)
    }

    /// Quantity of `item` held (0 if not owned).
    pub fn quantity(&self, item: &I) -> u32 {
        self.items.iter().find(|(i, _)| i == item).map(|(_, q)| *q).unwrap_or(0)
    }

    /// Returns `true` if the inventory is at its slot capacity.
    pub fn is_full(&self) -> bool {
        self.max_slots > 0 && self.items.len() >= self.max_slots
    }

    /// Returns `true` if `item` would exceed the per-slot cap when adding `quantity`.
    pub fn would_exceed_per_slot_cap(&self, item: &I, quantity: u32) -> bool {
        if self.max_per_slot == 0 {
            return false; // unlimited
        }
        let current = self.quantity(item);
        current.saturating_add(quantity) > self.max_per_slot
    }

    // ── Mutation ───────────────────────────────────────────────────────

    /// Try to add `quantity` of `item`.
    ///
    /// Returns `Err` with the max quantity if the per-slot cap would be
    /// exceeded or the inventory is full for a new item slot.
    pub fn add(&mut self, item: I, quantity: u32) -> Result<(), AddError> {
        if quantity == 0 {
            return Ok(());
        }
        // Check per-slot capacity
        if self.would_exceed_per_slot_cap(&item, quantity) {
            return Err(AddError::PerSlotCapReached(self.max_per_slot));
        }
        // Try to merge with existing slot
        for (existing, qty) in self.items.iter_mut() {
            if *existing == item {
                *qty = qty.saturating_add(quantity);
                return Ok(());
            }
        }
        // New item: check slot capacity
        if self.is_full() {
            return Err(AddError::InventoryFull);
        }
        self.items.push((item, quantity));
        Ok(())
    }

    /// Remove up to `quantity` of `item`. Returns `true` if successful.
    pub fn remove(&mut self, item: &I, quantity: u32) -> bool {
        if let Some(pos) = self.items.iter().position(|(i, _)| i == item) {
            let current = self.items[pos].1;
            if current < quantity {
                return false;
            }
            if current == quantity {
                self.items.remove(pos);
            } else {
                self.items[pos].1 -= quantity;
            }
            return true;
        }
        false
    }

    // ── Filtering ──────────────────────────────────────────────────────

    /// Filter items by a predicate on item id.
    pub fn filter<F>(&self, pred: F) -> Vec<&(I, u32)>
    where
        F: Fn(&I) -> bool,
    {
        self.items.iter().filter(|(i, _)| pred(i)).collect()
    }

    /// Filter items by kind, using a game-supplied mapping from `I` -> `K`.
    pub fn filter_by_kind<F>(&self, kind: K, kind_fn: F) -> Vec<&(I, u32)>
    where
        K: PartialEq,
        F: Fn(&I) -> K,
    {
        self.items.iter().filter(|(i, _)| kind_fn(i) == kind).collect()
    }

    // ── Sorting ────────────────────────────────────────────────────────

    /// Sort items in-place by a comparison function.
    pub fn sort_by<F>(&mut self, cmp: F)
    where
        F: FnMut(&(I, u32), &(I, u32)) -> std::cmp::Ordering,
    {
        self.items.sort_by(cmp);
    }

    /// Sort items by name, using a game-supplied name function.
    pub fn sort_by_name<F>(&mut self, name_fn: F)
    where
        F: Fn(&I) -> &str,
    {
        self.items.sort_by(|a, b| name_fn(&a.0).cmp(name_fn(&b.0)));
    }

    /// Sort items by a priority ordering (e.g. by `ItemKind` order).
    pub fn sort_by_kind<F>(&mut self, kind_fn: F)
    where
        F: Fn(&I) -> K,
        K: Ord,
    {
        self.items.sort_by(|a, b| kind_fn(&a.0).cmp(&kind_fn(&b.0)));
    }

    // ── Iteration ──────────────────────────────────────────────────────

    /// Iterate over all `(item, quantity)` pairs.
    pub fn iter(&self) -> impl Iterator<Item = &(I, u32)> {
        self.items.iter()
    }

    /// Consume and return the inner vec.
    pub fn into_inner(self) -> Vec<(I, u32)> {
        self.items
    }

    // ── Capacity ───────────────────────────────────────────────────────

    /// Maximum distinct slots (0 = unlimited).
    pub fn max_slots(&self) -> usize {
        self.max_slots
    }

    /// Maximum quantity per slot (0 = unlimited).
    pub fn max_per_slot(&self) -> u32 {
        self.max_per_slot
    }
}

/// Error returned when an `add` operation fails due to capacity limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddError {
    /// The inventory has reached its maximum distinct slot count.
    InventoryFull,
    /// The per-slot quantity limit would be exceeded.
    PerSlotCapReached(u32),
}
```

### 4.5 `EquipmentSlots` — 装备系统

```rust
/// A generic equipment manager for equipping/unequipping items onto a
/// character or monster.
///
/// # Type parameters
///
/// * `I` — Item identifier type.
/// * `S` — Equip slot type (typically [`EquipSlot`] parameterized with a
///   game-specific custom-slot id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EquipmentSlots<I: Copy + Eq + Hash + Debug, S: Copy + Eq + Hash + Debug> {
    /// Currently equipped items, keyed by slot.
    slots: Vec<(S, Option<I>)>,
}

impl<I: Copy + Eq + Hash + Debug, S: Copy + Eq + Hash + Debug> EquipmentSlots<I, S> {
    /// Create an empty equipment set with the given slots.
    pub fn new(slots: &[S]) -> Self {
        Self {
            slots: slots.iter().map(|&s| (s, None)).collect(),
        }
    }

    /// Create from an iterator of `(slot, optional_item)` pairs.
    pub fn from_pairs(pairs: impl IntoIterator<Item = (S, Option<I>)>) -> Self {
        Self {
            slots: pairs.into_iter().collect(),
        }
    }

    // ── Query ──────────────────────────────────────────────────────────

    /// The item equipped in `slot`, or `None` if empty.
    pub fn equipped_in(&self, slot: &S) -> Option<I> {
        self.slots.iter().find(|(s, _)| s == slot).and_then(|(_, item)| *item)
    }

    /// All equipped items (ignoring empty slots).
    pub fn all_equipped(&self) -> Vec<I> {
        self.slots.iter().filter_map(|(_, item)| *item).collect()
    }

    /// Returns `true` if `item` is currently equipped in any slot.
    pub fn is_equipped(&self, item: &I) -> bool {
        self.slots.iter().any(|(_, equipped)| equipped == Some(*item))
    }

    /// Number of slots (occupied or not).
    pub fn slot_count(&self) -> usize {
        self.slots.len()
    }

    /// Iterate over all `(slot, maybe_item)` pairs.
    pub fn iter(&self) -> impl Iterator<Item = &(S, Option<I>)> {
        self.slots.iter()
    }

    // ── Mutation ───────────────────────────────────────────────────────

    /// Equip `item` into `slot`.
    ///
    /// Returns `Err(EquipError::SlotFull)` if the slot already has an item
    /// (the caller must unequip first). Returns
    /// `Err(EquipError::InvalidSlot)` if `slot` is not part of this set.
    pub fn equip(&mut self, slot: S, item: I) -> Result<(), EquipError> {
        let entry = self.slots.iter_mut().find(|(s, _)| *s == slot);
        match entry {
            Some((_, existing)) if existing.is_some() => Err(EquipError::SlotFull),
            Some((_, existing)) => {
                *existing = Some(item);
                Ok(())
            }
            None => Err(EquipError::InvalidSlot),
        }
    }

    /// Unequip the item in `slot`, returning the item if any.
    pub fn unequip(&mut self, slot: &S) -> Option<I> {
        self.slots.iter_mut().find(|(s, _)| s == slot).and_then(|(_, item)| item.take())
    }

    /// Swap the items in two slots.
    pub fn swap(&mut self, slot_a: &S, slot_b: &S) -> Result<(), EquipError> {
        // Find both slots by index
        let pos_a = self.slots.iter().position(|(s, _)| s == slot_a);
        let pos_b = self.slots.iter().position(|(s, _)| s == slot_b);
        match (pos_a, pos_b) {
            (Some(pa), Some(pb)) => {
                let item_b = self.slots[pb].1.take();
                let item_a = self.slots[pa].1.take();
                self.slots[pa].1 = item_b;
                self.slots[pb].1 = item_a;
                Ok(())
            }
            _ => Err(EquipError::InvalidSlot),
        }
    }

    /// Clear all slots, returning the previously-equipped items.
    pub fn clear(&mut self) -> Vec<I> {
        self.slots.iter_mut().filter_map(|(_, item)| item.take()).collect()
    }
}

/// Errors that can occur during equip/unequip operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EquipError {
    /// The slot already has an item equipped.
    SlotFull,
    /// The slot identifier is not valid for this equipment set.
    InvalidSlot,
}
```

### 4.6 增强的 `ItemUseResult` — 新增进化变体

```rust
/// Neutral result of an item-use attempt.
///
/// Enhanced with `EvolutionTriggered` to support evolution items natively
/// in the engine's result type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ItemUseResult<I: Copy + Eq + Hash + Debug> {
    /// The effect was applied. `consume` tells the driver whether to remove
    /// one unit from the bag. `message_key` is an opaque game-defined
    /// message identifier.
    Applied {
        consume: bool,
        message_key: Option<String>,
    },
    /// The item was applicable but produced no effect (e.g. Potion at full HP).
    /// Not consumed.
    NoEffect,
    /// A capture device succeeded (battle context). Consumed.
    Caught,
    /// The attempt failed (e.g. a ball that broke free). Not consumed.
    Failed,
    /// The item triggered an evolution.
    ///
    /// The engine driver should NOT consume the item here — the evolution
    /// sequence may be accepted or declined by the player, so the item
    /// is consumed only after the evolution is confirmed. The game layer
    /// handles this flow.
    EvolutionTriggered {
        /// The item that triggered the evolution.
        item: I,
        /// Opaque game-defined message key.
        message_key: Option<String>,
    },
    /// The item taught a move to the target monster.
    MoveLearned {
        /// Whether the item was consumed (TMs consume, reusable items don't).
        consume: bool,
        /// Opaque game-defined message key.
        message_key: Option<String>,
    },
}

impl<I: Copy + Eq + Hash + Debug> ItemUseResult<I> {
    /// Whether the driver should remove one unit from the bag.
    pub fn consumes(&self) -> bool {
        match self {
            ItemUseResult::Applied { consume, .. } => *consume,
            ItemUseResult::Caught => true,
            ItemUseResult::MoveLearned { consume, .. } => *consume,
            // Evolution items are consumed only after the player confirms
            ItemUseResult::EvolutionTriggered { .. } => false,
            ItemUseResult::NoEffect | ItemUseResult::Failed => false,
        }
    }
}
```

### 4.7 增强的 `ItemProvider` Trait

```rust
/// Enhanced ItemProvider trait with item kind and richer hooks.
///
/// # Changes from current
///
/// * `Item` now also requires `Debug` (already implicit in practice).
/// * `item_kind(&self, item: &Self::Item) -> ItemKind<Self::CustomKind>` —
///   new required method for classifying items.
/// * `on_use_field` — hook for field-only item effects (bikes, repel, etc.).
/// * `on_teach_move` — hook for TM/HM teach-move logic.
/// * Old methods remain with default impls for backward compat.
///
/// Equipment metadata (slots, stat bonuses) lives on the SEPARATE, optional
/// `EquipProvider` trait (see §4.7b) so games without equipment never declare
/// slot/stat placeholder types. Evolution items have NO dedicated hook: they
/// dispatch through `apply_effect` and report
/// `ItemUseResult::EvolutionTriggered` (see §4.9 for why).
pub trait ItemProvider {
    /// Concrete item identifier type.
    type Item: Copy + Eq + Hash + Debug;
    /// Describes what the item does when used (opaque to engine).
    type Effect;
    /// The monster / party-member type that items may be applied to.
    type Monster;
    /// Game-specific custom item kind variants.
    type CustomKind: Copy + Eq + Hash + Debug;

    // ── Required: Metadata ────────────────────────────────────────────

    /// Human-readable name.
    fn item_name(&self, item: &Self::Item) -> &str;

    /// Flavour / description text.
    fn item_description(&self, item: &Self::Item) -> &str;

    /// The effect descriptor (opaque to engine).
    fn item_effect(&self, item: &Self::Item) -> Self::Effect;

    /// Base purchase / sale price.
    fn item_price(&self, item: &Self::Item) -> u32;

    /// The kind / classification of this item.
    fn item_kind(&self, item: &Self::Item) -> ItemKind<Self::CustomKind>;

    // ── Required: Usage gate ──────────────────────────────────────────

    /// Whether this item can be used outside battle.
    fn can_use_outside_battle(&self, item: &Self::Item) -> bool;

    /// Whether this item can be used in battle.
    fn can_use_in_battle(&self, item: &Self::Item) -> bool;

    /// Attempt to apply the item's effect to a monster (legacy API).
    fn use_on_monster(&self, item: &Self::Item, monster: &mut Self::Monster) -> ItemResult;

    /// Whether the item is consumed after use.
    fn consume(&self, item: &Self::Item) -> bool;

    // ── Defaulted: context eligibility ─────────────────────────────────

    /// Where / whether this item may be used.
    ///
    /// Defaults to `UsageContext::FieldAndBattle`.  The default
    /// implementation uses the legacy `can_use_outside_battle` /
    /// `can_use_in_battle` methods for backward compatibility.
    fn usable_in(&self, item: &Self::Item) -> UsageContext {
        let outside = self.can_use_outside_battle(item);
        let inside = self.can_use_in_battle(item);
        match (outside, inside) {
            (true, true) => UsageContext::FieldAndBattle,
            (true, false) => UsageContext::FieldOnly,
            (false, true) => UsageContext::BattleOnly,
            (false, false) => UsageContext::Never,
        }
    }

    // ── Defaulted: Opaque effect dispatch ─────────────────────────────

    /// Apply the item's effect in a given context.
    ///
    /// The `provider` parameter gives access to the `MonsterProvider` so the
    /// game can query stats, max HP, moves, etc. via `target.max_hp(provider)`,
    /// `provider.hp_stat()`, and `target.stats.get(stat)`.
    ///
    /// Default implementation returns `NoEffect`. Games override this to
    /// implement healing, status cures, PP restoration, stat boosts, capture
    /// logic, and any other item effects.
    fn apply_effect<M: crate::party::MonsterProvider>(
        &self,
        provider: &M,
        item: Self::Item,
        ctx: UsageContext,
        target: Option<&mut crate::party::MonsterInstance<M>>,
        rng: &mut dyn crate::battle::rng::BattleRng,
    ) -> ItemUseResult<Self::Item> {
        let _ = (provider, item, ctx, target, rng);
        ItemUseResult::NoEffect
    }

    // ── Defaulted: Teach-move system ──────────────────────────────────

    /// Attempt to teach `target` the move associated with this item (TM/HM).
    ///
    /// Returns `None` by default (not a teach-move item). The game
    /// provides the actual move-learning logic.
    fn on_teach_move<M: crate::party::MonsterProvider>(
        &self,
        item: Self::Item,
        target: &mut crate::party::MonsterInstance<M>,
    ) -> Option<ItemUseResult<Self::Item>> {
        let _ = (item, target);
        None
    }

    // ── Defaulted: Field effects ──────────────────────────────────────

    /// Apply a field-only effect (no monster target).
    ///
    /// Used for items like Bicycle (enable overworld movement), Repel
    /// (prevent encounters), Escape Rope (return to last PokéCenter), etc.
    /// Returns `None` by default (no field effect).
    fn on_use_field(&self, item: Self::Item) -> Option<ItemUseResult<Self::Item>> {
        let _ = item;
        None
    }
}
```

### 4.7b `EquipProvider` — 可选装备 Provider（独立 trait）

装备元数据从 `ItemProvider` 中拆出，作为可选的扩展 trait。两个动机：

1. **零成本**：没有装备系统的游戏（如 Gen 1 pokered）完全不实现它，
   无需声明 `CustomSlot` / `Stat` 占位类型。
2. **可实现性**：`stat_bonuses` 若是泛型方法 `fn stat_bonuses<Stat: Copy>(...)
   -> &[(Stat, i16)]`，类型由**调用方**选择，任何实现都只能返回空切片
   （无法为任意调用方类型构造数据）。改为关联类型 `type Stat` 后，
   实现方在 impl 时固定类型，可以返回真实数据。

```rust
/// Optional provider trait for games with an equipment system.
/// Implemented IN ADDITION to ItemProvider.
pub trait EquipProvider: ItemProvider {
    /// Game-specific equipment slot identifier (uninhabited enum if the
    /// standard EquipSlot variants suffice).
    type CustomSlot: Copy + Eq + Hash + Debug;
    /// The game's stat identifier for equipment bonuses (typically the same
    /// type as the game's MonsterProvider::Stat).
    type Stat: Copy;

    /// Which slots this item can be equipped into. Empty = not equipment.
    fn equip_slots(&self, item: &Self::Item) -> Vec<EquipSlot<Self::CustomSlot>>;

    /// Additive stat bonuses granted while equipped. The game applies these
    /// to its own monster stats. Defaults to no bonuses.
    fn stat_bonuses(&self, item: &Self::Item) -> &[(Self::Stat, i16)] {
        let _ = item;
        &[]
    }
}
```

### 4.8 增强的 `ShopProvider` — 折扣、库存限制

```rust
/// Enhanced ShopProvider trait with discount, stock, and restock support.
pub trait ShopProvider {
    /// Concrete item identifier type.
    type Item: Copy + Eq + Hash + Debug;
    /// Shop location / identity type.
    type ShopId: Copy + Eq + Hash + Debug;

    // ── Required ──────────────────────────────────────────────────────

    /// Returns the shop's inventory as `(item, price)` pairs.
    fn shop_inventory(&self, shop_id: &Self::ShopId) -> Vec<(Self::Item, u32)>;

    /// Human-readable name of the shop.
    fn shop_name(&self, shop_id: &Self::ShopId) -> &str;

    // ── Defaulted: Pricing ────────────────────────────────────────────

    /// Price the player pays to buy one unit of `item`.
    ///
    /// Defaults to 0; games override with their list price.
    fn buy_price(&self, item: &Self::Item) -> u32 {
        let _ = item;
        0
    }

    /// Price the player receives for selling one unit of `item`.
    ///
    /// Defaults to half the buy_price (Gen-1 style).
    fn sell_price(&self, item: &Self::Item) -> u32 {
        self.buy_price(item) / 2
    }

    /// Whether the shop will buy `item` from the player.
    fn can_sell(&self, item: &Self::Item) -> bool {
        let _ = item;
        true
    }

    // ── Defaulted: Discount system ────────────────────────────────────

    /// A per-player discount multiplier for this shop.
    ///
    /// 1.0 = full price, 0.8 = 20% off, 1.2 = 20% markup.
    /// The engine applies this to `buy_price` to compute the actual cost.
    fn discount_rate(&self, _shop_id: &Self::ShopId) -> f32 {
        1.0 // no discount by default
    }

    /// A per-shop sell-price multiplier, applied ON TOP OF `sell_price`.
    ///
    /// Defaults to 1.0 (pass-through). The Gen-1 half-price rule is already
    /// encoded in the `sell_price` default (`buy_price / 2`); a 0.5 default
    /// here would compose to quarter price. Override per shop for vendors
    /// that pay more or less than the game-wide sell price.
    fn sell_rate(&self, _shop_id: &Self::ShopId) -> f32 {
        1.0
    }

    // ── Defaulted: Stock / inventory limits ───────────────────────────

    /// Whether this shop has limited stock for `item`.
    ///
    /// Unlimited stock by default (infinite supply).
    fn has_limited_stock(&self, _item: &Self::Item) -> bool {
        false
    }

    /// Maximum stock of `item` for a limited-stock shop.
    fn max_stock(&self, _item: &Self::Item) -> u32 {
        0
    }

    /// Whether the shop restocks its limited items after a period.
    fn restocks(&self, _shop_id: &Self::ShopId) -> bool {
        false
    }

    /// Number of game-time units between restocks.
    fn restock_interval(&self, _shop_id: &Self::ShopId) -> u32 {
        0
    }
}
```

### 4.9 增强的 `use_item` 驱动

```rust
/// Enhanced use_item driver supporting all item categories.
///
/// Extended dispatch order:
/// 1. Validate ownership (inventory check)
/// 2. Validate usage context (field/battle/menu gate)
/// 3. Route by ItemKind:
///    - TeachMove → on_teach_move()
///    - KeyItem/Currency → on_use_field() or NoEffect
///    - Equipment → apply_effect() (equip flow itself is game-side via
///      EquipProvider::equip_slots + EquipmentSlots)
///    - Evolution/Consumable/StatBoost/Custom → apply_effect()
/// 4. Consume one unit if `result.consumes()` returns true
///
/// Evolution items deliberately have NO dedicated dispatch arm: the game's
/// `apply_effect` returns `ItemUseResult::EvolutionTriggered`, which the
/// driver never consumes (the game consumes the item after the player
/// confirms the evolution). A dedicated `on_evolve` hook would force
/// `M: EvolutionProvider` + `M::EvoItem: From<I::Item>` bounds onto EVERY
/// use_item caller — even ones using a Potion — so games without evolution
/// mechanics would pay for the feature in trait bounds.
pub fn use_item<I, M>(
    provider: &I,
    mon_provider: &M,
    inv: &mut Inventory<I::Item>,
    item: I::Item,
    ctx: UsageContext,
    target: Option<&mut MonsterInstance<M>>,
    rng: &mut dyn BattleRng,
) -> ItemUseResult<I::Item>
where
    I: ItemProvider,
    M: MonsterProvider,   // plain MonsterProvider — no evolution bounds
{
    // 1. Validate ownership.
    if !inv.contains(&item, 1) {
        return ItemUseResult::Failed;
    }

    // 2. Validate usage context.
    if !ctx.allows(provider.usable_in(&item)) {
        return ItemUseResult::Failed;
    }

    // 3. Route by item kind.
    let kind = provider.item_kind(&item);
    let result = match kind {
        // Teach-move items: delegate to teach-move hook
        ItemKind::TeachMove => {
            if let Some(target) = target {
                provider.on_teach_move(item, target)
                    .unwrap_or(ItemUseResult::NoEffect)
            } else {
                ItemUseResult::NoEffect
            }
        }
        // Field-effect items (bikes, repels, etc.)
        ItemKind::KeyItem | ItemKind::Currency => {
            provider.on_use_field(item)
                .unwrap_or(ItemUseResult::NoEffect)
        }
        // Everything else (incl. Evolution): opaque effect dispatch
        _ => provider.apply_effect(mon_provider, item, ctx, target, rng),
    };

    // 4. Consume one unit on success.
    if result.consumes() {
        inv.remove(&item, 1);
    }
    result
}

/// buy() error handling: with capacity-limited inventories, `inv.add` can
/// fail. The driver checks money FIRST, then attempts the add, and only
/// deducts money once the goods are in the bag — a full bag returns
/// `ShopError::InventoryFull` with the player's money untouched.

// ── Backward-compat usage context check ─────────────────────────────

impl UsageContext {
    /// Returns `true` if an item whose eligibility is `eligibility` may be
    /// used while the *active* context is `self`.
    fn allows(self, eligibility: UsageContext) -> bool {
        match eligibility {
            UsageContext::Never => false,
            UsageContext::FieldAndBattle => !matches!(self, UsageContext::Never),
            UsageContext::FieldOnly => {
                matches!(self, UsageContext::FieldOnly | UsageContext::FieldAndBattle)
            }
            UsageContext::BattleOnly => {
                matches!(self, UsageContext::BattleOnly | UsageContext::FieldAndBattle)
            }
            UsageContext::MenuOnly => {
                matches!(self, UsageContext::MenuOnly)
            }
        }
    }
}
```

---

## 5. 集成设计

### 5.1 与 Party 系统的集成

**道具效果应用于 `MonsterInstance`**：`apply_effect` 方法接收 `provider: &M` 和 `target: Option<&mut MonsterInstance<M>>`，游戏层通过 provider 访问最大 HP、属性等数据。

```rust
// 在游戏层的 ItemProvider 实现中：
fn apply_effect<M: MonsterProvider>(
    &self,
    provider: &M,  // 访问 max_hp, hp_stat, stats 等
    item: Self::Item,
    ctx: UsageContext,
    target: Option<&mut MonsterInstance<M>>,
    rng: &mut dyn BattleRng,
) -> ItemUseResult<Self::Item> {
    match item {
        MyItem::Potion => {
            let mon = target?;
            let max_hp = mon.max_hp(provider);  // 通过 provider 获取最大 HP
            let heal = 20.min(max_hp - mon.current_hp);
            if heal == 0 { return ItemUseResult::NoEffect; }
            mon.current_hp += heal;
            ItemUseResult::Applied { consume: true, message_key: None }
        }
        MyItem::RareCandy => {
            let mon = target?;
            // 需要 M: ExpProvider 才能调用 gain_exp
            // 可以通过 trait bound 或 downcast 处理
            ItemUseResult::Applied { consume: true, message_key: None }
        }
        MyItem::FireStone => {
            // EvolutionProvider 已经使用 EvolutionTrigger::Item
            ItemUseResult::EvolutionTriggered {
                item,
                message_key: Some("evolve?".into()),
            }
        }
        // ...
    }
}
```

**进化流程**：`EvolutionProvider::evolution_target()` 已经接受 `EvolutionTrigger<Item>`，进化道具触发 `EvolutionTrigger::Item(item_id)`。

```rust
// Game层处理进化的典型流程：
fn handle_evolution_item<M: EvolutionProvider>(
    provider: &M,
    mon: &mut MonsterInstance<M>,
    item: M::EvoItem,
) -> Option<M::SpeciesId>
where
    M::EvoItem: From<MyItem>,
{
    let trigger = EvolutionTrigger::Item(item);
    mon.try_evolve(provider, trigger)
}
```

### 5.2 与 Battle 系统的集成

`BattleAction::UseItem` 已经存在。战役中的道具使用流程：

```
BattleAction::UseItem { item }
    → BattleDriver 调用 use_item()
    → ItemProvider::apply_effect() 游戏层处理
    → 返回 ItemUseResult
```

`BattleRng` 用于捕获概率、状态判定等随机因素。

### 5.3 与 Save 系统的集成

保存时需序列化的道具数据：

```rust
/// Save-relevant item state for the player.
#[derive(Debug, Clone)]
pub struct ItemSaveData<I: Copy + Eq + Hash + Debug, S: Copy + Eq + Hash + Debug> {
    /// Bag inventory.
    pub bag: Inventory<I, ItemKind<()>>,  // simplified for save; kind is not persisted
    /// PC storage boxes (indexed by box number).
    pub pc_storage: Vec<Inventory<I, ItemKind<()>>>,
    /// Currently equipped items per party member.
    pub equipment: Vec<EquipmentSlots<I, S>>,
    /// Shop stock remaining (for limited-stock shops).
    pub shop_stock: Vec<(ShopStockKey, u32)>,
}

/// Key for tracking remaining shop stock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ShopStockKey<I: Copy + Eq + Hash + Debug, S: Copy + Eq + Hash + Debug> {
    pub shop_id: S,
    pub item: I,
}
```

### 5.4 `GameData` 集成

新增 `ItemProvider` 相关的关联类型和方法：

```rust
pub trait GameData {
    // ... 现有关联类型 ...

    /// Returns a reference to the item provider.
    fn item_provider(&self) -> &dyn ItemProvider<
        Item = Self::Item,
        Effect = /* game-specific effect type */,
        Monster = /* game-specific monster type */,
        CustomKind = /* game-specific custom kind */,
        CustomSlot = /* game-specific custom slot */,
    >;

    /// Returns a reference to the shop provider.
    fn shop_provider(&self) -> &dyn ShopProvider<Item = Self::Item, ShopId = /* game shop id */>;
}
```

---

## 6. 游戏层实现示例

### 6.1 Pokémon Red/Blue 示例 (简化的 `pokered-data`)

```rust
// examples/pokered/src/items.rs  (或 pokered-data/src/items.rs)

use jrpg_engine::items::*;

// ── Item identifiers ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemId {
    // Recovery
    Potion,
    SuperPotion,
    HyperPotion,
    Antidote,
    FullHeal,
    Ether,
    MaxEther,
    Elixir,
    // Stat boost
    Protein,
    Iron,
    Calcium,
    RareCandy,
    // Evolution
    FireStone,
    ThunderStone,
    WaterStone,
    LeafStone,
    // Key items
    Bicycle,
    TownMap,
    SSAnneTicket,
    SilphScope,
    // TMs
    TM01(MoveId),  // TM01 Mega Punch, etc.
    HM01(MoveId),  // HM01 Cut, etc.
    // Currency
    Nugget,
    Pearl,
    BigPearl,
    // Balls
    PokeBall,
    GreatBall,
    UltraBall,
    // Equipment (not in Gen 1, but for illustration)
    // ...
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CustomKind {
    /// 捕获装置（精灵球、怪物陷阱等）
    Ball,
    /// 技能机器（TM）
    Tm,
    /// 秘传技机器（HM）
    Hm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CustomSlot {
    // Pokémon Gen 2+ would add HeldItem here
}

// ── Item data table ───────────────────────────────────────────────

struct ItemData {
    name: &'static str,
    description: &'static str,
    price: u32,
    kind: ItemKind<CustomKind>,
    heal_hp: u16,
    heal_status: StatusCondition,
    heal_pp: u8,
    stat_boost: Option<(Stat, u16)>,
    teach_move: Option<MoveId>,
}

static ITEM_DATA: phf::Map<ItemId, ItemData> = phf::phf_map! {
    ItemId::Potion => ItemData {
        name: "POTION",
        description: "Restores HP by 20.",
        price: 300,
        kind: ItemKind::Consumable,
        heal_hp: 20,
        heal_status: StatusCondition::None,
        heal_pp: 0,
        stat_boost: None,
        teach_move: None,
    },
    ItemId::RareCandy => ItemData {
        name: "RARE CANDY",
        description: "Raises level by 1.",
        price: 0,
        kind: ItemKind::StatBoost,
        heal_hp: 0,
        heal_status: StatusCondition::None,
        heal_pp: 0,
        stat_boost: None,
        teach_move: None,
    },
    ItemId::FireStone => ItemData {
        name: "FIRE STONE",
        description: "Evolves certain Pokémon.",
        price: 2100,
        kind: ItemKind::Evolution,
        heal_hp: 0,
        heal_status: StatusCondition::None,
        heal_pp: 0,
        stat_boost: None,
        teach_move: None,
    },
    ItemId::HM01 => ItemData {
        name: "HM01 CUT",
        description: "Cuts down small trees.",
        price: 0,
        kind: ItemKind::TeachMove(CustomKind::Hm),
        heal_hp: 0,
        heal_status: StatusCondition::None,
        heal_pp: 0,
        stat_boost: None,
        teach_move: Some(MoveId::Cut),
    },
    ItemId::PokeBall => ItemData {
        name: "POKE BALL",
        description: "A device for catching wild Pokémon.",
        price: 200,
        kind: ItemKind::Custom(CustomKind::Ball),  // Ball is game-specific, not engine-standard
        heal_hp: 0,
        heal_status: StatusCondition::None,
        heal_pp: 0,
        stat_boost: None,
        teach_move: None,
    },
    ItemId::Bicycle => ItemData {
        name: "BICYCLE",
        description: "A folding bike for fast travel.",
        price: 0,
        kind: ItemKind::KeyItem,
        heal_hp: 0,
        heal_status: StatusCondition::None,
        heal_pp: 0,
        stat_boost: None,
        teach_move: None,
    },
    // ... etc
};

// ── ItemProvider implementation ───────────────────────────────────

pub struct PokemonItemProvider {
    // references to other providers
    mon_provider: PokemonMonsterProvider,
    move_provider: PokemonMoveProvider,
}

impl ItemProvider for PokemonItemProvider {
    type Item = ItemId;
    type Effect = ();  // opaque; we handle everything in apply_effect
    type Monster = PokemonMonster;  // legacy, not used for new dispatch
    type CustomKind = CustomKind;
    type CustomSlot = CustomSlot;

    fn item_name(&self, item: &ItemId) -> &str {
        ITEM_DATA.get(item).map(|d| d.name).unwrap_or("???")
    }

    fn item_description(&self, item: &ItemId) -> &str {
        ITEM_DATA.get(item).map(|d| d.description).unwrap_or("???")
    }

    fn item_effect(&self, item: &ItemId) -> Self::Effect {
        let _ = item;
        // Opaque; actual effect handled in apply_effect
    }

    fn item_price(&self, item: &ItemId) -> u32 {
        ITEM_DATA.get(item).map(|d| d.price).unwrap_or(0)
    }

    fn item_kind(&self, item: &ItemId) -> ItemKind<Self::CustomKind> {
        match item {
            ItemId::Potion | ItemId::SuperPotion | ItemId::HyperPotion => ItemKind::Consumable,
            ItemId::Antidote | ItemId::BurnHeal => ItemKind::Consumable,
            ItemId::MoonStone | ItemId::FireStone => ItemKind::Evolution,
            ItemId::HpUp | ItemId::Protein | ItemId::RareCandy => ItemKind::StatBoost,
            ItemId::Bicycle | ItemId::TownMap | ItemId::Pokedex => ItemKind::KeyItem,
            // PokeBall is game-specific capture mechanic, not engine-standard
            ItemId::MasterBall | ItemId::UltraBall | ItemId::PokeBall => ItemKind::Custom(CustomKind::Ball),
            _ => ItemKind::Custom(CustomKind::Tm),
        }
    }

    fn can_use_outside_battle(&self, item: &ItemId) -> bool {
        match item {
            ItemId::PokeBall | ItemId::GreatBall | ItemId::UltraBall => false,
            ItemId::Bicycle => true,  // field use only
            _ => true,
        }
    }

    fn can_use_in_battle(&self, item: &ItemId) -> bool {
        match item {
            ItemId::Bicycle | ItemId::TownMap | ItemId::SSAnneTicket => false,
            ItemId::HM01(_) => false,
            _ => true,
        }
    }

    fn use_on_monster(&self, _item: &ItemId, _monster: &mut Self::Monster) -> ItemResult {
        // Legacy API — not used in new code; dispatch through apply_effect
        ItemResult::NoEffect
    }

    fn consume(&self, item: &ItemId) -> bool {
        match ITEM_DATA.get(item).map(|d| d.kind) {
            Some(ItemKind::KeyItem) => false,
            Some(ItemKind::TeachMove(CustomKind::Hm)) => false,
            Some(ItemKind::Equipment) => false,
            _ => true,
        }
    }

    fn usable_in(&self, item: &ItemId) -> UsageContext {
        match item {
            ItemId::PokeBall | ItemId::GreatBall | ItemId::UltraBall => UsageContext::BattleOnly,
            ItemId::Bicycle => UsageContext::FieldOnly,
            ItemId::TownMap => UsageContext::FieldOnly,
            ItemId::HM01(_) => UsageContext::MenuOnly,  // use from bag menu to teach
            _ => UsageContext::FieldAndBattle,
        }
    }

    // ── Core effect dispatch ──────────────────────────────────────

    fn apply_effect<M: MonsterProvider>(
        &self,
        provider: &M,
        item: Self::Item,
        _ctx: UsageContext,
        target: Option<&mut MonsterInstance<M>>,
        rng: &mut dyn BattleRng,
    ) -> ItemUseResult<Self::Item> {
        let data = match ITEM_DATA.get(&item) {
            Some(d) => d,
            None => return ItemUseResult::NoEffect,
        };

        match data.kind {
            ItemKind::Consumable => {
                let mon = match target {
                    Some(m) => m,
                    None => return ItemUseResult::NoEffect,
                };
                // HP healing — use provider to get max HP
                if data.heal_hp > 0 {
                    let max_hp = mon.max_hp(provider);
                    if mon.current_hp >= max_hp {
                        return ItemUseResult::NoEffect;
                    }
                    let heal = data.heal_hp.min(max_hp - mon.current_hp);
                    mon.current_hp += heal;
                    return ItemUseResult::Applied { consume: true, message_key: None };
                }
                // Status healing
                if data.heal_status != StatusCondition::None && mon.status != MonsterStatus::Healthy {
                    // match and clear status...
                    return ItemUseResult::Applied { consume: true, message_key: None };
                }
                ItemUseResult::NoEffect
            }

            ItemKind::StatBoost => {
                // Rare Candy: gain 1 level
                if matches!(item, ItemId::RareCandy) {
                    let mon = match target {
                        Some(m) => m,
                        None => return ItemUseResult::NoEffect,
                    };
                    // MonsterInstance<M> requires ExpProvider for gain_exp
                    // This would be dispatched via a generic bound on M
                    ItemUseResult::Applied { consume: true, message_key: None }
                } else {
                    // Vitamins: permanently raise a stat
                    let _ = (target, rng);
                    ItemUseResult::Applied { consume: true, message_key: None }
                }
            }

            ItemKind::Custom(CustomKind::Ball) => {
                // Capture logic — game-specific
                let _ = rng;
                // Simplified: 50% catch rate
                if rng.next_u8() >= 128 {
                    ItemUseResult::Caught
                } else {
                    ItemUseResult::Failed
                }
            }

            ItemKind::Evolution => {
                // Report the trigger WITHOUT evolving or consuming. The game
                // then asks the player to confirm, runs the evolution
                // sequence (EvolutionProvider::evolution_target +
                // EvolutionTrigger::Item), and only then removes the item
                // from the bag. EvolutionTriggered.consumes() == false, so
                // the driver leaves the item alone.
                ItemUseResult::EvolutionTriggered {
                    item,
                    message_key: Some("evolve?".into()),
                }
            }

            _ => ItemUseResult::NoEffect,
        }
    }

    fn on_teach_move<M: MonsterProvider>(
        &self,
        item: Self::Item,
        target: &mut MonsterInstance<M>,
    ) -> Option<ItemUseResult<Self::Item>> {
        let data = ITEM_DATA.get(&item)?;
        let move_id = data.teach_move?;

        // Check if already knows the move
        if target.moves.iter().any(|m| m.move_id == move_id.into()) {
            return Some(ItemUseResult::NoEffect);
        }

        // Check if has room for a new move
        if target.moves.len() < 4 {
            target.moves.push(MoveSlot {
                move_id: move_id.into(),
                pp: 0,   // game calculates PP from move data
                pp_up: 0,
            });
            Some(ItemUseResult::MoveLearned {
                consume: true,
                message_key: Some("learned_move".into()),
            })
        } else {
            // Forget a move flow — game handles this
            Some(ItemUseResult::MoveLearned {
                consume: true,
                message_key: Some("forget_move".into()),
            })
        }
    }

    fn on_use_field(&self, item: Self::Item) -> Option<ItemUseResult<Self::Item>> {
        match item {
            ItemId::Bicycle => {
                // Signal the overworld to enable bike movement
                Some(ItemUseResult::Applied {
                    consume: false,
                    message_key: Some("used_bike".into()),
                })
            }
            _ => None,
        }
    }
}
```

### 6.2 Final Fantasy 示例 (简化)

```rust
// examples/ff-rust/src/items.rs

use jrpg_engine::items::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FfItem {
    // Recovery
    Potion,
    HiPotion,
    PhoenixDown,
    Ether,
    // Equipment
    BronzeSword,
    IronArmor,
    LeatherCap,
    PowerRing,
    // Key
    CrystalShard,
    KingSeal,
    // ...
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FfCustomKind {
    Weapon,
    Armor,
    Accessory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FfEquipSlot {
    Weapon,
    Armor,
    Helmet,
    Ring1,
    Ring2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FfStat {
    Attack,
    Defense,
    Magic,
}

impl ItemProvider for FinalFantasyProvider {
    type Item = FfItem;
    type Effect = ();
    type Monster = FfCharacter;
    type CustomKind = FfCustomKind;

    fn item_kind(&self, item: &FfItem) -> ItemKind<Self::CustomKind> {
        match item {
            FfItem::BronzeSword => ItemKind::Equipment,
            FfItem::IronArmor => ItemKind::Equipment,
            FfItem::LeatherCap => ItemKind::Equipment,
            FfItem::PowerRing => ItemKind::Equipment,
            FfItem::CrystalShard | FfItem::KingSeal => ItemKind::KeyItem,
            _ => ItemKind::Consumable,
        }
    }

    // ... other methods follow the same pattern
}

// FF has equipment, so it ALSO implements the optional EquipProvider trait.
// `type Stat` is fixed at impl time, so stat_bonuses can return real data
// (impossible with a caller-chosen generic <Stat> parameter).
impl EquipProvider for FinalFantasyProvider {
    type CustomSlot = FfEquipSlot;
    type Stat = FfStat;

    fn equip_slots(&self, item: &FfItem) -> Vec<EquipSlot<Self::CustomSlot>> {
        match item {
            FfItem::BronzeSword => vec![EquipSlot::Custom(FfEquipSlot::Weapon)],
            FfItem::IronArmor => vec![EquipSlot::Custom(FfEquipSlot::Armor)],
            FfItem::LeatherCap => vec![EquipSlot::Custom(FfEquipSlot::Helmet)],
            FfItem::PowerRing => vec![
                EquipSlot::Custom(FfEquipSlot::Ring1),
                EquipSlot::Custom(FfEquipSlot::Ring2),
            ],
            _ => Vec::new(),
        }
    }

    fn stat_bonuses(&self, item: &FfItem) -> &[(FfStat, i16)] {
        match item {
            FfItem::BronzeSword => &[(FfStat::Attack, 5)],
            FfItem::IronArmor => &[(FfStat::Defense, 8)],
            FfItem::PowerRing => &[(FfStat::Magic, 3), (FfStat::Defense, 2)],
            _ => &[],
        }
    }
}
```

---

## 7. 迁移路径

### Phase 1: 新增 `kind.rs` 和 `equip.rs`（向后兼容）

**目标**：添加 `ItemKind`、`EquipSlot`、`EquipmentSlots` 类型，不修改任何现有代码。

**变更**：
- 新建 `crates/jrpg-engine/src/items/kind.rs` — `ItemKind` 枚举
- 新建 `crates/jrpg-engine/src/items/equip.rs` — `EquipSlot`、`EquipmentSlots`
- 在 `mod.rs` 中 `pub mod kind;` 和 `pub mod equip;`
- 现有代码完全不受影响

**风险**：无。纯新增类型。

### Phase 2: 增强 `Inventory`（轻微破坏）

**目标**：为 `Inventory` 添加容量、过滤、排序功能。

**变更**：
- `Inventory<I>` → `Inventory<I, K>`（新增 phantom type parameter `K`）
- 现有代码中 `Inventory<ItemId>` → `Inventory<ItemId, ItemKind<CustomKind>>`
- 提供 `Inventory::<I, K>::new()` 保持默认用法

**兼容性**：类型参数变更需要更新所有实例化处。为最小化破坏，可提供类型别名：
```rust
// 简化迁移的类型别名
pub type SimpleInventory<I> = Inventory<I, ()>;
```

**风险**：中。需要更新引擎内和游戏层中的 `Inventory` 使用处。

### Phase 3: 增强 `ItemUseResult`（轻微破坏）

**目标**：添加 `EvolutionTriggered` 和 `MoveLearned` 变体。

**变更**：
- `ItemUseResult` → `ItemUseResult<I>`（新增泛型参数）
- 添加 `EvolutionTriggered { item, message_key }`
- 添加 `MoveLearned { consume, message_key }`
- 现有的 `use_item` 函数签名更新

**兼容性**：所有匹配 `ItemUseResult` 的 `match` 需要更新。

**风险**：中。更新现有 match 语句。

### Phase 4: 增强 `ItemProvider`（向后兼容，逐步采纳）

**目标**：为 `ItemProvider` 添加新的关联类型和方法。

**变更**：
- 添加关联类型 `CustomKind`、`CustomSlot`
- 添加 `item_kind()` 方法（提供默认实现返回 `ItemKind::Consumable`）
- 添加 `on_teach_move()`、`on_use_field()`；装备相关（`equip_slots()`、`stat_bonuses()`）放入独立的 `EquipProvider` trait（§4.7b）；进化道具不设 hook，走 `apply_effect` 返回 `EvolutionTriggered`（§4.9）
- 现有 `usable_in()` 的默认实现使用 `can_use_outside_battle` / `can_use_in_battle`

**兼容性**：所有新方法有默认实现，新关联类型允许使用 `()` 作为占位。

**风险**：低。纯新增方法和关联类型，有默认值。

### Phase 5: 增强 `ShopProvider`（向后兼容）

**目标**：添加折扣、库存限制、补货功能。

**变更**：
- 添加 `discount_rate()`、`sell_rate()` 带默认实现
- 添加 `has_limited_stock()`、`max_stock()`、`restocks()`、`restock_interval()` 带默认实现
- 增强 `buy()` 和 `sell()` 函数以支持这些功能

**兼容性**：完全向后兼容，所有新方法有默认实现。

**风险**：低。

### Phase 6 (可选): 废弃旧 API

**目标**：标记旧方法为 deprecated。

**变更**：
- `can_use_outside_battle()` / `can_use_in_battle()` → `#[deprecated]`，推荐使用 `usable_in()`
- `use_on_monster()` → `#[deprecated]`，推荐使用 `apply_effect()`
- `ItemResult` → `#[deprecated]`，推荐使用 `ItemUseResult`

**风险**：低。纯标记，不影响编译。

### 迁移时间线

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6
  kind.rs   Inventory    ItemUseRes   ItemProvider  ShopProvider  Deprecate
  equip.rs  泛型化       泛型化       增强           增强          旧API
```

所有 Phase 可以非阻塞并行进行（Phase 2→3 除外，因为 `ItemUseResult` 的变更会影响 `use_item` 签名）。

---

## 8. 测试策略

### 8.1 单元测试（引擎层）

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // ── Mock types ──────────────────────────────────────────────────

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    enum MockItem {
        Potion,
        Antidote,
        FireStone,
        Bicycle,
        TmSlash,
        ExpShare,
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    enum MockCustomKind {}

    struct MockProvider;

    impl ItemProvider for MockProvider {
        type Item = MockItem;
        type Effect = ();
        type Monster = ();
        type CustomKind = MockCustomKind;

        fn item_name(&self, item: &MockItem) -> &str {
            match item {
                MockItem::Potion => "Potion",
                MockItem::FireStone => "Fire Stone",
                MockItem::Bicycle => "Bicycle",
                _ => "Item",
            }
        }

        fn item_description(&self, _item: &MockItem) -> &str { "An item." }
        fn item_effect(&self, _item: &MockItem) {}
        fn item_price(&self, item: &MockItem) -> u32 {
            match item {
                MockItem::Potion => 300,
                MockItem::FireStone => 2100,
                _ => 0,
            }
        }

        fn item_kind(&self, item: &MockItem) -> ItemKind<Self::CustomKind> {
            match item {
                MockItem::Potion | MockItem::Antidote => ItemKind::Consumable,
                MockItem::FireStone => ItemKind::Evolution,
                MockItem::Bicycle => ItemKind::KeyItem,
                MockItem::TmSlash => ItemKind::TeachMove,
                MockItem::ExpShare => ItemKind::Equipment,
            }
        }

        fn can_use_outside_battle(&self, item: &MockItem) -> bool {
            !matches!(item, MockItem::FireStone)
        }
        fn can_use_in_battle(&self, item: &MockItem) -> bool {
            matches!(item, MockItem::Potion | MockItem::Antidote)
        }
        fn use_on_monster(&self, _item: &MockItem, _m: &mut ()) -> ItemResult {
            ItemResult::NoEffect
        }
        fn consume(&self, item: &MockItem) -> bool {
            !matches!(item, MockItem::Bicycle)
        }
    }

    // ── Tests: ItemKind defaults ────────────────────────────────────

    #[test]
    fn key_item_not_sellable() {
        assert!(!ItemKind::<()>::KeyItem.default_sellable());
    }

    #[test]
    fn consumable_sellable_and_stackable() {
        assert!(ItemKind::<()>::Consumable.default_sellable());
        assert!(ItemKind::<()>::Consumable.default_stackable());
        assert!(ItemKind::<()>::Consumable.default_consumed_on_use());
        assert!(ItemKind::<()>::Consumable.default_discardable());
    }

    #[test]
    fn equipment_not_stackable_not_consumed() {
        assert!(!ItemKind::<()>::Equipment.default_stackable());
        assert!(!ItemKind::<()>::Equipment.default_consumed_on_use());
        assert!(ItemKind::<()>::Equipment.default_sellable());
        assert!(ItemKind::<()>::Equipment.default_discardable());
    }

    #[test]
    fn evolution_item_not_sellable() {
        assert!(!ItemKind::<()>::Evolution.default_sellable());
        assert!(ItemKind::<()>::Evolution.default_stackable());
        assert!(ItemKind::<()>::Evolution.default_consumed_on_use());
    }

    #[test]
    fn stat_boost_sellable_and_consumed() {
        assert!(ItemKind::<()>::StatBoost.default_sellable());
        assert!(ItemKind::<()>::StatBoost.default_stackable());
        assert!(ItemKind::<()>::StatBoost.default_consumed_on_use());
    }

    #[test]
    fn currency_sellable_and_consumed() {
        assert!(ItemKind::<()>::Currency.default_sellable());
        assert!(ItemKind::<()>::Currency.default_stackable());
        assert!(ItemKind::<()>::Currency.default_consumed_on_use());
    }

    #[test]
    fn teach_move_not_sellable() {
        assert!(!ItemKind::<()>::TeachMove.default_sellable());
        assert!(!ItemKind::<()>::TeachMove.default_stackable());
        assert!(ItemKind::<()>::TeachMove.default_consumed_on_use());
    }

    #[test]
    fn custom_kind_defaults_are_optimistic() {
        // Custom kind defaults: sellable, stackable, consumable, discardable
        let kind = ItemKind::Custom(());
        assert!(kind.default_sellable());
        assert!(kind.default_stackable());
        assert!(kind.default_consumed_on_use());
        assert!(kind.default_discardable());
    }

    #[test]
    fn key_item_not_discardable() {
        assert!(!ItemKind::<()>::KeyItem.default_discardable());
    }

    // ── Tests: EquipSlot ────────────────────────────────────────────

    #[test]
    fn equipment_slots_new() {
        let slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon, EquipSlot::Body]);
        assert_eq!(slots.slot_count(), 2);
        assert!(slots.equipped_in(&EquipSlot::Weapon).is_none());
        assert!(slots.equipped_in(&EquipSlot::Body).is_none());
    }

    #[test]
    fn equip_and_unequip() {
        let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon]);
        assert!(slots.equip(EquipSlot::Weapon, 5).is_ok());
        assert_eq!(slots.equipped_in(&EquipSlot::Weapon), Some(5));
        assert!(slots.is_equipped(&5));
        assert_eq!(slots.unequip(&EquipSlot::Weapon), Some(5));
        assert!(slots.equipped_in(&EquipSlot::Weapon).is_none());
        assert!(!slots.is_equipped(&5));
    }

    #[test]
    fn equip_into_occupied_slot_fails() {
        let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon]);
        slots.equip(EquipSlot::Weapon, 1).unwrap();
        assert_eq!(slots.equip(EquipSlot::Weapon, 2), Err(EquipError::SlotFull));
    }

    #[test]
    fn equip_invalid_slot_fails() {
        let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon]);
        assert_eq!(slots.equip(EquipSlot::Head, 1), Err(EquipError::InvalidSlot));
    }

    #[test]
    fn swap_slots() {
        let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon, EquipSlot::Body]);
        slots.equip(EquipSlot::Weapon, 1).unwrap();
        slots.equip(EquipSlot::Body, 2).unwrap();
        slots.swap(&EquipSlot::Weapon, &EquipSlot::Body).unwrap();
        assert_eq!(slots.equipped_in(&EquipSlot::Weapon), Some(2));
        assert_eq!(slots.equipped_in(&EquipSlot::Body), Some(1));
    }

    #[test]
    fn clear_equipment() {
        let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon, EquipSlot::Body]);
        slots.equip(EquipSlot::Weapon, 1).unwrap();
        slots.equip(EquipSlot::Body, 2).unwrap();
        let items = slots.clear();
        assert_eq!(items.len(), 2);
        assert!(items.contains(&1));
        assert!(items.contains(&2));
        assert!(slots.equipped_in(&EquipSlot::Weapon).is_none());
        assert!(slots.equipped_in(&EquipSlot::Body).is_none());
    }

    #[test]
    fn all_equipped_returns_only_occupied() {
        let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
            EquipmentSlots::new(&[EquipSlot::Weapon, EquipSlot::Body, EquipSlot::Head]);
        slots.equip(EquipSlot::Weapon, 1).unwrap();
        slots.equip(EquipSlot::Head, 3).unwrap();
        let all = slots.all_equipped();
        assert_eq!(all.len(), 2);
        assert!(all.contains(&1));
        assert!(all.contains(&3));
        assert!(!all.contains(&2));
    }

    #[test]
    fn from_pairs_initializes_correctly() {
        let slots: EquipmentSlots<u8, EquipSlot<()>> = EquipmentSlots::from_pairs(vec![
            (EquipSlot::Weapon, Some(10)),
            (EquipSlot::Body, None),
        ]);
        assert_eq!(slots.equipped_in(&EquipSlot::Weapon), Some(10));
        assert!(slots.equipped_in(&EquipSlot::Body).is_none());
    }

    // ── Tests: Inventory capacities ─────────────────────────────────

    type TestInventory = Inventory<MockItem, ItemKind<MockCustomKind>>;

    #[test]
    fn inventory_unlimited_by_default() {
        let mut inv = TestInventory::new();
        for i in 0..100u8 {
            assert!(inv.add(MockItem::Potion, 10).is_ok());
        }
        assert_eq!(inv.quantity(&MockItem::Potion), 1000);
    }

    #[test]
    fn inventory_with_capacity_rejects_new_slots_when_full() {
        let mut inv = TestInventory::with_capacity(1, 0); // 1 slot max
        assert!(inv.add(MockItem::Potion, 5).is_ok());
        assert!(inv.is_full());
        assert_eq!(inv.add(MockItem::Antidote, 3), Err(AddError::InventoryFull));
    }

    #[test]
    fn inventory_per_slot_cap() {
        let mut inv = TestInventory::with_capacity(0, 10); // max 10 per slot
        assert!(inv.add(MockItem::Potion, 10).is_ok());
        assert!(inv.would_exceed_per_slot_cap(&MockItem::Potion, 1));
        assert_eq!(
            inv.add(MockItem::Potion, 1),
            Err(AddError::PerSlotCapReached(10))
        );
    }

    #[test]
    fn inventory_add_merges_existing() {
        let mut inv = TestInventory::new();
        assert!(inv.add(MockItem::Potion, 5).is_ok());
        assert!(inv.add(MockItem::Potion, 3).is_ok());
        assert_eq!(inv.quantity(&MockItem::Potion), 8);
        assert_eq!(inv.count(), 1); // still 1 slot
    }

    #[test]
    fn inventory_remove_decrements() {
        let mut inv = TestInventory::new();
        inv.add(MockItem::Potion, 10).unwrap();
        assert!(inv.remove(&MockItem::Potion, 3));
        assert_eq!(inv.quantity(&MockItem::Potion), 7);
        assert!(inv.contains(&MockItem::Potion, 7));
        assert!(!inv.contains(&MockItem::Potion, 8));
    }

    #[test]
    fn inventory_remove_exact_removes_slot() {
        let mut inv = TestInventory::new();
        inv.add(MockItem::Potion, 5).unwrap();
        assert!(inv.remove(&MockItem::Potion, 5));
        assert_eq!(inv.count(), 0);
        assert_eq!(inv.quantity(&MockItem::Potion), 0);
    }

    #[test]
    fn inventory_remove_insufficient_fails() {
        let mut inv = TestInventory::new();
        inv.add(MockItem::Potion, 3).unwrap();
        assert!(!inv.remove(&MockItem::Potion, 5));
        assert_eq!(inv.quantity(&MockItem::Potion), 3); // unchanged
    }

    #[test]
    fn inventory_remove_nonexistent_fails() {
        let mut inv = TestInventory::new();
        assert!(!inv.remove(&MockItem::Potion, 1));
    }

    #[test]
    fn inventory_filter_by_predicate() {
        let mut inv = TestInventory::new();
        inv.add(MockItem::Potion, 5).unwrap();
        inv.add(MockItem::Antidote, 3).unwrap();
        inv.add(MockItem::FireStone, 1).unwrap();

        let healing: Vec<_> = inv.filter(|i| matches!(i, MockItem::Potion | MockItem::Antidote));
        assert_eq!(healing.len(), 2);
    }

    #[test]
    fn inventory_sort_by_name() {
        let mut inv = TestInventory::new();
        inv.add(MockItem::FireStone, 1).unwrap();
        inv.add(MockItem::Potion, 5).unwrap();
        inv.add(MockItem::Bicycle, 1).unwrap();
        inv.sort_by_name(|item| match item {
            MockItem::Bicycle => "Bicycle",
            MockItem::FireStone => "Fire Stone",
            MockItem::Potion => "Potion",
            _ => "?",
        });
        let names: Vec<&str> = inv.iter().map(|(i, _)| match i {
            MockItem::Bicycle => "Bicycle",
            MockItem::FireStone => "Fire Stone",
            MockItem::Potion => "Potion",
            _ => "?",
        }).collect();
        assert_eq!(names, vec!["Bicycle", "Fire Stone", "Potion"]);
    }

    #[test]
    fn inventory_into_inner_consumes() {
        let mut inv = TestInventory::new();
        inv.add(MockItem::Potion, 5).unwrap();
        inv.add(MockItem::Antidote, 3).unwrap();
        let inner = inv.into_inner();
        assert_eq!(inner.len(), 2);
    }

    #[test]
    fn inventory_add_zero_quantity_is_noop() {
        let mut inv = TestInventory::new();
        assert!(inv.add(MockItem::Potion, 0).is_ok());
        assert_eq!(inv.count(), 0);
    }

    // ── Tests: Custom item kind ─────────────────────────────────────

    #[test]
    fn custom_kind_defines_own_defaults() {
        let kind = ItemKind::Custom(MockCustomKind);
        // Custom kind defaults are optimistic (sellable, stackable, consumable)
        assert!(kind.default_sellable());
        assert!(kind.default_stackable());
        assert!(kind.default_consumed_on_use());
        assert!(kind.default_discardable());
    }

    // ── Tests: EquipSlot labels ─────────────────────────────────────

    #[test]
    fn equip_slot_labels() {
        assert_eq!(EquipSlot::<()>::Weapon.label(), "Weapon");
        assert_eq!(EquipSlot::<()>::Head.label(), "Head");
        assert_eq!(EquipSlot::<()>::Body.label(), "Body");
        assert_eq!(EquipSlot::<()>::Accessory1.label(), "Accessory");
        assert_eq!(EquipSlot::<()>::HeldItem.label(), "Held Item");
    }

    // ── Tests: UsageContext allows ───────────────────────────────────

    #[test]
    fn usage_context_never_blocks_all() {
        assert!(!UsageContext::FieldOnly.allows(UsageContext::Never));
        assert!(!UsageContext::BattleOnly.allows(UsageContext::Never));
        assert!(!UsageContext::MenuOnly.allows(UsageContext::Never));
    }

    #[test]
    fn usage_context_field_only_allows_field() {
        assert!(UsageContext::FieldOnly.allows(UsageContext::FieldOnly));
        assert!(UsageContext::FieldOnly.allows(UsageContext::FieldAndBattle));
        assert!(!UsageContext::FieldOnly.allows(UsageContext::BattleOnly));
        assert!(!UsageContext::FieldOnly.allows(UsageContext::MenuOnly));
    }

    #[test]
    fn usage_context_battle_only_allows_battle() {
        assert!(UsageContext::BattleOnly.allows(UsageContext::BattleOnly));
        assert!(UsageContext::BattleOnly.allows(UsageContext::FieldAndBattle));
        assert!(!UsageContext::BattleOnly.allows(UsageContext::FieldOnly));
        assert!(!UsageContext::BattleOnly.allows(UsageContext::MenuOnly));
    }

    #[test]
    fn usage_context_menu_only_allows_menu_only() {
        assert!(UsageContext::MenuOnly.allows(UsageContext::MenuOnly));
        assert!(!UsageContext::MenuOnly.allows(UsageContext::FieldOnly));
        assert!(!UsageContext::MenuOnly.allows(UsageContext::BattleOnly));
        assert!(!UsageContext::MenuOnly.allows(UsageContext::FieldAndBattle));
    }

    // ── Tests: ShopProvider defaults ────────────────────────────────

    #[test]
    fn shop_default_discount_is_1x() {
        struct NoDiscount;
        impl ShopProvider for NoDiscount {
            type Item = u8;
            type ShopId = u8;
            fn shop_inventory(&self, _id: &u8) -> Vec<(u8, u32)> { vec![] }
            fn shop_name(&self, _id: &u8) -> &str { "Shop" }
        }
        let p = NoDiscount;
        assert!((p.discount_rate(&0) - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn shop_default_sell_rate_is_half() {
        struct HalfRate;
        impl ShopProvider for HalfRate {
            type Item = u8;
            type ShopId = u8;
            fn shop_inventory(&self, _id: &u8) -> Vec<(u8, u32)> { vec![] }
            fn shop_name(&self, _id: &u8) -> &str { "Shop" }
            fn buy_price(&self, _item: &u8) -> u32 { 100 }
        }
        let p = HalfRate;
        assert!((p.sell_rate(&0) - 0.5).abs() < f32::EPSILON);
        assert_eq!(p.sell_price(&1), 50);
    }
}
```

### 8.2 集成测试（游戏层 + 引擎层）

```rust
// tests/integration/item_system_integration.rs

use jrpg_engine::items::*;

// Use the existing mock types from `pokered-data` tests or engine tests

#[test]
fn full_item_use_flow() {
    // Arrange: game provider, inventory with items, target monster
    // Act: call use_item() through the engine driver
    // Assert: correct ItemUseResult, inventory mutated appropriately
}

#[test]
fn equipment_affects_stats() {
    // Arrange: monster, equipment slots, equipment provider
    // Act: equip an item that gives +5 ATK
    // Assert: monster's ATK increases by 5
}

#[test]
fn shop_buy_with_discount() {
    // Arrange: shop with 20% discount on Potions (price 300, actual 240)
    // Act: buy 1 Potion
    // Assert: paid 240, received 1 Potion
}

#[test]
fn shop_limited_stock() {
    // Arrange: shop with limited stock (3 Potions)
    // Act: buy 4 Potions
    // Assert: 3rd buy succeeds, 4th fails (out of stock)
}

#[test]
fn key_item_cannot_be_sold() {
    // Arrange: player has Bicycle (key item)
    // Act: try to sell Bicycle via sell()
    // Assert: Err(ShopError::CannotSell)
}

#[test]
fn evolution_item_triggers_evolve() {
    // Arrange: provider with FireStone -> Charmander -> Charmeleon evolution
    // Act: use_item(FireStone, target = Charmander)
    // Assert: EvolutionTriggered, item not consumed yet
}

#[test]
fn tm_teaches_move() {
    // Arrange: provider with TM01 (Mega Punch), monster with < 4 moves
    // Act: use_item(TM01, target = monster)
    // Assert: MoveLearned, monster now has Mega Punch
}

#[test]
fn inventory_unlimited_by_default() {
    // Arrange: Inventory::new() (no capacity limits)
    // Act: add 1000 different items
    // Assert: all succeed
    let mut inv: Inventory<u8, ()> = Inventory::new();
    for i in 0..1000u8 {
        assert!(inv.add(i, 99).is_ok());
    }
    assert_eq!(inv.count(), 1000);
}

#[test]
fn rare_candy_levels_up() {
    // Arrange: monster at level 5 with exp curve
    // Act: use Rare Candy
    // Assert: monster levels up, stats recalculated
}
```

### 8.3 测试覆盖目标

| 测试类别 | 目标覆盖率 | 关键测试点 | 当前状态 |
|----------|-----------|-----------|---------|
| `ItemKind` 默认行为 | 100% | 每个变体的 `sellable`、`stackable`、`consumable`、`discardable` | ✅ 12 个测试 |
| `EquipSlot` / `EquipmentSlots` | 100% | 装备、卸装、交换、清空、满槽拒绝、无效槽位、`all_equipped`、`from_pairs`、`is_equipped` | ✅ 10 个测试 |
| `Inventory` 增强 | 100% | 容量限制、过滤、排序、per-slot cap、无限制默认、合并、移除、`into_inner` | ✅ 12 个测试 |
| `UsageContext` 门控 | 100% | `Never` 阻断、`FieldOnly`/`BattleOnly`/`MenuOnly`/`FieldAndBattle` 的 `allows` 矩阵 | ✅ 4 个测试 |
| `ShopProvider` 增强 | 100% | 折扣、库存限制、补货、出售禁止 | ✅ 2 个测试 |
| 进化道具流程 | 100% | `EvolutionTriggered` 结果、未消耗、确认后消耗 | 待实现 |
| 技能学习道具 | 100% | `MoveLearned` 结果、满技能覆盖流程 | 待实现 |
| 向后兼容性 | 关键路径 | 现有代码无需修改即可编译通过 | 待实现 |
| 游戏层实现 | Smoke test | Pokémon 和 FF 示例实现的关键方法 | 待实现 |

**总计：40+ 个单元测试覆盖引擎层核心类型。**

---

## 附录 A: 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `crates/jrpg-engine/src/items/kind.rs` | **新增** | `ItemKind` 枚举 |
| `crates/jrpg-engine/src/items/equip.rs` | **新增** | `EquipSlot`、`EquipmentSlots`、`EquipError` |
| `crates/jrpg-engine/src/items/mod.rs` | **修改** | 新增 `pub mod kind;`、`pub mod equip;`；增强 `Inventory` 签名；增强 `ItemProvider`、`ShopProvider` |
| `crates/jrpg-engine/src/items/use_driver.rs` | **修改** | `ItemUseResult` 泛型化、增强 `use_item` 派发、增强 `buy`/`sell` 支持折扣与库存 |
| `crates/jrpg-engine/src/lib.rs` | **免修改** | `GameData` 的关联类型已包含 `Item`，新增方法将在后续迭代添加 |
| `examples/pokered/src/items.rs` | **修改** | 适配新 `ItemProvider` 关联类型和 `item_kind()` |
| `.sisyphus/drafts/item-system-design.md` | **新增** | 本文档 |

## 附录 B: 关键决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| `ItemKind` 放在引擎还是游戏层？ | 引擎 / 游戏 | 引擎 | 引擎需要在标准行为（出售、丢弃、堆叠）上做门控，枚举的每个变体有引擎级默认值 |
| `ItemKind` 的 `Custom` 变体 | 无 / 泛型 | 泛型 `Custom(Id)` | 游戏需要扩展分类（如区分 TM/HM），泛型参数最灵活 |
| `Ball` 是否应该内置？ | 内置 / Custom | Custom | 精灵球/捕获装置是 Pokemon 特化机制，不是通用 JRPG 概念；通过 `Custom(GameKind::Ball)` 实现 |
| `apply_effect` 是否需要 `MonsterProvider` 参数？ | 是 / 否 | 是 | 游戏层需要通过 `provider.hp_stat()` 和 `mon.max_hp(provider)` 访问最大 HP、属性等数据；没有 provider 则无法实现 HP 恢复、状态治疗等核心功能 |
| 装备系统是否应该管理 stat bonuses？ | 引擎计算 / 游戏回调 | 引擎提供 `stat_bonuses`，游戏负责应用 | 引擎不知道游戏的 stat 类型，无法计算；游戏调用 `stat_bonuses` 后自己加到怪物属性上 |
| `ItemUseResult` 是否应包含 `EvolutionTriggered`？ | 是 / 否 | 是 | 让引擎的 `use_item` 驱动能区分进化道具，以便在进化确认前不消耗道具 |
| `Inventory` 的第二个泛型参数 | 仅 `K` / 更多 | 仅 `K` (ItemKind) | 最小化泛型复杂性，过滤和排序通过闭包而非泛型实现 |
| 向后兼容策略 | 破坏性 / 加法 | 加法优先 | 所有新方法提供默认实现，新关联类型使用 `()` 作为占位 |
| 装备 API 放哪？ | `ItemProvider` 方法 / 独立 trait | 独立 `EquipProvider` trait | 无装备的游戏零成本（不声明 `CustomSlot`/`Stat` 占位）；且 `stat_bonuses` 必须用关联类型 `type Stat` —— 泛型方法参数由调用方选类型，实现方只能返回空切片，API 不可实现 |
| 进化道具是否要专用 hook？ | `on_evolve` hook / 走 `apply_effect` | 走 `apply_effect` | 专用 hook 会把 `M: EvolutionProvider + EvoItem: From<Item>` 约束传染给所有 `use_item` 调用方（用个药水也要满足）；改为 `apply_effect` 返回 `EvolutionTriggered`，引擎契约只剩"该结果不消耗" |
| `sell_rate` 默认值 | 0.5 / 1.0 | 1.0 | Gen-1 半价已编码在 `sell_price` 默认实现（`buy_price / 2`）中，两者相乘会变成 1/4 价；`sell_rate` 是叠加在 `sell_price` 之上的每店倍率 |
| `buy()` 背包满时 | 忽略 add 失败 / 先验证再扣钱 | 先 add 成功再扣钱 | 容量受限的 `Inventory` 的 `add` 可能失败；静默忽略会扣钱不给货。失败返回 `ShopError::InventoryFull`，金钱不动 |
