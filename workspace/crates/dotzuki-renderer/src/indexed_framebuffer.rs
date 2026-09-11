//! Indexed (palette-based) framebuffer with packed bitplane storage.
//!
//! [`IndexedFrameBuffer`] stores one palette index per pixel instead of RGBA
//! bytes. It is an additive alternative to the engine's RGBA
//! [`dotzuki_engine::render::FrameBuffer`] for fixed-palette games (the GB-port
//! plan, `docs/low-end-hardware-optimization.md` §5.4, and NES/SNES-style projects):
//! a Game Boy 160×144 screen costs 5,760 bytes instead of 92,160.
//!
//! # Storage format (packed 2bpp, planar bitplanes)
//!
//! Two candidate storages were considered: one byte per pixel (`W*H` bytes)
//! or packed 2bpp (`W*H/4` bytes). Packed 2bpp was chosen:
//!
//! - **VRAM isomorphism.** The packing is the *same planar bitplane layout
//!   used by Game Boy VRAM tiles* and by this crate's tile pipeline
//!   ([`crate::tile::Tile::from_2bpp`], [`crate::resource::png_to_2bpp`]):
//!   each row of 8 pixels is stored as one byte per bitplane, bit 7 =
//!   leftmost pixel, bitplane 0 first. A [`GbColor`] (2-bit) buffer's raw
//!   bytes are literally GB 2bpp tile data — tile blits and buffer contents
//!   are interchangeable, and rendering code translates almost 1:1 to real
//!   GB VRAM (`docs/low-end-hardware-optimization.md` §5.4).
//! - **4× smaller**: 5.7 KiB vs 23 KiB for a 160×144 screen.
//! - The cost — bit twiddling in `set_pixel`/`get_pixel` — is negligible
//!   for a fixed 5.7 KiB buffer.
//!
//! On GBA builds the same API deliberately uses one byte per pixel instead.
//! That costs 23 KiB for the 160×144 framebuffer, but makes software drawing
//! constant-time and leaves a 32-bit-aligned linear source for Mode 4 DMA.
//!
//! The bit width is derived from `C::MAX` (2 bits for [`GbColor`], 4 bits
//! for [`GbaColor`]), so the same type serves both the 4-color DMG and
//! 16-color GBA palettes. RGBA conversion is deferred to display time via
//! [`IndexedFrameBuffer::to_rgba`], which is what makes palette swaps
//! (fades, flashes) nearly free — the way real GB hardware does them.
//!
//! # Memory
//!
//! Dimensions are fixed at construction (runtime values, like the engine's
//! [`dotzuki_engine::render::FrameBuffer`]); [`Default`] is the 160×144 Game
//! Boy screen. Storage is a `Vec` allocated exactly once at construction and
//! never resized: `packed_len` bytes on hosted targets, or one aligned byte
//! per pixel on GBA. A compile-time-sized fixed-array variant is not possible
//! on stable Rust today — array lengths cannot be computed from generic
//! parameters (`generic_const_exprs` is unstable) — so the eventual no_std/GB
//! step can swap the `Vec` for a static buffer without touching other code.

use core::marker::PhantomData;

use crate::palette::{ColorIndex, GbColor, GbaColor, Palette, GRAYSCALE_PALETTE};
use crate::tile::{Tile, TILE_PIXELS};
use dotzuki_engine::render::Rgba;
use dotzuki_engine::render_config::RenderConfig;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default screen width in pixels (Game Boy DMG resolution).
pub const SCREEN_WIDTH: usize = 160;
/// Default screen height in pixels (Game Boy DMG resolution).
pub const SCREEN_HEIGHT: usize = 144;

/// Number of bits needed to store one palette index of type `C`.
///
/// 2 for [`GbColor`] (4 colors), 4 for [`GbaColor`] (16 colors), at least 1
/// for any index type.
pub const fn index_bits<C: ColorIndex>() -> usize {
    let bits = C::MAX.ilog2();
    if bits < 1 {
        1
    } else {
        bits as usize
    }
}

/// Number of 8-pixel groups per row (rounded up).
///
/// A full Game Boy row is 20 groups; rows not divisible by 8 pack a partial
/// final group whose unused bits stay zero and are never read.
const fn groups_per_row(width: usize) -> usize {
    (width + 7) / 8
}

/// Packed storage length in bytes for a `width × height` buffer of `C`
/// indices: `height * groups_per_row(width) * index_bits::<C>()`.
///
/// 5,760 for a 160×144 [`GbColor`] buffer, 11,520 for [`GbaColor`].
pub const fn packed_len<C: ColorIndex>(width: usize, height: usize) -> usize {
    height * groups_per_row(width) * index_bits::<C>()
}

// ---------------------------------------------------------------------------
// IndexedFrameBuffer
// ---------------------------------------------------------------------------

/// A fixed-size framebuffer storing palette indices instead of RGBA pixels.
///
/// `C` is the palette index type ([`GbColor`] for 4-color DMG, [`GbaColor`]
/// for 16-color GBA). Dimensions are chosen at construction (see
/// [`Default`] for the 160×144 Game Boy screen). Hosted storage is a packed
/// planar bitplane array; GBA storage is chunky and DMA-aligned (see the
/// [module docs](self)). Index values are implicitly masked to the storage
/// width on write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedFrameBuffer<C: ColorIndex = GbColor> {
    /// Pixel storage. Hosted targets use packed planar bitplanes; the GBA
    /// uses one byte per index to trade 17 KiB for much faster software
    /// rasterization and direct Mode 4 presentation.
    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    data: Vec<u8>,
    // u32 backing guarantees the alignment required by 32-bit GBA DMA. The
    // bytes are still addressed individually by the drawing API.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    data: Vec<u32>,
    /// Screen width in pixels.
    width: usize,
    /// Screen height in pixels.
    height: usize,
    #[doc(hidden)]
    _phantom: PhantomData<C>,
}

#[cfg(any(all(target_os = "none", target_arch = "arm"), test))]
#[inline(always)]
fn scroll_chunky_row(row: &mut [u8], dx: i32, clear: u8) {
    debug_assert!(dx != 0 && (dx.unsigned_abs() as usize) < row.len());
    let offset = dx.unsigned_abs() as usize;
    let copy_width = row.len() - offset;
    let source_x = if dx < 0 { offset } else { 0 };
    let target_x = if dx > 0 { offset } else { 0 };
    let row_ptr = row.as_mut_ptr();

    // A 2-byte-misaligned source/destination would otherwise require twice
    // as many halfword copies. On the little-endian GBA, combine adjacent
    // aligned words so each iteration still moves four pixels.
    if cfg!(target_endian = "little")
        && row.len() & 3 == 0
        && row_ptr as usize & 3 == 0
        && offset & 3 == 2
    {
        let words = row.len() / 4;
        let word_offset = offset / 4;
        let full_words = copy_width / 4;
        let row_words = row_ptr as *mut u32;
        if dx < 0 {
            for target_word in 0..full_words {
                let source_word = word_offset + target_word;
                let lower = unsafe { row_words.add(source_word).read() };
                let upper = unsafe { row_words.add(source_word + 1).read() };
                unsafe {
                    row_words
                        .add(target_word)
                        .write((lower >> 16) | (upper << 16));
                }
            }
            let tail = unsafe { row_words.add(words - 1).read() } >> 16;
            unsafe { (row_ptr.add(full_words * 4) as *mut u16).write(tail as u16) };
            row[copy_width..].fill(clear);
        } else {
            for source_word in (0..full_words).rev() {
                let lower = unsafe { row_words.add(source_word).read() };
                let upper = unsafe { row_words.add(source_word + 1).read() };
                unsafe {
                    row_words
                        .add(word_offset + 1 + source_word)
                        .write((lower >> 16) | (upper << 16));
                }
            }
            let prefix = unsafe { row_words.read() } as u16;
            unsafe { (row_ptr.add(offset) as *mut u16).write(prefix) };
            row[..offset].fill(clear);
        }
        return;
    }

    let source_address = unsafe { row_ptr.add(source_x) } as usize;
    let target_address = unsafe { row_ptr.add(target_x) } as usize;
    if (source_address | target_address | copy_width) & 3 == 0 {
        let words = copy_width / 4;
        let source = unsafe { row_ptr.add(source_x) as *const u32 };
        let target = unsafe { row_ptr.add(target_x) as *mut u32 };
        if dx > 0 {
            for word in (0..words).rev() {
                unsafe { target.add(word).write(source.add(word).read()) };
            }
        } else {
            for word in 0..words {
                unsafe { target.add(word).write(source.add(word).read()) };
            }
        }
    } else if (source_address | target_address | copy_width) & 1 == 0 {
        let halfwords = copy_width / 2;
        let source = unsafe { row_ptr.add(source_x) as *const u16 };
        let target = unsafe { row_ptr.add(target_x) as *mut u16 };
        if dx > 0 {
            for halfword in (0..halfwords).rev() {
                unsafe { target.add(halfword).write(source.add(halfword).read()) };
            }
        } else {
            for halfword in 0..halfwords {
                unsafe { target.add(halfword).write(source.add(halfword).read()) };
            }
        }
    } else if dx > 0 {
        for byte in (0..copy_width).rev() {
            unsafe {
                row_ptr
                    .add(target_x + byte)
                    .write(row_ptr.add(source_x + byte).read())
            };
        }
    } else {
        for byte in 0..copy_width {
            unsafe {
                row_ptr
                    .add(target_x + byte)
                    .write(row_ptr.add(source_x + byte).read())
            };
        }
    }

    if dx > 0 {
        row[..target_x].fill(clear);
    } else {
        row[copy_width..].fill(clear);
    }
}

impl<C: ColorIndex> IndexedFrameBuffer<C> {
    /// Create a new `width × height` buffer, cleared to `clear`.
    pub fn new(width: usize, height: usize, clear: C) -> Self {
        #[cfg(all(target_os = "none", target_arch = "arm"))]
        let data = vec![0; (width * height + 3) / 4];
        #[cfg(not(all(target_os = "none", target_arch = "arm")))]
        let data = vec![0; packed_len::<C>(width, height)];
        let mut fb = Self {
            data,
            width,
            height,
            _phantom: PhantomData,
        };
        fb.clear(clear);
        fb
    }

