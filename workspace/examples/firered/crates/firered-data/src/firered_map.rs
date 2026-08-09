//! Faithful FireRed overworld map model — Pallet Town.
//!
//! This module reproduces the data the GBA had and the decode rules from
//! `pokefirered`'s `fieldmap.c` / `field_camera.c`, so the renderer in
//! `firered-app` can re-run the original metatile compositing pipeline:
//!
//! ```text
//! map.bin block (u16)  ──&0x03FF──►  metatile id (0..1023)
//!   metatile id  <640 → primary tileset metatile, else secondary[id-640]
//!   metatile = 8 tile-entries: [0..4] bottom layer, [4..8] top layer (each a 2x2 of 8x8)
//!   tile-entry (u16): tile = e&0x03FF, hflip = e&0x0400, vflip = e&0x0800, pal = (e>>12)&0x0F
//!   tile index addresses the COMBINED tile array (primary 0..639, secondary 640..) — GBA VRAM order
//!   pal indexes one of 13 BG palette banks; color index 0 is transparent
//! ```
//!
//! Assets are produced by `tools/firered-asset-converter/convert.py` and embedded
//! via `include_bytes!`, so this crate performs no I/O.

use jrpg_engine::render::Rgba;

// ── dimensions / constants (Pallet Town) ───────────────────────────────────

/// 8×8 hardware tile size in pixels.
pub const TILE: usize = 8;
/// 16×16 metatile size in pixels.
pub const METATILE: usize = 16;
/// VRAM split: tile indices below this come from the primary tileset.
pub const NUM_TILES_IN_PRIMARY: u16 = 640;
/// Metatile id split between primary and secondary tilesets.
pub const NUM_METATILES_IN_PRIMARY: u16 = 640;
/// Number of BG palette banks (primary 0..6, secondary 7..12).
pub const NUM_PALETTES: usize = 13;

pub const MAP_W: usize = 24;
pub const MAP_H: usize = 20;
pub const BORDER_W: usize = 2;
pub const BORDER_H: usize = 2;

pub const PLAYER_SHEET_W: usize = 144;
pub const PLAYER_SHEET_H: usize = 32;
pub const PLAYER_FRAME_W: usize = 16;
pub const PLAYER_FRAME_H: usize = 32;
pub const PLAYER_FRAMES: usize = 9;

// ── embedded assets ─────────────────────────────────────────────────────────

mod raw {
    pub const TILES: &[u8] = include_bytes!("../../../assets/pallet_town/tiles.bin");
    pub const PALETTES: &[u8] = include_bytes!("../../../assets/pallet_town/palettes.bin");
    pub const METATILES_PRIMARY: &[u8] =
        include_bytes!("../../../assets/pallet_town/metatiles_primary.bin");
    pub const METATILES_SECONDARY: &[u8] =
        include_bytes!("../../../assets/pallet_town/metatiles_secondary.bin");
    pub const ATTRS_PRIMARY: &[u8] =
        include_bytes!("../../../assets/pallet_town/attributes_primary.bin");
    pub const ATTRS_SECONDARY: &[u8] =
        include_bytes!("../../../assets/pallet_town/attributes_secondary.bin");
    pub const MAP: &[u8] = include_bytes!("../../../assets/pallet_town/map.bin");
    pub const BORDER: &[u8] = include_bytes!("../../../assets/pallet_town/border.bin");
    pub const PLAYER: &[u8] = include_bytes!("../../../assets/pallet_town/player.bin");
}

// ── types ────────────────────────────────────────────────────────────────────

/// How a metatile's two halves composite relative to overworld sprites.
///
/// Mirrors `METATILE_LAYER_TYPE_*` and the three BG buffers in `DrawMetatile`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LayerType {
    /// Bottom half under the player, top half over it (walk-behind trees/roofs).
    Normal,
    /// Both halves under the player (floors, bridges you stand on).
    Covered,
    /// Bottom under, top over — same visible order as `Normal` in a single FB.
    Split,
}

/// A decoded BG tile-entry (one of a metatile's 8 quadrant references).
#[derive(Clone, Copy)]
pub struct TileEntry {
    /// Index into the combined tile array (primary 0..639, secondary 640..).
    pub tile: u16,
    pub hflip: bool,
    pub vflip: bool,
    /// BG palette bank 0..12.
    pub pal: u8,
}

impl TileEntry {
    #[inline]
    pub fn decode(e: u16) -> Self {
        Self {
            tile: e & 0x03FF,
            hflip: e & 0x0400 != 0,
            vflip: e & 0x0800 != 0,
            pal: ((e >> 12) & 0x0F) as u8,
        }
    }
}

/// A metatile: 8 raw tile-entries (`[0..4]` bottom layer, `[4..8]` top) + layer type.
#[derive(Clone, Copy)]
pub struct Metatile {
    pub entries: [u16; 8],
    pub layer: LayerType,
}

/// The full decoded map + tilesets for one location.
pub struct FireRedMap {
    /// Combined indexed tiles, 64 indices (0..15) per 8×8 tile.
    tiles: Vec<[u8; 64]>,
    /// 13 BG palette banks of 16 colors; color 0 is transparent.
    palettes: [[Rgba; 16]; NUM_PALETTES],
    primary_metatiles: Vec<Metatile>,
    secondary_metatiles: Vec<Metatile>,
    /// `MAP_W * MAP_H` raw map-grid blocks.
    map: Vec<u16>,
    /// `BORDER_W * BORDER_H` border blocks (row-major).
    border: Vec<u16>,
    /// Player sprite sheet, `PLAYER_SHEET_W * PLAYER_SHEET_H` RGBA pixels.
    player: Vec<Rgba>,
}

