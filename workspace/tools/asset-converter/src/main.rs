//! Asset Converter: Convert Game Boy 2bpp tilesets to RGBA tilesets.
//!
//! Reads a 2bpp tileset stored as a grayscale PNG (4 shades: black, dark gray,
//! light gray, white) and converts each 8×8 tile to true-color RGBA using a
//! user-supplied palette. Also generates a Tiled `.tsx` tileset definition.
//!
//! ## 2bpp → Grayscale mapping
//!
//! In Game Boy 2bpp format, palette index 0 is the lightest color (white) and
//! index 3 is the darkest (black). The input grayscale PNG encodes this as:
//!
//! | Gray value | Palette index | Meaning        |
//! |------------|---------------|----------------|
//! | 0–63       | 3             | Black/darkest  |
//! | 64–127     | 2             | Dark gray      |
//! | 128–191    | 1             | Light gray     |
//! | 192–255    | 0             | White/lightest |
//!
//! ## Usage
//!
//! ```sh
//! # Convert a single tileset
//! cargo run -- --input tileset_2bpp.png --palette custom_palette.json --output tileset_rgba.png
//!
//! # Batch convert all tilesets in a directory
//! cargo run -- --all --input-dir gfx/tilesets --output-dir assets/converted
//! ```

use clap::Parser;
use image::{GenericImageView, ImageBuffer, RgbaImage};
use serde::Deserialize;
use std::io::Write;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Game Boy tile dimensions (always 8×8 pixels).
const TILE_PIXELS: u32 = 8;

/// Default columns in a tileset sheet (tiles are arranged row-major).
const DEFAULT_COLUMNS: u32 = 16;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "asset-converter")]
#[command(version, about = "Convert GB 2bpp tilesets to RGBA tilesets with Tiled .tsx output")]
struct Cli {
    /// Input 2bpp tileset PNG (grayscale, 4 shades)
    #[arg(short, long, required_unless_present_any = ["all", "all_monster"])]
    input: Option<PathBuf>,

    /// Palette JSON file
    #[arg(short, long, required_unless_present_any = ["all", "all_monster"])]
    palette: Option<PathBuf>,

    /// Output RGBA tileset PNG
    #[arg(short, long, required_unless_present_any = ["all", "all_monster"])]
    output: Option<PathBuf>,

    /// Batch mode: convert all PNGs in --input-dir
    #[arg(long, default_value_t = false)]
    all: bool,

    /// Input directory for batch mode
    #[arg(long, default_value = ".")]
    input_dir: PathBuf,

    /// Output directory for batch mode
    #[arg(long, default_value = "./converted")]
    output_dir: PathBuf,

    /// Palette JSON file for batch mode (applied to all tilesets)
    #[arg(long)]
    batch_palette: Option<PathBuf>,

    /// Tile count for .tsx generation (auto-detected if 0)
    #[arg(long, default_value_t = 0)]
    tile_count: usize,

    /// Columns in the tileset sheet (default: 16)
    #[arg(long, default_value_t = DEFAULT_COLUMNS)]
    columns: u32,

    /// Skip .tsx generation
    #[arg(long, default_value_t = false)]
    no_tsx: bool,

    /// Alias for `--all` (legacy workflow)
    #[arg(long = "all-monster", default_value_t = false)]
    all_monster: bool,
}

// ---------------------------------------------------------------------------
// Palette types
// ---------------------------------------------------------------------------

/// A single RGBA color in a palette.
#[derive(Debug, Clone, Deserialize)]
struct PaletteColor {
    r: u8,
    g: u8,
    b: u8,
    #[serde(default = "default_alpha")]
    a: u8,
}

fn default_alpha() -> u8 {
    255
}

/// A palette definition with 4 colors (matching GB 2bpp indices 0–3).
#[derive(Debug, Clone, Deserialize)]
struct PaletteDef {
    #[allow(dead_code)]
    name: String,
    colors: Vec<PaletteColor>,
}

impl PaletteDef {
    /// Extract the 4 palette entries as an array.
    fn as_array(&self) -> Result<[PaletteColor; 4], String> {
        if self.colors.len() != 4 {
            return Err(format!(
                "Palette must have exactly 4 colors, got {}",
                self.colors.len()
            ));
        }
        Ok([
            self.colors[0].clone(),
            self.colors[1].clone(),
            self.colors[2].clone(),
            self.colors[3].clone(),
        ])
    }
}

// ---------------------------------------------------------------------------
// Default palette (DMG green)
// ---------------------------------------------------------------------------

