# Shops

> - **Audience**: rust developers
> - **Type**: reference
> - **Status**: active
> - **Last verified**: v0.5.4

The engine's [mart](./glossary.md) module: a UI-level shop interaction state
machine (`MartState`), the `MartBackend` callback trait the game implements,
and the ready-made `MartDriver` backend — with the exact phase flow of the
Buy / Sell / Quit interaction.

The module lives at `crates/dotzuki-engine/src/items/mart.rs` and is
re-exported from `dotzuki_engine::items` as `MartBackend`, `MartDriver`,
`MartState`, and `MartStock`. There is no feature gate. No code outside the
module's own unit tests consumes it yet; it is a game-facing API.

## The two halves

A running shop splits into a state machine and a backend:

- `MartState<I>` owns only the *interaction flow*: the Buy/Sell/Quit top
  menu, item-list cursors, quantity selection, the Yes/No confirmation
  sub-phase, and result display. It knows nothing about prices, money, or bag
  capacity.
- The game's `MartBackend` implementation owns all money and bag semantics:
  pricing rules, currency, per-slot caps, unsellable key items. `MartState`
  never touches money directly.

Input is the engine-wide `MenuInput` (`up` / `down` / `confirm` / `cancel`
booleans, `crates/dotzuki-engine/src/menu/mod.rs`). Sound cues arrive as typed
`MartSound` values the game maps to its own audio ids; `MartSound` has one
variant, `Purchase`.

## Phases

`MartState` has two public fields: `inventory: MartStock<I>` (the shop's stock
in display order) and `phase: MartPhase`. `MartPhase`:

| Phase | Meaning |
|---|---|
| `MainMenu { cursor }` | Top menu; `cursor: MartTopChoice` is `Buy`, `Sell`, or `Quit` |
| `Buy(BuyMenuState)` | Inside the buy flow |
| `Sell(SellMenuState)` | Inside the sell flow |
| `Exiting` | Terminal; `update_frame` keeps returning `MartUpdate::Exit` |

`BuyMenuState` and `SellMenuState` share a shape; the sell variants add
`max_quantity: u8` (the owned count at the selected bag slot) on `Quantity`
and `Confirm`:

| Sub-state | Payload |
|---|---|
| `SelectItem` | `cursor` over the stock list (buy) or the bag (sell) |
| `Quantity` | `item_index`, `quantity` |
| `Confirm` | quantity fields plus `selected: ConfirmChoice` (`Yes` / `No`) |
| `Result` | `dialogue: BuyResult` / `SellResult`, `return_to_list: bool` |

## Frame behavior

`MartState::new(inventory)` starts at `MainMenu` with the cursor on `Buy`.
Drive the machine with one `update_frame(input, backend)` call per input
frame; the returned `MartUpdate` tells the caller what happened:

- `Continue` — keep rendering.
- `PlaySound(MartSound)` — play the cue; only a successful buy commit emits
  `MartSound::Purchase`.
- `Exit` — the mart interaction is over.

Top menu: up/down wraps the cursor through the fixed order Buy → Sell → Quit
(`MartTopChoice::position()` returns the index). Cancel, or confirming
`Quit`, enters `Exiting` and returns `Exit`; `Exiting` is sticky and returns
`Exit` on every later frame. Confirming `Sell` with an empty bag
(`bag_len() == 0`) stays on the main menu.

Buy flow:

1. `SelectItem` — the cursor wraps around the stock list; confirm enters
   `Quantity` only when `backend.can_buy(&item)` holds, otherwise the machine
   stays on the list. Cancel returns to `MainMenu` on the Buy tab.
2. `Quantity` — up/down wraps `quantity` through 1..=99; cancel returns to
   `SelectItem` with the cursor preserved; confirm enters `Confirm` with
   `Yes` preselected.
3. `Confirm` — up/down toggles Yes/No; cancel returns to `Quantity`;
   confirming `No` returns to `SelectItem` with the cursor preserved;
   confirming `Yes` calls `backend.commit_buy(item, quantity)` and enters
   `Result`. A success returns `PlaySound(Purchase)` for that frame.
4. `Result` — auto-dismisses on the *next* `update_frame`, regardless of
   input. `return_to_list: true` (success) goes back to the item list with
   the cursor reset to 0; `false` (failure) goes back to the top menu on the
   Buy tab.

