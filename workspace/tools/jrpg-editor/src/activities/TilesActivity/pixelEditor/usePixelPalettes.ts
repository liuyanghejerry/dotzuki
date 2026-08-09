import { ref, computed, watch, type Ref } from 'vue'
import { hexToRgb, toHex, hexHue, hexLum } from './colorUtils'

// ── Colour palettes ─────────────────────────────────────────────────────────
// Three swatch strips: the working palette extracted from THIS image (+ sort,
// 合并杂色, and an optional constrain-while-painting), the user's saved slots
// (localStorage), and recently-used colours. Extracted from TilePixelEditor;
// the host threads canvas/colour state through `ctx`.

export interface PalettesCtx {
  /** The flattened composite (source for extracting the working palette). */
  composite: () => Uint8ClampedArray
  buildComposite: () => void
  /** The currently-active editing colour (for 储存 to the user palette). */
  activeColor: Ref<string>
  /** Preview brightness — swatches track it visually. */
  brightness: Ref<number>
  /** Opacity slider — a picked swatch restores its alpha too. */
  alpha: Ref<number>
  /** Route a chosen colour to the active slot (tool-aware). */
  setColor: (hex: string) => void
  /** Replace one colour with another on the active layer (undo-aware); true if
   *  the source colour was present. */
  replaceColor: (fromHex: string, toHex: string) => boolean
  showToast: (text: string, ok?: boolean) => void
}

const PALETTE_KEY = 'jrpg-tile-palette'
const DOC_PALETTE_MAX = 64

export function usePixelPalettes(ctx: PalettesCtx) {
  const recent = ref<string[]>([])
  function noteRecent(hex: string) {
    recent.value = [hex, ...recent.value.filter((c) => c !== hex)].slice(0, 12)
  }

  // ── User-saved colour slots, persisted in localStorage across tiles/sessions.
  function loadPalette(): string[] {
    try {
      const s = localStorage.getItem(PALETTE_KEY)
      return s ? (JSON.parse(s) as string[]) : []
    } catch {
      return []
    }
  }
  const userPalette = ref<string[]>(loadPalette())
  function persistPalette() {
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(userPalette.value))
    } catch {
      /* ignore storage quota / availability errors */
    }
  }
  function storeColor() {
    const c = ctx.activeColor.value
    if (!userPalette.value.includes(c)) {
      userPalette.value.push(c)
      persistPalette()
    }
  }
  function removeUserColor(i: number) {
    userPalette.value.splice(i, 1)
    persistPalette()
  }

  // ── Working palette extracted from the current image + optional constrain. ──
  const docPalette = ref<{ hex: string; a: number; n: number }[]>([])
  const constrainToPalette = ref(false)
  let constrainCache: Map<number, [number, number, number]> | null = null
  // Rebuild the working palette from the image's distinct opaque colours (most
  // frequent first, capped). Called on load and via the 提取 button.
  function extractDocPalette() {
    ctx.buildComposite()
    const composite = ctx.composite()
    const counts = new Map<number, { a: number; n: number }>()
    for (let i = 0; i < composite.length; i += 4) {
      if (composite[i + 3] === 0) continue
      const key = (composite[i] << 16) | (composite[i + 1] << 8) | composite[i + 2]
      const e = counts.get(key)
      if (e) {
        e.n++ // keep the first-seen alpha (deterministic) rather than last-scanned
      } else {
        counts.set(key, { a: composite[i + 3], n: 1 })
      }
    }
    const arr = [...counts.entries()].map(([key, v]) => ({
      hex: toHex((key >> 16) & 255, (key >> 8) & 255, key & 255),
      a: v.a,
      n: v.n,
    }))
    arr.sort((x, y) => y.n - x.n)
    docPalette.value = arr.slice(0, DOC_PALETTE_MAX)
    constrainCache = null
  }
  // Nearest palette colour by the redmean approximation (cached per packed RGB).
  function nearestPaletteColor(r: number, g: number, b: number): [number, number, number] {
    const pal = docPalette.value
    if (!pal.length) return [r, g, b]
    if (!constrainCache) constrainCache = new Map()
    const key = (r << 16) | (g << 8) | b
    const hit = constrainCache.get(key)
    if (hit) return hit
    let best: [number, number, number] = [r, g, b]
    let bestD = Infinity
    for (const e of pal) {
      const [pr, pg, pb] = hexToRgb(e.hex)
      const rm = (r + pr) / 2
      const dr = r - pr
      const dg = g - pg
      const db = b - pb
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
      if (d < bestD) {
        bestD = d
        best = [pr, pg, pb]
      }
    }
    constrainCache.set(key, best)
    return best
  }
  function pickDoc(e: { hex: string; a: number; n: number }) {
    ctx.setColor(e.hex)
    ctx.alpha.value = e.a
  }

  // ── Working-palette sorting + one-click colour merge (并杂色) ──
  const docSort = ref<'count' | 'hue' | 'lum'>('count')
  const sortedDocPalette = computed(() => {
    const arr = docPalette.value.slice()
    if (docSort.value === 'hue') {
      arr.sort((a, b) => hexHue(a.hex) - hexHue(b.hex) || hexLum(a.hex) - hexLum(b.hex))
    } else if (docSort.value === 'lum') {
      arr.sort((a, b) => hexLum(a.hex) - hexLum(b.hex))
    }
    // 'count' keeps extractDocPalette's frequency order (most-used first).
    return arr
  })
  const mergeMode = ref(false)
  const mergeFrom = ref<string | null>(null)
  function onDocSwatch(e: { hex: string; a: number; n: number }) {
    if (!mergeMode.value) {
      pickDoc(e)
      return
    }
    if (!mergeFrom.value) {
      mergeFrom.value = e.hex // arm the source colour
      return
    }
    if (mergeFrom.value === e.hex) {
      mergeFrom.value = null // clicking the armed source again cancels
      return
    }
    mergeColors(mergeFrom.value, e.hex)
    mergeFrom.value = null
  }
  // Replace `fromHex` with `toHex` on the active layer, then refresh the working
  // palette so the merged colour drops out. Sampled from the flattened composite,
  // so a colour on a NON-active/contour layer won't match — surface that instead
  // of a silent no-op, so the two-click gesture never just appears broken.
  function mergeColors(fromHex: string, toHex: string) {
    if (ctx.replaceColor(fromHex, toHex)) {
      extractDocPalette()
      ctx.showToast(`已合并 ${fromHex} → ${toHex}`, true)
    } else {
      ctx.showToast('未在当前图层找到该颜色（可能在其他图层，请切换图层后再试）', false)
    }
  }

  // Apply the preview 明度 to a swatch colour so the palettes track the canvas —
  // purely visual; the true hex is kept for click/title. Mirrors redraw().
  function displayHex(hex: string): string {
    const k = ctx.brightness.value / 100
    if (k === 1) return hex
    const [r, g, b] = hexToRgb(hex)
    return toHex(
      Math.min(255, Math.round(r * k)),
      Math.min(255, Math.round(g * k)),
      Math.min(255, Math.round(b * k)),
    )
  }

  // Working palette / constrain changed → drop the nearest-colour memo.
  watch([docPalette, constrainToPalette], () => { constrainCache = null })
  // Leaving 合并 mode disarms the pending source colour.
  watch(mergeMode, (v) => { if (!v) mergeFrom.value = null })

  return {
    recent, noteRecent,
    userPalette, storeColor, removeUserColor,
    docPalette, sortedDocPalette, docSort, constrainToPalette,
    extractDocPalette, nearestPaletteColor, pickDoc, onDocSwatch,
    mergeMode, mergeFrom, displayHex,
  }
}
