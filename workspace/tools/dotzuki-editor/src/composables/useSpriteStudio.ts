// ───────────────────────────────────────────────────────────────────────────
// Sprite Studio data access — talks to the dev-server /api/sprites/* routes.
//
// Categories are project-configured (story activity `sprite.categories`) with
// built-in defaults; metadata + bytes live on disk under
// `gfxRoot/<category.dir>/<id>/sheet.png` (+ per-frame PNGs). This composable is
// stateless beyond a module-level category cache; per-character UI state lives in
// the SpriteStudio component.
// ───────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import type { FramePng } from './spriteCanvas'

export interface SpriteCategory {
  id: string
  label?: string | Record<string, string>
  dir: string
  rows: number
  cols: number
  cellW: number
  cellH: number
  rowNames?: string[]
  colNames?: string[]
  animated?: boolean
  footAnchor?: boolean
  standCol?: number
  walkCols?: number[]
  runCols?: number[]
}

export interface SpriteMeta {
  category: string
  id: string
  dir: string
  exists: boolean
  rows: number
  cols: number
  cellW: number
  cellH: number
  rowNames: string[] | null
  colNames: string[] | null
  animated: boolean
  footAnchor: boolean
  standCol: number
  walkCols: number[] | null
  runCols: number[] | null
  generateConfigured: boolean
  sheet: { exists: boolean; w: number; h: number }
  raw: { exists: boolean }
  frames: string[]
}

const categories = ref<SpriteCategory[]>([])
let categoriesLoaded = false

async function getJson(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(await resp.json().then(j => j.error).catch(() => resp.statusText))
  return resp.json()
}

/** The per-frame filename for cell (row,col), mirroring sprite_post.py:
 *  multi-row grids → `<rowName>_<col>.png`; single-cell categories → `<id>.png`;
 *  single-row strips → `<colName>.png`. */
export function frameName(cat: SpriteCategory | SpriteMeta, row: number, col: number): string {
  const rows = cat.rows
  const cols = cat.cols
  if (rows === 1 && cols === 1) {
    const id = (cat as SpriteMeta).id ?? (cat as SpriteCategory).id
    return `${id}.png`
  }
  if (rows > 1) {
    const rn = cat.rowNames?.[row] ?? String(row)
    return cols > 1 ? `${rn}_${col}.png` : `${rn}.png`
  }
  const cn = cat.colNames?.[col] ?? String(col)
  return `${cn}.png`
}

/** Human label for a column (frame), best-effort. */
export function colLabel(cat: SpriteCategory | SpriteMeta, col: number): string {
  return cat.colNames?.[col] ?? `#${col}`
}

/** Human label for a row (facing), best-effort. */
export function rowLabel(cat: SpriteCategory | SpriteMeta, row: number): string {
  return cat.rowNames?.[row] ?? `#${row}`
}

export function useSpriteStudio() {
  async function loadCategories(force = false): Promise<SpriteCategory[]> {
    if (categoriesLoaded && !force) return categories.value
    categories.value = await getJson('/api/sprites/categories')
    categoriesLoaded = true
    return categories.value
  }

  function loadMeta(category: string, id: string): Promise<SpriteMeta> {
    return getJson(`/api/sprites/meta?category=${encodeURIComponent(category)}&id=${encodeURIComponent(id)}`)
  }

  function fileUrl(category: string, id: string, name = 'sheet.png', v = 0): string {
    return `/api/sprites/file?category=${encodeURIComponent(category)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&v=${v}`
  }

  async function saveSheet(
    category: string,
    id: string,
    sheetBase64: string,
    frames: FramePng[],
  ): Promise<{ ok: boolean; dir: string }> {
    const resp = await fetch('/api/sprites/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, id, sheetBase64, frames }),
    })
    if (!resp.ok) throw new Error(await resp.json().then(j => j.error).catch(() => resp.statusText))
    return resp.json()
  }

  async function generate(
    category: string,
    id: string,
    prompt?: string,
    /** Image-provider creds bridged to the generate command's env (GEMINI_KEY, …). */
    auth?: { apiKey?: string; proxyUrl?: string; model?: string },
  ): Promise<{ ok: boolean; output: string; dir: string; frames: string[] }> {
    const resp = await fetch('/api/sprites/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, id, prompt, ...auth }),
    })
    const data = await resp.json()
    if (!resp.ok) throw new Error(data.error || 'generation failed')
    return data
  }

  return { categories, loadCategories, loadMeta, fileUrl, saveSheet, generate }
}
