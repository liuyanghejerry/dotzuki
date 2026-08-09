# Pokémon Red/Blue 道具系统迁移计划

> 将 pokered 道具系统从现有实现迁移到 `jrpg-engine` 的通用 `ItemKind`/`EquipSlot`/增强 `Inventory`/增强 `ItemProvider` 架构
> 基于设计文档：`.sisyphus/drafts/item-system-design.md`

---

## 1. TL;DR

将 pokered 的道具系统从"两种 `Inventory` + 死代码 `ItemEffect` + 缺少 `MonsterProvider` 参数"的状态，迁移到引擎层提供通用类型、游戏层实现具体策略的架构。核心变更：新增 `kind.rs`/`equip.rs`，增强 `Inventory`/`ItemProvider`/`ShopProvider`/`ItemUseResult`，统一两种 `Inventory` 类型，修复 known divergence（status cure on fainted）。**11 个实现任务 + 2 个验证任务，分 3 波并行执行 + 1 波最终验证。**

---

## 2. Context（现状分析）

### 2.1 引擎层 (`crates/jrpg-engine/src/items/`)

| 文件 | 行数 | 当前状态 | 问题 |
|------|------|----------|------|
| `mod.rs` | 555 | `ItemProvider` trait, `ShopProvider` trait, `Inventory<I>` (无K参数, 无容量限制) | 缺少 `ItemKind`, 缺少 `EquipSlot`, `Inventory` 无 `K` 泛型参数 |
| `use_driver.rs` | 678 | `use_item()`, `buy()`, `sell()` 函数, `ItemUseResult` | `apply_effect` 没有 `provider: &M` 参数, `ItemUseResult` 无 `EvolutionTriggered`/`MoveLearned` 变体 |
| **缺失**: `kind.rs` | - | 不存在 | 需要新增 `ItemKind<Id>` 枚举 |
| **缺失**: `equip.rs` | - | 不存在 | 需要新增 `EquipSlot<Id>`, `EquipmentSlots<I,S>` |

### 2.2 游戏数据层 (`examples/pokered/crates/pokered-data/src/`)

| 文件 | 行数 | 当前状态 | 问题 |
|------|------|----------|------|
| `items.rs` | 448 | `ItemId` 枚举 (83个道具), `ItemEffect` 枚举, `ShopId` | `ItemEffect` 是死代码 (定义但未被任何 dispatcher 使用) |
| `item_data.rs` | 79 | `ItemData` 结构体 (仅 id/name/price/is_key_item) | 缺少 `kind` 字段, 缺少 heal/status/pp 等效果数据 |

### 2.3 游戏核心层 (`examples/pokered/crates/pokered-core/src/items/`)

| 文件 | 行数 | 当前状态 | 问题 |
|------|------|----------|------|
| `use_engine.rs` | 695 | `PokeItemProvider`, `apply_to_pokemon()` dispatcher | `apply_effect` 无 `provider` 参数, HP/PP/vitamins 走旧路径返回 `NoEffect` |
| `healing.rs` | ~200 | HP 恢复逻辑 (Potion=20, Super=50, Hyper=200, Max=full) | 依赖 `Pokemon` 具体类型 |
| `status_cure.rs` | ~200 | 状态治疗 (Antidote, BurnHeal 等) | 可被引擎泛化 |
| `pp_restore.rs` | ~150 | PP 恢复 (Ether=+10, Max=full, Elixir=all) | 依赖 `Pokemon` 具体类型 |
| `vitamins.rs` | ~150 | 维生素 (+2560 stat-exp, cap 25600) + Rare Candy | 依赖 `Pokemon` 具体类型 |
| `inventory.rs` | 183 | pokered 自己的 `Inventory` (20 槽, max 99/槽) | **与引擎的 `Inventory<I>` 重复** |
| `shop.rs` | 770 | Mart 状态机 + 买卖函数 | 依赖 pokered 自己的 `Inventory` |

### 2.4 关键问题清单

1. **`apply_effect` 缺少 `MonsterProvider` 参数**: 无法调用 `mon.max_hp(provider)`，导致 HP 治疗无法实现
2. **HP/PP/vitamins 通过 `apply_effect` 返回 `NoEffect`**: 使用旧 `use_on_monster()` 路径，实际效果从引擎驱动不可见
3. **两种 `Inventory` 类型**: 引擎的 `Inventory<I>` 无容量限制，pokered 的 `Inventory` 有 20 槽/99 上限逻辑，代码重复
4. **`ItemEffect` 枚举是死代码**: 定义在 pokered-data 但未被任何 dispatcher 使用
5. **Status cure 对 fainted mon 有已知偏差**: `status_cured_by()` 使用满 HP 的 scratch Pokemon 探测，绕过了 `hp == 0` 的 guard

---

## 3. Work Objectives

### 3.1 核心目标

将 pokered 道具系统完整迁移到 `jrpg-engine` 的通用 `ItemKind`/`EquipSlot`/增强 `Inventory`/增强 `ItemProvider` 架构，消除代码重复和已知偏差。

### 3.2 交付物

- `crates/jrpg-engine/src/items/kind.rs` — `ItemKind<Id>` 枚举
- `crates/jrpg-engine/src/items/equip.rs` — `EquipSlot<Id>`, `EquipmentSlots<I,S>`, `EquipError`
- `crates/jrpg-engine/src/items/mod.rs` — 增强 `Inventory<I,K>` (容量/过滤/排序), 增强 `ItemProvider`, 增强 `ShopProvider`
- `crates/jrpg-engine/src/items/use_driver.rs` — 增强 `ItemUseResult<I>` (新变体), 增强 `use_item()` (ItemKind dispatch), 增强 `buy()`/`sell()`
- `examples/pokered/crates/pokered-data/src/items.rs` — 适配 `CustomKind`, `item_kind()` 等
- `examples/pokered/crates/pokered-core/src/items/use_engine.rs` — 统一到 `apply_effect` 路径, 添加 `provider` 参数
- 统一后的单一 `Inventory` 类型
- 修复 status cure on fainted divergence

### 3.3 Definition of Done

- [ ] `cargo build` 在 `jrpg-engine` 和所有 `pokered-*` crate 上通过
- [ ] `cargo test -p jrpg-engine` 全部通过(引擎层测试 + 新增测试)
- [ ] `cargo test -p pokered-data` 全部通过
- [ ] `cargo test -p pokered-core` 全部通过(包括 item 模块的 parity tests)
- [ ] `make compare` (pokered worktree) 已验证 SHA1 不变
- [ ] 已知偏差 `cure_item_on_fainted_target_documents_known_divergence` 被修复或明确记录

### 3.4 Must Have

