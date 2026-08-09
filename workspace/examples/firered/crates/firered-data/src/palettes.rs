//! GBA-style 16-color palette definitions for FireRed environments.
//!
//! Each palette is a 16-color `Palette<GbaColor>` that maps
//! 4-bit color indices to RGBA values. These palettes emulate
//! the visual style of Pokémon FireRed/LeafGreen on the GBA.

use jrpg_engine::render::Rgba;
pub use jrpg_renderer::palette::{GbaColor, Palette};

/// Helper to create a 16-color GBA palette from an array.
pub fn make_palette(colors: [Rgba; 16]) -> Palette<GbaColor> {
    Palette::from_gba_palette(colors)
}

// ============================================================================
// Environment Palettes (BG)
// ============================================================================

/// Overworld palette — grassy routes, bright outdoor feel.
/// Maps to FireRedPaletteId::Overworld
pub const OVERWORLD_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,                                    // 0: transparent
        Rgba::rgb(0x90, 0xC0, 0x58), // 1: grass light
        Rgba::rgb(0x60, 0x98, 0x30), // 2: grass mid
        Rgba::rgb(0x38, 0x68, 0x18), // 3: grass dark
        Rgba::rgb(0xC8, 0xA8, 0x78), // 4: path light
        Rgba::rgb(0xA0, 0x80, 0x58), // 5: path mid
        Rgba::rgb(0x70, 0x58, 0x38), // 6: path dark
        Rgba::rgb(0xA0, 0xD0, 0xF0), // 7: water light
        Rgba::rgb(0x68, 0xA0, 0xD0), // 8: water mid
        Rgba::rgb(0x38, 0x68, 0xA0), // 9: water dark
        Rgba::rgb(0x88, 0x70, 0x48), // 10: tree trunk
        Rgba::rgb(0x48, 0xA0, 0x38), // 11: tree leaf light
        Rgba::rgb(0x30, 0x78, 0x20), // 12: tree leaf mid
        Rgba::rgb(0x18, 0x50, 0x10), // 13: tree leaf dark
        Rgba::rgb(0xE0, 0xD0, 0xB8), // 14: fence/border light
        Rgba::rgb(0xB0, 0xA0, 0x88), // 15: fence/border dark
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// Town palette — warm stone and tile tones.
/// Maps to FireRedPaletteId::Town
pub const TOWN_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xD8, 0xD0, 0xC0), // 1: ground light
        Rgba::rgb(0xC0, 0xB8, 0xA0), // 2: ground mid
        Rgba::rgb(0xA0, 0x98, 0x80), // 3: ground dark
        Rgba::rgb(0xF0, 0xE0, 0xD0), // 4: building wall
        Rgba::rgb(0xD0, 0xB8, 0xA0), // 5: building shadow
        Rgba::rgb(0xE0, 0x60, 0x40), // 6: roof red
        Rgba::rgb(0xB0, 0x40, 0x28), // 7: roof dark
        Rgba::rgb(0x88, 0x80, 0x68), // 8: stone
        Rgba::rgb(0x68, 0x60, 0x48), // 9: stone dark
        Rgba::rgb(0xF8, 0xF0, 0xE0), // 10: window
        Rgba::rgb(0xA8, 0xD8, 0x58), // 11: bush light
        Rgba::rgb(0x70, 0xA8, 0x38), // 12: bush dark
        Rgba::rgb(0x58, 0x60, 0x70), // 13: sign board
        Rgba::rgb(0xD0, 0xC8, 0xB8), // 14: path light
        Rgba::rgb(0xA8, 0xA0, 0x90), // 15: path dark
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// Forest palette — deep greens for Viridian Forest-like areas.
/// Maps to FireRedPaletteId::Forest
pub const FOREST_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0x68, 0xA0, 0x38), // 1: grass light
        Rgba::rgb(0x48, 0x78, 0x20), // 2: grass mid
        Rgba::rgb(0x28, 0x50, 0x10), // 3: grass dark
        Rgba::rgb(0x58, 0x88, 0x28), // 4: leaf light
        Rgba::rgb(0x38, 0x60, 0x18), // 5: leaf mid
        Rgba::rgb(0x20, 0x40, 0x08), // 6: leaf dark
        Rgba::rgb(0x80, 0x68, 0x40), // 7: trunk light
        Rgba::rgb(0x58, 0x40, 0x28), // 8: trunk dark
        Rgba::rgb(0x90, 0x88, 0x68), // 9: path light
        Rgba::rgb(0x68, 0x60, 0x40), // 10: path dark
        Rgba::rgb(0xD0, 0xE8, 0xC0), // 11: light beam
        Rgba::rgb(0xA0, 0xC0, 0x88), // 12: light beam 2
        Rgba::rgb(0x30, 0x30, 0x28), // 13: shadow
        Rgba::rgb(0x48, 0x48, 0x38), // 14: rock
        Rgba::rgb(0x70, 0x70, 0x58), // 15: rock light
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// Cave palette — dark rocky tones for Mt. Moon-like areas.
/// Maps to FireRedPaletteId::Cave
pub const CAVE_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0x60, 0x58, 0x50), // 1: rock light
        Rgba::rgb(0x48, 0x40, 0x38), // 2: rock mid
        Rgba::rgb(0x30, 0x28, 0x20), // 3: rock dark
        Rgba::rgb(0x70, 0x68, 0x58), // 4: floor light
        Rgba::rgb(0x50, 0x48, 0x38), // 5: floor mid
        Rgba::rgb(0x38, 0x30, 0x28), // 6: floor dark
        Rgba::rgb(0x98, 0x90, 0x80), // 7: stalagmite
        Rgba::rgb(0x70, 0x68, 0x58), // 8: stalagmite dark
        Rgba::rgb(0x80, 0x78, 0x68), // 9: wall highlight
        Rgba::rgb(0x20, 0x18, 0x10), // 10: deep shadow
        Rgba::rgb(0xC0, 0xB8, 0xA0), // 11: torch light
        Rgba::rgb(0xE0, 0xC8, 0x80), // 12: torch flame
        Rgba::rgb(0xF8, 0xE0, 0x60), // 13: torch bright
        Rgba::rgb(0x50, 0x60, 0x80), // 14: water hint
        Rgba::rgb(0x30, 0x40, 0x58), // 15: water hint dark
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// Water palette — ocean and river blues.
/// Maps to FireRedPaletteId::Water
pub const WATER_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0x78, 0xB8, 0xF0), // 1: water surface light
        Rgba::rgb(0x50, 0x90, 0xD0), // 2: water surface mid
        Rgba::rgb(0x28, 0x68, 0xB0), // 3: water surface dark
        Rgba::rgb(0xC0, 0xD0, 0x98), // 4: shore light
        Rgba::rgb(0xA0, 0xB8, 0x78), // 5: shore mid
        Rgba::rgb(0x70, 0x88, 0x48), // 6: shore dark
        Rgba::rgb(0x90, 0xC8, 0xF8), // 7: wave foam
        Rgba::rgb(0x68, 0xA8, 0xE8), // 8: wave mid
        Rgba::rgb(0x38, 0x78, 0xC0), // 9: wave dark
        Rgba::rgb(0xA8, 0xC8, 0x70), // 10: grass near water
        Rgba::rgb(0x78, 0x98, 0x48), // 11: grass dark
        Rgba::rgb(0x88, 0x70, 0x50), // 12: wooden dock
        Rgba::rgb(0x60, 0x50, 0x38), // 13: dock dark
        Rgba::rgb(0xF0, 0xE8, 0xD0), // 14: sand light
        Rgba::rgb(0xD8, 0xC8, 0xA8), // 15: sand dark
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// Indoor palette — warm interior tones for buildings.
/// Maps to FireRedPaletteId::Indoor
pub const INDOOR_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xF0, 0xE8, 0xD8), // 1: wall light
        Rgba::rgb(0xD8, 0xD0, 0xC0), // 2: wall mid
        Rgba::rgb(0xB8, 0xB0, 0xA0), // 3: wall dark
        Rgba::rgb(0xC8, 0xA8, 0x88), // 4: wood floor light
        Rgba::rgb(0xA8, 0x88, 0x68), // 5: wood floor mid
        Rgba::rgb(0x80, 0x60, 0x40), // 6: wood floor dark
        Rgba::rgb(0xE0, 0xB0, 0x80), // 7: counter top
        Rgba::rgb(0xC0, 0x90, 0x60), // 8: counter side
        Rgba::rgb(0xF8, 0xF0, 0xE8), // 9: table cloth
        Rgba::rgb(0x68, 0x68, 0x78), // 10: machine gray
        Rgba::rgb(0x48, 0x48, 0x58), // 11: machine dark
        Rgba::rgb(0xF0, 0x60, 0x50), // 12: pokeball red
        Rgba::rgb(0xA0, 0xC0, 0x60), // 13: plant green
        Rgba::rgb(0x58, 0x78, 0x30), // 14: plant dark
        Rgba::rgb(0xD0, 0xC8, 0xB0), // 15: carpet
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