    /// Screen width in pixels.
    #[inline]
    pub const fn width(&self) -> usize {
        self.width
    }

    /// Screen height in pixels.
    #[inline]
    pub const fn height(&self) -> usize {
        self.height
    }

    /// Total number of pixels.
    #[inline]
    pub fn len(&self) -> usize {
        self.width * self.height
    }

    /// Whether the buffer holds no pixels.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }

    /// Clear the entire buffer to a single index.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    pub fn clear(&mut self, color: C) {
        self.data
            .fill(u32::from_ne_bytes([color.to_index() as u8; 4]));
    }

    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    pub fn clear(&mut self, color: C) {
        let value = color.to_index();
        let bits = index_bits::<C>();
        if value == 0 || value + 1 == C::MAX {
            self.data.fill(if value == 0 { 0x00 } else { 0xFF });
            return;
        }
        // In planar layout, byte `i` holds bitplane `i % bits` of a row
        // group, so filling every byte of a plane with 0xFF/0x00 paints
        // that plane across all 8 pixels of each group.
        for (i, byte) in self.data.iter_mut().enumerate() {
            let plane = i % bits;
            *byte = if (value >> plane) & 1 == 1 {
                0xFF
            } else {
                0x00
            };
        }
    }

    /// Set a single pixel. Returns false if out of bounds.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    #[inline]
    pub fn set_pixel(&mut self, x: u32, y: u32, color: C) -> bool {
        if x >= self.width as u32 || y >= self.height as u32 {
            return false;
        }
        let index = y as usize * self.width + x as usize;
        unsafe {
            (self.data.as_mut_ptr() as *mut u8)
                .add(index)
                .write(color.to_index() as u8);
        }
        true
    }

    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    pub fn set_pixel(&mut self, x: u32, y: u32, color: C) -> bool {
        if x >= self.width as u32 || y >= self.height as u32 {
            return false;
        }
        let value = color.to_index();
        let bits = index_bits::<C>();
        let group = (x as usize) / 8;
        let bit = 7 - ((x as usize) % 8);
        let base = ((y as usize) * groups_per_row(self.width) + group) * bits;
        for plane in 0..bits {
            let plane_bit = ((value >> plane) & 1) as u8;
            let byte = &mut self.data[base + plane];
            *byte = (*byte & !(1 << bit)) | (plane_bit << bit);
        }
        true
    }

    /// Get the index of a single pixel. Returns None if out of bounds.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    #[inline]
    pub fn get_pixel(&self, x: u32, y: u32) -> Option<C> {
        if x >= self.width as u32 || y >= self.height as u32 {
            return None;
        }
        let index = y as usize * self.width + x as usize;
        let value = unsafe { (self.data.as_ptr() as *const u8).add(index).read() };
        Some(C::from_u8(value))
    }

    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    pub fn get_pixel(&self, x: u32, y: u32) -> Option<C> {
        if x >= self.width as u32 || y >= self.height as u32 {
            return None;
        }
        let bits = index_bits::<C>();
        let group = (x as usize) / 8;
        let bit = 7 - ((x as usize) % 8);
        let base = ((y as usize) * groups_per_row(self.width) + group) * bits;
        let mut value = 0usize;
        for plane in 0..bits {
            if (self.data[base + plane] >> bit) & 1 == 1 {
                value |= 1 << plane;
            }
        }
        Some(C::from_u8(value as u8))
    }

    /// Fill a rectangular region with an index. Coordinates are clamped to
    /// buffer bounds.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    pub fn fill_rect(&mut self, x: u32, y: u32, rect_width: u32, rect_height: u32, color: C) {
        let x_start = (x as usize).min(self.width);
        let y_start = (y as usize).min(self.height);
        let x_end = (x.saturating_add(rect_width) as usize).min(self.width);
        let y_end = (y.saturating_add(rect_height) as usize).min(self.height);
        let value = color.to_index() as u8;
        let pixels = unsafe {
            core::slice::from_raw_parts_mut(self.data.as_mut_ptr() as *mut u8, self.len())
        };
        for row in y_start..y_end {
            pixels[row * self.width + x_start..row * self.width + x_end].fill(value);
        }
    }

    /// Move the existing pixels by `(dx, dy)` and fill the newly exposed
    /// edges with `clear`.
    ///
    /// Positive offsets move pixels right/down. Pixels shifted outside the
    /// framebuffer are discarded. The GBA's chunky backing performs the
    /// move in place, avoiding a second full-screen allocation.
    pub fn scroll(&mut self, dx: i32, dy: i32, clear: C) {
        if dx == 0 && dy == 0 {
            return;
        }
        if self.is_empty()
            || dx.unsigned_abs() as usize >= self.width
            || dy.unsigned_abs() as usize >= self.height
        {
            self.clear(clear);
            return;
        }

        #[cfg(all(target_os = "none", target_arch = "arm"))]
        {
            let width = self.width;
            let height = self.height;
            let copy_width = width - dx.unsigned_abs() as usize;
            let source_x = if dx < 0 {
                dx.unsigned_abs() as usize
            } else {
                0
            };
            let target_x = if dx > 0 { dx as usize } else { 0 };
            let clear_value = clear.to_index() as u8;
            let pixels = unsafe {
                core::slice::from_raw_parts_mut(self.data.as_mut_ptr() as *mut u8, width * height)
            };

            // Vertical-only moves are one contiguous memmove. Horizontal
            // moves need row boundaries, so copy aligned words/halfwords in
            // the overlap-safe direction instead of invoking memmove once
            // per scanline.
            if dx == 0 {
                if dy > 0 {
                    let offset = dy as usize;
                    pixels.copy_within(0..(height - offset) * width, offset * width);
                    pixels[..offset * width].fill(clear_value);
                } else {
                    let offset = dy.unsigned_abs() as usize;
                    pixels.copy_within(offset * width..height * width, 0);
                    pixels[(height - offset) * width..].fill(clear_value);
                }
                return;
            }

            if dy == 0 {
                for y in 0..height {
                    let start = y * width;
                    scroll_chunky_row(&mut pixels[start..start + width], dx, clear_value);
                }
                return;
            }

            if dy > 0 {
                let offset = dy as usize;
                for source_y in (0..height - offset).rev() {
                    let target_y = source_y + offset;
                    let source = source_y * width + source_x;
                    let target = target_y * width + target_x;
                    pixels.copy_within(source..source + copy_width, target);
                    if dx > 0 {
                        pixels[target_y * width..target_y * width + target_x].fill(clear_value);
                    } else if dx < 0 {
                        pixels[target + copy_width..(target_y + 1) * width].fill(clear_value);
                    }
                }
                pixels[..offset * width].fill(clear_value);
            } else {
                let offset = dy.unsigned_abs() as usize;
                for source_y in offset..height {
                    let target_y = source_y - offset;
                    let source = source_y * width + source_x;
                    let target = target_y * width + target_x;
                    pixels.copy_within(source..source + copy_width, target);
                    if dx > 0 {
                        pixels[target_y * width..target_y * width + target_x].fill(clear_value);
                    } else if dx < 0 {
                        pixels[target + copy_width..(target_y + 1) * width].fill(clear_value);
                    }
                }
                pixels[(height - offset) * width..].fill(clear_value);
            }
        }

        #[cfg(not(all(target_os = "none", target_arch = "arm")))]
        {
            let source = self.clone();
            self.clear(clear);
            for y in 0..self.height as i32 {
                let source_y = y - dy;
                if source_y < 0 || source_y >= self.height as i32 {
                    continue;
                }
                for x in 0..self.width as i32 {
                    let source_x = x - dx;
                    if source_x < 0 || source_x >= self.width as i32 {
                        continue;
                    }
                    let color = source
                        .get_pixel(source_x as u32, source_y as u32)
                        .expect("scroll source is in bounds");
                    self.set_pixel(x as u32, y as u32, color);
                }
            }
        }
    }

    /// Copy a clipped pixel rectangle from `other` at the same coordinates.
    /// Pixels outside the rectangle are preserved. Both buffers must have the
    /// same dimensions.
    pub fn copy_rect_from(
        &mut self,
        other: &Self,
        x: u32,
        y: u32,
        rect_width: u32,
        rect_height: u32,
    ) {
        assert_eq!(self.width, other.width, "framebuffer width mismatch");
        assert_eq!(self.height, other.height, "framebuffer height mismatch");
        let x_start = (x as usize).min(self.width);
        let y_start = (y as usize).min(self.height);
        let x_end = (x.saturating_add(rect_width) as usize).min(self.width);
        let y_end = (y.saturating_add(rect_height) as usize).min(self.height);
        if x_start >= x_end || y_start >= y_end {
            return;
        }

        #[cfg(all(target_os = "none", target_arch = "arm"))]
        {
            let copy_width = x_end - x_start;
            let destination = self.data.as_mut_ptr().cast::<u8>();
            let source = other.data.as_ptr().cast::<u8>();
            for row in y_start..y_end {
                let offset = row * self.width + x_start;
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        source.add(offset),
                        destination.add(offset),
                        copy_width,
                    );
                }
            }
        }

        #[cfg(not(all(target_os = "none", target_arch = "arm")))]
        for row in y_start..y_end {
            for column in x_start..x_end {
                let color = other
                    .get_pixel(column as u32, row as u32)
                    .expect("copy source is in bounds");
                self.set_pixel(column as u32, row as u32, color);
            }
        }
    }

    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    pub fn fill_rect(&mut self, x: u32, y: u32, rect_width: u32, rect_height: u32, color: C) {
        let x_start = (x as usize).min(self.width);
        let y_start = (y as usize).min(self.height);
        let x_end = (x.saturating_add(rect_width) as usize).min(self.width);
        let y_end = (y.saturating_add(rect_height) as usize).min(self.height);
        if x_start >= x_end || y_start >= y_end {
            return;
        }

        let value = color.to_index();
        let bits = index_bits::<C>();
        let groups = groups_per_row(self.width);
        let first_group = x_start / 8;
        let last_group = (x_end - 1) / 8;
        for row in y_start..y_end {
            for group in first_group..=last_group {
                let group_x = group * 8;
                let from = x_start.saturating_sub(group_x).min(8);
                let until = x_end.saturating_sub(group_x).min(8);
                let mask = (0xFFu8 >> from) & (0xFFu8 << (8 - until));
                let base = (row * groups + group) * bits;
                for plane in 0..bits {
                    let fill = if (value >> plane) & 1 == 1 {
                        0xFF
                    } else {
                        0x00
                    };
                    if mask == 0xFF {
                        self.data[base + plane] = fill;
                    } else if fill == 0xFF {
                        self.data[base + plane] |= mask;
                    } else {
                        self.data[base + plane] &= !mask;
                    }
                }
            }
        }
    }

    /// Expand the indexed buffer into RGBA using `palette`.
    ///
    /// Writes `width * height * 4` bytes of row-major `[r, g, b, a]` pixel
    /// data into `out`. Returns false (and writes nothing) if `out` is too
    /// small. The palette should define an entry for every index in the
    /// buffer.
    pub fn to_rgba(&self, palette: &Palette<C>, out: &mut [u8]) -> bool {
        let need = self.width * self.height * 4;
        if out.len() < need {
            return false;
        }
        let mut base = 0;
        for y in 0..self.height {
            for x in 0..self.width {
                let index = self.get_pixel(x as u32, y as u32).expect("pixel in bounds");
                out[base..base + 4].copy_from_slice(&palette.color(index).to_array());
                base += 4;
            }
        }
        true
    }

    /// Raw packed storage, in the planar bitplane format described in the
    /// [module docs](self). For [`GbColor`] this is GB 2bpp tile data, so
    /// any 8×8-aligned region can be fed directly to
    /// [`crate::tile::Tile::from_2bpp`].
    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    #[inline]
    pub fn packed(&self) -> &[u8] {
        &self.data
    }

    /// Mutable raw packed storage (e.g. for tile blits into 8×8-aligned
    /// regions, or for serialization). The caller must preserve the
    /// planar bitplane layout.
    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    #[inline]
    pub fn packed_mut(&mut self) -> &mut [u8] {
        &mut self.data
    }

    /// GBA-only chunky one-byte-per-pixel storage, ready for Mode 4.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    #[inline]
    pub fn indices(&self) -> &[u8] {
        unsafe { core::slice::from_raw_parts(self.data.as_ptr() as *const u8, self.len()) }
    }

    /// Mutable GBA-only chunky one-byte-per-pixel storage.
    ///
    /// Platform frontends may use this view for hardware-accelerated moves.
    /// Every byte must remain a valid palette index for `C`.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    #[inline]
    pub fn indices_mut(&mut self) -> &mut [u8] {
        unsafe {
            core::slice::from_raw_parts_mut(self.data.as_mut_ptr() as *mut u8, self.len())
        }
    }
}