- `ItemKind<Id>` 枚举 (7 个标准变体 + `Custom(Id)`)
- `EquipSlot<Id>` + `EquipmentSlots<I,S>` (基础装备管理)
- `Inventory<I,K>` 增强 (容量限制、过滤、排序、`AddError`)
- `ItemUseResult<I>` 增强 (新增 `EvolutionTriggered`, `MoveLearned`)
- `ItemProvider` 增强 (新增 `CustomKind`, `CustomSlot` 关联类型; 新增 `item_kind`, `equip_slots`, `stat_bonuses`, `on_teach_move`, `on_evolve`, `on_use_field`; `apply_effect` 添加 `provider: &M` 参数)
- `ShopProvider` 增强 (新增 `discount_rate`, `sell_rate`, `has_limited_stock`, `max_stock`, `restocks`, `restock_interval`)
- `use_item()` 增强 (ItemKind 驱动的 dispatch)
- pokered-data 适配 (CustomKind 定义, `item_kind` 实现)
- pokered-core `apply_effect` 适配 (添加 provider 参数, HP 治疗使用 `max_hp(provider)`)
- 统一两种 Inventory 类型
- 修复 status cure on fainted divergence

### 3.5 Must NOT Have

- **不修改** `crates/jrpg-engine/src/lib.rs` 的 `GameData` trait (后续迭代)
- **不修改** `crates/jrpg-engine/src/party/` 的 `MonsterProvider` 或 `MonsterInstance`
- **不修改** `crates/jrpg-engine/src/battle/` 的 `BattleAction` 或 `BattleRng`
- **不修改** `crates/jrpg-engine/src/save/` 的 SaveData
- **不实现** UI 渲染变更 (装备菜单、背包 UI 等属于游戏层)
- **不删除** 旧 API (`use_on_monster`, `can_use_outside_battle`, `ItemResult`) — 仅添加 `#[deprecated]` 标记（可选）

---

## 4. Verification Strategy

### 4.1 逐层验证命令

```bash
# 引擎层
cargo test -p jrpg-engine                                # 全部引擎测试
cargo test -p jrpg-engine -- items::tests                # Inventory 测试
cargo test -p jrpg-engine -- items::use_driver::tests    # use_item/buy/sell 测试

# 游戏数据层
cargo test -p pokered-data                               # 数据层测试

# 游戏核心层
cargo test -p pokered-core                               # 全部核心测试
cargo test -p pokered-core -- items::use_engine::tests   # ItemProvider parity tests
cargo test -p pokered-core -- items::healing_tests       # 治疗测试
cargo test -p pokered-core -- items::status_cure_tests   # 状态治疗测试
cargo test -p pokered-core -- items::pp_restore_tests    # PP 恢复测试
cargo test -p pokered-core -- items::vitamins_tests      # 维生素测试
cargo test -p pokered-core -- items::inventory_tests     # Inventory 测试
cargo test -p pokered-core -- items::shop_tests          # 商店测试

# 最终全量验证
cargo test --workspace                                   # 全 workspace 测试
```

### 4.2 QA 策略

1. **每任务执行完** → `cargo test -p <affected-crate>` 验证
2. **每 Wave 结束后** → `cargo test --workspace` 全量验证
3. **最终验证** → 全量 test + `cargo build --workspace` + 确认已知偏差测试被修复或更新
4. **不允许**跳过任何测试失败

---

## 5. Execution Strategy

### 5.1 并行波次

```
Wave 1 (引擎类型 - 完全并行)
  ├── Task 1: kind.rs      [无依赖]
  ├── Task 2: equip.rs     [无依赖]
  ├── Task 3: Inventory    [无依赖]
  └── Task 4: ItemUseResult [无依赖]

Wave 2 (引擎特质 - 完全并行)
  ├── Task 5: ItemProvider [依赖 Task 1, 2, 3, 4]
  ├── Task 6: ShopProvider [依赖 Task 3]
  └── Task 7: use_item()   [依赖 Task 4, 5, 6]

Wave 3 (游戏层 - 混合并行)
  ├── Task 8: pokered-data adaptation  [依赖 Task 5]
  ├── Task 9: pokered-core adaptation  [依赖 Task 8]
  ├── Task 10: 统一 Inventory 类型     [依赖 Task 3, 9]
  └── Task 11: 修复 status cure divergence [依赖 Task 9]

Wave FINAL (串行)
  ├── Task F1: 全量测试验证
  └── Task F2: 文档更新
```

### 5.2 依赖矩阵

| Task | 依赖 | 被依赖 | 并行伙伴 |
|------|------|--------|----------|
| T1 (kind.rs) | 无 | T5 | T2,T3,T4 |
| T2 (equip.rs) | 无 | T5 | T1,T3,T4 |
| T3 (Inventory) | 无 | T5,T6,T10 | T1,T2,T4 |
| T4 (ItemUseResult) | 无 | T5,T7 | T1,T2,T3 |
| T5 (ItemProvider) | T1,T2,T3,T4 | T7,T8 | T6 |
| T6 (ShopProvider) | T3 | T7 | T5 |
| T7 (use_item) | T4,T5,T6 | - | - |
| T8 (pokered-data) | T5 | T9 | - |
| T9 (pokered-core) | T8 | T10,T11 | - |
| T10 (统一Inventory) | T3,T9 | - | T11 |
| T11 (fix divergence) | T9 | - | T10 |

---

## 6. TODOs

---

### Wave 1: 引擎类型（完全并行，4 任务）

#### Task 1: 新增 `kind.rs` — `ItemKind` 枚举

**What to do:**
- 创建 `crates/jrpg-engine/src/items/kind.rs`
- 定义 `ItemKind<Id: Copy + Eq + Hash + Debug>` 枚举，包含 7 个标准变体 + `Custom(Id)`：
  - `Consumable`, `Equipment`, `KeyItem`, `Evolution`, `StatBoost`, `Currency`, `TeachMove`, `Custom(Id)`
- 实现 `default_sellable()`, `default_discardable()`, `default_stackable()`, `default_consumed_on_use()` 方法
- 在 `mod.rs` 中添加 `pub mod kind;`
- 添加 `#[cfg(test)]` 测试(每个变体的默认行为验证)

**Must NOT do:**
- 不要添加任何游戏特定的逻辑
- 不要修改现有文件（除 `mod.rs` 添加 `pub mod kind;` 外）
- 不要让 `ItemKind` 依赖于 `ItemProvider` 或任何 trait

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 🔥 可与 T2, T3, T4 完全并行

