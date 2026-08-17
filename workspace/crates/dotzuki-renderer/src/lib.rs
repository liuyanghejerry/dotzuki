// dotzuki-renderer: General-purpose JRPG rendering library built from
// Game Boy tile rendering principles.
//
// This is NOT a Game Boy hardware emulator. It provides a higher-level
// rendering API that draws into a 160×144 pixel framebuffer and displays
// it via a scaled window using the `pixels` crate.

pub mod asset_provider;
pub mod battle_anim;
pub mod battle_scene;
pub mod battle_transition;
pub mod charmap;
pub mod embedded_font;
pub mod icon;
pub mod indexed_framebuffer;
pub mod input;
pub mod layer_renderer;
pub mod layout;
pub mod layout_engine;
pub mod menu;
#[cfg(feature = "gpu")]
pub mod mon_icon;
pub mod palette;
#[cfg(feature = "gpu")]
pub mod party_hp_bar;
pub mod sprite;
pub mod text_renderer;
pub mod textbox;
pub mod tile;
pub mod tilemap;
pub mod title;
pub mod transition;
pub mod walk_sprite;
#[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
pub mod window;
pub mod window_layer;

pub use dotzuki_engine::render::{DirtyRegion, FrameBuffer, Rgba, BYTES_PER_PIXEL, TILE_SIZE};
pub use dotzuki_engine::render_config::RenderConfig;
pub use indexed_framebuffer::{
    index_bits, packed_len, quantize, DefaultPalette, FbSurface, IndexedFrameBuffer,
    RgbaIndexedFrameBuffer, SCREEN_HEIGHT, SCREEN_WIDTH,
};

#[cfg(test)]
mod tests;