// ============================================================================
// UI Palettes
// ============================================================================

/// Title screen palette — FireRed's signature fiery tones.
/// Maps to FireRedPaletteId::TitleScreen
pub const TITLE_SCREEN_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xF8, 0x48, 0x28), // 1: fire bright
        Rgba::rgb(0xE0, 0x30, 0x18), // 2: fire mid
        Rgba::rgb(0xB0, 0x20, 0x08), // 3: fire dark
        Rgba::rgb(0xF8, 0xC8, 0x60), // 4: flame yellow
        Rgba::rgb(0xE8, 0xA0, 0x30), // 5: flame orange
        Rgba::rgb(0xC8, 0x70, 0x18), // 6: ember
        Rgba::rgb(0xFF, 0xFF, 0xFF), // 7: white text
        Rgba::rgb(0x18, 0x10, 0x08), // 8: background dark
        Rgba::rgb(0x30, 0x20, 0x18), // 9: background
        Rgba::rgb(0x50, 0x38, 0x28), // 10: ground
        Rgba::rgb(0x10, 0x30, 0x88), // 11: leafgreen blue accent
        Rgba::rgb(0x08, 0x20, 0x60), // 12: blue dark
        Rgba::rgb(0x20, 0x58, 0x28), // 13: leafgreen green
        Rgba::rgb(0x10, 0x38, 0x18), // 14: green dark
        Rgba::rgb(0xF0, 0xF0, 0xE0), // 15: highlight
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// Battle palette — default battle background.
/// Maps to FireRedPaletteId::Battle
pub const BATTLE_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xE8, 0xE0, 0xD8), // 1: platform light
        Rgba::rgb(0xC0, 0xB8, 0xB0), // 2: platform mid
        Rgba::rgb(0x98, 0x90, 0x80), // 3: platform dark
        Rgba::rgb(0xC8, 0xD8, 0xF0), // 4: sky light
        Rgba::rgb(0x90, 0xB0, 0xD8), // 5: sky mid
        Rgba::rgb(0x58, 0x78, 0xA8), // 6: sky dark
        Rgba::rgb(0x40, 0x50, 0x60), // 7: ground
        Rgba::rgb(0x30, 0x38, 0x48), // 8: ground dark
        Rgba::rgb(0xF8, 0xF8, 0xF8), // 9: text white
        Rgba::rgb(0x50, 0x50, 0x50), // 10: text shadow
        Rgba::rgb(0x30, 0xD8, 0x30), // 11: HP green
        Rgba::rgb(0xF8, 0xC0, 0x30), // 12: HP yellow
        Rgba::rgb(0xF8, 0x30, 0x30), // 13: HP red
        Rgba::rgb(0x70, 0x60, 0x50), // 14: shadow
        Rgba::rgb(0x50, 0x40, 0x38), // 15: shadow dark
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// UI palette — menus, dialogs, and HUD elements.
/// Maps to FireRedPaletteId::UI
pub const UI_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xF8, 0xF8, 0xF8), // 1: text white
        Rgba::rgb(0xC0, 0xC8, 0xD0), // 2: text gray
        Rgba::rgb(0x50, 0x50, 0x60), // 3: text dark
        Rgba::rgb(0x38, 0x40, 0x50), // 4: dialog bg
        Rgba::rgb(0x60, 0x68, 0x78), // 5: dialog border
        Rgba::rgb(0x18, 0x20, 0x28), // 6: dialog shadow
        Rgba::rgb(0x40, 0x48, 0x58), // 7: menu bg
        Rgba::rgb(0xE0, 0x68, 0x30), // 8: menu highlight
        Rgba::rgb(0xF8, 0x88, 0x48), // 9: menu selected
        Rgba::rgb(0x28, 0x30, 0x40), // 10: border dark
        Rgba::rgb(0x80, 0x88, 0x98), // 11: scrollbar
        Rgba::rgb(0x30, 0xD8, 0x30), // 12: HP green
        Rgba::rgb(0xF8, 0xC0, 0x30), // 13: HP yellow
        Rgba::rgb(0xF8, 0x30, 0x30), // 14: HP red
        Rgba::rgb(0x18, 0x18, 0x28), // 15: deep bg
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