**References:**
- 设计文档 `kind.rs` 节: `.sisyphus/drafts/item-system-design.md#41-itemkind--道具分类枚举` (L197-291)
- 目标位置: `crates/jrpg-engine/src/items/kind.rs`
- 父模块: `crates/jrpg-engine/src/items/mod.rs` (L1, 添加 `pub mod kind;`)
- 设计文档测试节: L1916-1974 (ItemKind defaults 测试)

**Acceptance criteria:**
- `kind.rs` 编译通过
- `cargo test -p jrpg-engine` 中新的 ItemKind 测试全部通过
- `ItemKind::<()>::Consumable.default_sellable()` 返回 `true`
- `ItemKind::<()>::KeyItem.default_sellable()` 返回 `false`

**QA scenarios:**

```rust
// 1. ItemKind 编译
let kind: ItemKind<()> = ItemKind::Consumable;
assert!(kind.default_sellable());

// 2. Custom 变体泛型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum MyCustom { Ball }
let kind: ItemKind<MyCustom> = ItemKind::Custom(MyCustom::Ball);
assert!(kind.default_sellable()); // optimistic

// 3. KeyItem 不可出售
assert!(!ItemKind::<()>::KeyItem.default_sellable());
assert!(!ItemKind::<()>::KeyItem.default_discardable());
```

**Commands:**
```bash
cargo test -p jrpg-engine -- items::kind::tests   # 运行 kind 测试
```

**Commit message:**
```
feat(jrpg-engine): add ItemKind enum (#T1)

- ItemKind<Id> with 7 standard variants + Custom(Id)
- Default behavior methods: sellable, discardable, stackable, consumed_on_use
- Unit tests for each variant's defaults
```

---

#### Task 2: 新增 `equip.rs` — `EquipSlot` 和 `EquipmentSlots`

**What to do:**
- 创建 `crates/jrpg-engine/src/items/equip.rs`
- 定义 `EquipSlot<Id: Copy + Eq + Hash + Debug>` 枚举：
  - `Weapon`, `Head`, `Body`, `Accessory1`, `Accessory2`, `HeldItem`, `Custom(Id)`
- 实现 `EquipSlot::standard()`, `EquipSlot::label()`
- 定义 `EquipmentSlots<I, S>` 结构体：
  - `new(slots: &[S])`, `from_pairs()`, `equipped_in()`, `all_equipped()`, `is_equipped()`
  - `equip()`, `unequip()`, `swap()`, `clear()`, `iter()`
- 定义 `EquipError` 枚举 (`SlotFull`, `InvalidSlot`)
- 在 `mod.rs` 中添加 `pub mod equip;`
- 添加完整测试

**Must NOT do:**
- 不要实现 stat bonus 计算（引擎只提供 `stat_bonuses` 查询，游戏负责应用）
- 不要添加任何游戏特定的装备逻辑

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 🔥 可与 T1, T3, T4 完全并行

**References:**
- 设计文档 `equip.rs` 节: `.sisyphus/drafts/item-system-design.md#42-equipslot--装备槽位枚举` (L294-353)
- 设计文档 `EquipmentSlots` 节: L588-701
- 设计文档测试节: L1983-2065 (10 个测试)
- 目标位置: `crates/jrpg-engine/src/items/equip.rs`

**Acceptance criteria:**
- `equip.rs` 编译通过
- 所有 EquipmentSlots 操作（equip/unequip/swap/clear）测试通过
- 边界情况：满槽拒绝、无效槽位拒绝

**QA scenarios:**

```rust
// 1. 基本装备流程
let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
    EquipmentSlots::new(&[EquipSlot::Weapon]);
assert!(slots.equip(EquipSlot::Weapon, 5).is_ok());
assert_eq!(slots.equipped_in(&EquipSlot::Weapon), Some(5));
assert_eq!(slots.unequip(&EquipSlot::Weapon), Some(5));

// 2. 满槽拒绝
let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
    EquipmentSlots::new(&[EquipSlot::Weapon]);
slots.equip(EquipSlot::Weapon, 1).unwrap();
assert_eq!(slots.equip(EquipSlot::Weapon, 2), Err(EquipError::SlotFull));

// 3. 无效槽位拒绝
let mut slots: EquipmentSlots<u8, EquipSlot<()>> =
    EquipmentSlots::new(&[EquipSlot::Weapon]);
assert_eq!(slots.equip(EquipSlot::Head, 1), Err(EquipError::InvalidSlot));
```

**Commands:**
```bash
cargo test -p jrpg-engine -- items::equip::tests   # 运行 equip 测试
```

**Commit message:**
```
feat(jrpg-engine): add EquipSlot and EquipmentSlots (#T2)

- EquipSlot<Id> with Weapon, Head, Body, Accessory1/2, HeldItem, Custom
- EquipmentSlots<I, S> with equip/unequip/swap/clear operations
- EquipError enum (SlotFull, InvalidSlot)
- Unit tests for all operations and edge cases
```

---

#### Task 3: 增强 `Inventory` — 容量限制、过滤、排序

**What to do:**
- 修改 `crates/jrpg-engine/src/items/mod.rs`：
  - `Inventory<I>` → `Inventory<I, K>`（新增 `K` phantom type parameter）
  - 添加 `max_slots: usize` 和 `max_per_slot: u32` 字段
  - 添加 `with_capacity(max_slots, max_per_slot)` 构造函数
  - `add()` 返回 `Result<(), AddError>`（原有 `fn add(&mut self, item: I, quantity: u32)` 改为返回 Result）
  - 添加 `is_full()`, `would_exceed_per_slot_cap()`, `quantity()`
  - 添加 `filter()`, `filter_by_kind()`, `sort_by()`, `sort_by_name()`, `sort_by_kind()`
  - 添加 `iter()`, `into_inner()`, `max_slots()`, `max_per_slot()`
- 定义 `AddError` 枚举 (`InventoryFull`, `PerSlotCapReached(u32)`)
- 提供向后兼容类型别名 `pub type SimpleInventory<I> = Inventory<I, ()>;`
- 更新 `Default` impl
- 更新现有测试（`add()` 调用改为 `let _ = inv.add(...);` 或处理 Result）
- 添加新测试：容量限制、过滤、排序

**Must NOT do:**
- 不要修改 `pub items: Vec<(I, u32)>` 字段的可见性（如果有外部代码直接访问）
- 不要让 `K` 影响 Inventory 的序列化（只作为 phantom type）
- 不要删除旧的公开方法签名（如 `add` 从无返回值改为 `Result`，需要更新所有调用处）

**Breaking changes 注意：**
- `Inventory<I>` → `Inventory<I, K>` 需要更新所有实例化处
- `inv.add(item, qty)` 不再返回 `()`，而是 `Result<(), AddError>`
- 所有现有的 `Inventory<ItemId>` 需要改为 `Inventory<ItemId, SomeKindType>` 或使用 `SimpleInventory<ItemId>`

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 🔥 可与 T1, T2, T4 完全并行