/// The default [`IndexedFrameBuffer`] is a 160×144 Game Boy screen,
/// cleared to index 0.
impl<C: ColorIndex> Default for IndexedFrameBuffer<C> {
    fn default() -> Self {
        Self::new(SCREEN_WIDTH, SCREEN_HEIGHT, C::from_u8(0))
    }
}

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

/// Find the palette entry closest to `color`.
///
/// Distance is summed squared channel difference over all four channels
/// (r, g, b, a), so transparent palette entries only win for transparent
/// input colors. Only the first `palette.count` entries are considered;
/// ties prefer the lower index.
pub fn quantize<C: ColorIndex>(palette: &Palette<C>, color: Rgba) -> C {
    let mut best = C::from_u8(0);
    let mut best_dist = u32::MAX;
    for i in 0..palette.count as usize {
        let entry = palette.colors[i];
        let dr = entry.r as i32 - color.r as i32;
        let dg = entry.g as i32 - color.g as i32;
        let db = entry.b as i32 - color.b as i32;
        let da = entry.a as i32 - color.a as i32;
        let dist = (dr * dr + dg * dg + db * db + da * da) as u32;
        if dist < best_dist {
            best_dist = dist;
            best = C::from_u8(i as u8);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::palette::{GbaColor, GRAYSCALE_PALETTE, GRAYSCALE_SPRITE_PALETTE};
    use crate::tile::Tile;

    #[test]
    fn storage_sizes() {
        // The flagship case from the port plan: 160×144, 2bpp → 5,760 B.
        assert_eq!(packed_len::<GbColor>(SCREEN_WIDTH, SCREEN_HEIGHT), 5760);
        assert_eq!(packed_len::<GbColor>(160, 144), 5760);
        // 4-bit indices double the footprint.
        assert_eq!(packed_len::<GbaColor>(160, 144), 11520);
        assert_eq!(index_bits::<GbColor>(), 2);
        assert_eq!(index_bits::<GbaColor>(), 4);
        // The buffer itself is exactly that many bytes, no slack.
        let fb = IndexedFrameBuffer::<GbColor>::new(160, 144, GbColor::White);
        assert_eq!(fb.packed().len(), 5760);
        let gba = IndexedFrameBuffer::<GbaColor>::new(160, 144, GbaColor(0));
        assert_eq!(gba.packed().len(), 11520);
    }

    #[test]
    fn default_is_screen_sized_cleared() {
        let fb = IndexedFrameBuffer::<GbColor>::default();
        assert_eq!(fb.width(), SCREEN_WIDTH);
        assert_eq!(fb.height(), SCREEN_HEIGHT);
        assert_eq!(fb.len(), 160 * 144);
        assert_eq!(fb.get_pixel(0, 0), Some(GbColor::White));
        assert_eq!(fb.get_pixel(159, 143), Some(GbColor::White));
        let gba = IndexedFrameBuffer::<GbaColor>::default();
        assert_eq!(gba.get_pixel(159, 143), Some(GbaColor(0)));
    }

    #[test]
    fn packing_round_trip_gb() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(16, 8, GbColor::White);
        let pattern = [
            GbColor::White,
            GbColor::LightGray,
            GbColor::DarkGray,
            GbColor::Black,
        ];
        for y in 0..8u32 {
            for x in 0..16u32 {
                fb.set_pixel(x, y, pattern[((x + y) as usize) % 4]);
            }
        }
        for y in 0..8u32 {
            for x in 0..16u32 {
                assert_eq!(
                    fb.get_pixel(x, y),
                    Some(pattern[((x + y) as usize) % 4]),
                    "mismatch at ({x}, {y})"
                );
            }
        }
    }

    #[test]
    fn packing_round_trip_gba() {
        let mut fb = IndexedFrameBuffer::<GbaColor>::new(8, 4, GbaColor(0));
        for y in 0..4u32 {
            for x in 0..8u32 {
                fb.set_pixel(x, y, GbaColor(((x * 3 + y * 5) % 16) as u8));
            }
        }
        for y in 0..4u32 {
            for x in 0..8u32 {
                assert_eq!(
                    fb.get_pixel(x, y),
                    Some(GbaColor(((x * 3 + y * 5) % 16) as u8))
                );
            }
        }
    }

    #[test]
    fn packing_round_trip_non_multiple_of_8() {
        // 10×7 is not divisible by 8; the partial row group must stay
        // readable and never alias into the next row.
        let mut fb = IndexedFrameBuffer::<GbColor>::new(10, 7, GbColor::White);
        for y in 0..7u32 {
            for x in 0..10u32 {
                fb.set_pixel(x, y, GbColor::from_u8(((x + y) % 4) as u8));
            }
        }
        for y in 0..7u32 {
            for x in 0..10u32 {
                assert_eq!(
                    fb.get_pixel(x, y),
                    Some(GbColor::from_u8(((x + y) % 4) as u8))
                );
            }
        }
        // The unused bits of the partial group must read back as nothing:
        // those pixel positions are out of bounds.
        assert_eq!(fb.get_pixel(10, 0), None);
        assert_eq!(fb.get_pixel(0, 7), None);
    }

    #[test]
    fn packed_layout_is_gb_vram_bitplanes() {
        // Pin the exact byte layout: row of [1,0,3,0,2,0,1,0] packs to
        // plane 0 = 0b10100010 (bits 7,5,1), plane 1 = 0b00101000 (bits 5,3).
        let mut fb = IndexedFrameBuffer::<GbColor>::new(8, 1, GbColor::White);
        let row = [1u8, 0, 3, 0, 2, 0, 1, 0];
        for (x, &v) in row.iter().enumerate() {
            fb.set_pixel(x as u32, 0, GbColor::from_u8(v));
        }
        assert_eq!(fb.packed(), &[0xA2, 0x28]);
    }

    #[test]
    fn packed_data_feeds_tile_decoder() {
        // VRAM isomorphism: a GbColor 8×8 buffer's packed bytes are GB 2bpp
        // tile data, so Tile::from_2bpp decodes them 1:1.
        let mut fb = IndexedFrameBuffer::<GbColor>::new(8, 8, GbColor::White);
        for y in 0..8u32 {
            for x in 0..8u32 {
                fb.set_pixel(x, y, GbColor::from_u8(((x * y) % 4) as u8));
            }
        }
        let tile = Tile::from_2bpp(fb.packed());
        for y in 0..8 {
            for x in 0..8 {
                assert_eq!(tile.pixels[y][x], ((x * y) % 4) as u8);
            }
        }
    }

    #[test]
    fn bounds_are_checked() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(8, 4, GbColor::White);
        assert!(fb.set_pixel(7, 3, GbColor::Black));
        assert!(!fb.set_pixel(8, 0, GbColor::Black));
        assert!(!fb.set_pixel(0, 4, GbColor::Black));
        assert!(!fb.set_pixel(u32::MAX, 0, GbColor::Black));
        assert_eq!(fb.get_pixel(8, 0), None);
        assert_eq!(fb.get_pixel(0, 4), None);
        assert_eq!(fb.get_pixel(7, 3), Some(GbColor::Black));
    }

    #[test]
    fn clear_fills_every_pixel() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(10, 7, GbColor::Black);
        // Deface it.
        fb.fill_rect(0, 0, 10, 7, GbColor::LightGray);
        assert_eq!(fb.get_pixel(5, 3), Some(GbColor::LightGray));
        fb.clear(GbColor::Black);
        for y in 0..7u32 {
            for x in 0..10u32 {
                assert_eq!(fb.get_pixel(x, y), Some(GbColor::Black));
            }
        }
        assert_eq!(fb.packed(), &[0xFF; packed_len::<GbColor>(10, 7)]);
    }

    #[test]
    fn fill_rect_clamps_to_bounds() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(8, 8, GbColor::White);
        // Start beyond the edge and overflow the opposite edge.
        fb.fill_rect(4, 4, 100, 100, GbColor::Black);
        assert_eq!(fb.get_pixel(3, 3), Some(GbColor::White));
        assert_eq!(fb.get_pixel(4, 3), Some(GbColor::White));
        assert_eq!(fb.get_pixel(3, 4), Some(GbColor::White));
        assert_eq!(fb.get_pixel(4, 4), Some(GbColor::Black));
        assert_eq!(fb.get_pixel(7, 7), Some(GbColor::Black));
        // Fully out of bounds: no-op.
        fb.fill_rect(8, 8, 4, 4, GbColor::DarkGray);
        assert_eq!(fb.get_pixel(7, 7), Some(GbColor::Black));
    }

    #[test]
    fn fill_rect_preserves_pixels_outside_partial_groups() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(19, 3, GbColor::White);
        fb.fill_rect(3, 1, 13, 1, GbColor::DarkGray);
        for y in 0..3 {
            for x in 0..19 {
                let expected = if y == 1 && (3..16).contains(&x) {
                    GbColor::DarkGray
                } else {
                    GbColor::White
                };
                assert_eq!(fb.get_pixel(x, y), Some(expected), "({x}, {y})");
            }
        }
    }

    #[test]
    fn chunky_row_scroll_matches_reference_for_every_offset() {
        let mut storage = [0u32; 10];
        let storage_bytes = unsafe {
            core::slice::from_raw_parts_mut(storage.as_mut_ptr() as *mut u8, storage.len() * 4)
        };
        for width in [37, storage_bytes.len()] {
            let row = &mut storage_bytes[..width];
            let original: Vec<u8> = (0..row.len() as u8).collect();
            for dx in -(row.len() as i32 - 1)..row.len() as i32 {
                if dx == 0 {
                    continue;
                }
                row.copy_from_slice(&original);
                scroll_chunky_row(row, dx, 0xff);
                for (x, &actual) in row.iter().enumerate() {
                    let source_x = x as i32 - dx;
                    let expected = if (0..original.len() as i32).contains(&source_x) {
                        original[source_x as usize]
                    } else {
                        0xff
                    };
                    assert_eq!(actual, expected, "width {width}, offset {dx}, pixel {x}");
                }
            }
        }
    }

    #[test]
    fn scroll_moves_pixels_and_clears_exposed_edges() {
        let mut original = IndexedFrameBuffer::<GbColor>::new(5, 4, GbColor::White);
        for y in 0..4 {
            for x in 0..5 {
                original.set_pixel(x, y, GbColor::from_u8(((y * 5 + x) % 4) as u8));
            }
        }

        for (dx, dy) in [(2, 1), (-2, -1), (1, -2), (-1, 2)] {
            let mut shifted = original.clone();
            shifted.scroll(dx, dy, GbColor::Black);
            for y in 0..4i32 {
                for x in 0..5i32 {
                    let source_x = x - dx;
                    let source_y = y - dy;
                    let expected = if (0..5).contains(&source_x) && (0..4).contains(&source_y) {
                        original
                            .get_pixel(source_x as u32, source_y as u32)
                            .unwrap()
                    } else {
                        GbColor::Black
                    };
                    assert_eq!(
                        shifted.get_pixel(x as u32, y as u32),
                        Some(expected),
                        "offset ({dx}, {dy}), pixel ({x}, {y})"
                    );
                }
            }
        }
    }

    #[test]
    fn scroll_clears_when_offset_exceeds_dimensions() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(5, 4, GbColor::LightGray);
        fb.scroll(5, 0, GbColor::DarkGray);
        for y in 0..4 {
            for x in 0..5 {
                assert_eq!(fb.get_pixel(x, y), Some(GbColor::DarkGray));
            }
        }
    }

    #[test]
    fn copy_rect_from_preserves_pixels_outside_the_rectangle() {
        let mut source = IndexedFrameBuffer::<GbColor>::new(10, 7, GbColor::White);
        for y in 0..7 {
            for x in 0..10 {
                source.set_pixel(x, y, GbColor::from_u8(((x + y * 3) % 4) as u8));
            }
        }
        let mut destination = IndexedFrameBuffer::<GbColor>::new(10, 7, GbColor::Black);
        destination.copy_rect_from(&source, 2, 1, 5, 4);
        for y in 0..7 {
            for x in 0..10 {
                let expected = if (2..7).contains(&x) && (1..5).contains(&y) {
                    source.get_pixel(x, y).unwrap()
                } else {
                    GbColor::Black
                };
                assert_eq!(destination.get_pixel(x, y), Some(expected), "({x}, {y})");
            }
        }
    }

    #[test]
    fn to_rgba_applies_palette() {
        let mut fb = IndexedFrameBuffer::<GbColor>::new(4, 2, GbColor::White);
        fb.set_pixel(0, 0, GbColor::Black);
        fb.set_pixel(3, 1, GbColor::DarkGray);
        let pal = GRAYSCALE_PALETTE;
        let mut out = [0u8; 4 * 2 * 4];
        assert!(fb.to_rgba(&pal, &mut out));
        assert_eq!(&out[0..4], &Rgba::rgb(0x00, 0x00, 0x00).to_array());
        assert_eq!(&out[1 * 4..2 * 4], &Rgba::rgb(0xFF, 0xFF, 0xFF).to_array());
        assert_eq!(
            &out[(3 + 1 * 4) * 4..(3 + 1 * 4) * 4 + 4],
            &Rgba::rgb(0x55, 0x55, 0x55).to_array()
        );
    }

    #[test]
    fn to_rgba_rejects_short_slice() {
        let fb = IndexedFrameBuffer::<GbColor>::new(4, 2, GbColor::White);
        let mut out = [0u8; 4 * 2 * 4 - 1];
        assert!(!fb.to_rgba(&GRAYSCALE_PALETTE, &mut out));
        assert_eq!(out, [0u8; 4 * 2 * 4 - 1]); // untouched
    }

    #[test]
    fn quantize_exact_match() {
        let pal = GRAYSCALE_PALETTE;
        assert_eq!(quantize(&pal, Rgba::rgb(0xFF, 0xFF, 0xFF)), GbColor::White);
        assert_eq!(
            quantize(&pal, Rgba::rgb(0xAA, 0xAA, 0xAA)),
            GbColor::LightGray
        );
        assert_eq!(
            quantize(&pal, Rgba::rgb(0x55, 0x55, 0x55)),
            GbColor::DarkGray
        );
        assert_eq!(quantize(&pal, Rgba::rgb(0x00, 0x00, 0x00)), GbColor::Black);
    }

    #[test]
    fn quantize_picks_nearest() {
        // Midway between white (255) and light gray (170) → light gray.
        let pal = GRAYSCALE_PALETTE;
        assert_eq!(quantize(&pal, Rgba::rgb(200, 200, 200)), GbColor::LightGray);
        // Midway between light gray (170) and dark gray (85) → dark gray.
        assert_eq!(
            quantize(&pal, Rgba::rgb(0x7F, 0x7F, 0x7F)),
            GbColor::DarkGray
        );
        // Darkest possible input → black.
        assert_eq!(quantize(&pal, Rgba::rgb(30, 30, 30)), GbColor::Black);
    }

    #[test]
    fn quantize_alpha_aware() {
        // Sprite palette entry 0 is transparent: an opaque dark pixel must
        // not quantize to it.
        let pal = GRAYSCALE_SPRITE_PALETTE;
        assert_eq!(pal.colors[0], Rgba::TRANSPARENT);
        assert_eq!(quantize(&pal, Rgba::rgb(0x00, 0x00, 0x00)), GbColor::Black);
        // A fully transparent pixel prefers the transparent entry.
        assert_eq!(quantize(&pal, Rgba::TRANSPARENT), GbColor::White);
    }

    #[test]
    fn quantize_gba_palette() {
        let mut colors = [Rgba::BLACK; 16];
        colors[0] = Rgba::rgb(0xFF, 0x00, 0x00);
        colors[1] = Rgba::rgb(0x00, 0xFF, 0x00);
        colors[2] = Rgba::rgb(0x00, 0x00, 0xFF);
        let pal = Palette::<GbaColor>::from_gba_palette(colors);
        assert_eq!(quantize(&pal, Rgba::rgb(0xFF, 0x00, 0x00)), GbaColor(0));
        assert_eq!(quantize(&pal, Rgba::rgb(0x00, 0xFF, 0x00)), GbaColor(1));
        assert_eq!(quantize(&pal, Rgba::rgb(0x00, 0x00, 0xFF)), GbaColor(2));
        // Midway between red and green, the input lands on the closer one.
        assert_eq!(quantize(&pal, Rgba::rgb(0xC0, 0x40, 0x00)), GbaColor(0));
    }
}

