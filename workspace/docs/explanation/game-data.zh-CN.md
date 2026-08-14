# GameData：provider 模式

> 本文是 `explanation/game-data.md` 的中文翻译，同步至引擎版本 v0.1.0（源文档 commit 3133fb419ae3bc6e5c08bbbcd43ac7fa0289e44f）。
> 内容以英文源为准；发现不一致请更新英文源再同步翻译。

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

为什么引擎通过一个带泛型关联类型的 trait 与游戏对话，以及游戏要各自实现什么。

## 问题

`dotzuki-engine` 必须能在不了解任何游戏数据模型的情况下运行任何 JRPG：地图、怪物、
道具与招式因游戏而异，而引擎 crate 不携带任何具体游戏数据。解决方案是一个 provider
trait（`GameData`），它的标识符类型是**泛型关联类型**（GAT）——游戏同时提供类型与
数据，引擎代码保持完全泛型。

## 这个 trait

当前接口（`crates/dotzuki-engine/src/lib.rs`）：

```rust
pub trait GameData {
    type Tileset: tileset::TilesetTrait;
    type Map: map::MapTrait;
    type Palette: palette::PaletteTrait;
    type TileMeta: tile_meta::TileMetaTrait;

    type Move: Copy + Eq + Hash + Debug;
    type Item: Copy + Eq + Hash + Debug;
    type Species: Copy + Eq + Hash + Debug;

    fn tileset_provider(&self) -> &dyn tileset::TilesetProvider<Self::Tileset>;
    fn map_provider(&self) -> &dyn map::MapProvider<Self::Map>;
    fn palette_provider(&self) -> &dyn palette::PaletteProvider<Self::Palette>;
    fn tile_metadata(&self) -> &dyn tile_meta::TileMetadata<Self::TileMeta>;
    fn render_data(
        &self,
    ) -> &dyn render_data::RenderData<Move = Self::Move, Item = Self::Item, Species = Self::Species>;
}
```

两种形态的关联类型：

- **富类型**（`Tileset`、`Map`、`Palette`、`TileMeta`）——受一个 trait 约束（例如
  `map::MapTrait`），通过引擎按标识符查询的 provider 对象返回。
- **纯标识符**（`Move`、`Item`、`Species`）——只有 `Copy + Eq + Hash + Debug`；
  游戏通常使用一个枚举，引擎存储并比较它们，其背后的数据经由 `render_data` 与
  战斗栈处理。

## 为什么用泛型关联类型

- **零单态化之痛**：引擎系统（`map::`、`battle::stack`、`render_data::`）只针对
  GAT 编写一次，而不是每个游戏各写一份。
- **标识符上没有 trait 对象开销**：id 保持小巧的 `Copy` 值；只有 provider 是
  `&dyn`。
- **引擎中没有游戏数据**：游戏实现一次 `GameData`（通常是一个持有自身数据表的
  结构体）；引擎从不打开文件或探查路径。

## 消费方式

游戏仓库在自己的数据结构体上实现 `GameData`，为它的标识符类型实现 provider trait，
并把 `&dyn GameData` 交给引擎。本仓库没有任何 crate 实现 `GameData`——它是给消费
方游戏的契约。

零 Rust 项目完全跳过这个 trait：`dotzuki-runner` 提供引擎栈消费的 provider（战斗
provider 经由一个泛型 `BattleProvider`/`EffectProvider` 实现），而不是提供
`GameData` 实现。见[项目清单](../reference/project-manifest.md)。

## 相关页面

- [架构概览](architecture.md)
- [效果栈](effect-stack.md)——战斗栈是 `GameData` 的主要消费方
- [术语表](../reference/glossary.md)