fn default_palette() -> [PaletteColor; 4] {
    [
        PaletteColor { r: 0x9B, g: 0xBC, b: 0x0F, a: 255 },
        PaletteColor { r: 0x8B, g: 0xAC, b: 0x0F, a: 255 },
        PaletteColor { r: 0x30, g: 0x62, b: 0x30, a: 255 },
        PaletteColor { r: 0x0F, g: 0x38, b: 0x0F, a: 255 },
    ]
}

// ---------------------------------------------------------------------------
// Grayscale → palette index
// ---------------------------------------------------------------------------

/// Map an 8-bit grayscale value to a GB palette index (0–3).
///
/// Uses equal-width threshold bands:
/// - 0–63   → index 3 (black/darkest)
/// - 64–127 → index 2 (dark gray)
/// - 128–191 → index 1 (light gray)
/// - 192–255 → index 0 (white/lightest)
fn gray_to_index(gray: u8) -> u8 {
    match gray {
        0..=63 => 3,
        64..=127 => 2,
        128..=191 => 1,
        192..=255 => 0,
    }
}

// ---------------------------------------------------------------------------
// Core conversion
// ---------------------------------------------------------------------------

/// Convert a 2bpp grayscale tileset PNG to an RGBA tileset PNG.
///
/// Each 8×8 tile in the source image has its pixels mapped from grayscale
/// → palette index → RGBA color via the provided palette.
fn convert_tileset(
    input_path: &Path,
    output_path: &Path,
    palette: &[PaletteColor; 4],
) -> Result<(u32, u32, usize), String> {
    let img = image::open(input_path)
        .map_err(|e| format!("Failed to open '{}': {}", input_path.display(), e))?;

    let (width, height) = img.dimensions();

    if width % TILE_PIXELS != 0 || height % TILE_PIXELS != 0 {
        return Err(format!(
            "Image dimensions {}×{} are not multiples of {} (tile size)",
            width, height, TILE_PIXELS
        ));
    }

    let tiles_x = (width / TILE_PIXELS) as usize;
    let tiles_y = (height / TILE_PIXELS) as usize;
    let tile_count = tiles_x * tiles_y;

    let mut out_img: RgbaImage = ImageBuffer::new(width, height);

    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let base_x = (tx as u32) * TILE_PIXELS;
            let base_y = (ty as u32) * TILE_PIXELS;
            for row in 0..TILE_PIXELS {
                for col in 0..TILE_PIXELS {
                    let px = img.get_pixel(base_x + col, base_y + row);
                    let gray = px[0];
                    let idx = gray_to_index(gray) as usize;
                    let color = &palette[idx];
                    out_img.put_pixel(
                        base_x + col,
                        base_y + row,
                        image::Rgba([color.r, color.g, color.b, color.a]),
                    );
                }
            }
        }
    }

    out_img
        .save(output_path)
        .map_err(|e| format!("Failed to save '{}': {}", output_path.display(), e))?;

    Ok((tiles_x as u32, tiles_y as u32, tile_count))
}

// ---------------------------------------------------------------------------
// .tsx generation
// ---------------------------------------------------------------------------

/// Generate a Tiled `.tsx` tileset definition file.
///
/// The .tsx file references the output PNG image and describes the tile grid.
fn generate_tsx(
    tsx_path: &Path,
    image_rel_path: &str,
    name: &str,
    tile_count: usize,
    columns: u32,
) -> Result<(), String> {
    let tile_width = TILE_PIXELS;
    let tile_height = TILE_PIXELS;
    let image_width = columns * TILE_PIXELS;
    let image_height =
        ((tile_count as u32 + columns - 1) / columns) * TILE_PIXELS;

    let escaped_name = escape_xml(name);

    let tsx_content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.2" name="{name}" tilewidth="{tw}" tileheight="{th}" tilecount="{tc}" columns="{cols}">
 <image source="{img}" width="{iw}" height="{ih}"/>
</tileset>
"#,
        name = escaped_name,
        tw = tile_width,
        th = tile_height,
        tc = tile_count,
        cols = columns,
        img = escape_xml(image_rel_path),
        iw = image_width,
        ih = image_height,
    );

    let mut file = std::fs::File::create(tsx_path)
        .map_err(|e| format!("Failed to create '{}': {}", tsx_path.display(), e))?;
    file.write_all(tsx_content.as_bytes())
        .map_err(|e| format!("Failed to write '{}': {}", tsx_path.display(), e))?;

    Ok(())
}

/// Escape `&`, `<`, `>`, `"`, `'` for XML text content.
fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/// Load a palette from a JSON file.
fn load_palette(path: &Path) -> Result<[PaletteColor; 4], String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read palette: {}", e))?;
    let def: PaletteDef =
        serde_json::from_str(&content).map_err(|e| format!("Invalid palette JSON: {}", e))?;
    def.as_array()
}