// ---------------------------------------------------------------------------
// DefaultPalette — per-index-type construction default
// ---------------------------------------------------------------------------

/// The palette [`RgbaIndexedFrameBuffer`] quantizes against when constructed
/// without an explicit palette.
pub trait DefaultPalette: ColorIndex {
    /// Default quantization/display palette for this index type.
    fn default_palette() -> Palette<Self>;
}

impl DefaultPalette for GbColor {
    fn default_palette() -> Palette<Self> {
        // The pokered render chain draws in GRAYSCALE shades, so quantizing
        // against the grayscale palette is exact for every current draw call.
        GRAYSCALE_PALETTE
    }
}

impl DefaultPalette for GbaColor {
    fn default_palette() -> Palette<Self> {
        let mut colors = [Rgba::BLACK; 16];
        for i in 0..16 {
            let v = (255 - i * 17) as u8;
            colors[i] = Rgba::rgb(v, v, v);
        }
        Palette::<GbaColor>::from_gba_palette(colors)
    }
}

// ---------------------------------------------------------------------------
// FbSurface — shared draw/present surface trait
// ---------------------------------------------------------------------------

/// A framebuffer draw surface shared by the engine's RGBA [`FrameBuffer`]
/// and the indexed [`RgbaIndexedFrameBuffer`].
///
/// Draw code written against RGBA (`set_pixel` / `fill_rect` / `clear`)
/// compiles and behaves identically on both: the indexed surface quantizes
/// every RGBA write through its base palette. `present_into` dumps the
/// final RGBA pixels (applying the display palette for indexed surfaces),
/// and `pixel_rgba` reads a single pixel (used by terminal halfblock
/// presenters).
pub trait FbSurface: Sized {
    /// Create a new `width × height` surface, cleared to black.
    fn new_screen(width: u32, height: u32) -> Self;
    /// Screen width in pixels.
    fn width(&self) -> u32;
    /// Screen height in pixels.
    fn height(&self) -> u32;
    /// Set a single pixel. Returns false if out of bounds.
    fn set_pixel(&mut self, x: u32, y: u32, color: Rgba) -> bool;
    /// Get the current color of a single pixel. Returns None if out of bounds.
    fn get_pixel(&self, x: u32, y: u32) -> Option<Rgba>;
    /// Clear the entire surface to a single color.
    fn clear(&mut self, color: Rgba);
    /// Fill a rectangular region with a color (clamped to bounds).
    fn fill_rect(&mut self, x: u32, y: u32, rect_width: u32, rect_height: u32, color: Rgba);
    /// Blit one decoded Game Boy tile, clipped to the surface.
    ///
    /// The default implementation preserves the ordinary RGBA drawing
    /// semantics. Indexed surfaces override it so the four palette entries
    /// are quantized once per tile rather than once per pixel.
    fn blit_gb_tile(
        &mut self,
        x: i32,
        y: i32,
        tile: &Tile,
        palette: &Palette,
        transparent: bool,
        flip_x: bool,
        flip_y: bool,
    ) {
        let width = self.width() as i32;
        let height = self.height() as i32;
        for dst_row in 0..TILE_PIXELS {
            let dst_y = y + dst_row as i32;
            if dst_y < 0 || dst_y >= height {
                continue;
            }
            let src_row = if flip_y {
                TILE_PIXELS - 1 - dst_row
            } else {
                dst_row
            };
            for dst_col in 0..TILE_PIXELS {
                let dst_x = x + dst_col as i32;
                if dst_x < 0 || dst_x >= width {
                    continue;
                }
                let src_col = if flip_x {
                    TILE_PIXELS - 1 - dst_col
                } else {
                    dst_col
                };
                let color = palette.color(GbColor::from_u8(tile.pixels[src_row][src_col]));
                if transparent && color == Rgba::TRANSPARENT {
                    continue;
                }
                self.set_pixel(dst_x as u32, dst_y as u32, color);
            }
        }
    }
    /// Read a single pixel as RGBA; out-of-bounds reads return transparent.
    fn pixel_rgba(&self, x: u32, y: u32) -> Rgba {
        self.get_pixel(x, y).unwrap_or(Rgba::TRANSPARENT)
    }
    /// Dump the whole surface as row-major RGBA into `out`, which must hold
    /// at least `width * height * 4` bytes.
    fn present_into(&self, out: &mut [u8]);
}

