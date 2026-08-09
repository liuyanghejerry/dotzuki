// ───────────────────────────────────────────────────────────────────────────
// cvProcess — deterministic computer-vision assists for the pixel editor, reusing
// the sprite pipeline's primitives (chroma matte, shared-palette quantize, grid
// pixelize). No AI model: pure, fast, in-process. Wrapped by POST /api/cv-process.
// ───────────────────────────────────────────────────────────────────────────
import { decodePNG, encodePNG, cloneImg, type Img } from './spriteSheet/image'
import { removeBackground } from './spriteSheet/chroma'
import { buildSharedPalette, applyPalette } from './spriteSheet/quantize'
import { detectPixelScale, pixelize } from './spriteSheet/pixelize'

export type CvOp = 'bg-removal' | 'palette-harmonize' | 'pixelize-grid'

export interface CvParams {
  colorCount?: number
  gridSize?: number
}

/** Apply one CV operation to a base64 PNG and return the processed base64 PNG. */
export function processCv(op: CvOp, pngBase64: string, params: CvParams = {}): { pngBase64: string } {
  const buf = Buffer.from(String(pngBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64')
  let img: Img = decodePNG(buf)

  if (op === 'bg-removal') {
    img = removeBackground(img)
  } else if (op === 'palette-harmonize') {
    const n = Math.max(2, Math.min(64, Number(params.colorCount) || 16))
    const pal = buildSharedPalette([img], n)
    if (pal) { img = cloneImg(img); applyPalette(img, pal) }
  } else if (op === 'pixelize-grid') {
    const scale = Math.max(1, Math.round(Number(params.gridSize) || detectPixelScale(img)))
    img = pixelize(img, scale)
  } else {
    throw new Error('unknown CV operation: ' + op)
  }

  return { pngBase64: 'data:image/png;base64,' + encodePNG(img).toString('base64') }
}