**References:**
- 设计文档 `Inventory` 增强节: `.sisyphus/drafts/item-system-design.md#44-增强的-inventory--带容量过滤排序` (L379-585)
- 当前文件: `crates/jrpg-engine/src/items/mod.rs` (L60-128)
- 设计文档测试节: L2069-2187 (12 个测试)
- 受影响的调用处：
  - `crates/jrpg-engine/src/items/use_driver.rs`: `use_item()`, `buy()`, `sell()` 函数签名和内部 `inv.add()` 调用
  - `examples/pokered/crates/pokered-core/src/items/use_engine.rs`: `Inventory<ItemId>` 的用法

**Acceptance criteria:**
- 旧测试通过（调用处已更新为新的 Result 返回）
- 新增容量测试通过
- `Inventory::<(), ()>::new()` 保持向后兼容
- `SimpleInventory<ItemId>` 类型别名可用

**QA scenarios:**

```rust
// 1. 无容量限制（默认）
let mut inv: Inventory<u8, ()> = Inventory::new();
assert!(inv.add(1, 100).is_ok());

// 2. 容量限制
let mut inv: Inventory<u8, ()> = Inventory::with_capacity(1, 0);
assert!(inv.add(1, 5).is_ok());
assert!(inv.is_full());
assert_eq!(inv.add(2, 3), Err(AddError::InventoryFull));

// 3. Per-slot cap
let mut inv: Inventory<u8, ()> = Inventory::with_capacity(0, 10);
assert!(inv.add(1, 10).is_ok());
assert_eq!(inv.add(1, 1), Err(AddError::PerSlotCapReached(10)));

// 4. 过滤
let healing = inv.filter(|i| *i == 1);
```

**Commands:**
```bash
cargo test -p jrpg-engine                                   # 引擎全部测试
cargo test -p jrpg-engine -- items::tests::inventory_*      # 新 Inventory 测试
cargo test -p pokered-core                                  # 验证调用处已更新
```

**Commit message:**
```
feat(jrpg-engine): enhance Inventory with capacity, filtering, sorting (#T3)

- Inventory<I> → Inventory<I, K> with phantom type parameter
- AddError enum (InventoryFull, PerSlotCapReached)
- New methods: with_capacity, is_full, quantity, filter, sort_by_name, etc.
- Backward compat alias: SimpleInventory<I> = Inventory<I, ()>
- Update all call sites for new Result return type on add()
```

---

#### Task 4: 增强 `ItemUseResult` — 新增变体

**What to do:**
- 修改 `crates/jrpg-engine/src/items/use_driver.rs`：
  - `ItemUseResult` → `ItemUseResult<I: Copy + Eq + Hash + Debug>`（新增泛型参数）
  - 添加 `EvolutionTriggered { item: I, message_key: Option<String> }` 变体
  - 添加 `MoveLearned { consume: bool, message_key: Option<String> }` 变体
  - 更新 `ItemUseResult::consumes()` 方法以处理新变体
- 更新 `UsageContext` 添加 `MenuOnly` 变体（替代 `None` 为更精确的语义，保留 `None` 作为 deprecated 别名）
- 更新 `use_item()` 函数签名使用 `ItemUseResult<I::Item>`
- 更新 `use_item()` dispatch 逻辑以处理新变体
- 更新引擎层测试

**Must NOT do:**
- 不要修改 `ItemUseResult` 的 `consumes()` 之外的公开方法
- 不要将 `MenuOnly` 变体添加到 `allows()` 之外的其他逻辑中
- 不要删除 `None` 变体（保持向后兼容，可标记 `#[deprecated]`）

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 🔥 可与 T1, T2, T3 完全并行

**References:**
- 设计文档 `ItemUseResult` 增强节: L703-760
- 设计文档 `UsageContext` 增强节: L355-377
- 当前文件: `crates/jrpg-engine/src/items/use_driver.rs` (L63-98)
- 设计文档测试节: L2214-2243 (UsageContext allows 测试)

**Acceptance criteria:**
- `ItemUseResult<I>` 编译通过
- `EvolutionTriggered` 的 `consumes()` 返回 `false`
- `MoveLearned { consume: true }` 的 `consumes()` 返回 `true`
- 现有代码中 `ItemUseResult` 的所有 match 被更新（编译器会捕获所有 match）

**QA scenarios:**

```rust
// 1. EvolutionTriggered 不消耗
let result = ItemUseResult::<u8>::EvolutionTriggered {
    item: 5,
    message_key: None,
};
assert!(!result.consumes());

// 2. MoveLearned 根据 consume 标志
let result = ItemUseResult::<u8>::MoveLearned {
    consume: true,
    message_key: None,
};
assert!(result.consumes());

// 3. Applied 保持不变
let result = ItemUseResult::<u8>::Applied {
    consume: true,
    message_key: None,
};
assert!(result.consumes());
```

**Commands:**
```bash
cargo build -p jrpg-engine                                    # 确认编译通过
cargo test -p jrpg-engine -- items::use_driver::tests         # 运行 use_driver 测试
```

**Commit message:**
```
feat(jrpg-engine): enhance ItemUseResult with EvolutionTriggered and MoveLearned (#T4)

- ItemUseResult → ItemUseResult<I> with generic item type parameter
- New variants: EvolutionTriggered, MoveLearned
- UsageContext gains MenuOnly variant
- Updated consumes() for new variants
```

---

### Wave 2: 引擎特质（完全并行，3 任务）

#### Task 5: 增强 `ItemProvider` — 新关联类型和方法

**What to do:**
- 修改 `crates/jrpg-engine/src/items/mod.rs`：
  - 添加关联类型 `CustomKind: Copy + Eq + Hash + Debug`（默认不可推导，必须显式指定）
  - 添加关联类型 `CustomSlot: Copy + Eq + Hash + Debug`
  - 添加必需方法 `fn item_kind(&self, item: &Self::Item) -> ItemKind<Self::CustomKind>`
  - 更新 `apply_effect` 签名：添加 `provider: &M` 参数
    ```rust
    fn apply_effect<M: crate::party::MonsterProvider>(
        &self,
        provider: &M,
        item: Self::Item,
        ctx: UsageContext,
        target: Option<&mut crate::party::MonsterInstance<M>>,
        rng: &mut dyn crate::battle::rng::BattleRng,
    ) -> ItemUseResult<Self::Item>
    ```
  - 添加默认方法（有默认实现，向后兼容）：
    - `fn equip_slots(&self, item: &Self::Item) -> Vec<EquipSlot<Self::CustomSlot>>`
    - `fn stat_bonuses<Stat: Copy>(&self, item: &Self::Item) -> &[(Stat, i16)]`
    - `fn on_teach_move<M: MonsterProvider>(...) -> Option<ItemUseResult<Self::Item>>`
    - `fn on_evolve<M: EvolutionProvider>(...) -> Option<ItemUseResult<Self::Item>>`
    - `fn on_use_field(&self, item: Self::Item) -> Option<ItemUseResult<Self::Item>>`