The sell flow mirrors the buy flow over the bag: the list comes from
`bag_len()` / `bag_entry(index)`, and `quantity` wraps through
1..=`max_quantity` instead of 1..=99. A failed sale returns to the top menu
on the Sell tab.

## The backend contract

The trait the game implements (`crates/dotzuki-engine/src/items/mart.rs`):

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

*Verified by `mart_buy_happy_path` in `crates/dotzuki-engine/src/items/mart.rs`,
whose `MockMart` implements this trait.*

| Method | Contract |
|---|---|
| `bag_len()` | Number of occupied bag slots; drives the sell-list cursor |
| `bag_entry(index)` | `(item, owned_quantity)` at that slot, if occupied |
| `can_buy(&item)` | Gates entry into the quantity phase; defaults to `true` |
| `commit_buy(item, quantity)` | Add to the bag and deduct money; returns `BuyResult` |
| `commit_sell(bag_index, quantity)` | Remove from the bag and credit money; returns `SellResult` |

One hard rule: **a failed commit must not mutate anything** — no money or bag
changes when the result is not `Success`. `BuyResult` is
`Success { total_cost }` / `NotEnoughMoney` / `BagFull` / `InvalidItem`;
`SellResult` is `Success { total_value }` / `Unsellable` / `NotInBag` /
`InvalidItem`.

## `MartDriver`: the ready-made backend

`MartDriver<'a, S: ShopProvider, const N: usize>` implements `MartBackend` for
games whose bag is a plain engine `Inventory`. It routes transactions through
the engine's `buy` / `sell` drivers
(`crates/dotzuki-engine/src/items/use_driver.rs`) and a
[provider](./glossary.md) trait (`ShopProvider`,
`crates/dotzuki-engine/src/items/mod.rs`), so shop-specific prices, discount
and sell rates, and `can_sell` rules all apply. Games with custom bag
semantics (overflow spill, key-item rules beyond `can_sell`) implement
`MartBackend` directly instead.

The fields are public; construct it with struct literal syntax:

| Field | Role |
|---|---|
| `provider: &'a S` | The game's `ShopProvider` |
| `shop_id: S::ShopId` | Which shop's inventory and rates apply |
| `money: &'a mut u32` | The player's money |
| `bag: &'a mut Inventory<S::Item, N>` | The player's bag |

Error mapping from the drivers' `ShopError`:

| Condition | `BuyResult` | `SellResult` |
|---|---|---|
| `NotEnoughMoney` | `NotEnoughMoney` | — |
| `InventoryFull` | `BagFull` | — |
| `CannotSell` | `InvalidItem` | `Unsellable` |
| `InvalidQuantity` | `InvalidItem` | `InvalidItem` |
| Any other driver error | — | `InvalidItem` |
| Bag slot empty | — | `NotInBag` |

`ShopProvider::sell_price` defaults to `buy_price / 2` (half-price sell-back).
`MartDriver::bag_entry` clamps the stored `u32` quantity to `u8`, so a slot
holding more than 255 units reports 255.

## Example

A full buy walk — main menu to committed purchase — on a minimal backend:

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

/// Gen-1-style shop rules: list prices, half-price sell-back.
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

    mart.update_frame(confirm, &mut shop); // MainMenu → stock list
    mart.update_frame(down, &mut shop);    // cursor → Potion
    mart.update_frame(confirm, &mut shop); // Potion → quantity 1
    mart.update_frame(confirm, &mut shop); // quantity → Yes/No, Yes preselected
    let update = mart.update_frame(confirm, &mut shop); // Yes → commit

    assert_eq!(update, MartUpdate::PlaySound(MartSound::Purchase));
    assert_eq!(shop.money, 700); // 1000 − 300
}
```

*Verified by `mart_buy_happy_path` in `crates/dotzuki-engine/src/items/mart.rs`.*

## Notes

- `MartStock::from_strings(&[S])` builds a stock list from item names when
  the id type implements `FromStr`; on a bad name it returns `Err` naming the
  offending string. *Verified by `mart_stock_from_strings` in
  `crates/dotzuki-engine/src/items/mart.rs`.*
- `MartState`, `MartPhase`, and the sub-state enums derive `PartialEq`/`Eq`:
  snapshot-test the whole `phase` field instead of probing internals.
- `MartDriver` borrows `money` and `bag` mutably for the whole session;
  construct it at the shop entrance and drop it when `update_frame` returns
  `Exit`.