impl FbSurface for dotzuki_engine::render::FrameBuffer {
    fn new_screen(width: u32, height: u32) -> Self {
        Self::new(RenderConfig::new(width, height), Rgba::BLACK)
    }
    fn width(&self) -> u32 {
        self.width
    }
    fn height(&self) -> u32 {
        self.height
    }
    fn set_pixel(&mut self, x: u32, y: u32, color: Rgba) -> bool {
        Self::set_pixel(self, x, y, color)
    }
    fn get_pixel(&self, x: u32, y: u32) -> Option<Rgba> {
        Self::get_pixel(self, x, y)
    }
    fn clear(&mut self, color: Rgba) {
        Self::clear(self, color)
    }
    fn fill_rect(&mut self, x: u32, y: u32, rect_width: u32, rect_height: u32, color: Rgba) {
        Self::fill_rect(self, x, y, rect_width, rect_height, color)
    }
    fn present_into(&self, out: &mut [u8]) {
        assert!(out.len() >= self.data.len(), "present buffer too small");
        out[..self.data.len()].copy_from_slice(&self.data);
    }
}

// ---------------------------------------------------------------------------
// RgbaIndexedFrameBuffer — RGBA facade over IndexedFrameBuffer
// ---------------------------------------------------------------------------

/// An [`IndexedFrameBuffer`] with an RGBA-facing facade: RGBA writes are
/// quantized through a fixed *base* palette (so drawing is stable no matter
/// what display effect is active), while a separate *display* palette is
/// applied at present time.
///
/// Fades and flashes become palette operations, the way real GB hardware
/// does them: swap the display palette ([`Self::set_palette`],
/// [`Self::remap_shades`], [`Self::scale_shades`], [`Self::apply_bgp`])
/// instead of touching every pixel. Hosted buffers stay packed 2bpp — 5,760
/// bytes for a 160×144 screen instead of 92,160 — while GBA builds use the
/// module's DMA-friendly one-byte-per-pixel representation.
///
/// `base` doubles as the initial display palette; [`Self::reset_palette`]
/// restores it. The indexed API remains reachable via [`Self::indexed`] /
/// [`Self::indexed_mut`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RgbaIndexedFrameBuffer<C: ColorIndex = GbColor> {
    /// The indexed pixel storage.
    buffer: IndexedFrameBuffer<C>,
    /// Quantization palette: RGBA writes map to the nearest entry's index.
    base: Palette<C>,
    /// True when `base` is the standard opaque 0/85/170/255 gray ramp.
    /// This enables an O(1) quantizer for the overwhelmingly common path.
    fast_grayscale: bool,
    /// Display palette applied at present time; fades/flashes remap this.
    pub palette: Palette<C>,
}

impl<C: ColorIndex> RgbaIndexedFrameBuffer<C> {
    /// Create a `config`-sized buffer with an explicit base palette, cleared
    /// to `clear` (quantized through `base`).
    pub fn with_palette(config: RenderConfig, clear: Rgba, base: Palette<C>) -> Self {
        let fast_grayscale = base.count == 4
            && base.colors[0] == Rgba::rgb(0xFF, 0xFF, 0xFF)
            && base.colors[1] == Rgba::rgb(0xAA, 0xAA, 0xAA)
            && base.colors[2] == Rgba::rgb(0x55, 0x55, 0x55)
            && base.colors[3] == Rgba::rgb(0x00, 0x00, 0x00);
        let mut fb = Self {
            buffer: IndexedFrameBuffer::new(
                config.screen_width as usize,
                config.screen_height as usize,
                C::from_u8(0),
            ),
            palette: base,
            base,
            fast_grayscale,
        };
        fb.clear(clear);
        fb
    }

    /// The current display palette.
    #[inline]
    pub fn display_palette(&self) -> &Palette<C> {
        &self.palette
    }

    /// Replace the display palette (fade/flash effect).
    pub fn set_palette(&mut self, palette: Palette<C>) {
        self.palette = palette;
    }

    /// Restore the display palette to the base palette.
    pub fn reset_palette(&mut self) {
        self.palette = self.base;
    }

    /// Remap every display shade through `map`: display color `i` becomes the
    /// base palette entry `map[i]`. This is the indexed-buffer equivalent of
    /// the per-pixel `remap_shades` loops (rBGP-style register writes).
    pub fn remap_shades(&mut self, map: &[u8]) {
        let count = self.palette.count as usize;
        for i in 0..count {
            let mapped = map.get(i).copied().unwrap_or(i as u8) as usize % count;
            self.palette.colors[i] = self.base.colors[mapped];
        }
        self.palette.count = self.base.count;
    }

    /// Scale the display colors toward black by `scale` (0.0 = black,
    /// 1.0 = base palette). Alpha is preserved. Mirrors the per-pixel
    /// "brighten/darken" loops (e.g. the Ghost Marowak reveal).
    pub fn scale_shades(&mut self, scale: f32) {
        let scale = scale.clamp(0.0, 1.0);
        for i in 0..self.palette.count as usize {
            let c = self.base.colors[i];
            self.palette.colors[i] = Rgba::new(
                (c.r as f32 * scale) as u8,
                (c.g as f32 * scale) as u8,
                (c.b as f32 * scale) as u8,
                c.a,
            );
        }
    }

    /// Read-only access to the underlying indexed buffer.
    #[inline]
    pub fn indexed(&self) -> &IndexedFrameBuffer<C> {
        &self.buffer
    }

    /// Mutable access to the underlying indexed buffer (C-index API).
    #[inline]
    pub fn indexed_mut(&mut self) -> &mut IndexedFrameBuffer<C> {
        &mut self.buffer
    }

    /// Raw packed 2bpp storage (see [`IndexedFrameBuffer::packed`]).
    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    #[inline]
    pub fn packed(&self) -> &[u8] {
        self.buffer.packed()
    }

    /// Mutable raw packed storage.
    #[cfg(not(all(target_os = "none", target_arch = "arm")))]
    #[inline]
    pub fn packed_mut(&mut self) -> &mut [u8] {
        self.buffer.packed_mut()
    }

    /// GBA-only chunky one-byte-per-pixel storage, ready for Mode 4.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    #[inline]
    pub fn indices(&self) -> &[u8] {
        self.buffer.indices()
    }

    /// Mutable GBA-only chunky one-byte-per-pixel storage.
    ///
    /// Platform frontends may use this view for hardware-accelerated moves.
    /// Every byte must remain a valid palette index for `C`.
    #[cfg(all(target_os = "none", target_arch = "arm"))]
    #[inline]
    pub fn indices_mut(&mut self) -> &mut [u8] {
        self.buffer.indices_mut()
    }

    /// Expand the buffer into RGBA using the *display* palette.
    /// Writes `width * height * 4` bytes into `out`; returns false (and
    /// writes nothing) if `out` is too small.
    pub fn to_rgba(&self, out: &mut [u8]) -> bool {
        self.buffer.to_rgba(&self.palette, out)
    }

    /// Copy the pixels and display palette of `other` into this buffer.
    /// Both buffers must have the same dimensions.
    pub fn copy_from(&mut self, other: &Self) {
        self.copy_from_with(other, |destination, source| {
            destination.copy_from_slice(source);
        });
    }

