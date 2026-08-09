// Pure raster ops — synthetic RGBA buffers, exact mask/pixel assertions.
import { describe, it, expect } from 'vitest'
import {
  deriveContour,
  reflowRGBA,
  rectMask,
  maskBBox,
  wandMask,
  lassoMask,
  medianDenoise,
} from './imageOps'

type RGBA = [number, number, number, number]
const RED: RGBA = [255, 0, 0, 255]
const BLUE: RGBA = [0, 0, 255, 255]
const GRAY: RGBA = [128, 128, 128, 255]
const WHITE: RGBA = [255, 255, 255, 255]

/** pw×ph fully transparent buffer with the given 'x,y' pixels painted in. */
function img(pw: number, ph: number, px: Record<string, RGBA> = {}): Uint8ClampedArray {
  const b = new Uint8ClampedArray(pw * ph * 4)
  for (const [k, c] of Object.entries(px)) {
    const [x, y] = k.split(',').map(Number)
    b.set(c, (y * pw + x) * 4)
  }
  return b
}

/** Solid pw×ph buffer of one colour. */
function solid(pw: number, ph: number, c: RGBA): Uint8ClampedArray {
  const b = new Uint8ClampedArray(pw * ph * 4)
  for (let i = 0; i < pw * ph; i++) b.set(c, i * 4)
  return b
}

/** Row-major [x, y] list of a mask's set pixels. */
function coords(m: Uint8Array, pw: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < m.length; i++) if (m[i]) out.push([i % pw, (i / pw) | 0])
  return out
}

const pxAt = (b: Uint8ClampedArray, pw: number, x: number, y: number): number[] =>
  Array.from(b.slice((y * pw + x) * 4, (y * pw + x) * 4 + 4))

const sum = (m: Uint8Array): number => m.reduce((a, v) => a + v, 0)