**Must NOT do:**
- 不要删除任何现有方法
- 不要在引擎层实现任何游戏逻辑
- 不要修改 `ItemProvider` 之外的任何 trait

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 🔥 可与 T6 并行（但依赖 T1,T2,T3,T4）

**References:**
- 设计文档 `ItemProvider` 增强节: L762-927
- 当前文件: `crates/jrpg-engine/src/items/mod.rs` (L132-216)
- 依赖的任务: T1 (ItemKind), T2 (EquipSlot), T3 (Inventory), T4 (ItemUseResult)

**Acceptance criteria:**
- 所有现有 `ItemProvider` 实现编译通过（新关联类型使用 `()` 作为占位）
- 新的 `item_kind()` 方法可用
- `apply_effect` 接受 `provider: &M` 参数

**QA scenarios:**

```rust
// 1. 最小实现（使用 () 作为占位类型）
struct MinProvider;
impl ItemProvider for MinProvider {
    type Item = u8;
    type Effect = ();
    type Monster = ();
    type CustomKind = ();
    type CustomSlot = ();
    fn item_name(&self, _: &u8) -> &str { "x" }
    fn item_description(&self, _: &u8) -> &str { "" }
    fn item_effect(&self, _: &u8) {}
    fn item_price(&self, _: &u8) -> u32 { 0 }
    fn item_kind(&self, _: &u8) -> ItemKind<()> { ItemKind::Consumable }
    fn can_use_outside_battle(&self, _: &u8) -> bool { true }
    fn can_use_in_battle(&self, _: &u8) -> bool { true }
    fn use_on_monster(&self, _: &u8, _: &mut ()) -> ItemResult { ItemResult::NoEffect }
    fn consume(&self, _: &u8) -> bool { true }
}
```

**Commands:**
```bash
cargo build -p jrpg-engine                    # 确认编译
cargo test -p jrpg-engine                      # 确认测试通过
```

**Commit message:**
```
feat(jrpg-engine): enhance ItemProvider with kind, equip, evolution hooks (#T5)

- New associated types: CustomKind, CustomSlot
- New required method: item_kind()
- apply_effect now takes provider: &M parameter
- New defaulted methods: equip_slots, stat_bonuses, on_teach_move, on_evolve, on_use_field
```

---

#### Task 6: 增强 `ShopProvider` — 折扣和库存限制

**What to do:**
- 修改 `crates/jrpg-engine/src/items/mod.rs`：
  - 添加 `fn discount_rate(&self, _shop_id: &Self::ShopId) -> f32`（默认 1.0）
  - 添加 `fn sell_rate(&self, _shop_id: &Self::ShopId) -> f32`（默认 0.5）
  - 添加 `fn has_limited_stock(&self, _item: &Self::Item) -> bool`（默认 false）
  - 添加 `fn max_stock(&self, _item: &Self::Item) -> u32`（默认 0）
  - 添加 `fn restocks(&self, _shop_id: &Self::ShopId) -> bool`（默认 false）
  - 添加 `fn restock_interval(&self, _shop_id: &Self::ShopId) -> u32`（默认 0）
- 更新 `use_driver.rs` 中的 `buy()` 函数以应用折扣
- 更新 `sell()` 函数以应用 sell_rate

**Must NOT do:**
- 不要为引擎层添加库存追踪状态（库存管理属于游戏层或 save 系统）
- 不要使用 `f32` 进行金钱计算（保留整数运算，折扣仅作为建议）

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 🔥 可与 T5 并行（依赖 T3）

**References:**
- 设计文档 `ShopProvider` 增强节: L929-1011
- 当前文件: `crates/jrpg-engine/src/items/mod.rs` (L218-272)
- 设计文档测试节: L2245-2273 (2 个测试)

**Acceptance criteria:**
- 所有现有 `ShopProvider` 实现编译通过
- 新增方法有合理的默认值
- `buy()` 应用 `discount_rate`，`sell()` 应用 `sell_rate`

**QA scenarios:**

```rust
// 1. 折扣
let provider = /* shop with 20% discount */;
let price = provider.buy_price(&item);             // 100
let rate = provider.discount_rate(&shop_id);       // 0.8
let actual = (price as f32 * rate) as u32;         // 80

// 2. 限库存
assert!(provider.has_limited_stock(&item));
assert_eq!(provider.max_stock(&item), 5);
assert!(!provider.restocks(&shop_id));
```

**Commands:**
```bash
cargo build -p jrpg-engine
cargo test -p jrpg-engine -- items::use_driver::tests::buy_*
cargo test -p jrpg-engine -- items::use_driver::tests::sell_*
```

**Commit message:**
```
feat(jrpg-engine): enhance ShopProvider with discounts and stock limits (#T6)

- New methods: discount_rate, sell_rate, has_limited_stock, max_stock, restocks
- buy() applies discount_rate to buy_price
- sell() applies sell_rate to sell_price
- All new methods have safe defaults (1.0, false, 0, etc.)
```

---

#### Task 7: 增强 `use_item()` 驱动 — ItemKind dispatch

**What to do:**
- 修改 `crates/jrpg-engine/src/items/use_driver.rs`：
  - 更新 `use_item()` 函数签名：接受 `Inventory<I::Item, ItemKind<I::CustomKind>>` 和 `provider: &M`
  - 添加 `ItemKind` dispatch 逻辑：
    ```
    1. 验证所有权
    2. 验证用法上下文
    3. 按 ItemKind 路由：
       - Evolution → on_evolve()
       - TeachMove → on_teach_move()
       - KeyItem → on_use_field()
       - Equipment → on_use_field() (游戏层通过 equip_slots 处理装备)
       - Consumable/StatBoost/Currency/Custom → apply_effect()
    4. 如果 result.consumes() 则消耗一个单位
    ```
  - 更新 `buy()` 和 `sell()` 函数签名以使用 `Inventory<I::Item, K>`
  - 更新 `UsageContext::allows()` 处理 `MenuOnly` 变体
  - 更新测试

**Must NOT do:**
- 不要在引擎层实现任何具体道具效果
- 不要让 `use_item()` 依赖于任何游戏特定类型

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 不可并行（依赖 T4, T5, T6）