    /// Copy from `other`, delegating the backing-storage transfer to
    /// `copy_pixels`.
    ///
    /// Hosted targets pass their packed planar bytes to the callback. Bare
    /// metal ARM targets pass their chunky one-byte-per-pixel storage, so a
    /// platform frontend can use a hardware copy engine without exposing
    /// renderer internals. The callback must copy every source byte into the
    /// equally sized destination slice before returning.
    ///
    /// Both buffers must have the same dimensions.
    pub fn copy_from_with<F>(&mut self, other: &Self, copy_pixels: F)
    where
        F: FnOnce(&mut [u8], &[u8]),
    {
        assert_eq!(self.width(), other.width(), "framebuffer width mismatch");
        assert_eq!(self.height(), other.height(), "framebuffer height mismatch");

        #[cfg(not(all(target_os = "none", target_arch = "arm")))]
        copy_pixels(&mut self.buffer.data, &other.buffer.data);

        #[cfg(all(target_os = "none", target_arch = "arm"))]
        {
            let len = self.buffer.len();
            let destination = unsafe {
                core::slice::from_raw_parts_mut(self.buffer.data.as_mut_ptr().cast::<u8>(), len)
            };
            copy_pixels(destination, other.buffer.indices());
        }

        self.palette = other.palette;
        self.base = other.base;
        self.fast_grayscale = other.fast_grayscale;
    }

    /// Copy a clipped pixel rectangle from `other` at the same coordinates,
    /// preserving all palette state and pixels outside the rectangle.
    pub fn copy_rect_from(
        &mut self,
        other: &Self,
        x: u32,
        y: u32,
        rect_width: u32,
        rect_height: u32,
    ) {
        self.buffer
            .copy_rect_from(&other.buffer, x, y, rect_width, rect_height);
    }

    /// Move the indexed pixels by `(dx, dy)`, filling exposed edges with
    /// `clear`. The display and quantization palettes are unchanged.
    pub fn scroll_indices(&mut self, dx: i32, dy: i32, clear: C) {
        self.buffer.scroll(dx, dy, clear);
    }

    /// Set a single pixel by palette index. Returns false if out of bounds.
    pub fn set_pixel_index(&mut self, x: u32, y: u32, color: C) -> bool {
        self.buffer.set_pixel(x, y, color)
    }

    /// Get the palette index of a single pixel. Returns None if out of bounds.
    pub fn get_index(&self, x: u32, y: u32) -> Option<C> {
        self.buffer.get_pixel(x, y)
    }

    /// Clear the entire buffer to a single palette index.
    pub fn clear_index(&mut self, color: C) {
        self.buffer.clear(color);
    }

    /// Total number of pixels.
    #[inline]
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Screen width in pixels.
    #[inline]
    pub fn width(&self) -> u32 {
        self.buffer.width() as u32
    }

    /// Screen height in pixels.
    #[inline]
    pub fn height(&self) -> u32 {
        self.buffer.height() as u32
    }

    /// Whether the buffer holds no pixels.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Set a single pixel, quantized through the base palette.
    /// Returns false if out of bounds.
    pub fn set_pixel(&mut self, x: u32, y: u32, color: Rgba) -> bool {
        let index = self.quantize_color(color);
        self.buffer.set_pixel(x, y, index)
    }

    /// Get the current display color of a single pixel (through the display
    /// palette). Returns None if out of bounds.
    pub fn get_pixel(&self, x: u32, y: u32) -> Option<Rgba> {
        self.buffer.get_pixel(x, y).map(|i| self.palette.color(i))
    }

    /// Clear the entire buffer to a single color (quantized through the base
    /// palette).
    ///
    /// Also restores the display palette to the base palette. This mirrors
    /// the RGBA buffer's contract — after a clear the framebuffer is in a
    /// pristine state — and is what prevents fade/flash palettes from
    /// leaking into the next frame: every frame starts with a clear, so the
    /// display mapping always begins from the base and effects re-apply
    /// their palette at the end of the frame.
    pub fn clear(&mut self, color: Rgba) {
        let index = self.quantize_color(color);
        self.buffer.clear(index);
        self.palette = self.base;
    }

    /// Fill a rectangular region with a color (quantized through the base
    /// palette). Coordinates are clamped to buffer bounds.
    pub fn fill_rect(&mut self, x: u32, y: u32, rect_width: u32, rect_height: u32, color: Rgba) {
        let index = self.quantize_color(color);
        self.buffer.fill_rect(x, y, rect_width, rect_height, index);
    }

    /// Blit one decoded Game Boy tile through `palette`, clipped to the
    /// framebuffer. The four RGBA palette entries are converted to the base
    /// indices once, then reused for every source pixel.
    #[inline]
    pub fn blit_gb_tile(
        &mut self,
        x: i32,
        y: i32,
        tile: &Tile,
        palette: &Palette,
        transparent: bool,
        flip_x: bool,
        flip_y: bool,
    ) {
        let rgba = [
            palette.color(GbColor::White),
            palette.color(GbColor::LightGray),
            palette.color(GbColor::DarkGray),
            palette.color(GbColor::Black),
        ];
        let mapped = [
            self.quantize_color(rgba[0]),
            self.quantize_color(rgba[1]),
            self.quantize_color(rgba[2]),
            self.quantize_color(rgba[3]),
        ];
        let width = self.width() as i32;
        let height = self.height() as i32;

        // Title screens, dialogue portraits and most GB sprites already use
        // the framebuffer's native shade order. On the GBA those tiles can
        // bypass the generic clipped/remapped loop entirely. Palette entry
        // zero is allowed to quantize differently when it is transparent,
        // because that source index is skipped rather than written.
        #[cfg(all(target_os = "none", target_arch = "arm"))]
        if !flip_x
            && !flip_y
            && x >= 0
            && y >= 0
            && x + TILE_PIXELS as i32 <= width
            && y + TILE_PIXELS as i32 <= height
        {
            let transparent_zero = transparent && rgba[0] == Rgba::TRANSPARENT;
            let transparent_nonzero =
                transparent && rgba[1..].iter().any(|color| *color == Rgba::TRANSPARENT);
            let identity_mapping = mapped.iter().enumerate().all(|(index, color)| {
                (index == 0 && transparent_zero) || color.to_index() == index
            });

            if identity_mapping && !transparent_nonzero {
                let destination = self.buffer.data.as_mut_ptr() as *mut u8;
                for row in 0..TILE_PIXELS {
                    let source = tile.pixels[row].as_ptr();
                    let target = unsafe {
                        destination.add((y as usize + row) * width as usize + x as usize)
                    };
                    if transparent_zero {
                        for column in 0..TILE_PIXELS {
                            let value = unsafe { source.add(column).read() };
                            if value != 0 {
                                unsafe { target.add(column).write(value) };
                            }
                        }
                    } else {
                        unsafe { core::ptr::copy_nonoverlapping(source, target, TILE_PIXELS) };
                    }
                }
                return;
            }
        }

        let tile_size = TILE_PIXELS as i32;
        let x_start = x.saturating_neg().clamp(0, tile_size) as usize;
        let y_start = y.saturating_neg().clamp(0, tile_size) as usize;
        let x_end = width.saturating_sub(x).clamp(0, tile_size) as usize;
        let y_end = height.saturating_sub(y).clamp(0, tile_size) as usize;
        if x_start >= x_end || y_start >= y_end {
            return;
        }

        #[cfg(all(target_os = "none", target_arch = "arm"))]
        let mapped = [
            mapped[0].to_index() as u8,
            mapped[1].to_index() as u8,
            mapped[2].to_index() as u8,
            mapped[3].to_index() as u8,
        ];
        #[cfg(all(target_os = "none", target_arch = "arm"))]
        let destination = self.buffer.data.as_mut_ptr() as *mut u8;

        for dst_row in y_start..y_end {
            let src_row = if flip_y {
                TILE_PIXELS - 1 - dst_row
            } else {
                dst_row
            };
            for dst_col in x_start..x_end {
                let src_col = if flip_x {
                    TILE_PIXELS - 1 - dst_col
                } else {
                    dst_col
                };
                let source = (tile.pixels[src_row][src_col] & 0x03) as usize;
                if transparent && rgba[source] == Rgba::TRANSPARENT {
                    continue;
                }
                #[cfg(all(target_os = "none", target_arch = "arm"))]
                unsafe {
                    let offset = (y + dst_row as i32) as usize * width as usize
                        + (x + dst_col as i32) as usize;
                    destination.add(offset).write(mapped[source]);
                }
                #[cfg(not(all(target_os = "none", target_arch = "arm")))]
                self.buffer.set_pixel(
                    (x + dst_col as i32) as u32,
                    (y + dst_row as i32) as u32,
                    mapped[source],
                );
            }
        }
    }

    /// Copy a horizontal line of RGBA data into the buffer (each pixel
    /// quantized through the base palette). `src` must be exactly
    /// `count * 4` bytes. Returns false if the line goes out of bounds.
    pub fn blit_row(&mut self, x: u32, y: u32, src: &[u8], count: u32) -> bool {
        if y >= self.height() || x >= self.width() {
            return false;
        }
        let actual_count = count.min(self.width() - x) as usize;
        let src_bytes = actual_count * 4;
        if src.len() < src_bytes {
            return false;
        }
        for i in 0..actual_count {
            let off = i * 4;
            let c = Rgba::new(src[off], src[off + 1], src[off + 2], src[off + 3]);
            let index = self.quantize_color(c);
            self.buffer.set_pixel(x + i as u32, y, index);
        }
        true
    }

    #[inline]
    fn quantize_color(&self, color: Rgba) -> C {
        if self.fast_grayscale && color.a == 0xFF && color.r == color.g && color.g == color.b {
            // Exact nearest-color boundaries for [255, 170, 85, 0]. At a
            // midpoint the generic quantizer prefers the lower index.
            let index = match color.r {
                213..=255 => 0,
                128..=212 => 1,
                43..=127 => 2,
                _ => 3,
            };
            C::from_u8(index)
        } else {
            quantize(&self.base, color)
        }
    }