// ── parsing helpers ──────────────────────────────────────────────────────────

fn parse_u16_le(raw: &[u8]) -> Vec<u16> {
    raw.chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect()
}

fn parse_tiles(raw: &[u8]) -> Vec<[u8; 64]> {
    raw.chunks_exact(64)
        .map(|c| {
            let mut t = [0u8; 64];
            t.copy_from_slice(c);
            t
        })
        .collect()
}

fn parse_palettes(raw: &[u8]) -> [[Rgba; 16]; NUM_PALETTES] {
    let mut banks = [[Rgba::TRANSPARENT; 16]; NUM_PALETTES];
    for (bank, bank_colors) in banks.iter_mut().enumerate() {
        for (ci, color) in bank_colors.iter_mut().enumerate() {
            let o = (bank * 16 + ci) * 4;
            *color = Rgba::new(raw[o], raw[o + 1], raw[o + 2], raw[o + 3]);
        }
    }
    banks
}

fn parse_metatiles(mt_raw: &[u8], attr_raw: &[u8]) -> Vec<Metatile> {
    let entries = mt_raw.chunks_exact(16).map(|c| {
        let mut e = [0u16; 8];
        for (i, slot) in e.iter_mut().enumerate() {
            *slot = u16::from_le_bytes([c[2 * i], c[2 * i + 1]]);
        }
        e
    });
    let layers = attr_raw.chunks_exact(4).map(|c| {
        let a = u32::from_le_bytes([c[0], c[1], c[2], c[3]]);
        match (a >> 29) & 0x3 {
            1 => LayerType::Covered,
            2 => LayerType::Split,
            _ => LayerType::Normal,
        }
    });
    entries
        .zip(layers)
        .map(|(entries, layer)| Metatile { entries, layer })
        .collect()
}

// ── public API ────────────────────────────────────────────────────────────────

impl FireRedMap {
    /// Decode all embedded Pallet Town assets.
    pub fn load() -> Self {
        Self {
            tiles: parse_tiles(raw::TILES),
            palettes: parse_palettes(raw::PALETTES),
            primary_metatiles: parse_metatiles(raw::METATILES_PRIMARY, raw::ATTRS_PRIMARY),
            secondary_metatiles: parse_metatiles(raw::METATILES_SECONDARY, raw::ATTRS_SECONDARY),
            map: parse_u16_le(raw::MAP),
            border: parse_u16_le(raw::BORDER),
            player: raw::PLAYER
                .chunks_exact(4)
                .map(|c| Rgba::new(c[0], c[1], c[2], c[3]))
                .collect(),
        }
    }

    #[inline]
    pub fn map_width(&self) -> usize {
        MAP_W
    }
    #[inline]
    pub fn map_height(&self) -> usize {
        MAP_H
    }

    /// The combined indexed tile graphics for `tile_idx` (None if out of range).
    #[inline]
    pub fn tile(&self, tile_idx: u16) -> Option<&[u8; 64]> {
        self.tiles.get(tile_idx as usize)
    }

    /// One of the 13 BG palette banks (clamped to valid range).
    #[inline]
    pub fn palette(&self, bank: u8) -> &[Rgba; 16] {
        &self.palettes[(bank as usize).min(NUM_PALETTES - 1)]
    }

    /// Resolve a metatile id to its metatile (primary or secondary tileset).
    #[inline]
    pub fn metatile(&self, metatile_id: u16) -> Option<&Metatile> {
        if metatile_id < NUM_METATILES_IN_PRIMARY {
            self.primary_metatiles.get(metatile_id as usize)
        } else {
            self.secondary_metatiles
                .get((metatile_id - NUM_METATILES_IN_PRIMARY) as usize)
        }
    }

    /// Mask a map-grid block to its metatile id (bits 0..9).
    #[inline]
    pub fn block_metatile_id(block: u16) -> u16 {
        block & 0x03FF
    }

    /// Collision field of a map-grid block (bits 10..11); nonzero = impassable.
    #[inline]
    pub fn block_collision(block: u16) -> u8 {
        ((block >> 10) & 0x3) as u8
    }

    /// The raw map-grid block at metatile coords `(x, y)`, wrapping the 2×2
    /// border around off-map coordinates (as `GetBorderBlockAt` does).
    #[inline]
    pub fn block_at(&self, x: i32, y: i32) -> u16 {
        if x >= 0 && y >= 0 && (x as usize) < MAP_W && (y as usize) < MAP_H {
            self.map[y as usize * MAP_W + x as usize]
        } else {
            let bx = x.rem_euclid(BORDER_W as i32) as usize;
            let by = y.rem_euclid(BORDER_H as i32) as usize;
            self.border[by * BORDER_W + bx]
        }
    }

    /// `true` if the metatile at `(x, y)` blocks walking (collision or off-map).
    #[inline]
    pub fn is_blocked(&self, x: i32, y: i32) -> bool {
        Self::block_collision(self.block_at(x, y)) != 0
    }

    /// A pixel of the player sprite sheet at `(frame, fx, fy)` (frame-local coords).
    #[inline]
    pub fn player_pixel(&self, frame: usize, fx: usize, fy: usize) -> Rgba {
        let sx = frame * PLAYER_FRAME_W + fx;
        let sy = fy;
        if sx >= PLAYER_SHEET_W || sy >= PLAYER_SHEET_H {
            return Rgba::TRANSPARENT;
        }
        self.player[sy * PLAYER_SHEET_W + sx]
    }
}