**References:**
- 设计文档增强 `use_item` 驱动节: L1013-1110
- 当前文件: `crates/jrpg-engine/src/items/use_driver.rs` (L100-223)
- 依赖: T4 (ItemUseResult), T5 (ItemProvider), T6 (ShopProvider)

**Acceptance criteria:**
- `use_item()` 通过 `item_kind()` 路由到正确的 handler
- Evolution items 通过 `on_evolve()` 处理
- TeachMove items 通过 `on_teach_move()` 处理
- 现有测试通过

**QA scenarios:**

```rust
// Evolution item dispatch
let kind = provider.item_kind(&Item::FireStone);
if let ItemKind::Evolution = kind {
    // on_evolve() is called
}

// Consumable dispatch
let kind = provider.item_kind(&Item::Potion);
if let ItemKind::Consumable = kind {
    // apply_effect() is called
}
```

**Commands:**
```bash
cargo build -p jrpg-engine
cargo test -p jrpg-engine -- items::use_driver::tests
```

**Commit message:**
```
feat(jrpg-engine): enhance use_item with ItemKind dispatch (#T7)

- use_item() routes via ItemKind variants (Evolution, TeachMove, KeyItem, etc.)
- New signatures accept generic Inventory<I, K> and provider: &M
- buy()/sell() signatures updated for new Inventory
- UsageContext::MenuOnly fully handled
```

---

### Wave 3: 游戏层适配（混合并行，4 任务）

#### Task 8: pokered-data 适配 — CustomKind 和 item_kind()

**What to do:**
- 修改 `examples/pokered/crates/pokered-data/src/items.rs`：
  - 定义 `CustomKind` 枚举：`Ball`, `Tm`, `Hm`
  - 定义 `CustomSlot` 枚举（当前为空，`HeldItem` 在 Gen 2+ 中使用）
  - 更新 `ItemData` 结构体（在 `item_data.rs` 中）添加 `kind: ItemKind<CustomKind>` 字段
  - 实现 `ItemProvider` 的 `CustomKind = CustomKind`, `CustomSlot = CustomSlot`
  - 实现 `fn item_kind()` 方法，为每个 `ItemId` 返回正确的 `ItemKind`
  - 更新 `item_data.rs` 中的 `ItemData` 结构体

**Must NOT do:**
- 不要修改 `ItemId` 枚举的变体
- 不要删除 `ItemEffect` 枚举（标记为 `#[deprecated]` 或留待后续清理）
- 不要在 pokered-data 中实现 `ItemProvider`（这是 pokered-core 的工作）

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 不可并行（依赖 T5）

**References:**
- 当前文件: `examples/pokered/crates/pokered-data/src/items.rs` (全部 448 行)
- 当前文件: `examples/pokered/crates/pokered-data/src/item_data.rs` (全部 79 行)
- 设计文档: L1241-1431 (PokemonItemProvider 示例)
- `CustomKind` 示例: L1289-1297

**Acceptance criteria:**
- `CustomKind` 和 `CustomSlot` 定义在 pokered-data 中
- 所有 83 个 `ItemId` 有对应的 `ItemKind` 映射
- `cargo test -p pokered-data` 通过

**QA scenarios:**

```rust
// 1. ItemKind 映射
let kind = item_kind(&ItemId::Potion);
assert_eq!(kind, ItemKind::<CustomKind>::Consumable);

let kind = item_kind(&ItemId::FireStone);
assert_eq!(kind, ItemKind::<CustomKind>::Evolution);

let kind = item_kind(&ItemId::MasterBall);
assert_eq!(kind, ItemKind::Custom(CustomKind::Ball));
```

**Commands:**
```bash
cargo build -p pokered-data
cargo test -p pokered-data
```

**Commit message:**
```
feat(pokered-data): add CustomKind, CustomSlot, and item_kind mappings (#T8)

- New CustomKind enum: Ball, Tm, Hm
- CustomSlot enum (empty, reserved for Gen 2+)
- ItemData gains kind field
- item_kind() maps all 83 ItemId variants to ItemKind<CustomKind>
```

---

#### Task 9: pokered-core `apply_effect` 适配 — provider 参数和统一 dispatcher

**What to do:**
- 修改 `examples/pokered/crates/pokered-core/src/items/use_engine.rs`：
  - 更新 `PokeItemProvider` 实现：新增 `CustomKind = CustomKind`, `CustomSlot = CustomSlot`
  - 更新 `apply_effect` 签名：添加 `provider: &M` 参数
  - 实现在 `apply_effect` 中的 HP 治疗：使用 `target.max_hp(provider)` 获取最大 HP
  - 实现在 `apply_effect` 中的 PP 恢复
  - 实现在 `apply_effect` 中的维生素
  - 实现在 `apply_effect` 中的 Rare Candy
  - 保留 `use_on_monster` 路径作为 fallback（用于不兼容引擎类型的操作）
  - 更新所有测试

**Must NOT do:**
- 不要修改 `healing.rs`, `pp_restore.rs`, `vitamins.rs` 中的现有逻辑（只在 `apply_effect` 中包装调用）
- 不要删除 `apply_to_pokemon()` 函数（保留为内部 dispatcher）
- 不要修改 `Pokemon` 结构体

**Agent profile:**
- 分类: `implementation`
- 技能: 无特定要求
- 并行: 不可并行（依赖 T8）

**References:**
- 当前文件: `examples/pokered/crates/pokered-core/src/items/use_engine.rs` (全部 695 行)
- 设计文档集成节: L1116-1172 (apply_effect 与 Party 系统集成)
- 设计文档 ItemProvider 增强节: L840-861 (apply_effect 默认实现)

**Acceptance criteria:**
- `apply_effect` 现在接受 `provider: &M` 参数
- HP 治疗通过 `mon.max_hp(provider)` 计算
- `cargo test -p pokered-core` 所有测试通过
- `cure_item_on_fainted_target_documents_known_divergence` 测试仍然标识偏差（留待 T11 修复）

**QA scenarios:**

```rust
// HP healing now works through apply_effect
fn apply_effect<M: MonsterProvider>(
    &self,
    provider: &M,
    item: ItemId,
    _ctx: UsageContext,
    target: Option<&mut MonsterInstance<M>>,
    _rng: &mut dyn BattleRng,
) -> ItemUseResult<ItemId> {
    if let Some(mon) = target {
        let max_hp = mon.max_hp(provider);
        let heal = 20.min(max_hp - mon.current_hp);
        if heal > 0 {
            mon.current_hp += heal;
            return ItemUseResult::Applied { consume: true, message_key: None };
        }
    }
    ItemUseResult::NoEffect
}
```