    /// Save the framebuffer as a PNG file (display palette applied).
    #[cfg(any(feature = "gpu", feature = "image-assets"))]
    pub fn save_png(&self, path: &std::path::Path) -> std::io::Result<()> {
        use image::{ImageBuffer, Rgba as ImgRgba};
        let w = self.width() as u32;
        let h = self.height() as u32;
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        self.to_rgba(&mut rgba);
        let img: ImageBuffer<ImgRgba<u8>, _> =
            ImageBuffer::from_raw(w, h, rgba).expect("framebuffer size mismatch");
        img.save(path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    }
}

impl RgbaIndexedFrameBuffer<GbColor> {
    /// Blit a tile whose 2-bit pixel values already use the framebuffer's
    /// index order. This bypasses RGBA palette conversion entirely.
    ///
    /// Use this for GB backgrounds (and other identity-palette tiles). When
    /// `transparent_zero` is set, source index zero leaves the destination
    /// unchanged, matching Game Boy OBJ transparency.
    #[inline]
    pub fn blit_gb_tile_indices(
        &mut self,
        x: i32,
        y: i32,
        tile: &Tile,
        transparent_zero: bool,
        flip_x: bool,
        flip_y: bool,
    ) {
        let width = self.width() as i32;
        let height = self.height() as i32;

        // The GBA framebuffer is one byte per pixel. The overwhelmingly
        // common aligned/background case is eight short row copies with no
        // per-pixel bounds checks or palette work.
        #[cfg(all(target_os = "none", target_arch = "arm"))]
        if !transparent_zero
            && !flip_x
            && !flip_y
            && x >= 0
            && y >= 0
            && x + TILE_PIXELS as i32 <= width
            && y + TILE_PIXELS as i32 <= height
        {
            let destination = self.buffer.data.as_mut_ptr() as *mut u8;
            let width = width as usize;
            let x = x as usize;
            let y = y as usize;

            // Pick one copy shape per tile rather than branching for every
            // row. The bounds checks above cover all eight source and
            // destination rows. Tile rows are word-aligned because Tile has
            // 4-byte alignment and every row is eight bytes.
            if width & 3 == 0 && x & 3 == 0 {
                for row in 0..TILE_PIXELS {
                    unsafe {
                        let source = tile.pixels[row].as_ptr() as *const u32;
                        let destination = destination.add((y + row) * width + x) as *mut u32;
                        destination.write(source.read());
                        destination.add(1).write(source.add(1).read());
                    }
                }
            } else if width & 1 == 0 && x & 1 == 0 {
                // Smooth 2 px scrolling keeps halfword alignment even when
                // the destination is between word boundaries.
                for row in 0..TILE_PIXELS {
                    unsafe {
                        let source = tile.pixels[row].as_ptr() as *const u16;
                        let destination = destination.add((y + row) * width + x) as *mut u16;
                        for halfword in 0..4 {
                            destination.add(halfword).write(source.add(halfword).read());
                        }
                    }
                }
            } else {
                for row in 0..TILE_PIXELS {
                    unsafe {
                        core::ptr::copy_nonoverlapping(
                            tile.pixels[row].as_ptr(),
                            destination.add((y + row) * width + x),
                            TILE_PIXELS,
                        );
                    }
                }
            }
            return;
        }

        let tile_size = TILE_PIXELS as i32;
        let x_start = x.saturating_neg().clamp(0, tile_size) as usize;
        let y_start = y.saturating_neg().clamp(0, tile_size) as usize;
        let x_end = width.saturating_sub(x).clamp(0, tile_size) as usize;
        let y_end = height.saturating_sub(y).clamp(0, tile_size) as usize;
        if x_start >= x_end || y_start >= y_end {
            return;
        }

        #[cfg(all(target_os = "none", target_arch = "arm"))]
        let destination = self.buffer.data.as_mut_ptr() as *mut u8;
        for dst_row in y_start..y_end {
            let src_row = if flip_y {
                TILE_PIXELS - 1 - dst_row
            } else {
                dst_row
            };
            for dst_col in x_start..x_end {
                let src_col = if flip_x {
                    TILE_PIXELS - 1 - dst_col
                } else {
                    dst_col
                };
                let source = tile.pixels[src_row][src_col] & 0x03;
                if transparent_zero && source == 0 {
                    continue;
                }
                #[cfg(all(target_os = "none", target_arch = "arm"))]
                unsafe {
                    let offset = (y + dst_row as i32) as usize * width as usize
                        + (x + dst_col as i32) as usize;
                    destination.add(offset).write(source);
                }
                #[cfg(not(all(target_os = "none", target_arch = "arm")))]
                self.buffer.set_pixel(
                    (x + dst_col as i32) as u32,
                    (y + dst_row as i32) as u32,
                    GbColor::from_u8(source),
                );
            }
        }
    }
}

impl<C: ColorIndex + DefaultPalette> RgbaIndexedFrameBuffer<C> {
    /// Create a `config`-sized buffer using the type's default base palette,
    /// cleared to `clear`.
    pub fn new(config: RenderConfig, clear: Rgba) -> Self {
        Self::with_palette(config, clear, C::default_palette())
    }
}

impl RgbaIndexedFrameBuffer<GbColor> {
    /// Apply a DMG BGP register byte: display color `i` becomes the base
    /// palette's shade `(bgp >> (2 * i)) & 3`. This is exactly how the
    /// original hardware performs fades (by writing the BGP register).
    pub fn apply_bgp(&mut self, bgp: u8) {
        let mut remapped = [0u8; 4];
        for i in 0..4 {
            remapped[i] = (bgp >> (2 * i)) & 3;
        }
        self.remap_shades(&remapped);
    }
}

impl<C: ColorIndex + DefaultPalette> FbSurface for RgbaIndexedFrameBuffer<C> {
    fn new_screen(width: u32, height: u32) -> Self {
        Self::new(RenderConfig::new(width, height), Rgba::BLACK)
    }
    fn width(&self) -> u32 {
        self.buffer.width() as u32
    }
    fn height(&self) -> u32 {
        self.buffer.height() as u32
    }
    fn set_pixel(&mut self, x: u32, y: u32, color: Rgba) -> bool {
        self.set_pixel(x, y, color)
    }
    fn get_pixel(&self, x: u32, y: u32) -> Option<Rgba> {
        self.get_pixel(x, y)
    }
    fn clear(&mut self, color: Rgba) {
        self.clear(color)
    }
    fn fill_rect(&mut self, x: u32, y: u32, rect_width: u32, rect_height: u32, color: Rgba) {
        self.fill_rect(x, y, rect_width, rect_height, color)
    }
    fn blit_gb_tile(
        &mut self,
        x: i32,
        y: i32,
        tile: &Tile,
        palette: &Palette,
        transparent: bool,
        flip_x: bool,
        flip_y: bool,
    ) {
        self.blit_gb_tile(x, y, tile, palette, transparent, flip_x, flip_y)
    }
    fn present_into(&self, out: &mut [u8]) {
        assert!(out.len() >= self.len() * 4, "present buffer too small");
        self.to_rgba(out);
    }
}

#[cfg(test)]
mod facade_tests {
    use super::*;
    use crate::palette::GRAYSCALE_SPRITE_PALETTE;

    fn fb() -> RgbaIndexedFrameBuffer<GbColor> {
        RgbaIndexedFrameBuffer::new(RenderConfig::new(160, 144), Rgba::WHITE)
    }

    #[test]
    fn decoded_tiles_are_word_aligned_without_padding() {
        assert_eq!(core::mem::align_of::<Tile>(), 4);
        assert_eq!(core::mem::size_of::<Tile>(), 64);
    }

    #[test]
    fn storage_is_packed() {
        let fb = fb();
        assert_eq!(fb.len(), 160 * 144);
        assert_eq!(fb.packed().len(), 5760);
        assert_eq!(fb.packed().len(), packed_len::<GbColor>(160, 144));
    }

    #[test]
    fn grayscale_round_trips_exactly() {
        let mut fb = fb();
        let colors = [
            Rgba::WHITE,
            Rgba::rgb(0xAA, 0xAA, 0xAA),
            Rgba::rgb(0x55, 0x55, 0x55),
            Rgba::BLACK,
        ];
        for (i, &c) in colors.iter().enumerate() {
            assert!(fb.set_pixel(i as u32, 0, c));
        }
        for (i, &c) in colors.iter().enumerate() {
            assert_eq!(fb.get_pixel(i as u32, 0), Some(c));
            assert_eq!(fb.get_index(i as u32, 0), Some(GbColor::from_u8(i as u8)));
        }
    }

    #[test]
    fn fast_grayscale_quantizer_matches_generic_for_every_gray() {
        let mut fb = RgbaIndexedFrameBuffer::<GbColor>::new(RenderConfig::new(256, 1), Rgba::WHITE);
        assert!(fb.fast_grayscale);
        for gray in 0..=u8::MAX {
            let color = Rgba::rgb(gray, gray, gray);
            assert!(fb.set_pixel(gray as u32, 0, color));
            assert_eq!(
                fb.get_index(gray as u32, 0),
                Some(quantize(&GRAYSCALE_PALETTE, color)),
                "gray {gray}"
            );
        }
    }

    #[test]
    fn near_grays_quantize_to_nearest_shade() {
        let mut fb = fb();
        // 0xC0 → light gray (170), 0x80 → light gray (170), 0x40 → dark gray.
        fb.set_pixel(0, 0, Rgba::rgb(0xC0, 0xC0, 0xC0));
        fb.set_pixel(1, 0, Rgba::rgb(0x80, 0x80, 0x80));
        fb.set_pixel(2, 0, Rgba::rgb(0x40, 0x40, 0x40));
        assert_eq!(fb.get_index(0, 0), Some(GbColor::LightGray));
        assert_eq!(fb.get_index(1, 0), Some(GbColor::LightGray));
        assert_eq!(fb.get_index(2, 0), Some(GbColor::DarkGray));
    }

    #[test]
    fn transparent_writes_pick_nearest_opaque_shade() {
        // GRAYSCALE_PALETTE has no transparent entry, so a transparent write
        // quantizes to the nearest opaque color: black. Presenters ignore
        // alpha (native/web textures, TUI halfblocks), so this matches what
        // the old RGBA buffer displayed for such pixels.
        let mut fb = fb();
        fb.set_pixel(3, 3, Rgba::TRANSPARENT);
        assert_eq!(fb.get_index(3, 3), Some(GbColor::Black));
    }

    #[test]
    fn bounds_checked_rgba_facade() {
        let mut fb = fb();
        assert!(fb.set_pixel(159, 143, Rgba::BLACK));
        assert!(!fb.set_pixel(160, 0, Rgba::BLACK));
        assert!(!fb.set_pixel(0, 144, Rgba::BLACK));
        assert_eq!(fb.get_pixel(160, 0), None);
        assert_eq!(fb.pixel_rgba(160, 0), Rgba::TRANSPARENT);
    }

