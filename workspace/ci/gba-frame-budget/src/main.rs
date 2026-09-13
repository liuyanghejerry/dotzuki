#![no_std]
#![no_main]
#![cfg_attr(test, feature(custom_test_frameworks))]
#![cfg_attr(test, reexport_test_harness_main = "test_main")]
#![cfg_attr(test, test_runner(agb::test_runner::test_runner))]

use agb::timer::Divider;
use dotzuki_renderer::palette::GbColor;
use dotzuki_renderer::tile::Tile;
use dotzuki_renderer::{LinearRgbaIndexedFrameBuffer, RenderConfig, Rgba};

/// GBA master clock cycles available between 59.7275 Hz frames.
const FRAME_CYCLE_BUDGET: u32 = 280_896;
const SCREEN_WIDTH: u32 = 160;
const SCREEN_HEIGHT: u32 = 144;

// Kept in ROM and word aligned by `Tile`; the benchmark therefore exercises
// the same ROM-to-EWRAM row-copy path as a real baked tileset.
static BACKGROUND_TILE: Tile = Tile {
    pixels: [
        [0, 0, 1, 1, 1, 1, 0, 0],
        [0, 1, 2, 2, 2, 2, 1, 0],
        [1, 2, 3, 3, 3, 3, 2, 1],
        [1, 2, 3, 0, 0, 3, 2, 1],
        [1, 2, 3, 0, 0, 3, 2, 1],
        [1, 2, 3, 3, 3, 3, 2, 1],
        [0, 1, 2, 2, 2, 2, 1, 0],
        [0, 0, 1, 1, 1, 1, 0, 0],
    ],
};

static SPRITE_TILE: Tile = Tile {
    pixels: [
        [0, 0, 0, 1, 1, 0, 0, 0],
        [0, 0, 1, 2, 2, 1, 0, 0],
        [0, 1, 2, 3, 3, 2, 1, 0],
        [1, 2, 3, 3, 3, 3, 2, 1],
        [1, 2, 3, 3, 3, 3, 2, 1],
        [0, 1, 2, 3, 3, 2, 1, 0],
        [0, 0, 1, 2, 2, 1, 0, 0],
        [0, 0, 0, 1, 1, 0, 0, 0],
    ],
};

#[agb::entry]
fn main(_gba: agb::Gba) -> ! {
    loop {
        agb::halt();
    }
}

/// Measure ARM7TDMI master-clock cycles with timers 2 and 3 cascaded into a
/// 32-bit counter. The benchmark stays deterministic under mGBA because this
/// is emulated GBA time, not the CI host's wall clock.
fn measure_cycles(gba: &mut agb::Gba, workload: impl FnOnce()) -> u32 {
    let timers = gba.timers.timers();
    let mut low = timers.timer2;
    let mut high = timers.timer3;

    low.set_enabled(false)
        .set_cascade(false)
        .set_divider(Divider::Divider1)
        .set_overflow_amount(0);
    high.set_enabled(false)
        .set_cascade(true)
        .set_overflow_amount(0);

    high.set_enabled(true);
    low.set_enabled(true);
    workload();
    low.set_enabled(false);
    high.set_enabled(false);

    ((high.value() as u32) << 16) | low.value() as u32
}

fn assert_frame_budget(label: &str, cycles: u32) {
    agb::println!(
        "{}: {} / {} cycles ({:.1}% of frame)",
        label,
        cycles,
        FRAME_CYCLE_BUDGET,
        cycles as f32 * 100.0 / FRAME_CYCLE_BUDGET as f32
    );
    assert!(
        cycles <= FRAME_CYCLE_BUDGET,
        "{} exceeded the 59.7275 Hz GBA frame budget: {} > {} cycles",
        label,
        cycles,
        FRAME_CYCLE_BUDGET
    );
}

fn draw_complete_frame(frame: &mut LinearRgbaIndexedFrameBuffer) {
    frame.clear(Rgba::WHITE);

    // A full 20 x 18 tilemap redraw through the aligned ROM-to-EWRAM path.
    for tile_y in 0..18 {
        for tile_x in 0..20 {
            frame.blit_gb_tile_indices(
                tile_x * 8,
                tile_y * 8,
                &BACKGROUND_TILE,
                false,
                false,
                false,
            );
        }
    }

    // Transparent and flipped tiles model player, NPC, and battle sprites.
    for sprite in 0..12 {
        frame.blit_gb_tile_indices(
            8 + sprite * 11,
            40 + (sprite & 3) * 12,
            &SPRITE_TILE,
            true,
            sprite & 1 != 0,
            sprite & 2 != 0,
        );
    }

    // A dialogue/HUD band and one status bar exercise linear rectangle fills.
    frame.fill_rect(0, 112, SCREEN_WIDTH, 32, Rgba::WHITE);
    frame.fill_rect(8, 120, 104, 8, Rgba::BLACK);
}

/// Gate the two expensive frame shapes used by a GBA consumer:
///
/// - a complete background, sprite, and HUD redraw;
/// - a battle-effect frame restored from a stable image and smooth-scrolled.
///
/// Allocations, setup, and validation stay outside the timed regions. Both
/// results remain observable after timing so LTO cannot discard the work.
#[test_case]
fn renderer_frame_shapes_fit_gba_frame_budget(gba: &mut agb::Gba) {
    let config = RenderConfig::new(SCREEN_WIDTH, SCREEN_HEIGHT);
    let mut stable = LinearRgbaIndexedFrameBuffer::new(config, Rgba::WHITE);
    let mut frame = LinearRgbaIndexedFrameBuffer::new(config, Rgba::WHITE);

    let redraw_cycles = measure_cycles(gba, || draw_complete_frame(&mut stable));
    assert_frame_budget("complete redraw", redraw_cycles);

    let effect_cycles = measure_cycles(gba, || {
        frame.copy_from(&stable);
        frame.scroll_indices(2, 0, GbColor::White);
    });
    assert_frame_budget("stable-frame scroll effect", effect_cycles);

    let checksum = frame
        .indexed()
        .indices()
        .iter()
        .fold(0u32, |sum, &pixel| sum.wrapping_add(pixel as u32));
    assert_ne!(checksum, 0, "benchmark frame must remain observable");
}