describe('deriveContour', () => {
  // distance map of a solid 5×5 (canvas border counts as empty):
  //   1 1 1 1 1 / 1 2 2 2 1 / 1 2 3 2 1 / 1 2 2 2 1 / 1 1 1 1 1
  it('flat: the edge ring within width gets outline, deeper pixels get fill', () => {
    const out = deriveContour(solid(5, 5, RED), '#000000', '#ffffff', 1, 5, 5)
    expect(pxAt(out, 5, 0, 0)).toEqual([0, 0, 0, 255]) // border → outline
    expect(pxAt(out, 5, 4, 2)).toEqual([0, 0, 0, 255]) // border → outline
    expect(pxAt(out, 5, 1, 1)).toEqual([255, 255, 255, 255]) // depth 2 → fill
    expect(pxAt(out, 5, 2, 2)).toEqual([255, 255, 255, 255]) // core → fill
  })

  it('flat: a wider width deepens the outline ring', () => {
    const out = deriveContour(solid(5, 5, RED), '#000000', '#ffffff', 2, 5, 5)
    expect(pxAt(out, 5, 1, 1)).toEqual([0, 0, 0, 255]) // depth 2 ≤ width → outline
    expect(pxAt(out, 5, 2, 2)).toEqual([255, 255, 255, 255]) // only the core stays fill
  })

  it('skips transparent and semi-transparent pixels, which count as empty', () => {
    const out = deriveContour(img(4, 4, { '1,1': RED, '2,2': [255, 0, 0, 128] }), '#000000', '#ffffff', 1, 4, 4)
    expect(pxAt(out, 4, 1, 1)).toEqual([0, 0, 0, 255]) // lone opaque pixel is all edge
    expect(pxAt(out, 4, 2, 2)).toEqual([0, 0, 0, 0]) // a=128 is not opaque → skipped
    expect(pxAt(out, 4, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('ring: bands step outline → mid tone → fill by edge distance', () => {
    const out = deriveContour(solid(5, 5, RED), '#000000', '#ffffff', 1, 5, 5, { mode: 'ring', levels: 3 })
    expect(pxAt(out, 5, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pxAt(out, 5, 1, 1)).toEqual([128, 128, 128, 255])
    expect(pxAt(out, 5, 2, 2)).toEqual([255, 255, 255, 255])
  })

  it('ramp: a shape with no interior depth renders entirely as fill', () => {
    const out = deriveContour(solid(2, 2, RED), '#000000', '#ffffff', 1, 2, 2, { mode: 'ramp', levels: 3 })
    for (let i = 0; i < 4; i++) expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual([255, 255, 255, 255])
  })

  it('directional: ramps along the light direction, quantized to levels', () => {
    const out = deriveContour(solid(4, 1, RED), '#000000', '#ffffff', 1, 4, 1, { mode: 'directional', angle: 0, levels: 3 })
    expect(pxAt(out, 4, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pxAt(out, 4, 1, 0)).toEqual([128, 128, 128, 255])
    expect(pxAt(out, 4, 2, 0)).toEqual([128, 128, 128, 255])
    expect(pxAt(out, 4, 3, 0)).toEqual([255, 255, 255, 255])
  })

  it('does not mutate the source buffer', () => {
    const b = solid(3, 3, RED)
    const before = Array.from(b)
    deriveContour(b, '#000000', '#ffffff', 1, 3, 3)
    expect(Array.from(b)).toEqual(before)
  })
})

describe('reflowRGBA', () => {
  it('copies the old buffer into the new size at the pixel offset', () => {
    const out = reflowRGBA(solid(2, 2, RED), 2, 2, 4, 4, 1, 1)
    expect(pxAt(out, 4, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pxAt(out, 4, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pxAt(out, 4, 2, 2)).toEqual([255, 0, 0, 255])
    expect(pxAt(out, 4, 3, 3)).toEqual([0, 0, 0, 0])
  })

  it('clips source pixels that fall outside the new canvas', () => {
    const out = reflowRGBA(img(2, 2, { '0,0': RED, '1,1': BLUE }), 2, 2, 2, 2, -1, -1)
    expect(pxAt(out, 2, 0, 0)).toEqual([0, 0, 255, 255]) // only src(1,1) survives the shift
    expect(pxAt(out, 2, 1, 0)).toEqual([0, 0, 0, 0])
    expect(pxAt(out, 2, 0, 1)).toEqual([0, 0, 0, 0])
    expect(pxAt(out, 2, 1, 1)).toEqual([0, 0, 0, 0])
  })

  it('a same-size copy at offset 0 is identical', () => {
    const src = img(2, 2, { '0,0': RED, '1,0': BLUE, '0,1': WHITE })
    expect(Array.from(reflowRGBA(src, 2, 2, 2, 2, 0, 0))).toEqual(Array.from(src))
  })
})

describe('rectMask', () => {
  it('rasterizes the rect into a fresh mask', () => {
    expect(coords(rectMask(4, 4, 1, 1, 2, 2), 4)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]])
  })

  it('clips to canvas bounds, including a negative origin', () => {
    expect(coords(rectMask(4, 4, 3, 3, 3, 3), 4)).toEqual([[3, 3]])
    expect(coords(rectMask(4, 4, -2, 0, 3, 1), 4)).toEqual([[0, 0]])
  })

  it('a zero-size rect selects nothing', () => {
    expect(sum(rectMask(4, 4, 1, 1, 0, 0))).toBe(0)
  })
})

describe('maskBBox', () => {
  it('returns the tight box around the set pixels', () => {
    expect(maskBBox(rectMask(5, 5, 1, 2, 3, 2), 5, 5)).toEqual({ x: 1, y: 2, w: 3, h: 2 })
  })

  it('a single pixel has w=h=1', () => {
    const m = new Uint8Array(16)
    m[3 * 4 + 2] = 1
    expect(maskBBox(m, 4, 4)).toEqual({ x: 2, y: 3, w: 1, h: 1 })
  })

  it('returns null for an empty mask', () => {
    expect(maskBBox(new Uint8Array(16), 4, 4)).toBeNull()
  })
})

describe('wandMask', () => {
  it('floods the contiguous same-colour region at tolerance 0', () => {
    const b = solid(4, 4, RED)
    b.set(BLUE, (3 * 4 + 3) * 4)
    const m = wandMask(b, 4, 4, 0, 0, 0, false)
    expect(sum(m)).toBe(15)
    expect(m[3 * 4 + 3]).toBe(0)
  })

  it('stops at a colour barrier; global mode selects by colour everywhere', () => {
    const b = solid(4, 4, RED)
    for (let y = 0; y < 4; y++) b.set(BLUE, (y * 4 + 1) * 4) // blue wall at x=1
    expect(coords(wandMask(b, 4, 4, 0, 0, 0, false), 4)).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]])
    expect(sum(wandMask(b, 4, 4, 0, 0, 0, true))).toBe(12) // all three red columns
  })

  it('is 4-connected: diagonal neighbours are not flooded', () => {
    const b = img(2, 2, { '0,0': RED, '1,1': RED })
    expect(coords(wandMask(b, 2, 2, 0, 0, 0, false), 2)).toEqual([[0, 0]])
  })

  it('tolerance gates near-colour matches per channel', () => {
    const b = img(2, 1, { '0,0': [200, 100, 50, 255], '1,0': [205, 100, 50, 255] })
    expect(coords(wandMask(b, 2, 1, 0, 0, 4, false), 2)).toEqual([[0, 0]]) // diff 5 > tol 4
    expect(coords(wandMask(b, 2, 1, 0, 0, 5, false), 2)).toEqual([[0, 0], [1, 0]])
  })

  it('a transparent seed matches transparent pixels regardless of their RGB', () => {
    const b = img(3, 1, { '1,0': [9, 9, 9, 0], '2,0': [0, 0, 0, 0] })
    expect(coords(wandMask(b, 3, 1, 0, 0, 0, false), 3)).toEqual([[0, 0], [1, 0], [2, 0]])
  })

  it('transparent and opaque pixels never match each other, even at max tolerance', () => {
    const b = img(2, 1, { '0,0': RED }) // (1,0) transparent
    expect(coords(wandMask(b, 2, 1, 0, 0, 255, false), 2)).toEqual([[0, 0]])
    expect(coords(wandMask(b, 2, 1, 1, 0, 255, false), 2)).toEqual([[1, 0]])
  })
})

describe('lassoMask', () => {
  it('fills an axis-aligned square by pixel centres', () => {
    const m = lassoMask(4, 4, [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }])
    expect(coords(m, 4)).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]])
  })

  it('triangle: pixel centres exactly on the diagonal edge are excluded', () => {
    const m = lassoMask(4, 4, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }])
    expect(coords(m, 4)).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2]])
  })

  it('fewer than 3 points selects nothing', () => {
    expect(sum(lassoMask(4, 4, []))).toBe(0)
    expect(sum(lassoMask(4, 4, [{ x: 0, y: 0 }, { x: 3, y: 3 }]))).toBe(0)
  })
})