    #[test]
    fn gb_tile_blit_maps_palette_and_preserves_transparency() {
        let mut tile = Tile::blank();
        tile.pixels[0] = [0, 1, 2, 3, 0, 1, 2, 3];
        let palette = Palette::new(&[
            Rgba::TRANSPARENT,
            Rgba::BLACK,
            Rgba::rgb(0x55, 0x55, 0x55),
            Rgba::rgb(0xAA, 0xAA, 0xAA),
        ]);
        let mut fb = RgbaIndexedFrameBuffer::<GbColor>::new(RenderConfig::new(8, 2), Rgba::WHITE);

        fb.blit_gb_tile(0, 0, &tile, &palette, true, false, false);

        assert_eq!(fb.get_index(0, 0), Some(GbColor::White));
        assert_eq!(fb.get_index(1, 0), Some(GbColor::Black));
        assert_eq!(fb.get_index(2, 0), Some(GbColor::DarkGray));
        assert_eq!(fb.get_index(3, 0), Some(GbColor::LightGray));
    }

    #[test]
    fn gb_tile_blit_clips_and_flips() {
        let mut tile = Tile::blank();
        tile.pixels[7][7] = 3;
        let mut fb = RgbaIndexedFrameBuffer::<GbColor>::new(RenderConfig::new(4, 4), Rgba::WHITE);

        fb.blit_gb_tile(-7, -7, &tile, &GRAYSCALE_PALETTE, false, true, true);

        assert_eq!(fb.get_index(0, 0), Some(GbColor::White));
        assert_eq!(fb.get_index(3, 3), Some(GbColor::White));

        fb.blit_gb_tile(-7, -7, &tile, &GRAYSCALE_PALETTE, false, false, false);
        assert_eq!(fb.get_index(0, 0), Some(GbColor::Black));
    }

    #[test]
    fn gb_tile_index_blit_copies_indices_and_skips_zero() {
        let mut tile = Tile::blank();
        tile.pixels[0] = [0, 1, 2, 3, 0, 1, 2, 3];
        let mut fb = RgbaIndexedFrameBuffer::<GbColor>::new(RenderConfig::new(8, 2), Rgba::BLACK);

        fb.blit_gb_tile_indices(0, 0, &tile, false, false, false);
        assert_eq!(fb.get_index(0, 0), Some(GbColor::White));
        assert_eq!(fb.get_index(1, 0), Some(GbColor::LightGray));
        assert_eq!(fb.get_index(2, 0), Some(GbColor::DarkGray));
        assert_eq!(fb.get_index(3, 0), Some(GbColor::Black));

        fb.clear_index(GbColor::Black);
        fb.blit_gb_tile_indices(0, 0, &tile, true, false, false);
        assert_eq!(fb.get_index(0, 0), Some(GbColor::Black));
        assert_eq!(fb.get_index(1, 0), Some(GbColor::LightGray));
    }

    #[test]
    fn clear_and_fill_quantize() {
        let mut fb = fb();
        fb.fill_rect(0, 0, 100, 100, Rgba::rgb(0x55, 0x55, 0x55));
        assert_eq!(fb.get_index(50, 50), Some(GbColor::DarkGray));
        fb.clear(Rgba::BLACK);
        assert_eq!(fb.get_index(0, 0), Some(GbColor::Black));
        assert_eq!(fb.get_index(159, 143), Some(GbColor::Black));
    }

    #[test]
    fn blit_row_quantizes_each_pixel() {
        let mut fb = fb();
        let row = [255u8, 255, 255, 255, 0, 0, 0, 0];
        assert!(fb.blit_row(0, 0, &row, 2));
        assert_eq!(fb.get_index(0, 0), Some(GbColor::White));
        assert_eq!(fb.get_index(1, 0), Some(GbColor::Black));
        assert!(!fb.blit_row(160, 0, &row, 2));
        assert!(!fb.blit_row(0, 0, &row, 3)); // src too short
    }

    #[test]
    fn remap_shades_inverts() {
        let mut fb = fb();
        fb.fill_rect(0, 0, 8, 8, Rgba::BLACK);
        // Invert: 0→3, 1→2, 2→1, 3→0.
        fb.remap_shades(&[3, 2, 1, 0]);
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::WHITE));
        // Display palette changed; the index underneath is untouched.
        assert_eq!(fb.get_index(0, 0), Some(GbColor::Black));
        fb.reset_palette();
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::BLACK));
    }

    #[test]
    fn apply_bgp_fade_to_black() {
        let mut fb = fb();
        fb.set_pixel(0, 0, Rgba::WHITE);
        // rBGP = dc 3,3,3,3 → every shade maps to black.
        fb.apply_bgp(0b11111111);
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::BLACK));
        assert_eq!(fb.get_index(0, 0), Some(GbColor::White));
    }

    #[test]
    fn scale_shades_dims_display() {
        let mut fb = fb();
        fb.fill_rect(0, 0, 8, 8, Rgba::WHITE);
        fb.scale_shades(0.5);
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::rgb(127, 127, 127)));
        fb.scale_shades(0.0);
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::BLACK));
    }

    #[test]
    fn palette_swap_does_not_touch_draws() {
        let mut fb = fb();
        fb.set_pixel(4, 4, Rgba::rgb(0x55, 0x55, 0x55));
        fb.apply_bgp(0b11100100); // identity-ish fade state
                                  // Drawing while a display effect is active still quantizes via base.
        fb.set_pixel(5, 4, Rgba::rgb(0xAA, 0xAA, 0xAA));
        fb.reset_palette();
        assert_eq!(fb.get_pixel(5, 4), Some(Rgba::rgb(0xAA, 0xAA, 0xAA)));
    }

    #[test]
    fn copy_from_copies_pixels_and_palette() {
        let mut src = fb();
        src.fill_rect(0, 0, 16, 16, Rgba::BLACK);
        src.apply_bgp(0b00000000); // all white
        let mut dst = fb();
        dst.copy_from(&src);
        assert_eq!(dst.get_index(8, 8), Some(GbColor::Black));
        assert_eq!(dst.get_pixel(8, 8), Some(Rgba::WHITE));
        assert_eq!(dst.packed(), src.packed());
    }

    #[test]
    fn copy_from_with_delegates_storage_transfer() {
        let mut src = fb();
        src.fill_rect(3, 5, 9, 7, Rgba::BLACK);
        src.apply_bgp(0b00000000); // all white
        let mut dst = fb();
        let mut calls = 0;
        dst.copy_from_with(&src, |destination, source| {
            calls += 1;
            assert_eq!(destination.len(), source.len());
            destination.copy_from_slice(source);
        });
        assert_eq!(calls, 1);
        assert_eq!(dst.get_index(4, 6), Some(GbColor::Black));
        assert_eq!(dst.get_pixel(4, 6), Some(Rgba::WHITE));
        assert_eq!(dst.packed(), src.packed());
    }

    #[test]
    fn copy_rect_from_preserves_destination_palette_and_other_pixels() {
        let mut src = fb();
        src.fill_rect(2, 3, 6, 5, Rgba::BLACK);
        src.apply_bgp(0b00000000); // all white
        let mut dst = fb();
        dst.fill_rect(0, 0, 16, 16, Rgba::rgb(0x55, 0x55, 0x55));
        dst.apply_bgp(0b11100100); // identity display palette

        dst.copy_rect_from(&src, 2, 3, 6, 5);

        assert_eq!(dst.get_index(4, 4), Some(GbColor::Black));
        assert_eq!(dst.get_pixel(4, 4), Some(Rgba::BLACK));
        assert_eq!(dst.get_index(1, 4), Some(GbColor::DarkGray));
        assert_eq!(dst.get_pixel(1, 4), Some(Rgba::rgb(0x55, 0x55, 0x55)));
    }

    #[test]
    fn clear_resets_display_palette() {
        let mut fb = fb();
        fb.apply_bgp(0b00000000); // white-out display palette
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::WHITE));
        fb.clear(Rgba::BLACK);
        // Clear restores the base display mapping: black stays black.
        assert_eq!(fb.get_pixel(0, 0), Some(Rgba::BLACK));
        fb.set_pixel(1, 0, Rgba::WHITE);
        assert_eq!(fb.get_pixel(1, 0), Some(Rgba::WHITE));
    }

    #[test]
    fn to_rgba_uses_display_palette() {
        let mut fb = RgbaIndexedFrameBuffer::<GbColor>::new(RenderConfig::new(2, 1), Rgba::WHITE);
        fb.set_pixel(0, 0, Rgba::WHITE);
        fb.apply_bgp(0b00000000); // white-out
        let mut out = [0u8; 8];
        assert!(fb.to_rgba(&mut out));
        assert_eq!(&out[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn fb_surface_present_and_pixels() {
        let mut fb = RgbaIndexedFrameBuffer::<GbColor>::new_screen(4, 2);
        fb.set_pixel(1, 1, Rgba::WHITE);
        assert_eq!(fb.width(), 4);
        assert_eq!(fb.height(), 2);
        assert_eq!(fb.pixel_rgba(1, 1), Rgba::WHITE);
        assert_eq!(fb.pixel_rgba(0, 0), Rgba::BLACK);
        let mut out = [0u8; 4 * 2 * 4];
        fb.present_into(&mut out);
        assert_eq!(&out[5 * 4..6 * 4], &[0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn sprite_palette_quantization_matches_draw_palette() {
        // The pokered sprite path draws with GRAYSCALE_SPRITE_PALETTE colors;
        // quantizing those through the facade base must recover the original
        // indices. Color 0 is transparent and quantizes to black (nearest
        // opaque shade in the grayscale base palette) — the same visual the
        // RGBA buffer produced, since presenters ignore alpha.
        let mut fb = fb();
        for (i, &c) in GRAYSCALE_SPRITE_PALETTE.colors[..4].iter().enumerate() {
            fb.set_pixel(i as u32, 0, c);
            let expected = if i == 0 {
                GbColor::Black
            } else {
                GbColor::from_u8(i as u8)
            };
            assert_eq!(fb.get_index(i as u32, 0), Some(expected));
        }
    }
}
