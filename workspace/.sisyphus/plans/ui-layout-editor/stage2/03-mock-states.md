# Step 2.3 — Mock States

Each menu's draw function takes a state struct (`MartState`, `BagState`, `PartyState`, etc.). To preview a menu, we need a sensible default state. The editor user will swap between mock states (e.g. "bag with 5 items", "bag full", "bag empty").

## Storage

`crates/pokered-data/ui_mock_states/<screen>.json` — one file per screen, each containing multiple named states.

Example: `crates/pokered-data/ui_mock_states/mart.json`
```json
{
  "schema_version": 1,
  "screen": "mart",
  "states": {
    "default_buy_3_items": {
      "variant": "buy_items_with_money",
      "money": 5000,
      "cursor": 0,
      "scroll_offset": 0,
      "items": [
        { "id": "POTION", "qty": 200 },
        { "id": "ANTIDOTE", "qty": 100 },
        { "id": "REPEL", "qty": 350 }
      ]
    },
    "buy_long_list": {
      "variant": "buy_items_with_money",
      "money": 9999,
      "cursor": 5,
      "scroll_offset": 3,
      "items": [
        { "id": "POTION", "qty": 200 },
        { "id": "ANTIDOTE", "qty": 100 },
        { "id": "PARALYZ_HEAL", "qty": 200 },
        { "id": "AWAKENING", "qty": 250 },
        { "id": "BURN_HEAL", "qty": 250 },
        { "id": "ICE_HEAL", "qty": 250 },
        { "id": "REPEL", "qty": 350 },
        { "id": "SUPER_REPEL", "qty": 500 }
      ]
    },
    "sell_no_items": {
      "variant": "sell_items_with_money",
      "money": 1234,
      "cursor": 0,
      "scroll_offset": 0,
      "items": []
    }
  }
}
```

## Schema (per-screen)

```typescript
interface MockStateFile {
  schema_version: 1;
  screen: string;                         // matches a screen in ui_layouts/
  states: Record<string, MockState>;      // named state presets
}

interface MockState {
  variant: string;                        // which variant of the screen to render
  // ... screen-specific fields ...
}
```

The state shape per screen mirrors the actual `XState` Rust struct. The mock JSON is parsed in `pokered-ui-preview` and converted to the typed state.

## Per-Menu State Mocks

For each migrated menu, define at least 3 mock states covering:

1. **Default / typical** — what most users see
2. **Edge case A** — empty list, max values, longest text
3. **Edge case B** — partial scroll, mid-cursor, mixed content

### Mock Inventory

| Screen | Default State | Edge States |
|--------|---------------|-------------|
| `main` | continue + new game | new game only (first boot) |
| `mart` | 3 items to buy | empty inventory, 99-item list (scroll test) |
| `bag` | 8 items, mixed types | empty bag, full bag (20 items), key items only |
| `party` | 3 pokemon, mixed HP | 1 pokemon (level 5), 6 pokemon all fainted, 6 pokemon all full HP |
| `stats` | level 50 with 4 moves | level 100 max stats, level 1 with 1 move |
| `naming` | "POKEMON" → uppercase keyboard | switching to lowercase, switching to symbols |
| `options` | all defaults | all maxed (slow text, no music, set battle, off animation) |
| `save` | first save | overwrite save (existing data shown) |
| `start` | overworld defaults | post-pokedex (extra menu entry) |
| `dialog` | short text | long wrapped text, text with player name substitution |
| `battle_main` | normal turn | low HP critical, status afflicted |
| `battle_move` | 4 moves | 1 move learned, all moves out of PP |
| `battle_party` | 3 pokemon | only 1 conscious, all fainted |
| `battle_bag` | several throwables | empty bag in battle |
| `battle_text` | "Pikachu used Thunder!" | long messages with line wrapping |

## Source of Mock Data

Mocks should reflect **realistic** game data, not arbitrary numbers:

- Item IDs must match `constants/item_constants.asm`
- Pokemon species names must be valid
- Move names must be valid
- HP / stats must respect game rules (min 1 HP, level 1-100)

For trickiest cases (party, stats), capture from actual `pokered-emu` save states:

```bash
# Idea — actual implementation depends on what pokered-emu exposes
cargo run -p pokered-emu --bin save-to-mock -- \
    --save-file ./test-saves/midgame.sav \
    --screen party \
    > crates/pokered-data/ui_mock_states/party.json
```

This **bootstraps** the mock files. After bootstrap, hand-tune for clarity (e.g. give pokemon memorable names like "PIKA", "BULB" for editor screenshots).

## Loading in `pokered-ui-preview`

```rust
// crates/pokered-ui-preview/src/mock_states.rs

use serde::Deserialize;

#[derive(Deserialize)]
pub struct MartMockState {
    pub variant: String,
    pub money: u32,
    pub cursor: u32,
    pub scroll_offset: usize,
    pub items: Vec<MockItem>,
}

#[derive(Deserialize)]
pub struct MockItem {
    pub id: String,
    pub qty: u32,
}

// Convert to actual game state struct used by menus::mart::draw_*
impl MartMockState {
    pub fn to_game_state(&self) -> pokered_ui::menus::mart::MartState {
        // map String item id → ItemId enum, etc.
        unimplemented!()
    }
}

// Default state is embedded at build time:
pub fn default_mart_state() -> MartMockState {
    static DEFAULT: &str = include_str!("../../pokered-data/ui_mock_states/mart.json");
    let file: MockStateFile = serde_json::from_str(DEFAULT).unwrap();
    file.states["default_buy_3_items"].clone()
}
```

(Use `include_str!` so mocks ship inside the wasm binary — no extra fetch.)

## Editor Integration (Stage 3 preview)

The editor will:
1. Call `session.list_mock_states("mart")` → `["default_buy_3_items", "buy_long_list", "sell_no_items"]`
2. Show as dropdown
3. On selection: `session.set_mock_state("mart", "buy_long_list")` → re-render
4. Optionally: edit individual fields (money, cursor) → `session.set_state(json)` for ad-hoc tweaks

## Acceptance

- [ ] `crates/pokered-data/ui_mock_states/<screen>.json` exists for every migrated screen
- [ ] Each file has at least 3 named states
- [ ] All item/pokemon/move IDs in mocks are valid (verified by build.rs validation)
- [ ] `pokered-ui-preview` exposes `list_mock_states(screen) -> Vec<String>`
- [ ] `pokered-ui-preview` can load any mock state and pass it to its draw function
- [ ] Each mock state, rendered with its default layout, produces a non-empty pixel buffer that visually matches game behavior

## Effort

1 day. The Pokemon/item/move data is the time sink — mocks must use real IDs, and validation against the constants is fiddly. Capturing from real save states helps but adds emulator-tooling overhead.
