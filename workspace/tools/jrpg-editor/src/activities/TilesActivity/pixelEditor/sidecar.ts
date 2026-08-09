import { markRaw } from 'vue'
import type { SidecarDoc } from '../../../composables/useTilesActivity'
import type { Layer } from './types'

// ── Sidecar (de)serialization ───────────────────────────────────────────────
// The layered editing structure stored alongside a tile/group's flat PNG, so
// reopening the pixel editor can resume layered editing. Extracted from
// TilePixelEditor; geometry + the layer factory / setter are passed in.

/** Snapshot every layer as a PNG + its params into a sidecar doc. */
export function serializeLayers(layers: Layer[], pw: number, ph: number, cell: number): SidecarDoc {
  const oc = document.createElement('canvas')
  oc.width = pw
  oc.height = ph
  const c = oc.getContext('2d')!
  return {
    v: 1,
    w: pw,
    h: ph,
    tileSize: cell,
    layers: layers.map((L) => {
      c.clearRect(0, 0, pw, ph)
      c.putImageData(new ImageData(L.data.slice(), pw, ph), 0, 0)
      return {
        id: L.id,
        name: L.name,
        kind: L.kind,
        visible: L.visible,
        opacity: L.opacity / 255,
        outline: L.outline,
        fill: L.fill,
        width: L.width,
        mode: L.mode,
        levels: L.levels,
        angle: L.angle,
        png: oc.toDataURL('image/png'),
      }
    }),
  }
}

/** Decode a data-URL PNG into a crisp pw×ph RGBA buffer. */
function decodePng(dataUrl: string, pw: number, ph: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const oc = document.createElement('canvas')
      oc.width = pw
      oc.height = ph
      const c = oc.getContext('2d')!
      c.imageSmoothingEnabled = false
      c.clearRect(0, 0, pw, ph)
      c.drawImage(img, 0, 0, pw, ph)
      resolve(c.getImageData(0, 0, pw, ph).data)
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/** Rebuild layers from a sidecar; returns false (→ caller falls back to a flat
 *  PNG) on a dimension mismatch or any decode failure. `mkLayerId` remints empty
 *  or duplicate ids; `setLayers` installs the rebuilt stack. */
export async function hydrateFromSidecar(
  doc: SidecarDoc,
  pw: number,
  ph: number,
  mkLayerId: () => string,
  setLayers: (ls: Layer[]) => void,
): Promise<boolean> {
  if (!doc || doc.w !== pw || doc.h !== ph || !Array.isArray(doc.layers) || !doc.layers.length) return false
  const built: Layer[] = []
  const seenIds = new Set<string>()
  for (const sl of doc.layers) {
    const data = await decodePng(sl.png, pw, ph)
    if (!data) return false
    // Remint empty OR duplicate ids so two layers can't alias one graveyard buffer.
    const id = sl.id && !seenIds.has(sl.id) ? sl.id : mkLayerId()
    seenIds.add(id)
    built.push({
      id,
      name: sl.name ?? '图层',
      kind: sl.kind === 'contour' ? 'contour' : 'raster',
      data: markRaw(data),
      visible: sl.visible !== false,
      opacity: Math.max(0, Math.min(255, Math.round((sl.opacity ?? 1) * 255))),
      outline: sl.outline ?? '#1c1c1c',
      fill: sl.fill ?? '#ffffff',
      width: sl.width ?? 1,
      mode: sl.mode ?? 'flat',
      levels: sl.levels ?? 3,
      angle: sl.angle ?? 135,
    })
  }
  setLayers(built)
  return true
}
