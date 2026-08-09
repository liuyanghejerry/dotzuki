// ───────────────────────────────────────────────────────────────────────────
// backdropTools — the assistant's MAP / REFERENCE-IMAGE skills, implemented as
// pure functions over ProjectContext so the chat agent can generate and edit
// maps and art-reference images directly (not just text/JSON files).
//
// Skill surface (registered in server/actions/tools.ts):
//   generate_map_backdrop     — AI art-reference image (source.png) for a map
//   edit_map_backdrop         — multimodal edit of an existing source.png
//   trace_backdrop_to_map     — source.png → real tilemap (tiles + tileset + tmx)
//   generate_title_backdrop   — widescreen title-screen background
//
// Trust model: these ACT directly (they create/overwrite regenerable art
// assets, the same as the UI's ✨ Backdrop button); they are NOT proposals.
// The AI call is injectable (`genImage`) so everything is unit-testable.
//
// The trace pipeline is a server-side port of MapActivity.vue's
// traceBackdropToTiles: slice the image into a tileSize grid, content-address +
// dedupe identical cells into library tiles, assemble the map's tileset.png,
// and fill the ground layer. Uses only existing primitives (spriteSheet/image,
// cvProcess) — no canvas, no new deps.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import path from 'path'
import type { ProjectContext } from './context/projectContext'
import type { ImageProviderProfile } from './ai'
import { imageProvidersFile } from './api/storyPaths'
import type { GenerateImageFn } from './spriteSheet/pipeline'
import { decodePNG, encodePNG, newImg, blit, resample, type Img } from './spriteSheet/image'
import { processCv } from './cvProcess'

// ── Image providers (config, no keys — keys ride the client request) ───────

