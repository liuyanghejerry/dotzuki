// Pure raster / region helpers for the pixel editor (no component state; the
// grid size and buffers are passed in). Selection masks are `Uint8Array`
// (0/1, length pw*ph); pixel buffers are RGBA `Uint8ClampedArray`.
import { hexToRgb } from './colorUtils'
import type { ContourMode } from './types'

export interface ContourOpts {
  mode?: ContourMode // default 'flat'
  levels?: number // gradient bands for ring/ramp/directional (>= 2)
  angle?: number // light direction in degrees, for directional
}

/** Manhattan distance transform: for every opaque (a===255) pixel, the distance
 *  to the nearest empty pixel (the canvas border counts as empty). Two passes. */
function edgeDistance(px: Uint8ClampedArray, pw: number, ph: number): Int32Array {
  const n = pw * ph
  const dist = new Int32Array(n)
  const INF = 0x3fffffff
  for (let p = 0; p < n; p++) dist[p] = px[p * 4 + 3] === 255 ? INF : 0
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const p = y * pw + x
      if (dist[p] === 0) continue
      let d = dist[p]
      d = Math.min(d, (x > 0 ? dist[p - 1] : 0) + 1)
      d = Math.min(d, (y > 0 ? dist[p - pw] : 0) + 1)
      dist[p] = d
    }
  }
  for (let y = ph - 1; y >= 0; y--) {
    for (let x = pw - 1; x >= 0; x--) {
      const p = y * pw + x
      if (dist[p] === 0) continue
      let d = dist[p]
      d = Math.min(d, (x < pw - 1 ? dist[p + 1] : 0) + 1)
      d = Math.min(d, (y < ph - 1 ? dist[p + pw] : 0) + 1)
      dist[p] = d
    }
  }
  return dist
}

/** Derive the 勾填笔 render from an opaque silhouette. `flat` (default) keeps the
 *  classic single dark edge (pixels within `width` of the alpha edge → `outline`)
 *  + flat `fill`. The other modes step/ramp between the two tones, quantized to
 *  `levels` bands — see ContourMode. */
export function deriveContour(
  data: Uint8ClampedArray,
  outline: string,
  fill: string,
  width: number,
  pw: number,
  ph: number,
  opts: ContourOpts = {},
): Uint8ClampedArray {
  const px = data
  const [or, og, ob] = hexToRgb(outline)
  const [fr, fg, fb] = hexToRgb(fill)
  const w = Math.max(1, Math.round(width) || 1)
  const mode = opts.mode ?? 'flat'
  const n = pw * ph
  const out = new Uint8ClampedArray(n * 4)

  // flat: the original binary split — no distance banding beyond the edge test.
  if (mode === 'flat') {
    const dist = edgeDistance(px, pw, ph)
    for (let p = 0; p < n; p++) {
      if (px[p * 4 + 3] !== 255) continue
      const i = p * 4
      const edge = dist[p] <= w
      out[i] = edge ? or : fr
      out[i + 1] = edge ? og : fg
      out[i + 2] = edge ? ob : fb
      out[i + 3] = 255
    }
    return out
  }

  // t in [0,1] (0 → outline, 1 → fill), quantized to L discrete bands.
  const L = Math.max(2, Math.round(opts.levels ?? 3) || 2)
  const write = (i: number, t: number) => {
    const q = Math.round(Math.max(0, Math.min(1, t)) * (L - 1)) / (L - 1)
    out[i] = Math.round(or + (fr - or) * q)
    out[i + 1] = Math.round(og + (fg - og) * q)
    out[i + 2] = Math.round(ob + (fb - ob) * q)
    out[i + 3] = 255
  }

  if (mode === 'directional') {
    // Project each opaque pixel onto the light direction; the lit end (max proj)
    // is the fill tone, the far end the outline tone.
    const rad = ((opts.angle ?? 135) * Math.PI) / 180
    const dx = Math.cos(rad), dy = Math.sin(rad)
    let mn = Infinity, mx = -Infinity
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      if (px[(y * pw + x) * 4 + 3] !== 255) continue
      const pr = x * dx + y * dy
      if (pr < mn) mn = pr
      if (pr > mx) mx = pr
    }
    const span = mx - mn || 1
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const p = y * pw + x
      if (px[p * 4 + 3] !== 255) continue
      write(p * 4, (x * dx + y * dy - mn) / span)
    }
    return out
  }

  // ring / ramp both band by edge distance; ring uses fixed w-px bands (flat core
  // once past `levels` rings), ramp scales the bands to the shape's own depth.
  const dist = edgeDistance(px, pw, ph)
  let maxDist = 1
  if (mode === 'ramp') for (let p = 0; p < n; p++) if (px[p * 4 + 3] === 255 && dist[p] > maxDist) maxDist = dist[p]
  for (let p = 0; p < n; p++) {
    if (px[p * 4 + 3] !== 255) continue
    const d = dist[p]
    const t = mode === 'ramp'
      ? (maxDist <= 1 ? 1 : (d - 1) / (maxDist - 1))
      : Math.min(Math.floor((d - 1) / w), L - 1) / (L - 1)
    write(p * 4, t)
  }
  return out
}