**Commands:**
```bash
cargo build -p pokered-core
cargo test -p pokered-core -- items::use_engine::tests
cargo test -p pokered-core -- items::healing_tests
cargo test -p pokered-core -- items::status_cure_tests
cargo test -p pokered-core -- items::pp_restore_tests
cargo test -p pokered-core -- items::vitamins_tests
```

**Commit message:**
```
feat(pokered-core): unify apply_effect with MonsterProvider parameter (#T9)

- PokeItemProvider::apply_effect now takes provider: &M
- HP healing uses mon.max_hp(provider)
- PP restore, vitamins, Rare Candy routed through apply_effect
- All parity tests pass with unified path
```

---

#### Task 10: 统一 Inventory 类型

**What to do:**
- 重构 `examples/pokered/crates/pokered-core/src/items/inventory.rs`：
  - 将 pokered 的 `Inventory` 改为使用引擎的 `Inventory<ItemId, ItemKind<CustomKind>>` 作为内部存储
  - 保留 pokered 特有的方法：`add_item()`（带 overflow 逻辑），`remove_item_at()`, `use_item()`, `has_item()`, `item_quantity()`, `swap()`, `toss_item()`, `find_item()`, `clear()`
  - 保留 pokered 的容量常量：`MAX_ITEM_QUANTITY = 99`, `BAG_ITEM_CAPACITY = 20`, `PC_ITEM_CAPACITY = 50`
  - 或者：将 pokered 的 `Inventory` 重写为对引擎 `Inventory` 的包装（wrapper）
- 更新 `shop.rs` 中使用 `Inventory` 的所有引用
- 更新 `use_engine.rs` 中的 `Inventory<ItemId>` 引用为 `Inventory<ItemId, ItemKind<CustomKind>>`
- 更新所有测试

**两个方案选择：**
- **方案 A（推荐）**：将 pokered `Inventory` 重写为引擎 `Inventory` 的包装，保留现有公开 API
- **方案 B**：直接替换所有 `pokered_core::items::Inventory` 引用为引擎 `Inventory`

选择方案 A，最小化对外部 crate 的影响。

**Must NOT do:**
- 不要删除 `pokered_core::items::inventory` 模块（外部 crate 可能直接引用）
- 不要改变 `Inventory` 的公开方法签名（除非必要）
- 不要修改 `pokered-data` 的类型

**Agent profile:**
- 分类: `refactoring`
- 技能: 无特定要求
- 并行: 不可并行（依赖 T3, T9）

**References:**
- 当前文件: `examples/pokered/crates/pokered-core/src/items/inventory.rs` (全部 183 行)
- 引擎 Inventory: `crates/jrpg-engine/src/items/mod.rs` (T3 修改后)
- 使用处: `shop.rs` (L146-728, PlayerData, try_buy, try_sell 等)

**Acceptance criteria:**
- pokered `Inventory` 的所有公开 API 保持不变
- 内部使用引擎 `Inventory<ItemId, ItemKind<CustomKind>>`
- `cargo test -p pokered-core` 通过
- 所有 inventory_tests 通过

**QA scenarios:**

```rust
// 旧 API 仍然可用
let mut bag = Inventory::new_bag();
assert!(bag.add_item(ItemId::Potion, 5).is_ok());
assert!(bag.has_item(ItemId::Potion, 3));
assert_eq!(bag.item_quantity(ItemId::Potion), 5);
let _ = bag.use_item(0); // returns ItemId::Potion

// 内部使用引擎 Inventory
// bag.inner() -> &Inventory<ItemId, ItemKind<CustomKind>>
```

**Commands:**
```bash
cargo build -p pokered-core
cargo test -p pokered-core -- items::inventory_tests
cargo test -p pokered-core -- items::shop_tests
```

**Commit message:**
```
refactor(pokered-core): unify Inventory with engine Inventory wrapper (#T10)

- Pokered Inventory wraps engine Inventory<ItemId, ItemKind<CustomKind>>
- All existing public API preserved (add_item, remove_item_at, use_item, etc.)
- Constants MAX_ITEM_QUANTITY, BAG_ITEM_CAPACITY, PC_ITEM_CAPACITY kept
- Shop module updated to use unified Inventory
```

---

#### Task 11: 修复 status cure on fainted divergence

**What to do:**
- 修改 `examples/pokered/crates/pokered-core/src/items/use_engine.rs`：
  - 更新 `status_cured_by()` 函数：检查目标 `MonsterInstance` 的 `current_hp`，如果 `hp == 0` 则返回 `None`（匹配遗留行为）
  - 或者：在 `apply_effect` 中，在调用 `status_cured_by` 之前添加 `hp == 0` 的 guard
- 从 `status_cured_by` 的探测中添加 HP 感知
- 更新 `cure_item_on_fainted_target_documents_known_divergence` 测试：
  - 从"已知偏差"变为"确认修复"
  - 验证引擎路径和遗留路径现在一致

**Must NOT do:**
- 不要修改遗留的 `use_status_cure` 函数（保留在 `status_cure.rs` 中的原始逻辑）
- 不要删除记录偏差的注释（改为记录修复）

**Agent profile:**
- 分类: `bugfix`
- 技能: 无特定要求
- 并行: 可与 T10 并行（依赖 T9）

**References:**
- 当前文件: `examples/pokered/crates/pokered-core/src/items/use_engine.rs` (L228-248, L582-611)
- 遗留 dispatcher: `examples/pokered/crates/pokered-core/src/items/status_cure.rs`

**Acceptance criteria:**
- 引擎 `apply_effect` 路径对有 status 且 `hp == 0` 的目标返回 `NoEffect`
- `cure_item_on_fainted_target_documents_known_divergence` 测试被重写为 parity assert
- 所有状态治疗 parity tests 通过

**QA scenarios:**

```rust
// 修复后：fainted + poison → NoEffect
let mut fainted = pokemon_with_status(StatusCondition::Poison);
fainted.hp = 0;

let (legacy, _) = legacy_cure(ItemId::Antidote, &fainted);
let (engine, _) = engine_use(ItemId::Antidote, &fainted);

assert_eq!(legacy, StatusCureResult::NoEffect);    // 遗留行为
assert_eq!(engine, ItemUseResult::NoEffect);        // 引擎现在一致
```

**Commands:**
```bash
cargo test -p pokered-core -- items::use_engine::tests::cure_item_on_fainted_*
```

**Commit message:**
```
fix(pokered-core): align apply_effect status cure with legacy faint guard (#T11)

- status_cured_by now checks target HP before probing
- Engine apply_effect matches legacy use_status_cure for fainted targets
- Known divergence test converted to parity assert
```