describe('medianDenoise', () => {
  it('collapses an isolated noise pixel to the exact surrounding tone', () => {
    const b = solid(3, 3, GRAY)
    b.set(WHITE, (1 * 3 + 1) * 4) // white speck in the centre
    const out = medianDenoise(b, 3, 3)
    for (let i = 0; i < 9; i++) expect(Array.from(out.slice(i * 4, i * 4 + 4))).toEqual([128, 128, 128, 255])
  })

  it('preserves a sharp two-tone edge (no blending)', () => {
    const b = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) b.set(x < 2 ? [0, 0, 0, 255] : WHITE, (y * 4 + x) * 4)
    expect(Array.from(medianDenoise(b, 4, 4))).toEqual(Array.from(b))
  })

  it('leaves transparent pixels and sparse neighbourhoods untouched', () => {
    const b = img(3, 3, { '1,1': RED }) // lone opaque pixel: 1 opaque neighbour < 3
    const out = medianDenoise(b, 3, 3)
    expect(Array.from(out)).toEqual(Array.from(b))
    expect(pxAt(out, 3, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('does not mutate the input region', () => {
    const b = solid(3, 3, GRAY)
    b.set(WHITE, (1 * 3 + 1) * 4)
    medianDenoise(b, 3, 3)
    expect(pxAt(b, 3, 1, 1)).toEqual([255, 255, 255, 255])
  })
})
