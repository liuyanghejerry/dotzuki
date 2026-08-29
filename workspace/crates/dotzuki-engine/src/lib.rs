//! # dotzuki-engine
//!
//! Core trait definitions for a JRPG engine framework.
//!
//! This crate defines the foundational abstractions that any JRPG engine
//! implementation must provide. It has **zero dependency** on specific game
//! data — all types are generic associated types or marker traits that
//! the implementing crate supplies.
//!
//! ## Design Philosophy
//!
//! The traits in this crate follow these principles:
//!
//! - **Generic over game data**: No concrete game-specific, item, or move types.
//!   All identifiers are associated types bounded by `Copy + Eq + Hash + Debug`.
//! - **Provider pattern**: Data providers (tilesets, maps, palettes, tile
//!   metadata, render data) are obtained through a single `GameData` master
//!   trait, enabling dependency injection and testing.
//! - **No I/O, no platform**: This crate contains only trait definitions
//!   and simple data types. No file loading, no GPU code, no platform calls.
//!
//! ## Modules
//!
//! | Module | Contents |
//! |--------|----------|
//! | [`tileset`] | `TilesetTrait` and `TilesetProvider` — tileset loading and querying |
//! | [`tile_meta`] | `CollisionType`, `TileMetaTrait`, `TileMetadata` — collision and terrain |
//! | [`tilemap`] | `TilemapEntry`, `Tilemap` — 16-bit tilemap with per-tile metadata |
//! | [`map`] | `MapTrait`, `MapProvider`, `MapConnection` — map data and connections |
//! | [`palette`] | `PaletteTrait`, `PaletteProvider` — colour palette lookups |
//! | [`render_data`] | `RenderData` — display-name and metadata lookups for moves, items, species |
//! | [`save`] | `SaveData`, `SaveManager`, `SaveStorage`, `SaveError` — save/load with CRC16 |
//! | [`link`] | `NetworkTransport<M>`, `TransportError`, `ChannelTransport<M>`, `LinkRole`, JSON-line `link::codec` — game-agnostic link-play transport seam (zero-I/O) |

pub mod battle;
pub mod camera;
pub mod items;
pub mod link;
pub mod map;
pub mod menu;
pub mod metatile;
pub mod overworld;
pub mod palette;
pub mod party;
pub mod render;
pub mod render_config;
pub mod render_data;
pub mod save;
pub mod text;
pub mod tile_meta;
pub mod tilemap;
pub mod tileset;
pub mod trigger_manager;

use std::fmt::Debug;
use std::hash::Hash;

/// Master trait that provides access to all game data subsystems.
///
/// `GameData` is the central dependency-injection point for the engine.
/// Implementations supply concrete types for tilesets, maps, palettes,
/// tile metadata, moves, items, and species, along with provider objects
/// that serve the corresponding data.
///
/// # Type Parameters
///
/// * `Tileset` — A [`TilesetTrait`](tileset::TilesetTrait) implementation
///   (typically an enum of tileset IDs).
/// * `Map` — A [`MapTrait`](map::MapTrait) implementation (typically an
///   enum of map IDs).
/// * `Palette` — A [`PaletteTrait`](palette::PaletteTrait) implementation
///   (typically an enum of palette IDs).
/// * `TileMeta` — A [`TileMetaTrait`](tile_meta::TileMetaTrait) implementation
///   for tile collision lookups.
/// * `Move` — The move/ability ID type (`Copy + Eq + Hash + Debug`).
/// * `Item` — The item ID type (`Copy + Eq + Hash + Debug`).
/// * `Species` — The species/monster ID type (`Copy + Eq + Hash + Debug`).
///
/// # Example
///
/// ```ignore
/// struct MonsterGameData;
///
/// impl GameData for MonsterGameData {
///     type Tileset = TilesetId;
///     type Map = MapId;
///     type Palette = PaletteId;
///     type TileMeta = TileMetaId;
///     type Move = MoveId;
///     type Item = ItemId;
///     type Species = SpeciesId;
///
///     fn tileset_provider(&self) -> &dyn TilesetProvider<Self::Tileset> {
///         &MY_TILESET_PROVIDER
///     }
///     // ... etc
/// }
/// ```
pub trait GameData {
    /// The tileset identifier type.
    type Tileset: tileset::TilesetTrait;

    /// The map identifier type.
    type Map: map::MapTrait;

    /// The palette identifier type.
    type Palette: palette::PaletteTrait;

    /// The tile metadata identifier type.
    type TileMeta: tile_meta::TileMetaTrait;

    /// The move (ability/skill) identifier type.
    type Move: Copy + Eq + Hash + Debug;

    /// The item identifier type.
    type Item: Copy + Eq + Hash + Debug;

    /// The species (monster/character) identifier type.
    type Species: Copy + Eq + Hash + Debug;

    /// Returns a reference to the tileset data provider.
    fn tileset_provider(&self) -> &dyn tileset::TilesetProvider<Self::Tileset>;

    /// Returns a reference to the map data provider.
    fn map_provider(&self) -> &dyn map::MapProvider<Self::Map>;

    /// Returns a reference to the palette data provider.
    fn palette_provider(&self) -> &dyn palette::PaletteProvider<Self::Palette>;

    /// Returns a reference to the tile metadata provider.
    fn tile_metadata(&self) -> &dyn tile_meta::TileMetadata<Self::TileMeta>;

    /// Returns a reference to the render data provider.
    fn render_data(
        &self,
    ) -> &dyn render_data::RenderData<Move = Self::Move, Item = Self::Item, Species = Self::Species>;
}
