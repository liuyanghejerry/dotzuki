// ───────────────────────────────────────────────────────────────────────────
// Canvas helpers for the Sprite Studio.
//
// A sprite "sheet" is a `rows × cols` grid of `cellW × cellH` RGBA cells
// (row = facing, col = frame), matching the wuxia character-sprite-gen layout.
// These helpers slice cells out for preview / per-frame editing and composite an
// edited frame back into the sheet, then export both the trimmed sheet PNG and
// the per-frame PNGs the engine consumes. All pixel-art ops keep smoothing off.
// ───────────────────────────────────────────────────────────────────────────

export interface FramePng {
  name: string
  base64: string
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to load image: ' + url))
    img.src = url
  })
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.imageSmoothingEnabled = false
  return { c, x }
}

/** A fully-transparent `w × h` PNG data-URL — a blank frame to paint into. */
export function blankDataUrl(w: number, h: number): string {
  return makeCanvas(w, h).c.toDataURL('image/png')
}

/** Crop the cell at grid (col,row) out of `img` → a `cw × ch` PNG data-URL.
 *  Cells beyond the image bounds come back transparent. */
export function cropCell(
  img: HTMLImageElement | null,
  col: number,
  row: number,
  cw: number,
  ch: number,
): string {
  const { c, x } = makeCanvas(cw, ch)
  if (img && img.width > 0) x.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, cw, ch)
  return c.toDataURL('image/png')
}

/** Build the full grid sheet canvas, drawing `img` (if any) at the top-left so
 *  cells the source doesn't cover stay transparent (room to paint run frames). */
export function sheetCanvasFrom(
  img: HTMLImageElement | null,
  rows: number,
  cols: number,
  cw: number,
  ch: number,
): HTMLCanvasElement {
  const { c, x } = makeCanvas(cols * cw, rows * ch)
  if (img && img.width > 0) x.drawImage(img, 0, 0)
  return c
}

/** Stamp an edited `cw × ch` frame data-URL back into the sheet at (col,row). */
export async function stampFrame(
  sheet: HTMLCanvasElement,
  frameDataUrl: string,
  col: number,
  row: number,
  cw: number,
  ch: number,
): Promise<void> {
  const img = await loadImage(frameDataUrl)
  const x = sheet.getContext('2d')!
  x.imageSmoothingEnabled = false
  x.clearRect(col * cw, row * ch, cw, ch)
  x.drawImage(img, 0, 0, cw, ch, col * cw, row * ch, cw, ch)
}

/** Index of the last grid column containing any opaque pixel (≥ 0). Used to trim
 *  trailing un-painted columns so un-arted run frames don't pad the saved sheet
 *  (which would make the runtime show empty cells while running). */
export function lastPaintedCol(
  sheet: HTMLCanvasElement,
  rows: number,
  cols: number,
  cw: number,
  ch: number,
): number {
  const x = sheet.getContext('2d')!
  let last = 0
  for (let c = 0; c < cols; c++) {
    const data = x.getImageData(c * cw, 0, cw, rows * ch).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) { last = c; break }
    }
  }
  return last
}

/**
 * Export the sheet for saving: trim trailing empty columns, then return the
 * trimmed sheet PNG plus a per-frame PNG for every (row, col) cell.
 */
export function exportSheet(
  sheet: HTMLCanvasElement,
  rows: number,
  cols: number,
  cw: number,
  ch: number,
  frameName: (row: number, col: number) => string,
): { sheetBase64: string; frames: FramePng[]; cols: number } {
  const effCols = Math.max(1, lastPaintedCol(sheet, rows, cols, cw, ch) + 1)

  const { c: outC, x: outX } = makeCanvas(effCols * cw, rows * ch)
  outX.drawImage(sheet, 0, 0, effCols * cw, rows * ch, 0, 0, effCols * cw, rows * ch)

  const frames: FramePng[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < effCols; c++) {
      const { c: fc, x: fx } = makeCanvas(cw, ch)
      fx.drawImage(sheet, c * cw, r * ch, cw, ch, 0, 0, cw, ch)
      frames.push({ name: frameName(r, c), base64: fc.toDataURL('image/png') })
    }
  }
  return { sheetBase64: outC.toDataURL('image/png'), frames, cols: effCols }
}

/** Draw an image scaled by an integer factor with no smoothing (crisp pixels). */
export function blitScaled(
  dst: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, scale: number,
): void {
  dst.imageSmoothingEnabled = false
  dst.drawImage(img, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale)
}
