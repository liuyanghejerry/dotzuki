# 商店

> 本文是 `reference/shops.md` 的中文翻译，同步至引擎版本 v0.5.4（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

引擎的[商店](./glossary.md)（mart）模块：一个 UI 层的商店交互状态机
（`MartState`）、由游戏实现的 `MartBackend` 回调 trait，
以及现成的 `MartDriver` 后端——并给出 Buy / Sell / Quit
交互的完整相位流程。

模块位于 `crates/dotzuki-engine/src/items/mart.rs`，并从
`dotzuki_engine::items` 重导出 `MartBackend`、`MartDriver`、
`MartState`、`MartStock`。没有 feature 开关。除模块自身的
单元测试外，仓库内没有消费方；它是面向游戏的 API。

## 两个半边

一个运行中的商店分成状态机与后端两部分：

- `MartState<I>` 只拥有*交互流程*：Buy/Sell/Quit 顶层菜单、
  物品列表光标、数量选择、Yes/No 确认子相位以及结果展示。
  它对价格、金钱和背包容量一无所知。
- 游戏的 `MartBackend` 实现拥有全部金钱与背包裹义：定价
  规则、货币、每格上限、不可出售的关键道具。`MartState`
  从不直接触碰金钱。

输入使用引擎通用的 `MenuInput`（`up` / `down` / `confirm` /
`cancel` 四个布尔值，见 `crates/dotzuki-engine/src/menu/mod.rs`）。
音效提示以类型化的 `MartSound` 值上报，由游戏映射到自己的
音频 id；`MartSound` 只有一个变体 `Purchase`。

## 相位

`MartState` 有两个公开字段：`inventory: MartStock<I>`（商店
库存，按展示顺序）和 `phase: MartPhase`。`MartPhase`：

| 相位 | 含义 |
|---|---|
| `MainMenu { cursor }` | 顶层菜单；`cursor: MartTopChoice` 为 `Buy`、`Sell` 或 `Quit` |
| `Buy(BuyMenuState)` | 处于购买流程中 |
| `Sell(SellMenuState)` | 处于出售流程中 |
| `Exiting` | 终态；`update_frame` 持续返回 `MartUpdate::Exit` |

`BuyMenuState` 与 `SellMenuState` 形状相同；出售变体在
`Quantity` 与 `Confirm` 上额外携带 `max_quantity: u8`
（所选背包格子的持有数量）：

| 子相位 | 载荷 |
|---|---|
| `SelectItem` | `cursor`，指向库存列表（买）或背包（卖） |
| `Quantity` | `item_index`、`quantity` |
| `Confirm` | 数量字段加 `selected: ConfirmChoice`（`Yes` / `No`） |
| `Result` | `dialogue: BuyResult` / `SellResult`、`return_to_list: bool` |

## 逐帧行为

`MartState::new(inventory)` 从 `MainMenu`（光标在 `Buy`）开始。
每个输入帧调用一次 `update_frame(input, backend)` 驱动状态机；
返回的 `MartUpdate` 告知调用方发生了什么：

- `Continue` —— 继续渲染。
- `PlaySound(MartSound)` —— 播放音效；仅购买提交成功时发出
  `MartSound::Purchase`。
- `Exit` —— 商店交互结束。

顶层菜单：上/下让光标沿固定顺序 Buy → Sell → Quit 循环
（`MartTopChoice::position()` 返回序号）。按取消、或在 `Quit`
上确认，会进入 `Exiting` 并返回 `Exit`；`Exiting` 是粘性的，
之后每帧都返回 `Exit`。背包为空（`bag_len() == 0`）时在
`Sell` 上确认会停留在顶层菜单。

购买流程：

1. `SelectItem` —— 光标在库存列表上循环；仅当
   `backend.can_buy(&item)` 成立时确认才进入 `Quantity`，否则
   停留在列表上。取消返回 `MainMenu` 的 Buy 页。