---

### Wave FINAL: 最终验证（串行，2 任务）

#### Task F1: 全量测试验证

**What to do:**
- 运行全 workspace 测试
- 检查所有测试通过
- 对任何失败进行排查和修复
- 确认没有回归

**Commands:**
```bash
cargo build --workspace 2>&1 | head -50
cargo test --workspace 2>&1 | tail -30
```

**Acceptance criteria:**
- `cargo build --workspace` 无错误
- `cargo test --workspace` 全部通过
- 无警告（或仅预期的 deprecation 警告）

**Agent profile:**
- 分类: `verification`
- 技能: 无特定要求

---

#### Task F2: 文档更新

**What to do:**
- 更新 `.sisyphus/drafts/item-system-design.md` 附录 A（文件变更清单）
- 创建 `.sisyphus/plans/pokered-item-migration-summary.md` 迁移摘要
- 更新 `crates/jrpg-engine/src/items/mod.rs` 的模块文档注释

**Must NOT do:**
- 不要添加设计文档中未包含的新内容
- 不要更新 README.md（除非项目级别的变更）

**Agent profile:**
- 分类: `documentation`
- 技能: 无特定要求

---

## 7. 提交策略

| Wave | Commits | 说明 |
|------|---------|------|
| **Wave 1** | 4 个独立 commit | 每个任务一个 commit，互不冲突（不同文件） |
| **Wave 2** | 3 个独立 commit | 每个任务一个 commit，可独立 review |
| **Wave 3** | 4 个独立 commit | T8→T9→T10 按顺序，T11 可与 T10 交换顺序 |
| **Final** | 1-2 个 commit | 测试修复 + 文档更新 |

**总提交数：12-13 个 commit**

每个 commit 遵循规范：
```
<type>(<scope>): <description> (#<task-id>)

- Bullet points of key changes
```

---

## 8. Success Criteria

### 8.1 验证命令

```bash
# 1. 构建
cargo build -p jrpg-engine
cargo build -p pokered-data
cargo build -p pokered-core
cargo build --workspace

# 2. 引擎层测试
cargo test -p jrpg-engine

# 3. 数据层测试
cargo test -p pokered-data

# 4. 核心层测试
cargo test -p pokered-core

# 5. 全量测试
cargo test --workspace
```

### 8.2 验收检查清单

- [ ] `ItemKind<Id>` 定义在 `kind.rs`，所有变体的默认行为正确
- [ ] `EquipSlot<Id>` 和 `EquipmentSlots<I,S>` 定义在 `equip.rs`
- [ ] `Inventory<I, K>` 支持容量限制、过滤、排序
- [ ] `AddError` 枚举定义了 `InventoryFull` 和 `PerSlotCapReached`
- [ ] `ItemUseResult<I>` 包含 `EvolutionTriggered` 和 `MoveLearned`
- [ ] `UsageContext` 包含 `MenuOnly` 变体
- [ ] `ItemProvider` 有关联类型 `CustomKind` 和 `CustomSlot`
- [ ] `ItemProvider::item_kind()` 返回每个道具的 `ItemKind`
- [ ] `ItemProvider::apply_effect()` 接受 `provider: &M` 参数
- [ ] `ItemProvider` 有 `equip_slots`, `stat_bonuses`, `on_teach_move`, `on_evolve`, `on_use_field` 默认方法
- [ ] `ShopProvider` 有 `discount_rate`, `sell_rate`, `has_limited_stock`, `max_stock`, `restocks`, `restock_interval`
- [ ] `use_item()` 通过 `ItemKind` dispatch 路由道具效果
- [ ] pokered-data 有 `CustomKind` (Ball, Tm, Hm)
- [ ] pokered-core 的 `apply_effect` 使用 `provider` 参数进行 HP 治疗
- [ ] 统一的 `Inventory` 类型（引擎 Inventory 包装）
- [ ] Status cure on fainted divergence 已修复
- [ ] `cargo test --workspace` 全部通过

---

## 附录 A: 变更文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `crates/jrpg-engine/src/items/kind.rs` | **新增** | `ItemKind<Id>` 枚举 + 默认行为方法 + 测试 |
| `crates/jrpg-engine/src/items/equip.rs` | **新增** | `EquipSlot<Id>`, `EquipmentSlots<I,S>`, `EquipError` + 测试 |
| `crates/jrpg-engine/src/items/mod.rs` | **修改** | 添加 `pub mod kind;` `pub mod equip;`；增强 `Inventory<I,K>`；增强 `ItemProvider`；增强 `ShopProvider` |
| `crates/jrpg-engine/src/items/use_driver.rs` | **修改** | `ItemUseResult<I>` 泛型化；新增 `EvolutionTriggered`/`MoveLearned`；增强 `use_item` dispatch；增强 `buy`/`sell` 折扣支持；添加 `MenuOnly` 到 `UsageContext` |
| `examples/pokered/crates/pokered-data/src/items.rs` | **修改** | 新增 `CustomKind`/`CustomSlot` 枚举；实现 `item_kind()` 映射 |
| `examples/pokered/crates/pokered-data/src/item_data.rs` | **修改** | `ItemData` 添加 `kind` 字段 |
| `examples/pokered/crates/pokered-core/src/items/use_engine.rs` | **修改** | `apply_effect` 添加 `provider` 参数；HP/PP/维生素/Rare Candy 路由到 `apply_effect`；修复 status cure divergence |
| `examples/pokered/crates/pokered-core/src/items/inventory.rs` | **修改** | 包装引擎 `Inventory<ItemId, ItemKind<CustomKind>>`；保留现有 API |
| `.sisyphus/drafts/item-system-design.md` | **修改** | 更新附录 A 文件变更清单 |

## 附录 B: 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| `Inventory<I>` → `Inventory<I,K>` 破坏大量调用处 | 高 | 中 | 提供 `SimpleInventory<I>` 类型别名；逐个 crate 修复 |
| `add()` 返回类型从 `()` 变为 `Result` 破坏调用处 | 高 | 中 | 使用 `let _ = inv.add(...)` 或 `.unwrap()` 快速修复 |
| `ItemUseResult` 泛型化导致 match 需要更新 | 中 | 低 | 编译器会捕获所有未更新的 match |
| 引入 `CustomKind`/`CustomSlot` 关联类型破坏现有 impl | 高 | 中 | 提供 `()` 作为默认类型示例；设计文档已注明 |
| pokered-core 对 engine Inventory 的包装可能存在性能问题 | 低 | 低 | 编译器内联优化；仅在关键路径 benchmark |
| Fainted divergence 修复影响现有行为 | 低 | 低 | 只在引擎路径修复；遗留路径保持不变 |