// ============================================================================
// Sprite Palettes
// ============================================================================

/// Player character palette (FireRed male trainer).
/// Maps to FireRedPaletteId::Player
pub const PLAYER_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xF8, 0xF0, 0xE8), // 1: skin light
        Rgba::rgb(0xD8, 0xC0, 0xA0), // 2: skin
        Rgba::rgb(0xB0, 0x88, 0x68), // 3: skin shadow
        Rgba::rgb(0xE8, 0x40, 0x30), // 4: hat red
        Rgba::rgb(0xB0, 0x28, 0x18), // 5: hat dark
        Rgba::rgb(0xF8, 0xF8, 0xF8), // 6: shirt white
        Rgba::rgb(0xD0, 0xD0, 0xD8), // 7: shirt shadow
        Rgba::rgb(0x30, 0x40, 0x80), // 8: pants blue
        Rgba::rgb(0x20, 0x28, 0x58), // 9: pants dark
        Rgba::rgb(0x68, 0x48, 0x30), // 10: shoes
        Rgba::rgb(0x40, 0x28, 0x18), // 11: shoes dark
        Rgba::rgb(0xE8, 0xE0, 0x38), // 12: bag yellow
        Rgba::rgb(0xB0, 0xA8, 0x20), // 13: bag dark
        Rgba::rgb(0x80, 0x60, 0x40), // 14: hair brown
        Rgba::rgb(0x50, 0x38, 0x20), // 15: hair dark
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