2. `Quantity` —— 上/下让 `quantity` 在 1..=99 内循环；取消
   返回 `SelectItem` 并保留光标；确认进入 `Confirm`，预选
   `Yes`。
3. `Confirm` —— 上/下切换 Yes/No；取消返回 `Quantity`；在
   `No` 上确认返回 `SelectItem` 并保留光标；在 `Yes` 上确认
   调用 `backend.commit_buy(item, quantity)` 并进入
   `Result`。成功时该帧返回 `PlaySound(Purchase)`。
4. `Result` —— 在*下一次* `update_frame` 时自动消失，无论
   输入是什么。`return_to_list: true`（成功）回到物品列表且
   光标重置为 0；`false`（失败）回到顶层菜单的 Buy 页。

出售流程镜像购买流程，但作用在背包上：列表来自
`bag_len()` / `bag_entry(index)`，`quantity` 在
1..=`max_quantity` 内循环（而非 1..=99）。出售失败回到顶层
菜单的 Sell 页。

## 后端契约

游戏需要实现的 trait（`crates/dotzuki-engine/src/items/mart.rs`）：

```rust
pub trait MartBackend {
    type Item: Copy + Eq + Hash + Debug;
    fn bag_len(&self) -> usize;
    fn bag_entry(&self, index: usize) -> Option<(Self::Item, u8)>;
    fn can_buy(&self, item: &Self::Item) -> bool { true }
    fn commit_buy(&mut self, item: Self::Item, quantity: u8) -> BuyResult;
    fn commit_sell(&mut self, bag_index: usize, quantity: u8) -> SellResult;
}
```

*由 `crates/dotzuki-engine/src/items/mart.rs` 中的
`mart_buy_happy_path` 验证，其 `MockMart` 实现了该 trait。*

| 方法 | 契约 |
|---|---|
| `bag_len()` | 已占用的背包格子数；驱动出售列表光标 |
| `bag_entry(index)` | 该格子的 `(item, owned_quantity)`，若已占用 |
| `can_buy(&item)` | 能否进入数量相位；默认 `true` |
| `commit_buy(item, quantity)` | 放入背包并扣钱；返回 `BuyResult` |
| `commit_sell(bag_index, quantity)` | 从背包移除并加钱；返回 `SellResult` |

一条硬性规则：**提交失败时不得改动任何状态**——结果不是
`Success` 时，金钱和背包都不能变。`BuyResult` 为
`Success { total_cost }` / `NotEnoughMoney` / `BagFull` /
`InvalidItem`；`SellResult` 为 `Success { total_value }` /
`Unsellable` / `NotInBag` / `InvalidItem`。

## `MartDriver`：现成的后端

`MartDriver<'a, S: ShopProvider, const N: usize>` 为背包是
引擎原生 `Inventory` 的游戏实现 `MartBackend`。它把交易路由到
引擎的 `buy` / `sell` 驱动器
（`crates/dotzuki-engine/src/items/use_driver.rs`）和一个
[provider](./glossary.md) trait（`ShopProvider`，
`crates/dotzuki-engine/src/items/mod.rs`），因此商店专属价格、
折扣与回收倍率、`can_sell` 规则全部生效。背包语义特殊的游戏
（溢出外溢、超出 `can_sell` 的关键道具规则）应直接实现
`MartBackend`。

字段全部公开，用结构体字面量构造：

| 字段 | 作用 |
|---|---|
| `provider: &'a S` | 游戏的 `ShopProvider` |
| `shop_id: S::ShopId` | 采用哪家商店的库存与倍率 |
| `money: &'a mut u32` | 玩家的金钱 |
| `bag: &'a mut Inventory<S::Item, N>` | 玩家的背包 |

驱动器 `ShopError` 到结果的映射：