/** Image provider profiles configured on disk (`.jrpg-editor.image-providers.json`). */
export function listImageProviders(): ImageProviderProfile[] {
  try {
    const f = imageProvidersFile()
    if (!fs.existsSync(f)) return []
    const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// ── Path helpers ────────────────────────────────────────────────────────────

/** `<dataRoot>/<mapsDir>/<map>` — validated, clamped so it cannot escape mapsDir. */
function mapDirAbs(project: ProjectContext, map: string): string {
  if (!map || !/^[A-Za-z0-9_-]+$/.test(map)) throw new Error('a valid map name (A–Z, 0–9, _-) is required')
  const mc = (project.activity('map')?.config ?? {}) as { mapsDir?: string }
  const base = project.resolveData(mc.mapsDir ?? 'maps')
  const abs = path.resolve(base, path.basename(map))
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('access denied')
  return abs
}

function mapTileSize(project: ProjectContext): number {
  const mc = (project.activity('map')?.config ?? {}) as { tileSize?: number }
  return Math.max(1, Number(mc.tileSize) || 16)
}

function tilesDirAbs(project: ProjectContext): string {
  const tc = project.activity('tiles')?.config as { tilesDir?: string } | undefined
  if (!tc?.tilesDir) throw new Error('This project has no tiles activity — trace to map needs a tile library. Add a tiles activity (config: tilesDir) first.')
  return project.resolveData(tc.tilesDir)
}

// ── Map reference image (source.png) ────────────────────────────────────────

export const MAP_BACKDROP_PROMPT_PREFIX =
  'Top-down 2D game map backdrop, pixel-art reference style, no text or UI overlay.'

/** Generate an AI art-reference image for a map → `<map>/source.png` (overwrites). */
export async function generateMapBackdrop(
  project: ProjectContext, map: string, prompt: string, gen: GenerateImageFn,
): Promise<{ map: string; rel: string; width: number; height: number }> {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt is required')
  const dir = mapDirAbs(project, map)
  const img = await gen(`${MAP_BACKDROP_PROMPT_PREFIX} ${String(prompt).trim()}`, '1:1', [])
  const abs = path.join(dir, 'source.png')
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, encodePNG(img))
  return { map, rel: path.relative(project.root, abs), width: img.width, height: img.height }
}

/** Multimodal edit of the map's existing source.png (keeps size + pixel style). */
export async function editMapBackdrop(
  project: ProjectContext, map: string, prompt: string, gen: GenerateImageFn,
): Promise<{ map: string; rel: string; width: number; height: number }> {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt is required')
  const dir = mapDirAbs(project, map)
  const abs = path.join(dir, 'source.png')
  if (!fs.existsSync(abs)) throw new Error(`Map "${map}" has no source.png yet — generate one first (generate_map_backdrop).`)
  const src = decodePNG(fs.readFileSync(abs))
  const editPrompt =
    `Edit this game-map reference image. ${String(prompt).trim()}. ` +
    'Keep the SAME dimensions, low-resolution pixel-art style, and preserve transparency.'
  const img = await gen(editPrompt, '1:1', [src])
  const sized = (img.width !== src.width || img.height !== src.height) ? resample(img, src.width, src.height) : img
  fs.writeFileSync(abs, encodePNG(sized))
  return { map, rel: path.relative(project.root, abs), width: sized.width, height: sized.height }
}

// ── Trace reference → tilemap ───────────────────────────────────────────────

export interface TraceOptions {
  /** Collapse flat regions into shared tiles (palette-harmonize, colors). */
  quantize?: boolean
  /** Target palette size for quantize (default 16). */
  colors?: number
  /** Snap to the image's native pixel grid first. */
  pixelize?: boolean
}

export interface TraceResult {
  map: string
  width: number
  height: number
  tileSize: number
  /** Unique tiles written to the library. */
  tiles: number
}

/** FNV-1a hash of an RGBA buffer — content address for tile dedupe. */
export function hashRGBA(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/**
 * Turn a map's source.png straight into an editable tilemap: slice into a
 * tileSize grid, dedupe identical cells into library tiles, assemble the map's
 * tileset.png, and fill the ground layer. Refuses when the map already has an
 * authored tilemap (same rule as the editor's trace flow).
 */
export function traceBackdropToMap(project: ProjectContext, map: string, opts: TraceOptions = {}): TraceResult {
  const dir = mapDirAbs(project, map)
  const sourceAbs = path.join(dir, 'source.png')
  if (!fs.existsSync(sourceAbs)) throw new Error(`Map "${map}" has no source.png — generate one first (generate_map_backdrop).`)
  if (fs.existsSync(path.join(dir, 'map.tmx.json'))) {
    throw new Error(`Map "${map}" already has an authored tilemap (map.tmx.json) — trace only applies to a backdrop-only map.`)
  }
  // Preconditions first: trace needs the tile library, so a project without a
  // tiles activity fails fast (before any expensive slicing).
  const tilesDir = tilesDirAbs(project)

  const ts = mapTileSize(project)
  let img: Img = decodePNG(fs.readFileSync(sourceAbs))

  // Optional deterministic CV passes (reuse the /api/cv-process pipeline).
  if (opts.quantize || opts.pixelize) {
    let url = 'data:image/png;base64,' + encodePNG(img).toString('base64')
    if (opts.quantize) url = processCv('palette-harmonize', url, { colorCount: opts.colors }).pngBase64
    if (opts.pixelize) url = processCv('pixelize-grid', url, {}).pngBase64
    img = decodePNG(Buffer.from(url.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
  }

  const W = Math.max(1, Math.round(img.width / ts))
  const H = Math.max(1, Math.round(img.height / ts))
  img = resample(img, W * ts, H * ts)

  // Slice every cell; content-address + dedupe. Transparent cells stay GID 0.
  const cellKey: (string | null)[] = new Array(W * H).fill(null)
  const order: string[] = []
  const keyImg = new Map<string, Img>()
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const cell = srcRegion(img, cx * ts, cy * ts, ts, ts)
      let opaque = false
      for (let p = 3; p < cell.data.length; p += 4) {
        if (cell.data[p] !== 0) { opaque = true; break }
      }
      if (!opaque) continue
      const key = hashRGBA(cell.data)
      cellKey[cy * W + cx] = key
      if (!keyImg.has(key)) { keyImg.set(key, cell); order.push(key) }
    }
  }
  if (order.length === 0) throw new Error('The reference image is empty (fully transparent).')

  // Persist the unique slices to the tile library (id allocation mirrors the
  // /api/tiles-save-batch route) and assemble the map's tileset.
  fs.mkdirSync(tilesDir, { recursive: true })
  const idxFile = path.join(tilesDir, 'library.json')
  const idx = fs.existsSync(idxFile) ? safeJson(idxFile) : { tiles: [] }
  const has = (i: string) => idx.tiles.some((t: any) => t.id === i)
  const ids: string[] = []
  let n = idx.tiles.length + 1
  for (const key of order) {
    while (has(`t${String(n).padStart(4, '0')}`)) n++
    const id = `t${String(n).padStart(4, '0')}`
    n++
    fs.writeFileSync(path.join(tilesDir, `${id}.png`), encodePNG(keyImg.get(key)!))
    idx.tiles.push({ id, name: '', source: `trace:${map}` })
    ids.push(id)
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2), 'utf-8')

  const cols = 16
  const rows = Math.ceil(ids.length / cols)
  const sheet = newImg(cols * ts, rows * ts)
  order.forEach((key, i) => blit(sheet, (i % cols) * ts, Math.floor(i / cols) * ts, keyImg.get(key)!))
  fs.writeFileSync(path.join(dir, 'tileset.png'), encodePNG(sheet))
  fs.writeFileSync(path.join(dir, 'tileset.tiles.json'), JSON.stringify({ tileIds: ids, cols }, null, 2), 'utf-8')

  // Fill the ground layer (GID per cell), collision layer empty.
  const keyGid = new Map(order.map((key, i) => [key, i + 1]))
  const ground = new Array(W * H).fill(0)
  for (let i = 0; i < cellKey.length; i++) {
    if (cellKey[i]) ground[i] = keyGid.get(cellKey[i]!)!
  }
  const layer = (name: string, data: number[]) => ({
    name, width: W, height: H, visible: true, opacity: 1, type: 'tilelayer', data,
  })
  const tmx = {
    width: W, height: H, tilewidth: ts, tileheight: ts,
    backgroundcolor: '#101014',
    layers: [layer('ground', ground), layer('collision', new Array(W * H).fill(0))],
  }
  fs.writeFileSync(path.join(dir, 'map.tmx.json'), JSON.stringify(tmx))

  return { map, width: W, height: H, tileSize: ts, tiles: ids.length }
}

/** Read a JSON file, falling back to a sane default on corruption. */
function safeJson(file: string): { tiles: any[] } {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return { tiles: [] } }
}