/// NPC palette — generic NPC character.
/// Maps to FireRedPaletteId::NPC
pub const NPC_PALETTE: Palette<GbaColor> = Palette::<GbaColor> {
    colors: [
        Rgba::TRANSPARENT,
        Rgba::rgb(0xF8, 0xF0, 0xE8), // 1: skin light
        Rgba::rgb(0xD0, 0xC0, 0xA8), // 2: skin
        Rgba::rgb(0xA8, 0x88, 0x68), // 3: skin shadow
        Rgba::rgb(0x48, 0x68, 0xE0), // 4: clothing blue
        Rgba::rgb(0x30, 0x48, 0xA8), // 5: clothing dark
        Rgba::rgb(0xF8, 0xF0, 0xD8), // 6: apron light
        Rgba::rgb(0xD8, 0xC8, 0xA0), // 7: apron shadow
        Rgba::rgb(0x50, 0x38, 0x28), // 8: shoes
        Rgba::rgb(0x30, 0x20, 0x18), // 9: shoes dark
        Rgba::rgb(0x98, 0x70, 0x48), // 10: hair
        Rgba::rgb(0x68, 0x48, 0x28), // 11: hair dark
        Rgba::rgb(0xF8, 0xF8, 0xF8), // 12: highlight
        Rgba::rgb(0xA0, 0xA0, 0xA8), // 13: gray
        Rgba::rgb(0x60, 0x60, 0x68), // 14: dark gray
        Rgba::rgb(0x28, 0x20, 0x18), // 15: black
    ],
    count: 16,
    _phantom: std::marker::PhantomData,
};

// ============================================================================
// Palette lookup function
// ============================================================================

use crate::FireRedPaletteId;

/// Get the GBA palette for a given palette ID.
pub fn get_palette(id: FireRedPaletteId) -> &'static Palette<GbaColor> {
    use FireRedPaletteId::*;
    match id {
        Overworld => &OVERWORLD_PALETTE,
        Town => &TOWN_PALETTE,
        Forest => &FOREST_PALETTE,
        Cave => &CAVE_PALETTE,
        Water => &WATER_PALETTE,
        Indoor => &INDOOR_PALETTE,
        TitleScreen => &TITLE_SCREEN_PALETTE,
        Battle => &BATTLE_PALETTE,
        UI => &UI_PALETTE,
        Player => &PLAYER_PALETTE,
        NPC => &NPC_PALETTE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_palettes_have_16_colors() {
        let palettes: &[&Palette<GbaColor>] = &[
            &OVERWORLD_PALETTE,
            &TOWN_PALETTE,
            &FOREST_PALETTE,
            &CAVE_PALETTE,
            &WATER_PALETTE,
            &INDOOR_PALETTE,
            &TITLE_SCREEN_PALETTE,
            &BATTLE_PALETTE,
            &UI_PALETTE,
            &PLAYER_PALETTE,
            &NPC_PALETTE,
        ];
        for pal in palettes {
            assert_eq!(pal.count, 16, "palette should have 16 colors");
        }
    }

    #[test]
    fn test_get_palette_returns_correct_palette() {
        assert_eq!(get_palette(FireRedPaletteId::Overworld).colors, OVERWORLD_PALETTE.colors);
        assert_eq!(get_palette(FireRedPaletteId::Town).colors, TOWN_PALETTE.colors);
        assert_eq!(get_palette(FireRedPaletteId::Cave).colors, CAVE_PALETTE.colors);
    }

    #[test]
    fn test_firered_palette_id_from_u8() {
        assert_eq!(FireRedPaletteId::from_u8(0), Some(FireRedPaletteId::Overworld));
        assert_eq!(FireRedPaletteId::from_u8(10), Some(FireRedPaletteId::NPC));
        assert_eq!(FireRedPaletteId::from_u8(11), None);
        assert_eq!(FireRedPaletteId::from_u8(255), None);
    }
}
