# jrpg-engine 开发者指南

> **jrpg-engine** 是一个通用的 JRPG 游戏引擎框架，基于 Game Boy 瓦片渲染原理构建，用 Rust 编写。它提供了地图系统、回合制战斗、物品管理、存档、对话引擎、菜单系统等完整的 JRPG 核心功能。

---

## 目录

1. [架构概览](#1-架构概览)
2. [快速开始](#2-快速开始)
3. [核心概念](#3-核心概念)
4. [地图系统](#4-地图系统)
5. [NPC 系统](#5-npc-系统)
6. [战斗与怪物系统](#6-战斗与怪物系统)
7. [中文与多语言支持](#7-中文与多语言支持)
8. [对话与文本引擎](#8-对话与文本引擎)
9. [菜单系统](#9-菜单系统)
10. [物品系统](#10-物品系统)
11. [存档系统](#11-存档系统)
12. [事件与触发器系统](#12-事件与触发器系统)
13. [渲染系统](#13-渲染系统)
14. [API 参考](#14-api-参考)

---

## 1. 架构概览

### 1.1 项目结构

```
workspace/
├── Cargo.toml                      # Workspace 根配置
├── jrpg-template/                  # cargo-generate 模板，用于快速创建新游戏
│   ├── assets/                     # 地图、瓦片集、脚本
│   └── src/main.rs                 # 游戏主循环
│
├── crates/
│   ├── jrpg-engine/                # 🎯 核心引擎 —— 所有 trait 定义与通用类型
│   ├── jrpg-engine-tiled/          # 🗺️ Tiled .tmx JSON 解析器
│   ├── jrpg-engine-script/         # 📜 JS 脚本引擎 (Boa)
│   ├── jrpg-renderer/              # 🎨 现代像素字体渲染、UI DSL 布局引擎
│   ├── jrpg-ui/                    # 🖼️ 可复用的 JRPG UI 组件库
│   ├── jrpg-tui/                   # 🖥️ 终端 UI 后端
│   ├── jrpg-audio/                 # 🔊 音频引擎
│   ├── jrpg-web/                   # 🌐 WebAssembly 构建
│   └── jrpg-app/                   # 🚀 桌面可执行程序入口
│
└── examples/
    └── pokered/                    # Pokémon Red/Blue 重写（引擎的参考实现）
        └── crates/
            ├── pokered-core/       # 游戏逻辑
            ├── pokered-data/       # 游戏数据（151种精灵、招式、地图等）
            ├── pokered-renderer/   # 图形渲染
            ├── pokered-ui/         # UI 组件
            ├── pokered-audio/      # 音频
            └── pokered-app/        # 桌面程序入口
```

### 1.2 核心理念

jrpg-engine 遵循以下设计原则：

- **Provider 模式**：游戏数据通过 trait 提供，引擎本身不包含任何具体游戏数据
- **泛型关联类型**：所有标识符类型（地图 ID、物品 ID、怪物 ID）都是泛型参数，由实现者定义
- **零平台依赖**：引擎核心（`jrpg-engine`）无 I/O、无 GPU、无平台调用
- **可组合 trait**：各系统 trait 独立，不需要全部实现即可编译最小 JRPG

### 1.3 快速架构决策

| 你想做什么 | 需要实现的 trait | 参考示例 |
|-----------|-----------------|---------|
| 显示地图 | `MapTrait` + `MapProvider` + `TilesetTrait` + `TilesetProvider` | `pokered-data` |
| 玩家移动 | `TileMetaTrait` + `TileMetadata` | `pokered-data` |
| 对话系统 | `TextProvider` | `pokered-core` 的 `PokemonTextProvider` |
| 战斗系统 | `BattleProvider` + `TypeChart` + `BattleAI` + `EffectHandler` | `pokered-core` |
| 菜单系统 | `MenuProvider` | `pokered-data` |
| 物品背包 | `ItemProvider` + `ShopProvider` | `pokered-data` |
| 存档读档 | `SaveData` + `SaveStorage` | `pokered-core` |
| 色板渲染 | `PaletteTrait` + `PaletteProvider` | `pokered-data` |

---

## 2. 快速开始

### 2.1 使用 jrpg-template 创建新项目

```bash
git clone https://github.com/your-org/pokered-rust.git
cd workspace

# 方式一：使用 cargo-generate
cargo generate --path ./jrpg-template --name my-jrpg
cd my-jrpg

# 方式二：手动复制
cp -r jrpg-template my-jrpg
cd my-jrpg
# 编辑 Cargo.toml，将 {{project-name}} 替换为 my-jrpg

cargo run --release
```

### 2.2 模板项目结构

```
my-jrpg/
├── Cargo.toml             # 依赖 jrpg-engine, jrpg-engine-tiled, jrpg-engine-script
├── src/
│   └── main.rs            # 游戏主循环：加载地图、渲染图层、处理输入、摄像机跟随
├── assets/
│   ├── demo.tmx           # 20×15 瓦片地图（Tiled JSON 格式）
│   ├── tileset.png        # RGBA 瓦片集（8×8 像素瓦片，水平排列）
│   └── script.js          # 地图事件脚本
└── README.md
```

### 2.3 制作自己的游戏

1. **设计地图**：使用 [Tiled](https://www.mapeditor.org/) 编辑器，导出为 JSON 格式（.tmx）
2. **创建瓦片集**：制作 RGBA PNG 图片，8×8 像素瓦片水平排列
3. **编写地图脚本**：使用 JavaScript，实现 `onEnter()`、`onStep(x, y)`、`onInteract(facingX, facingY)`
4. **替换资源**：放入 `assets/` 目录
5. **自定义 main.rs**：调整 `tiled_gid_to_tileset_idx` 映射关系

### 2.4 操作键位

| 按键 | 功能 |
|------|------|
| 方向键 | 移动玩家（每次一格） |
| Z / Enter | 确认 / 交互（A 键） |
| X / Backspace | 取消 / 跑步（B 键） |
| Return / Space | 打开菜单（Start） |
| Escape | 退出 |

---

## 3. 核心概念

### 3.1 GameData —— 中央依赖注入点

`GameData` 是引擎的核心 trait，所有游戏数据子系统通过它提供：

```rust
use jrpg_engine::GameData;

struct MyGameData;

impl GameData for MyGameData {
    type Tileset = MyTilesetId;     // 瓦片集 ID 枚举
    type Map = MyMapId;             // 地图 ID 枚举
    type Palette = MyPaletteId;     // 色板 ID 枚举
    type TileMeta = MyTileMetaId;   // 瓦片元数据 ID
    type Move = MyMoveId;           // 招式 ID
    type Item = MyItemId;           // 物品 ID
    type Species = MySpeciesId;     // 物种/怪物 ID

    fn tileset_provider(&self) -> &dyn TilesetProvider<Self::Tileset> { &MY_PROVIDER }
    fn map_provider(&self) -> &dyn MapProvider<Self::Map> { &MY_PROVIDER }
    fn palette_provider(&self) -> &dyn PaletteProvider<Self::Palette> { &MY_PROVIDER }
    fn tile_metadata(&self) -> &dyn TileMetadata<Self::TileMeta> { &MY_PROVIDER }
    fn render_data(&self) -> &dyn RenderData<Move=Self::Move, Item=Self::Item, Species=Self::Species> { &MY_PROVIDER }
}
```

### 3.2 Provider 模式

引擎通过 trait 查询数据，而不是直接访问具体类型。这实现了：
- **依赖注入**：测试时可以注入 mock 实现
- **松耦合**：游戏数据变更不影响引擎代码
- **可复用**：同一个引擎可以驱动不同的 JRPG 游戏

---

## 4. 地图系统

### 4.1 地图数据模型

地图系统使用以下核心类型（定义在 `jrpg_engine::overworld::types`）：

```rust
// 地图数据
pub struct MapData<M: MapTrait, T: TilesetTrait, Mus> {
    pub id: M,                          // 地图 ID
    pub width: u8,                      // 宽度（瓦片数）
    pub height: u8,                     // 高度（瓦片数）
    pub tileset: T,                     // 使用的瓦片集
    pub music: Mus,                     // 背景音乐
    pub blocks: Vec<u8>,               // 方块数据（width * height 字节）
    pub warps: Vec<WarpPoint<M>>,      // 传送点
    pub npcs: Vec<NpcDefinition>,       // NPC 定义
    pub signs: Vec<Sign>,               // 告示牌
    pub connections: MapConnections<M>, // 地图连接
}
```

### 4.2 使用 Tiled 创建地图

推荐使用 [Tiled](https://www.mapeditor.org/) 编辑器创建地图，通过 `jrpg-engine-tiled` crate 自动解析：

```toml
[dependencies]
jrpg-engine-tiled = { path = "../crates/jrpg-engine-tiled" }
```

```rust
use jrpg_engine_tiled::parse_tiled_json;

let tmx_json = std::fs::read_to_string("assets/my_map.tmx")?;
let map_data: MapData<MyMapId, MyTilesetId, MyMusicId> = parse_tiled_json(&tmx_json)?;
```

**Tiled 使用要点：**
- 地图格式：JSON（.tmx → 导出为 JSON）
- 瓦片大小：8×8 像素（Game Boy 标准）
- 图层命名：按 `z_index` 排序（数值越小越靠后）
- 自定义属性：可用于设置碰撞、触发器、NPC 位置

### 4.3 地图连接（无缝滚动）

```rust
// 定义地图像素之间的连接
let connections = MapConnections {
    north: Some(MapConnection::new(Direction::Up, Route1, 0)),   // 北边连到 Route1
    south: Some(MapConnection::new(Direction::Down, PalletTown, 0)), // 南边连到真新镇
    west: None,
    east: None,
};
```

### 4.4 传送点

```rust
let warp = WarpPoint::new(
    10, 5,           // 地图坐标 (x, y)
    PokeCenterMap,   // 目标地图
    1,               // 目标地图中第几个传送点
);
```

### 4.5 碰撞系统

碰撞类型定义在 `jrpg_engine::tile_meta::CollisionType`：

```rust
pub enum CollisionType {
    Passable,                          // 可通行
    Impassable,                        // 不可通行
    Ledge { direction: u8 },          // 悬崖（可跳下）
    Counter,                           // 柜台（可从背后交互）
    Grass(Option<u8>),                // 草丛（触发遇敌）
    Water,                             // 水面（需要冲浪）
    Warp,                              // 传送门
    Door,                              // 门
}
```

实现 `TileMetadata` trait 为你的瓦片集提供碰撞数据：

```rust
impl TileMetadata<MyTileMeta> for MyTileMetaProvider {
    fn is_passable(&self, tileset: MyTileMeta, tile_id: u8) -> bool { /* ... */ }
    fn collision_type(&self, tileset: MyTileMeta, tile_id: u8) -> CollisionType { /* ... */ }
    fn is_ledge(&self, tileset: MyTileMeta, tile_id: u8) -> bool { /* ... */ }
    fn is_counter(&self, tileset: MyTileMeta, tile_id: u8) -> bool { /* ... */ }
    fn is_grass(&self, tileset: MyTileMeta, tile_id: u8) -> bool { /* ... */ }
    fn get_grass_tile(&self, tileset: MyTileMeta) -> Option<u8> { /* ... */ }
}
```

### 4.6 Metatile 系统

Metatile（元瓦片）是引擎对 Game Boy "方块"概念的泛化。一个 metatile 由 N×N 个瓦片组成（支持 2×2、3×3、4×4 等任意尺寸）：

```rust
use jrpg_engine::metatile::{MetatileDef, MetatileRegistry, MetatileCell, TriggerDef, TriggerType};

// 创建一个 4×4 的 metatile（Game Boy 标准）
let mut mt = MetatileDef::new((4, 4));

// 设置瓦片内容
mt.tiles[0] = MetatileCell { tile_id: 1, flip_x: false, flip_y: false, palette_bank: 0 };

// 设置碰撞
mt.collision[0] = CollisionCell::impassable();

// 设置触发器
mt.trigger = Some(TriggerDef {
    script_name: "heal_party".into(),
    trigger_type: TriggerType::OnStep,
});

// 注册到 tileset 的 metatile 注册表
let mut registry = MetatileRegistry::new();
let block_index = registry.add_def(mt); // 地图方块数据引用此索引
```

### 4.7 摄像机系统

```rust
use jrpg_engine::camera::{Camera, Vec2, Rect};

let mut cam = Camera::new(160.0, 144.0); // Game Boy 屏幕尺寸
cam.clamp_to_bounds(Rect::new(0.0, 0.0, 2048.0, 2048.0)); // 世界边界
cam.follow_target(Vec2::new(player_x, player_y));           // 跟随玩家
cam.smooth_factor = 0.2; // 平滑跟随（0.0 = 瞬移）

// 每帧调用
cam.update(dt);

// 世界坐标 → 屏幕坐标
let screen_pos = cam.world_to_screen(Vec2::new(npc_x, npc_y));
```

---

## 5. NPC 系统

### 5.1 NPC 定义

```rust
use jrpg_engine::overworld::types::{NpcDefinition, NpcMovementType, Direction};

let npc = NpcDefinition::new(
    1,                          // sprite_id: 精灵 ID
    10, 5,                      // 起始位置 (x, y)
    NpcMovementType::Wander,    // 移动类型
    Direction::Down,            // 朝向
    3,                          // 移动范围（0 = 不移动）
    42,                         // text_id: 交互时显示的文本
);
```

### 5.2 NPC 移动类型

| 类型 | 行为 |
|------|------|
| `Stationary` | 原地不动，面朝固定方向 |
| `Wander` | 在范围内随机移动 |
| `FixedPath` | 按固定路径移动 |
| `FacePlayer` | 对话时面向玩家 |

### 5.3 NPC 运行时状态

```rust
use jrpg_engine::overworld::npc_movement::NpcRuntimeState;

// 每帧更新 NPC 移动
update_npc_movement(npc_state, map_data, tile_metadata, &mut event_flags);

// 检查 NPC 是否在玩家前方
if let Some(npc) = npc_in_front_of_player(&player, &npc_states) { /* ... */ }

// 启动脚本化移动
start_scripted_move(npc_state, Direction::Up, 3); // 向上移动 3 格
```

### 5.4 NPC 交互

```rust
use jrpg_engine::overworld::npc_interaction::{try_interact, InteractionResult, check_line_of_sight};

// 尝试与 NPC 交互
let result = try_interact(npc_state, &player, &event_flags, &map_data);
match result {
    InteractionResult::Talk => { /* 显示对话 */ }
    InteractionResult::TrainerBattle => { /* 开始战斗 */ }
    InteractionResult::ItemPickup => { /* 获得物品 */ }
    InteractionResult::AlreadyDefeated => { /* 已击败的对话 */ }
}

// 检查训练师视线
let sight = check_line_of_sight(npc_state, &player);
```

---

## 6. 战斗与怪物系统

### 6.1 BattleProvider trait

战斗系统的核心是 `BattleProvider` trait。你需要为你的游戏实现这个 trait：

```rust
use jrpg_engine::battle::{BattleProvider, BattlerState, BattleState, DamageResult,
    MoveEffect, EffectResult, Weather, Terrain, EnumMap};

impl BattleProvider for MyBattleProvider {
    type Monster = MyMonster;
    type Move = MyMove;
    type Ability = MyAbility;
    type Status = MyStatus;
    type Stat = MyStat;
    type Species = MySpecies;
    type Type = MyType;
    type Item = MyItem;

    fn calculate_damage(&self, move_: &Self::Move, attacker: &BattlerState<Self>,
        defender: &BattlerState<Self>, random: u8, is_critical: bool) -> DamageResult {
        // 实现你的伤害公式
    }

    fn select_move(&self, battler: &BattlerState<Self>,
        state: &BattleState<Self>) -> Self::Move {
        // AI 招式选择
    }

    fn apply_move_effect(&self, effect: MoveEffect,
        user: &mut BattlerState<Self>, target: &mut BattlerState<Self>) -> EffectResult {
        // 应用招式效果
    }

    fn create_monster(&self, species: Self::Species, level: u8) -> BattlerState<Self> {
        // 根据物种和等级创建战斗单位
    }
}
```

### 6.2 战斗状态

```rust
// 创建战斗
let player_team = vec![player_battler];
let enemy_team = vec![enemy_battler];
let mut battle = BattleState::<MyBattleProvider>::new(player_team, enemy_team);

// 查询
let active = battle.active_player().unwrap();
let opponent = battle.active_opponent().unwrap();
```

### 6.3 战斗单位状态

```rust
let mut battler = BattlerState::<MyBattleProvider>::new(
    species, hp, max_hp, stats, moves
);

battler.take_damage(30);     // 受到 30 点伤害
battler.heal(20);            // 回复 20 点 HP（不超过 max_hp）
```

### 6.4 属性克制

```rust
pub trait TypeChart {
    type Type: PartialEq + Debug;
    fn effectiveness(attacking: &Self::Type, defending: &[Self::Type]) -> f32;
}

// 实现一个简单的剪刀石头布克制系统
impl TypeChart for MyTypeChart {
    type Type = Element;
    fn effectiveness(a: &Element, d: &[Element]) -> f32 {
        match (a, d.first().unwrap_or(&Element::Neutral)) {
            (Element::Fire, Element::Grass) => 2.0,  // 火克草
            (Element::Water, Element::Fire) => 2.0,   // 水克火
            (Element::Grass, Element::Water) => 2.0,  // 草克水
            (a, d) if a == d => 0.5,                   // 同属性减半
            _ => 1.0,                                   // 其他普通
        }
    }
}
```

### 6.5 招式效果

引擎提供 13 种招式效果分类：

| 效果 | 说明 |
|------|------|
| `Damage` | 纯伤害 |
| `Heal` | 回复 HP |
| `StatusCondition` | 施加状态异常 |
| `StatChange` | 能力值变化 |
| `MultiHit` | 多段攻击 |
| `Recharge` | 需要蓄力 |
| `DrainHp` | 吸血 |
| `Recoil` | 反伤 |
| `Flinch` | 畏缩 |
| `FieldEffect` | 场地效果 |
| `SpecialDamage` | 固定伤害 |
| `Ohko` | 一击必杀 |
| `MultiTurn` | 多回合招式 |

### 6.6 战场环境

```rust
// 天气
battle.weather = Weather::Rain;    // 下雨
battle.weather = Weather::Sun;     // 晴天
battle.weather = Weather::Sandstorm; // 沙暴
battle.weather = Weather::Snow;    // 冰雹

// 地形
battle.terrain = Terrain::Electric; // 电气场地
battle.terrain = Terrain::Grassy;   // 青草场地
battle.terrain = Terrain::Misty;    // 薄雾场地
battle.terrain = Terrain::Psychic;  // 精神场地
```

### 6.7 AI 系统

```rust
pub trait BattleAI<P: BattleProvider + ?Sized> {
    fn select_move(&self, battler: &BattlerState<P>, state: &BattleState<P>) -> P::Move;
    fn should_switch(&self, battler: &BattlerState<P>) -> bool;
    fn should_use_item(&self, battler: &BattlerState<P>) -> Option<P::Item>;
}
```

### 6.8 完整战斗示例

```rust
// 1. 创建战斗单位
let hero = provider.create_monster(MySpecies::Knight, 50);
let slime = provider.create_monster(MySpecies::Slime, 10);

// 2. 初始化战斗
let mut battle = BattleState::new(vec![hero], vec![slime]);

// 3. 单回合
let move_ = provider.select_move(battle.active_player().unwrap(), &battle);
let result = provider.calculate_damage(&move_, battle.active_player().unwrap(),
    battle.active_opponent().unwrap(), rand_val, false);
battle.active_opponent_mut().unwrap().take_damage(result.damage);

// 4. 检查结果
if provider.check_faint(battle.active_opponent().unwrap()) {
    // 敌人倒下了！
}
```

---

## 7. 中文与多语言支持

### 7.1 三条文本渲染路径

引擎支持**三种文本渲染方式**，以适应不同场景：

| 渲染路径 | 用途 | 中文支持 |
|---------|------|---------|
| **Modern Pixel Font** (`embedded_font.rs`) | UI 文本、对话、菜单 | ✅ 完整支持 |
| **Legacy GB Tilemap** (`charmap.rs`) | 复古 GB 风格文本 | ❌ 仅 ASCII |
| **Generic Text Engine** (`TextProvider`) | 框架级文本抽象 | 取决于实现 |

### 7.2 现代像素字体（推荐）

引擎使用 **Fusion Pixel 10px Monospaced** 字体（OFL-1.1 许可，由 TakWolf 制作）：

- **拉丁字符**：5px 半角宽度
- **CJK 字符**：10px 全角宽度
- **自动分发**：根据 Unicode 码位自动选择拉丁/CJK 渲染路径

```rust
use jrpg_renderer::embedded_font;

// 绘制中文字符
embedded_font::draw_char(framebuffer, '你', x, y, color);
embedded_font::draw_text(framebuffer, "你好，世界！", x, y, color);

// 判断是否为 CJK 字符
if embedded_font::is_cjk('中') {
    // 全角宽度处理
}

// 计算文本像素宽度
let width = embedded_font::text_width("你好");
```

### 7.3 添加中文字形

要添加新的中文字符：

1. **确保 BDF 字体文件包含该字符**
   - 字体位置：`crates/jrpg-renderer/fonts/fusion-pixel-10px-monospaced-zh_hans.bdf`（24,794 个字形）

2. **在 build.rs 的 CJK 字形列表中添加字符**
   ```rust
   // crates/jrpg-renderer/build.rs
   const CJK_CHARS: &str = "\
      你好世界欢迎来到宝可梦游戏\
      训练师战斗背包存档\
      火水草电冰龙一般格斗飞行毒地面岩石虫幽灵超能力\
      妙蛙种子小火龙杰尼龟皮卡丘卡比兽梦幻超梦梦\
      ";
   ```

3. **重新构建**
   ```bash
   cargo build -p jrpg-renderer
   ```

### 7.4 多语言数据管理

参考 `pokered-data/src/lang_data.rs` 的模式：

```rust
// 根据语言返回对应文本
fn species_name(species: SpeciesId, is_zh: bool) -> &'static str {
    if is_zh {
        match species {
            SpeciesId::Bulbasaur => "妙蛙种子",
            SpeciesId::Pikachu => "皮卡丘",
            // ...
        }
    } else {
        match species {
            SpeciesId::Bulbasaur => "BULBASAUR",
            SpeciesId::Pikachu => "PIKACHU",
            // ...
        }
    }
}
```

### 7.5 拼音输入法

引擎内置拼音输入法支持，用于命名界面：

```rust
use pokered_data::pinyin_dict::lookup_pinyin;

// 查找拼音对应的候选汉字
let candidates: Vec<char> = lookup_pinyin("ni");   // → ['你', '尼', '泥', ...]
let candidates: Vec<char> = lookup_pinyin("hao");  // → ['好', '号', '毫', ...]
```

拼音字典包含 400+ 条记录，位于 `pokered-data/src/pinyin_dict.rs`。

### 7.6 语言感知渲染

`FrameBufferPainter` 存储 `lang: Lang` 字段。当语言为中文时，会自动应用 **-1 像素 Y 偏移** 以对齐 CJK 字形：

```rust
let painter = FrameBufferPainter::new(framebuffer)
    .with_lang(Lang::Zh);  // 启用中文渲染
```

### 7.7 JS 脚本中的多语言支持

在使用 `jrpg-engine-script` 时，可通过 `game.t()` 实现双语文本：

```javascript
// game.t(en, zh) 根据当前语言返回对应文本
await game.showText(game.t(
    "Hello! Welcome to the world of POKéMON!",
    "你好！欢迎来到宝可梦的世界！"
));

// 条件判断
if (game.lang() === "zh") {
    await game.showText("常青森林\n前方请小心！");
} else {
    await game.showText("VIRIDIAN FOREST\nBe careful!");
}

// 选择框
const choice = await game.showTextChoice(
    game.t("Did you check out the MUSEUM?", "你去博物馆看过了吗？"),
    [game.t("YES", "是"), game.t("NO", "否")]
);
```

---

## 8. 对话与文本引擎

### 8.1 TextProvider trait

实现 `TextProvider` 来定义你的游戏字符编码：

```rust
use jrpg_engine::text::{TextProvider, ControlAction, DialogState, TileBuffer, TextStream};

impl TextProvider for MyTextProvider {
    type Char = MyChar;  // 你的字符类型（可以是枚举）

    fn decode_byte(&self, byte: u8) -> Option<Self::Char> {
        // 将字节解码为字符
        match byte {
            0x41..=0x5A => Some(MyChar::Ascii(byte as char)),
            0xFE => Some(MyChar::Newline),
            0xFF => Some(MyChar::Done),
            _ => None,
        }
    }

    fn render_char(&self, c: &Self::Char, buffer: &mut TileBuffer) {
        // 将字符绘制到 TileBuffer
    }

    fn is_control_code(&self, c: &Self::Char) -> bool {
        matches!(c, MyChar::Newline | MyChar::Done)
    }

    fn process_control(&self, c: &Self::Char, state: &mut DialogState) -> ControlAction {
        match c {
            MyChar::Newline => ControlAction::Newline,
            MyChar::Done => ControlAction::Done,
            _ => ControlAction::None,
        }
    }

    fn string_width(&self, text: &[Self::Char]) -> u16 {
        // 计算文本像素宽度
        text.len() as u16 * 8 // 等宽字体
    }
}
```

### 8.2 DialogEngine —— 逐字打字效果

```rust
use jrpg_engine::text::DialogEngine;

let provider = MyTextProvider;
let mut engine = DialogEngine::new(provider);
let mut buffer = TileBuffer::new();

// 开始对话
engine.open_dialog(&[0x48, 0x45, 0x4C, 0x4C, 0x4F, 0xFF]); // "HELLO" + DONE

// 每帧调用一次
while engine.is_active() {
    engine.update(&mut buffer);  // 逐字显示
}

// 玩家按 A 键推进对话
engine.advance();
```

### 8.3 控制码

| 控制动作 | 说明 |
|---------|------|
| `Newline` | 光标移到下一行 |
| `PageBreak` | 暂停，等待玩家按键后清屏 |
| `Done` | 结束当前对话 |
| `SetSpeed(n)` | 设置打字速度（0 = 即时） |
| `Clear` | 清空文本缓冲区 |
| `WaitInput` | 暂停，等待玩家按键 |
| `MoveCursor {x, y}` | 移动光标到指定位置 |
| `Scroll` | 向上滚动一行 |
| `Pause(n)` | 暂停 n 帧 |

### 8.4 对话状态

```rust
pub enum DialogMode {
    Typing,           // 正在逐字显示
    Paused,           // 暂停中
    WaitingForInput,  // 等待玩家按键
    Scrolling,        // 滚动中
    Done,             // 对话结束
}
```

---

## 9. 菜单系统

### 9.1 MenuProvider trait

```rust
use jrpg_engine::menu::{MenuProvider, MenuOption, MenuLayout};

impl MenuProvider for MyMenuProvider {
    type MenuId = MyMenuId;

    fn title(&self, menu: Self::MenuId) -> &str { "菜单标题" }
    fn options(&self, menu: Self::MenuId) -> &[MenuOption] { &self.items }
    fn option_count(&self, menu: Self::MenuId) -> u8 { 3 }
    fn scrollable(&self, menu: Self::MenuId) -> bool { false }
    fn layout(&self, menu: Self::MenuId) -> MenuLayout {
        MenuLayout::new(5, 3, 10, 9)  // (tile_x, tile_y, width, height)
            .with_spacing(2)
            .with_cursor(true)
    }
}
```

### 9.2 MenuSystem —— 菜单控制器

```rust
use jrpg_engine::menu::{MenuSystem, MenuInput, MenuAction};

let provider = MyMenuProvider { /* ... */ };
let mut menu = MenuSystem::new(&provider);

// 打开菜单
menu.open(MyMenuId::MainMenu);

// 处理输入（每帧一次）
let input = MenuInput { down: true, ..Default::default() };
let action = menu.handle_input(&input);
match action {
    MenuAction::Selected(0) => { /* 选项 1 被选中 */ }
    MenuAction::Selected(1) => { /* 选项 2 被选中 */ }
    MenuAction::Cancelled => { /* 取消 */ }
    MenuAction::Up | MenuAction::Down => { /* 光标移动 */ }
    _ => {}
}

// 渲染菜单（使用 Painter trait）
menu.render(&mut painter);
```

### 9.3 菜单选项

```rust
use jrpg_engine::menu::MenuOption;

let options = vec![
    MenuOption::new("新游戏"),              // 可选的正常选项
    MenuOption::new("继续"),               // 可选的正常选项
    MenuOption::disabled("需要存档"),       // 禁用（灰色）
];
```

### 9.4 菜单布局与样式

```rust
use jrpg_engine::menu::{BorderStyle, CursorStyle, CursorAnchor, MenuConfig, EdgeInsets};

// 边框样式（9格边框）
let border = BorderStyle {
    corner_tl: 192, corner_tr: 193,
    corner_bl: 198, corner_br: 199,
    edge_top: 194, edge_bottom: 197,
    edge_left: 195, edge_right: 196,
    fill_bg: 200,
};

// 光标样式
let cursor = CursorStyle::new(Some(223), CursorAnchor::CenterLeft);

// 菜单渲染配置
let config = MenuConfig::new(area, Some(border), content, cursor);
```

---

## 10. 物品系统

### 10.1 ItemProvider trait

```rust
use jrpg_engine::items::{ItemProvider, ItemResult, Inventory};

impl ItemProvider for MyItemProvider {
    type Item = MyItem;
    type Effect = MyEffect;
    type Monster = MyMonster;

    fn item_name(&self, item: &Self::Item) -> &str { "伤药" }
    fn item_description(&self, item: &Self::Item) -> &str { "回复 20 点 HP" }
    fn item_price(&self, item: &Self::Item) -> u32 { 300 }
    fn can_use_outside_battle(&self, item: &Self::Item) -> bool { true }
    fn can_use_in_battle(&self, item: &Self::Item) -> bool { true }
    fn consume(&self, item: &Self::Item) -> bool { true } // 使用后消失
    fn item_effect(&self, item: &Self::Item) -> MyEffect { MyEffect::Heal(20) }

    fn use_on_monster(&self, item: &Self::Item, monster: &mut Self::Monster) -> ItemResult {
        // 应用物品效果
        monster.current_hp = (monster.current_hp + 20).min(monster.max_hp);
        ItemResult::Used
    }
}
```

### 10.2 背包管理

```rust
use jrpg_engine::items::Inventory;

let mut bag = Inventory::new();

// 添加物品
bag.add(Potion, 3);   // 获得 3 个伤药
bag.add(Potion, 5);   // 再获得 5 个（自动堆叠为 8 个）

// 检查数量
assert!(bag.contains(&Potion, 5));

// 使用物品
bag.remove(&Potion, 1); // 使用 1 个
```

### 10.3 商店系统

```rust
use jrpg_engine::items::ShopProvider;

impl ShopProvider for MyShopProvider {
    type Item = MyItem;
    type ShopId = MyShopId;

    fn shop_inventory(&self, shop_id: &Self::ShopId) -> Vec<(Self::Item, u32)> {
        vec![
            (Potion, 300),   // 伤药 300 金币
            (Elixir, 500),   // 万灵药 500 金币
        ]
    }

    fn shop_name(&self, shop_id: &Self::ShopId) -> &str {
        "友好商店"
    }
}
```

### 10.4 物品分类

```rust
pub enum BagCategory {
    Items,      // 一般道具
    Medicine,   // 药品
    Balls,      // 捕获道具
    Battle,     // 战斗道具
    Key,        // 重要道具（不可丢弃）
    Other,      // 其他
}
```

---

## 11. 存档系统

### 11.1 SaveData trait

```rust
use jrpg_engine::save::{SaveData, SaveManager, SaveStorage, SaveSlot, SaveError};

impl SaveData for MySave {
    fn serialize(&self) -> Vec<u8> {
        // 序列化为字节数组（不包含校验和）
        let mut data = Vec::new();
        data.extend_from_slice(self.player_name.as_bytes());
        data.push(self.level);
        data.extend_from_slice(&self.gold.to_le_bytes());
        data
    }

    fn deserialize(data: &[u8]) -> Result<Self, SaveError> {
        // 从字节数组反序列化（不包含校验和）
        // ...
        Ok(MySave { /* ... */ })
    }

    fn save_size() -> usize {
        // 总存档大小（包含 2 字节校验和）
        1024
    }
}
```

### 11.2 使用 SaveManager

```rust
use jrpg_engine::save::{SaveManager, SaveSlot, InMemoryStorage};

// 创建存档管理器（使用内存存储——生产环境应实现文件存储）
let storage = Box::new(InMemoryStorage::new());
let manager = SaveManager::<MySave>::new(storage);

// 存档
manager.save(SaveSlot::Slot1, &my_save_data)?;

// 读档
let loaded = manager.load(SaveSlot::Slot1)?;

// 列出所有存档位
let slots = manager.list_slots();
for (slot, has_data) in slots {
    println!("{:?}: {}", slot, if has_data { "有数据" } else { "空" });
}

// 删除存档
manager.delete(SaveSlot::Slot1)?;
```

### 11.3 实现文件存储

```rust
use std::fs;

struct FileStorage { dir: String }

impl SaveStorage for FileStorage {
    fn write(&self, slot: usize, data: &[u8]) -> Result<(), SaveError> {
        let path = format!("{}/save_{}.sav", self.dir, slot);
        fs::write(&path, data).map_err(|e| SaveError::IoError(e.to_string()))
    }

    fn read(&self, slot: usize) -> Result<Vec<u8>, SaveError> {
        let path = format!("{}/save_{}.sav", self.dir, slot);
        fs::read(&path).map_err(|e| SaveError::IoError(e.to_string()))
    }

    fn slot_exists(&self, slot: usize) -> bool {
        std::path::Path::new(&format!("{}/save_{}.sav", self.dir, slot)).exists()
    }

    fn delete_slot(&self, slot: usize) -> Result<(), SaveError> {
        let path = format!("{}/save_{}.sav", self.dir, slot);
        fs::remove_file(&path).map_err(|e| SaveError::IoError(e.to_string()))
    }
}
```

### 11.4 CRC16 校验

引擎自动使用 CRC-16/XMODEM（多项式 `0x1021`）校验存档完整性：

```
存档数据结构： [游戏数据字节...] [2 字节 CRC16 校验和 (LE)]
```

---

## 12. 事件与触发器系统

### 12.1 TriggerManager

触发器系统允许你在特定瓦片上绑定脚本函数：

```rust
use jrpg_engine::trigger_manager::{TriggerManager, Trigger};
use jrpg_engine::metatile::TriggerType;

let mut trigger_mgr = TriggerManager::new();

// 注册触发器
trigger_mgr.add_trigger(Trigger::single_tile(
    "heal_npc",           // 触发器 ID
    "PalletTown",         // 所在地图
    TriggerType::OnStep,  // 踩上时触发
    3, 5,                 // 坐标 (x, y)
    "healParty",          // 脚本函数名
    true,                 // 一次性触发
));
```

### 12.2 触发器类型

| 类型 | 触发条件 | 典型用途 |
|------|---------|---------|
| `OnStep` | 每帧站在区域内 | 回复点、毒沼泽 |
| `OnEnter` | 首次进入区域 | 剧情触发、过场动画 |
| `OnInteract` | 玩家按下 A 键 | NPC 对话、门、宝箱 |

### 12.3 游戏主循环中的触发器检查

```rust
// 每帧检查
let triggered: Vec<String> = trigger_mgr.check_triggers("PalletTown", player_x, player_y);
for script_name in &triggered {
    script_engine.call_function(script_name);
}

// A 键交互
if input.a {
    if let Some(script_name) = trigger_mgr.check_interact_mut("PalletTown", facing_x, facing_y) {
        script_engine.call_function(&script_name);
    }
}
```

### 12.4 脚本配置中的触发器命名

在使用 `MapScriptConfig`（JSON 配置）定义坐标触发器时，每个 `coordEvent` 通过 `name` 字段标识，而非自动生成的 `"coord_{x}_{y}"` 格式。`name` 为 camelCase 字符串，在同一地图内必须唯一。

```json
{
  "coordEvents": [
    { "name": "northExit1", "position": [4, 1], "trigger": "coordNorthExit" }
  ]
}
```

脚本引擎通过 `coord_event_fn(x, y)` 或 `coord_event_by_name(name)` 查找对应的 JS 函数名。`.scene` 文件中的 `@trigger(name = "northExit1")` 参数直接映射到此 `name` 字段。建议为每个 coord event 赋予有意义的名称（如 `northExit1`、`oakLabTrigger`），提高可读性。

### 12.5 JS 脚本引擎

使用 `jrpg-engine-script` 来执行 JavaScript 地图脚本：

```javascript
// assets/script.js

// 地图首次进入时触发
export async function onEnter() {
    await game.showText("欢迎来到新手村！");
}

// 每帧踩在特定瓦片上时触发
export async function onStep(x, y) {
    // x, y 是当前玩家坐标
}

// 玩家按下 A 键时触发
export async function onInteract(facingX, facingY) {
    await game.showText("这是一个告示牌。");
}
```

### 12.6 事件标志

```rust
use jrpg_engine::overworld::event_flags::EventFlags;

let mut flags = EventFlags::new();

// 设置事件标志
flags.set("defeated_gym_leader");

// 检查事件标志
if flags.check("defeated_gym_leader") {
    // 道馆首领已被击败
}

// 重置事件标志
flags.reset("defeated_gym_leader");
```

---

## 13. 渲染系统

### 13.1 FrameBuffer

帧缓冲区是渲染的核心数据结构：

```rust
use jrpg_engine::render::FrameBuffer;

// 创建帧缓冲（160×144 像素 = Game Boy 分辨率）
let mut fb = FrameBuffer::default();

// 或自定义分辨率
let mut fb = FrameBuffer::new(320, 240);

// 常量
const SCREEN_WIDTH: usize = 160;
const SCREEN_HEIGHT: usize = 144;
const TILE_SIZE: usize = 8;  // 瓦片尺寸
```

### 13.2 Rgba 颜色

```rust
use jrpg_engine::render::Rgba;

let red = Rgba { r: 255, g: 0, b: 0, a: 255 };
let blue = Rgba { r: 0, g: 0, b: 255, a: 255 };
let transparent = Rgba { r: 0, g: 0, b: 0, a: 0 };
```

### 13.3 Painter trait

Painter 是渲染的抽象接口，支持像素渲染和录制回放：

```rust
use jrpg_engine::render::{Painter, TilePos, TileRect, InkColor, Ui, Frame};

// 使用 Painter
fn draw_scene<P: Painter>(painter: &mut P) {
    let mut ui = Ui::new(painter);

    // 绘制文本框
    ui.text_box(TileRect::new(0, 12, 20, 6), InkColor::Black, true, |f| {
        f.label(0, 0, "你好，冒险者！", InkColor::Black);
    });
}
```

### 13.4 瓦片坐标系统

```rust
use jrpg_engine::render::{TilePos, TileRect};

let pos = TilePos::new(5, 3);       // 第 5 列，第 3 行
let rect = TileRect::new(0, 12, 20, 6);  // (x, y, w, h)
```

### 13.5 地图图层渲染

```rust
use jrpg_engine::render::{MapLayer, MapRenderState, BlendMode};
use jrpg_engine::tilemap::Tilemap;

// 创建地图图层
let mut state = MapRenderState::new();

// 背景层
let bg_tilemap = Tilemap::new(32, 32);
let mut bg_layer = MapLayer::new(bg_tilemap, 0);  // z_index = 0（最底层）
bg_layer.scroll_factor = (0.5, 0.5);  // 视差滚动
state.add_layer(bg_layer);

// 前景层
let fg_tilemap = Tilemap::new(32, 32);
let mut fg_layer = MapLayer::new(fg_tilemap, 1);
fg_layer.blend_mode = BlendMode::Normal;
state.add_layer(fg_layer);

assert_eq!(state.visible_layer_count(), 2);
```

### 13.6 Tilemap

新的 Tilemap 支持 16 位元数据，替代传统 Game Boy 的 1 字节瓦片索引：

```rust
use jrpg_engine::tilemap::{Tilemap, TilemapEntry};
use jrpg_engine::tile_meta::CollisionType;

let mut tm = Tilemap::new(32, 32);

// 设置瓦片
let entry = TilemapEntry {
    tile_id: 42,
    flip_h: false,
    flip_v: true,
    palette_group: 2,
    priority: 1,
    collision_override: Some(CollisionType::Impassable),
    animation_group: Some(3),  // 动画组（水面、花草）
    ..Default::default()
};
tm.set(10, 5, entry);

// 从 Game Boy 格式转换
let gb_data: Vec<u8> = load_gb_tilemap();
let tm = Tilemap::from_gb_tilemap(&gb_data, 32, 32);
```

### 13.7 色板系统

```rust
use jrpg_engine::palette::{PaletteTrait, PaletteProvider, SgbColor, SgbPaletteId};

impl PaletteTrait for MyPaletteId {}

impl PaletteProvider<MyPaletteId> for MyPaletteProvider {
    fn bg_palette(&self, palette: MyPaletteId) -> [u8; 4] { /* ... */ }
    fn obj_palette0(&self, palette: MyPaletteId) -> [u8; 4] { /* ... */ }
    fn obj_palette1(&self, palette: MyPaletteId) -> [u8; 4] { /* ... */ }
    fn overworld_palette_for(&self, tileset_id: u8, map_id: u8, last_map: u8) -> MyPaletteId { /* ... */ }
    fn monster_palette(&self, species_index: u8) -> MyPaletteId { /* ... */ }
    fn hp_bar_to_palette_id(&self, hp_bar_color: u8) -> MyPaletteId { /* ... */ }
}
```

### 13.8 色板交换（Palette Swap）

```rust
use jrpg_engine::palette_swap::{PaletteSwapManager, PaletteSwap};

let mut manager = PaletteSwapManager::new();

// 定义夜晚色板
let night_swap = PaletteSwap {
    name: "night".into(),
    mappings: vec![(0, [Rgba { r: 10, g: 10, b: 20, a: 255 }; 4])].into_iter().collect(),
};
manager.add_swap(night_swap);
manager.set_active("night");

// 渲染时应用色板交换
let mut colors = original_colors;
manager.apply(palette_group, &mut colors);
```

### 13.9 RenderConfig

```rust
use jrpg_engine::render_config::RenderConfig;

// Game Boy 标准分辨率
let config = RenderConfig::default();  // 160×144

// 自定义分辨率
let config = RenderConfig::new(320, 240);
```

---

## 14. API 参考

### 14.1 核心 Trait 清单

| Trait | 所在模块 | 用途 |
|-------|---------|------|
| `GameData` | `lib.rs` | 中央依赖注入点，提供所有游戏数据 |
| `TilesetTrait` | `tileset` | 瓦片集标识符 |
| `TilesetProvider<T>` | `tileset` | 提供瓦片集数据 |
| `TileMetaTrait` | `tile_meta` | 瓦片元数据标识符 |
| `TileMetadata<T>` | `tile_meta` | 提供碰撞和地形元数据 |
| `MapTrait` | `map` | 地图标识符 |
| `MapProvider<M>` | `map` | 提供地图数据 |
| `PaletteTrait` | `palette` | 色板标识符 |
| `PaletteProvider<P>` | `palette` | 提供色板数据 |
| `RenderData` | `render_data` | 提供渲染时字符串查找 |
| `TextProvider` | `text` | 文本编码和渲染 |
| `MenuProvider` | `menu` | 提供菜单数据和布局 |
| `MenuInputSource` | `menu` | 平台输入 → 菜单输入 |
| `BattleProvider` | `battle` | 战斗数据、伤害公式、招式效果 |
| `TypeChart` | `battle` | 属性克制矩阵 |
| `BattleAI<P>` | `battle` | 战斗 AI 决策 |
| `EffectHandler<P>` | `battle` | 招式效果处理器 |
| `ItemProvider` | `items` | 物品元数据和使用效果 |
| `ShopProvider` | `items` | 商店库存和名称 |
| `SaveData` | `save` | 存档数据序列化/反序列化 |
| `SaveStorage` | `save` | 平台存储后端 |
| `Painter` | `render::painter` | 渲染抽象接口 |

### 14.2 核心类型清单

| 类型 | 所在模块 | 说明 |
|------|---------|------|
| `Rgba` | `render::color` | RGBA 颜色 |
| `InkColor` | `render::ink_color` | 预定义颜色枚举 |
| `FrameBuffer` | `render::framebuffer` | 像素帧缓冲 |
| `TilePos` | `render::geometry` | 瓦片坐标 |
| `TileRect` | `render::geometry` | 瓦片矩形 |
| `Tilemap` | `tilemap` | 瓦片地图（16位元数据） |
| `TilemapEntry` | `tilemap` | 瓦片条目 |
| `MapLayer` | `render` | 地图渲染图层 |
| `MapRenderState` | `render` | 地图渲染状态 |
| `BlendMode` | `render` | 图层混合模式 |
| `RenderConfig` | `render_config` | 渲染配置 |
| `MetatileDef` | `metatile` | 元瓦片定义 |
| `MetatileRegistry` | `metatile` | 元瓦片注册表 |
| `CollisionType` | `tile_meta` | 碰撞类型 |
| `Direction` | `overworld::types` | 方向枚举 |
| `MapData<M,T,Mus>` | `overworld::types` | 地图运行时数据 |
| `MapConnection<M>` | `overworld::types` | 地图连接 |
| `MapConnections<M>` | `overworld::types` | 地图连接集合 |
| `WarpPoint<M>` | `overworld::types` | 传送点 |
| `NpcDefinition` | `overworld::types` | NPC 定义 |
| `NpcMovementType` | `overworld::types` | NPC 移动模式 |
| `PlayerState` | `overworld::types` | 玩家状态 |
| `OverworldState<M>` | `overworld::types` | 大地图状态 |
| `OverworldInput` | `overworld::types` | 大地图输入 |
| `Camera` | `camera` | 摄像机 |
| `Vec2` | `camera` | 2D 浮点向量 |
| `Rect` | `camera` | 轴对齐矩形 |
| `EnumMap<K,V>` | `battle` | 枚举键值映射 |
| `BattlerState<P>` | `battle` | 战斗单位状态 |
| `BattleState<P>` | `battle` | 战斗状态 |
| `DamageResult` | `battle` | 伤害计算结果 |
| `MoveEffect` | `battle` | 招式效果类别 |
| `EffectResult` | `battle` | 效果应用结果 |
| `Weather` | `battle` | 天气 |
| `Terrain` | `battle` | 地形 |
| `Inventory<I>` | `items` | 物品背包 |
| `ItemResult` | `items` | 物品使用结果 |
| `BagCategory` | `items` | 背包分类 |
| `DialogEngine<P>` | `text` | 对话引擎 |
| `TileBuffer` | `text` | 文本瓦片缓冲区 |
| `TextStream<C>` | `text` | 文本字符流 |
| `DialogState` | `text` | 对话状态 |
| `DialogMode` | `text` | 对话模式 |
| `ControlAction` | `text` | 控制动作 |
| `MenuSystem<M>` | `menu` | 菜单控制器 |
| `MenuInput` | `menu` | 菜单输入 |
| `MenuAction` | `menu` | 菜单操作 |
| `MenuLayout` | `menu` | 菜单布局 |
| `MenuConfig` | `menu` | 菜单渲染配置 |
| `BorderStyle` | `menu` | 边框样式 |
| `CursorStyle` | `menu` | 光标样式 |
| `SaveManager<S>` | `save` | 存档管理器 |
| `SaveSlot` | `save` | 存档位 |
| `SaveError` | `save` | 存档错误 |
| `TriggerManager` | `trigger_manager` | 触发器管理器 |
| `Trigger` | `trigger_manager` | 触发器 |
| `TriggerType` | `metatile` | 触发器类型 |
| `PaletteSwapManager` | `palette_swap` | 色板交换管理器 |
| `IconKind` | `icon` | 图标类型 |

### 14.3 常用常量

| 常量 | 值 | 说明 |
|------|---|------|
| `render::SCREEN_WIDTH` | 160 | Game Boy 屏幕宽度（像素） |
| `render::SCREEN_HEIGHT` | 144 | Game Boy 屏幕高度（像素） |
| `render::TILE_SIZE` | 8 | 瓦片尺寸（像素） |
| `render::SCREEN_WIDTH_TILES` | 20 | 屏幕宽度（瓦片） |
| `render::SCREEN_HEIGHT_TILES` | 18 | 屏幕高度（瓦片） |
| `render::DEFAULT_SCALE` | 3 | 默认缩放倍数 |
| `camera::TILE_SIZE` | 8.0 | 摄像机瓦片尺寸（浮点） |

### 14.4 颜色常量

```rust
use jrpg_engine::render::InkColor;

InkColor::White      // 白色
InkColor::LightGray  // 浅灰
InkColor::DarkGray   // 深灰
InkColor::Black      // 黑色
```

---

## 附录

### A. 项目依赖关系图

```
jrpg-app / jrpg-tui / jrpg-web
├── jrpg-engine        (核心 trait 和类型)
│   ├── render/        (Rgba, FrameBuffer, Painter, geometry)
│   ├── overworld/     (地图、NPC、碰撞、移动)
│   ├── battle/        (战斗抽象)
│   ├── text/          (文本引擎)
│   ├── menu/          (菜单框架)
│   ├── items/         (物品系统)
│   ├── save/          (存档框架)
│   ├── tileset/       (瓦片集)
│   ├── palette/       (色板)
│   ├── tile_meta/     (瓦片碰撞)
│   ├── metatile/      (元瓦片)
│   ├── trigger_manager/ (触发器)
│   ├── link/           (联机传输抽象：NetworkTransport、ChannelTransport、LinkRole)
│   ├── camera/        (摄像机)
│   ├── tilemap/       (瓦片地图)
│   └── map/           (地图)
├── jrpg-engine-tiled  (Tiled .tmx 解析)
├── jrpg-engine-script (JS 脚本执行)
├── jrpg-renderer      (现代字体渲染)
├── jrpg-ui            (UI 组件库)
└── jrpg-audio         (音频引擎)
```

### B. 学习路径建议

1. **第一天**：阅读本文档，理解整体架构
2. **第二天**：使用 `jrpg-template` 创建第一个项目，运行示例
3. **第三天**：用 Tiled 设计自己的地图
4. **第四天**：实现 `TextProvider`，添加对话
5. **第五天**：实现 `BattleProvider`，创建简单战斗
6. **第六天**：添加 NPC 和触发器
7. **第七天**：添加菜单和物品系统

### C. 相关文档

- `AGENTS.md` — 项目总览与目录映射
- `CLAUDE.md` — 开发者指南（Rust 项目）
- [GAME_UI_DSL.md](./GAME_UI_DSL.md) — UI DSL 语法规范（已实现）
- [FULL_DSL.md](./FULL_DSL.md) — DSL 完整语法参考
- [DSL_MAPPING.md](./DSL_MAPPING.md) — DSL 编译契约
- [RUNNING.md](./RUNNING.md) — 运行说明