/** Copy an old (ow×oh) RGBA buffer into a fresh (nw×nh) one at pixel offset. */
export function reflowRGBA(
  src: Uint8ClampedArray,
  ow: number, oh: number,
  nw: number, nh: number,
  ox: number, oy: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    const sy = y - oy
    if (sy < 0 || sy >= oh) continue
    for (let x = 0; x < nw; x++) {
      const sx = x - ox
      if (sx < 0 || sx >= ow) continue
      const si = (sy * ow + sx) * 4, di = (y * nw + x) * 4
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3]
    }
  }
  return out
}

/** Rasterize an axis-aligned rect into a fresh pw×ph mask (clipped to bounds). */
export function rectMask(pw: number, ph: number, x: number, y: number, w: number, h: number): Uint8Array {
  const m = new Uint8Array(pw * ph)
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= ph) continue
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= pw) continue
      m[yy * pw + xx] = 1
    }
  }
  return m
}

/** Tight bounding box of a pw×ph mask, or null if empty. */
export function maskBBox(m: Uint8Array, pw: number, ph: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = pw, y0 = ph, x1 = -1, y1 = -1
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (m[y * pw + x]) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Magic-wand mask from a seed pixel over `buf`: contiguous flood (or global by
 *  colour) similarity — max per-channel diff ≤ tol; transparency must match. */
export function wandMask(buf: Uint8ClampedArray, pw: number, ph: number, sx: number, sy: number, tol: number, global: boolean): Uint8Array {
  const m = new Uint8Array(pw * ph)
  const si = (sy * pw + sx) * 4
  const tr = buf[si], tg = buf[si + 1], tb = buf[si + 2], ta = buf[si + 3]
  const matches = (i: number): boolean => {
    const a = buf[i * 4 + 3]
    if ((a > 0) !== (ta > 0)) return false
    if (a === 0 && ta === 0) return true // both transparent
    return Math.abs(buf[i * 4] - tr) <= tol && Math.abs(buf[i * 4 + 1] - tg) <= tol && Math.abs(buf[i * 4 + 2] - tb) <= tol
  }
  if (global) {
    for (let i = 0; i < pw * ph; i++) if (matches(i)) m[i] = 1
    return m
  }
  const stack = [sy * pw + sx]
  while (stack.length) {
    const i = stack.pop()!
    if (m[i] || !matches(i)) continue
    m[i] = 1
    const x = i % pw, y = (i / pw) | 0
    if (x + 1 < pw) stack.push(i + 1)
    if (x - 1 >= 0) stack.push(i - 1)
    if (y + 1 < ph) stack.push(i + pw)
    if (y - 1 >= 0) stack.push(i - pw)
  }
  return m
}

/** Even-odd polygon fill of the lasso path into a fresh pw×ph mask. */
export function lassoMask(pw: number, ph: number, pts: { x: number; y: number }[]): Uint8Array {
  const m = new Uint8Array(pw * ph)
  const n = pts.length
  if (n < 3) return m
  for (let y = 0; y < ph; y++) {
    const cy = y + 0.5
    for (let x = 0; x < pw; x++) {
      const cx = x + 0.5
      let inside = false
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = pts[i].y, yj = pts[j].y, xi = pts[i].x, xj = pts[j].x
        if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) m[y * pw + x] = 1
    }
  }
  return m
}

// A 3×3 median-by-luminance over opaque neighbours: each pixel becomes the
// neighbour whose luminance is the median, so salt-and-pepper 杂色 collapses to
// the surrounding tone WITHOUT inventing colours or blurring edges. Holes
// (transparent) and pixels with too few opaque neighbours are left as-is.
export function medianDenoise(region: Uint8ClampedArray, rw: number, rh: number): Uint8ClampedArray {
  const out = region.slice()
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const ci = (y * rw + x) * 4
      if (region[ci + 3] === 0) continue
      const nb: { l: number; i: number }[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue
          const ni = (ny * rw + nx) * 4
          if (region[ni + 3] === 0) continue
          nb.push({ l: lum(region[ni], region[ni + 1], region[ni + 2]), i: ni })
        }
      }
      if (nb.length < 3) continue
      nb.sort((a, b) => a.l - b.l)
      const mi = nb[nb.length >> 1].i
      out[ci] = region[mi]; out[ci + 1] = region[mi + 1]; out[ci + 2] = region[mi + 2]; out[ci + 3] = region[mi + 3]
    }
  }
  return out
}