/// Derive a .tsx path from an output PNG path.
fn tsx_path_for(output_path: &Path) -> PathBuf {
    output_path.with_extension("tsx")
}

/// Derive the image filename (basename) for use in the .tsx `<image source="...">`.
fn image_basename(output_path: &Path) -> String {
    output_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

/// Derive a tileset name from a filename (strip extension, TitleCase).
fn tileset_name_from_path(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

// ---------------------------------------------------------------------------
// Single-file conversion
// ---------------------------------------------------------------------------

fn run_single(cli: &Cli) -> Result<(), String> {
    let input = cli.input.as_ref().unwrap();
    let output = cli.output.as_ref().unwrap();

    let palette = match cli.palette.as_ref() {
        Some(p) => load_palette(p)?,
        None => default_palette(),
    };

    println!("Converting: {} → {}", input.display(), output.display());
    let (tiles_x, _tiles_y, tile_count) = convert_tileset(input, output, &palette)?;

    let columns = if cli.columns == DEFAULT_COLUMNS {
        tiles_x as u32
    } else {
        cli.columns
    };

    println!(
        "  Tiles: {} ({}×{} grid), {} columns",
        tile_count, tiles_x, _tiles_y, columns
    );

    if !cli.no_tsx {
        let tsx_path = tsx_path_for(output);
        let img_name = image_basename(output);
        let name = tileset_name_from_path(output);
        generate_tsx(&tsx_path, &img_name, &name, tile_count, columns)?;
        println!("  .tsx: {}", tsx_path.display());
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

fn run_batch(cli: &Cli) -> Result<(), String> {
    let input_dir = &cli.input_dir;
    let output_dir = &cli.output_dir;

    if !input_dir.is_dir() {
        return Err(format!(
            "Input directory does not exist: {}",
            input_dir.display()
        ));
    }

    std::fs::create_dir_all(output_dir).map_err(|e| {
        format!(
            "Failed to create output directory '{}': {}",
            output_dir.display(),
            e
        )
    })?;

    let palette = match cli.batch_palette.as_ref().or(cli.palette.as_ref()) {
        Some(p) => load_palette(p)?,
        None => default_palette(),
    };

    let mut png_files: Vec<PathBuf> = Vec::new();
    let entries = std::fs::read_dir(input_dir).map_err(|e| {
        format!(
            "Failed to read directory '{}': {}",
            input_dir.display(),
            e
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Directory entry error: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("png") {
                    png_files.push(path);
                }
            }
        }
    }

    if png_files.is_empty() {
        println!(
            "No PNG files found in '{}'. Nothing to convert.",
            input_dir.display()
        );
        return Ok(());
    }

    png_files.sort();
    let total = png_files.len();
    println!("Batch converting {} tileset(s) from '{}'...", total, input_dir.display());

    let mut converted = 0usize;
    let mut errors = 0usize;

    for input_path in &png_files {
        let stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
        let output_path = output_dir.join(format!("{}_rgba.png", stem));

        match convert_tileset(input_path, &output_path, &palette) {
            Ok((tiles_x, _tiles_y, tile_count)) => {
                let columns = if cli.columns == DEFAULT_COLUMNS {
                    tiles_x as u32
                } else {
                    cli.columns
                };
                println!(
                    "  ✓ {} → {} ({} tiles, {}×{})",
                    input_path.file_name().unwrap_or_default().to_string_lossy(),
                    output_path.file_name().unwrap_or_default().to_string_lossy(),
                    tile_count,
                    tiles_x,
                    _tiles_y,
                );

                if !cli.no_tsx {
                    let tsx_path = output_dir.join(format!("{}.tsx", stem));
                    let img_name = output_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let name = tileset_name_from_path(&output_path);
                    if let Err(e) = generate_tsx(&tsx_path, &img_name, &name, tile_count, columns)
                    {
                        eprintln!("  ⚠ Failed to generate .tsx for '{}': {}", stem, e);
                    } else {
                        println!("    .tsx: {}", tsx_path.display());
                    }
                }
                converted += 1;
            }
            Err(e) => {
                eprintln!(
                    "  ✗ {}: {}",
                    input_path.file_name().unwrap_or_default().to_string_lossy(),
                    e
                );
                errors += 1;
            }
        }
    }

    println!(
        "Done: {} converted, {} errors (out of {})",
        converted, errors, total
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() -> Result<(), String> {
    let cli = Cli::parse();

    let is_batch = cli.all || cli.all_monster;

    if is_batch {
        run_batch(&cli)
    } else {
        run_single(&cli)
    }
}
