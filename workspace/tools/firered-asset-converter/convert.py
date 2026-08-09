#!/usr/bin/env python3
"""FireRed → jrpg-engine asset extractor.

Reproduces the *data* the GBA had so the Rust runtime can re-run the original
FireRed overworld compositing pipeline (indexed 4bpp tiles + 13 BG palette banks
+ 16x16 two-layer metatiles + map grid), rather than a pre-flattened RGBA blob.

For one map (default: Pallet Town) it emits, into --out:

  tiles.bin               combined indexed tiles, 64 bytes/tile (1 byte = 1 px,
                          value 0..15). Primary tiles first (0..639), then
                          secondary (640..). A metatile tile-entry's 10-bit tile
                          index addresses this array directly (split at
                          NUM_TILES_IN_PRIMARY = 640, matching GBA VRAM layout).
  palettes.bin            13 BG palette banks * 16 colors * RGBA8888 = 832 bytes.
                          Banks 0..6  = primary  palettes 00.pal..06.pal
                          Banks 7..12 = secondary palettes 07.pal..12.pal
                          Color index 0 of every bank is forced transparent.
  metatiles_primary.bin   verbatim copy (8 u16 LE per metatile).
  metatiles_secondary.bin verbatim copy.
  attributes_primary.bin  verbatim copy (1 u32 LE per metatile; layer type =
                          bits 29..30).
  attributes_secondary.bin
  map.bin                 verbatim copy (width*height u16 LE blocks).
  border.bin              verbatim copy (border_w*border_h u16 LE blocks).
  player.bin              red_normal sprite sheet as RGBA8888 (idx 0 = transparent).
  meta.json               sizes/counts so the Rust side need not hardcode them.

Usage:
  python3 convert.py extract \
      --firered-root /path/to/pokefirered \
      --out ../../examples/firered/assets/pallet_town
"""
import argparse
import json
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  python3 -m pip install pillow")

TILE = 8
NUM_TILES_IN_PRIMARY = 640  # GBA VRAM split point (fieldmap.h)
NUM_PALS_IN_PRIMARY = 7      # banks 0..6 primary, 7..12 secondary (fieldmap.h)
NUM_PALS_TOTAL = 13


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def parse_jasc_pal(path):
    """Parse a JASC-PAL file → list of (r, g, b), padded/truncated to 16."""
    with open(path) as f:
        lines = [ln.strip() for ln in f.read().splitlines()]
    # lines[0]=JASC-PAL, lines[1]=0100, lines[2]=count
    cols = []
    for ln in lines[3:]:
        if not ln:
            continue
        r, g, b = (int(v) for v in ln.split()[:3])
        cols.append((r, g, b))
    while len(cols) < 16:
        cols.append((0, 0, 0))
    return cols[:16]