| 条件 | `BuyResult` | `SellResult` |
|---|---|---|
| `NotEnoughMoney` | `NotEnoughMoney` | — |
| `InventoryFull` | `BagFull` | — |
| `CannotSell` | `InvalidItem` | `Unsellable` |
| `InvalidQuantity` | `InvalidItem` | `InvalidItem` |
| 其他驱动器错误 | — | `InvalidItem` |
| 背包格子为空 | — | `NotInBag` |

`ShopProvider::sell_price` 默认为 `buy_price / 2`（半价回收）。
`MartDriver::bag_entry` 把存储的 `u32` 数量钳制到 `u8`，
超过 255 的格子会上报为 255。

## 示例

一次完整的购买流程——从顶层菜单到提交成交——基于一个最小
后端：

```rust
use dotzuki_engine::items::mart::{
    BuyResult, MartBackend, MartSound, MartState, MartStock, MartUpdate, SellResult,
};
use dotzuki_engine::menu::MenuInput;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Item {
    Ball,
    Potion,
}

/// Gen-1 风格的商店规则：挂牌价格，半价回收。
struct MockMart {
    money: u32,
    bag: Vec<(Item, u8)>,
}

impl MockMart {
    fn price(item: Item) -> u32 {
        match item {
            Item::Ball => 200,
            Item::Potion => 300,
        }
    }
}

impl MartBackend for MockMart {
    type Item = Item;

    fn bag_len(&self) -> usize {
        self.bag.len()
    }

    fn bag_entry(&self, index: usize) -> Option<(Item, u8)> {
        self.bag.get(index).copied()
    }

    fn commit_buy(&mut self, item: Item, quantity: u8) -> BuyResult {
        let cost = Self::price(item) * quantity as u32;
        if self.money < cost {
            return BuyResult::NotEnoughMoney;
        }
        self.bag.push((item, quantity));
        self.money -= cost;
        BuyResult::Success { total_cost: cost }
    }

    fn commit_sell(&mut self, bag_index: usize, quantity: u8) -> SellResult {
        let Some(&(item, owned)) = self.bag.get(bag_index) else {
            return SellResult::NotInBag;
        };
        let value = Self::price(item) / 2 * quantity as u32;
        if quantity == owned {
            self.bag.remove(bag_index);
        } else {
            self.bag[bag_index].1 -= quantity;
        }
        self.money += value;
        SellResult::Success { total_value: value }
    }
}

fn main() {
    let mut mart = MartState::new(MartStock::new(vec![Item::Ball, Item::Potion]));
    let mut shop = MockMart { money: 1000, bag: Vec::new() };
    let confirm = MenuInput { confirm: true, ..MenuInput::default() };
    let down = MenuInput { down: true, ..MenuInput::default() };

    mart.update_frame(confirm, &mut shop); // MainMenu → 库存列表
    mart.update_frame(down, &mut shop);    // 光标 → Potion
    mart.update_frame(confirm, &mut shop); // Potion → 数量 1
    mart.update_frame(confirm, &mut shop); // 数量 → Yes/No，预选 Yes
    let update = mart.update_frame(confirm, &mut shop); // Yes → 提交

    assert_eq!(update, MartUpdate::PlaySound(MartSound::Purchase));
    assert_eq!(shop.money, 700); // 1000 − 300
}
```

*由 `crates/dotzuki-engine/src/items/mart.rs` 中的
`mart_buy_happy_path` 验证。*

## 备注

- `MartStock::from_strings(&[S])` 在 id 类型实现 `FromStr`
  时从物品名构建库存列表；遇到无法解析的名字时返回携带该
  字符串的 `Err`。*由 `crates/dotzuki-engine/src/items/mart.rs`
  中的 `mart_stock_from_strings` 验证。*
- `MartState`、`MartPhase` 与各子相位枚举都派生了
  `PartialEq`/`Eq`：直接对整个 `phase` 字段做快照断言，
  而不必探测内部细节。
- `MartDriver` 在整个会话期间可变借用 `money` 与 `bag`：
  在进入商店时构造它，当 `update_frame` 返回 `Exit` 时丢弃。
