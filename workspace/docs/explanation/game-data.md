# GameData: the provider pattern

> - **Audience**: rust developers, engine contributors
> - **Type**: explanation
> - **Status**: active
> - **Last verified**: v0.1.0

Why the engine talks to games through a trait with generic associated types, and what a game implements.

## The problem

`dotzuki-engine` must run any JRPG without knowing any game's data model:
maps, monsters, items and moves differ per game, and the engine crates ship
no concrete game data. The solution is a provider trait (`GameData`) whose
identifier types are **generic associated types** (GATs) — the game supplies
both the types and the data, and the engine code stays fully generic.

## The trait

The current surface (`crates/dotzuki-engine/src/lib.rs`):

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

Two shapes of associated type:

- **Rich types** (`Tileset`, `Map`, `Palette`, `TileMeta`) — bound by a trait
  (e.g. `map::MapTrait`) and returned through a provider object that the
  engine queries by identifier.
- **Plain identifiers** (`Move`, `Item`, `Species`) — only `Copy + Eq + Hash +
  Debug`; games typically use an enum, and the engine stores and compares
  them, treating the data behind them via `render_data` and the battle stack.

## Why generic associated types

- **Zero monomorphization pain**: engine systems (`map::`, `battle::stack`,
  `render_data::`) are written once against the GATs, not per game.
- **No trait-object tax on identifiers**: ids stay small `Copy` values; only
  providers are `&dyn`.
- **No game data in the engine**: games implement `GameData` once (usually one
  struct holding their tables); the engine never opens files or probes paths.

## Consumption

A game repo implements `GameData` on its own data struct, implements the
provider traits for its identifier types, and hands the engine a `&dyn
GameData`. Zero-Rust projects skip this entirely: `dotzuki-runner` implements
`GameData` over the project's manifest and data tables (see
[the project manifest](../reference/project-manifest.md)).

## Related pages

- [Architecture overview](architecture.md)
- [Effect stack](effect-stack.md) — the battle stack is the main `GameData` consumer
- [Glossary](../reference/glossary.md)