def extract_indexed_tiles(png_path):
    """Read a 'P'-mode (4bpp) tiles.png → flat bytes, 64 indices per 8x8 tile."""
    img = Image.open(png_path)
    if img.mode != "P":
        # Some exports are 'L'; the luma value is still the index for these PNGs.
        img = img.convert("P")
    w, h = img.size
    if w % TILE or h % TILE:
        sys.exit(f"{png_path}: size {w}x{h} not a multiple of {TILE}")
    px = img.load()
    tiles_per_row = w // TILE
    tile_count = (w // TILE) * (h // TILE)
    out = bytearray()
    for t in range(tile_count):
        tx = (t % tiles_per_row) * TILE
        ty = (t // tiles_per_row) * TILE
        for row in range(TILE):
            for col in range(TILE):
                out.append(px[tx + col, ty + row] & 0x0F)
    return bytes(out), tile_count


def palette_bank_rgba(cols):
    """16 (r,g,b) → 64 RGBA bytes, color index 0 forced transparent."""
    out = bytearray()
    for i, (r, g, b) in enumerate(cols):
        if i == 0:
            out += bytes((0, 0, 0, 0))
        else:
            out += bytes((r, g, b, 255))
    return bytes(out)


def extract_sprite_rgba(png_path):
    """Read a 'P'-mode object sprite → RGBA8888, index 0 transparent.

    Object sprite PNGs (unlike tile PNGs) carry their *real* colors in the
    embedded palette, so we use it directly."""
    img = Image.open(png_path)
    if img.mode != "P":
        sys.exit(f"{png_path}: expected indexed ('P') sprite, got {img.mode}")
    w, h = img.size
    pal = img.getpalette()  # flat [r,g,b, r,g,b, ...]
    px = img.load()
    out = bytearray()
    for y in range(h):
        for x in range(w):
            idx = px[x, y]
            if idx == 0:
                out += bytes((0, 0, 0, 0))
            else:
                out += bytes((pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2], 255))
    return bytes(out), w, h


def read_layout(layouts_json, layout_id):
    with open(layouts_json) as f:
        data = json.load(f)
    for lay in data["layouts"]:
        if lay.get("id") == layout_id:
            return lay
    sys.exit(f"layout {layout_id} not found in {layouts_json}")


# ---------------------------------------------------------------------------
# extract command
# ---------------------------------------------------------------------------

def cmd_extract(args):
    root = args.firered_root
    out = args.out
    os.makedirs(out, exist_ok=True)

    lay = read_layout(os.path.join(root, "data/layouts/layouts.json"), args.layout_id)
    width, height = lay["width"], lay["height"]
    bw, bh = lay["border_width"], lay["border_height"]
    layout_dir = os.path.dirname(os.path.join(root, lay["blockdata_filepath"]))
    prim_dir = os.path.join(root, "data/tilesets/primary", args.primary)
    sec_dir = os.path.join(root, "data/tilesets/secondary", args.secondary)

    # --- tiles (combined, indexed) -----------------------------------------
    prim_tiles, n_prim_tiles = extract_indexed_tiles(os.path.join(prim_dir, "tiles.png"))
    sec_tiles, n_sec_tiles = extract_indexed_tiles(os.path.join(sec_dir, "tiles.png"))
    if n_prim_tiles > NUM_TILES_IN_PRIMARY:
        sys.exit(f"primary has {n_prim_tiles} tiles, exceeds {NUM_TILES_IN_PRIMARY}")
    # Pad primary up to the VRAM split so secondary indices line up at 640.
    pad = bytes((NUM_TILES_IN_PRIMARY - n_prim_tiles) * 64)
    tiles_bin = prim_tiles + pad + sec_tiles
    with open(os.path.join(out, "tiles.bin"), "wb") as f:
        f.write(tiles_bin)

    # --- palettes (13 banks, RGBA) -----------------------------------------
    pal_bin = bytearray()
    for i in range(NUM_PALS_IN_PRIMARY):                  # banks 0..6 from primary
        pal_bin += palette_bank_rgba(parse_jasc_pal(os.path.join(prim_dir, "palettes", f"{i:02}.pal")))
    for i in range(NUM_PALS_IN_PRIMARY, NUM_PALS_TOTAL):  # banks 7..12 from secondary
        pal_bin += palette_bank_rgba(parse_jasc_pal(os.path.join(sec_dir, "palettes", f"{i:02}.pal")))
    with open(os.path.join(out, "palettes.bin"), "wb") as f:
        f.write(pal_bin)

    # --- verbatim binary copies --------------------------------------------
    copies = [
        (os.path.join(prim_dir, "metatiles.bin"), "metatiles_primary.bin"),
        (os.path.join(sec_dir, "metatiles.bin"), "metatiles_secondary.bin"),
        (os.path.join(prim_dir, "metatile_attributes.bin"), "attributes_primary.bin"),
        (os.path.join(sec_dir, "metatile_attributes.bin"), "attributes_secondary.bin"),
        (os.path.join(layout_dir, "map.bin"), "map.bin"),
        (os.path.join(layout_dir, "border.bin"), "border.bin"),
    ]
    for src, dst in copies:
        shutil.copyfile(src, os.path.join(out, dst))

    # --- player sprite ------------------------------------------------------
    player_src = os.path.join(root, "graphics/object_events/pics/people", args.player + ".png")
    player_rgba, pw, ph = extract_sprite_rgba(player_src)
    with open(os.path.join(out, "player.bin"), "wb") as f:
        f.write(player_rgba)
    frame_w = args.player_frame_w
    n_frames = pw // frame_w

    n_prim_mt = os.path.getsize(os.path.join(out, "metatiles_primary.bin")) // 16
    n_sec_mt = os.path.getsize(os.path.join(out, "metatiles_secondary.bin")) // 16

    meta = {
        "layout_id": args.layout_id,
        "map_width": width,
        "map_height": height,
        "border_width": bw,
        "border_height": bh,
        "num_tiles_in_primary": NUM_TILES_IN_PRIMARY,
        "primary_tile_count": n_prim_tiles,
        "secondary_tile_count": n_sec_tiles,
        "combined_tile_count": NUM_TILES_IN_PRIMARY + n_sec_tiles,
        "primary_metatile_count": n_prim_mt,
        "secondary_metatile_count": n_sec_mt,
        "num_palettes": NUM_PALS_TOTAL,
        "num_pals_in_primary": NUM_PALS_IN_PRIMARY,
        "player_sheet_w": pw,
        "player_sheet_h": ph,
        "player_frame_w": frame_w,
        "player_frame_h": ph,
        "player_frames": n_frames,
    }
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Extracted {args.layout_id} -> {out}")
    print(f"  tiles.bin       {len(tiles_bin):>7} bytes  "
          f"({n_prim_tiles} primary + {n_sec_tiles} secondary, split @ {NUM_TILES_IN_PRIMARY})")
    print(f"  palettes.bin    {len(pal_bin):>7} bytes  ({NUM_PALS_TOTAL} banks)")
    print(f"  metatiles       {n_prim_mt} primary + {n_sec_mt} secondary")
    print(f"  map.bin         {width}x{height}   border {bw}x{bh}")
    print(f"  player.bin      {pw}x{ph}  ({n_frames} frames of {frame_w}x{ph})")


def main():
    ap = argparse.ArgumentParser(description="FireRed asset extractor for jrpg-engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    ex = sub.add_parser("extract", help="extract one map's raw render data")
    ex.add_argument("--firered-root", default="/Users/liuyanghe02/develop/pokefirered")
    ex.add_argument("--out", required=True, help="output asset directory")
    ex.add_argument("--layout-id", default="LAYOUT_PALLET_TOWN")
    ex.add_argument("--primary", default="general")
    ex.add_argument("--secondary", default="pallet_town")
    ex.add_argument("--player", default="red_normal")
    ex.add_argument("--player-frame-w", type=int, default=16)
    ex.set_defaults(func=cmd_extract)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