/** Extract a ts×ts region of `src` as a new image (clamped to src bounds). */
function srcRegion(src: Img, x: number, y: number, w: number, h: number): Img {
  const out = newImg(w, h)
  for (let dy = 0; dy < h; dy++) {
    const sy = y + dy
    if (sy < 0 || sy >= src.height) continue
    for (let dx = 0; dx < w; dx++) {
      const sx = x + dx
      if (sx < 0 || sx >= src.width) continue
      const si = (sy * src.width + sx) * 4
      const di = (dy * w + dx) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }
  return out
}

// ── Title-screen background ─────────────────────────────────────────────────

export const TITLE_BACKDROP_PROMPT_PREFIX =
  'Widescreen game title-screen background illustration, no text, logo, or UI overlay.'

/** Generate a widescreen title background → the title activity's bgImage. */
export async function generateTitleBackdrop(
  project: ProjectContext, prompt: string, gen: GenerateImageFn,
): Promise<{ rel: string; width: number; height: number }> {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt is required')
  const tc = project.activity('title-screen')?.config as { bgImage?: string } | undefined
  const rel = tc?.bgImage ?? 'data/gfx/title/background.png'
  const img = await gen(`${TITLE_BACKDROP_PROMPT_PREFIX} ${String(prompt).trim()}`, '16:9', [])
  const abs = project.resolveData(rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, encodePNG(img))
  return { rel: path.relative(project.root, abs), width: img.width, height: img.height }
}
