// Sidecar (de)serialization — environment is node, so the canvas/Image bits are
// stubbed with minimal stand-ins; what runs for real is the doc-shape mapping,
// validation, defaulting and id-reminting logic (vue's markRaw works in node).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { serializeLayers, hydrateFromSidecar } from './sidecar'
import type { Layer } from './types'
import type { SidecarDoc, SidecarLayer } from '../../../composables/useTilesActivity'

afterEach(() => vi.unstubAllGlobals())

const PW = 2
const PH = 2

const mkLayer = (over: Partial<Layer> = {}): Layer => ({
  id: 'L1',
  name: '线稿',
  kind: 'raster',
  data: new Uint8ClampedArray(PW * PH * 4).fill(255),
  visible: true,
  opacity: 128,
  outline: '#111111',
  fill: '#eeeeee',
  width: 2,
  mode: 'ring',
  levels: 4,
  angle: 45,
  ...over,
})

/** Minimal canvas/ImageData stand-ins for serializeLayers. */
function stubSerializeDom(png = 'data:image/png;base64,MOCK') {
  const putImageData = vi.fn()
  const clearRect = vi.fn()
  const toDataURL = vi.fn(() => png)
  vi.stubGlobal('ImageData', class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  })
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ clearRect, putImageData }),
      toDataURL,
    }),
  })
  return { putImageData, clearRect, toDataURL }
}

/** Image + canvas stand-ins for hydrateFromSidecar's decode path; every layer
 *  decodes to a fresh copy of `pixels`. */
function stubHydrateDom(pixels: Uint8ClampedArray) {
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_v: string) {
      queueMicrotask(() => this.onload?.())
    }
  })
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        imageSmoothingEnabled: true,
        clearRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: pixels.slice() }),
      }),
    }),
  })
}

/** A doc whose layers may omit optional fields (as hand/old docs could). */
const mkDoc = (layers: Record<string, unknown>[]): SidecarDoc =>
  ({ v: 1, w: PW, h: PH, tileSize: 16, layers }) as unknown as SidecarDoc

const collect = () => {
  const box = { layers: [] as Layer[] }
  return { box, setLayers: (ls: Layer[]) => { box.layers = ls } }
}

describe('serializeLayers', () => {
  it('snapshots the geometry and one entry per layer', () => {
    stubSerializeDom()
    const doc = serializeLayers([mkLayer(), mkLayer({ id: 'L2' })], PW, PH, 16)
    expect(doc.v).toBe(1)
    expect(doc.w).toBe(PW)
    expect(doc.h).toBe(PH)
    expect(doc.tileSize).toBe(16)
    expect(doc.layers.map((l) => l.id)).toEqual(['L1', 'L2'])
  })

  it('copies layer params and normalizes opacity to 0..1', () => {
    stubSerializeDom()
    const doc = serializeLayers([mkLayer({ kind: 'contour', visible: false, opacity: 128 })], PW, PH, 16)
    const sl = doc.layers[0]
    expect(sl.name).toBe('线稿')
    expect(sl.kind).toBe('contour')
    expect(sl.visible).toBe(false)
    expect(sl.opacity).toBeCloseTo(128 / 255, 5)
    expect(sl.outline).toBe('#111111')
    expect(sl.fill).toBe('#eeeeee')
    expect(sl.width).toBe(2)
    expect(sl.mode).toBe('ring')
    expect(sl.levels).toBe(4)
    expect(sl.angle).toBe(45)
    expect(sl.png).toBe('data:image/png;base64,MOCK')
  })

  it('clears then puts a fresh copy of each layer buffer on the canvas', () => {
    const { putImageData, clearRect } = stubSerializeDom()
    const layer = mkLayer()
    serializeLayers([layer, mkLayer({ id: 'L2' })], PW, PH, 16)
    expect(clearRect).toHaveBeenCalledTimes(2)
    expect(putImageData).toHaveBeenCalledTimes(2)
    const imageData = putImageData.mock.calls[0][0] as { data: Uint8ClampedArray; width: number; height: number }
    expect(imageData.width).toBe(PW)
    expect(imageData.height).toBe(PH)
    expect(Array.from(imageData.data)).toEqual(Array.from(layer.data))
    expect(imageData.data).not.toBe(layer.data) // a copy, not the live buffer
  })
})

describe('hydrateFromSidecar', () => {
  it('rejects a dimension mismatch without touching the DOM', async () => {
    const { box, setLayers } = collect()
    expect(await hydrateFromSidecar(mkDoc([{ png: 'x' }]), PW + 1, PH, () => 'm', setLayers)).toBe(false)
    expect(await hydrateFromSidecar(mkDoc([{ png: 'x' }]), PW, PH + 1, () => 'm', setLayers)).toBe(false)
    expect(box.layers).toEqual([])
  })

  it('rejects empty or malformed docs', async () => {
    const { box, setLayers } = collect()
    expect(await hydrateFromSidecar(mkDoc([]), PW, PH, () => 'm', setLayers)).toBe(false)
    expect(await hydrateFromSidecar({ v: 1, w: PW, h: PH, layers: 'nope' } as unknown as SidecarDoc, PW, PH, () => 'm', setLayers)).toBe(false)
    expect(await hydrateFromSidecar(null as unknown as SidecarDoc, PW, PH, () => 'm', setLayers)).toBe(false)
    expect(box.layers).toEqual([])
  })

  it('returns false when a layer PNG fails to decode', async () => {
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.())
      }
    })
    const { box, setLayers } = collect()
    expect(await hydrateFromSidecar(mkDoc([{ id: 'a', png: 'data:broken' }]), PW, PH, () => 'm', setLayers)).toBe(false)
    expect(box.layers).toEqual([])
  })

  it('rebuilds layers, applying defaults for missing params', async () => {
    stubHydrateDom(new Uint8ClampedArray(PW * PH * 4).fill(7))
    const { box, setLayers } = collect()
    const ok = await hydrateFromSidecar(mkDoc([{ id: 'a', png: 'data:x' }]), PW, PH, () => 'minted', setLayers)
    expect(ok).toBe(true)
    expect(box.layers).toHaveLength(1)
    const L = box.layers[0]
    expect(L.id).toBe('a')
    expect(L.name).toBe('图层')
    expect(L.kind).toBe('raster')
    expect(L.visible).toBe(true)
    expect(L.opacity).toBe(255)
    expect(L.outline).toBe('#1c1c1c')
    expect(L.fill).toBe('#ffffff')
    expect(L.width).toBe(1)
    expect(L.mode).toBe('flat')
    expect(L.levels).toBe(3)
    expect(L.angle).toBe(135)
    expect(Array.from(L.data)).toEqual(new Array(PW * PH * 4).fill(7))
  })

  it('clamps and rescales 0..1 opacity into 0..255', async () => {
    stubHydrateDom(new Uint8ClampedArray(PW * PH * 4))
    const { box, setLayers } = collect()
    const doc = mkDoc([
      { id: 'a', opacity: 0.5, png: 'x' },
      { id: 'b', opacity: 2, png: 'x' },
      { id: 'c', opacity: -1, png: 'x' },
    ])
    await hydrateFromSidecar(doc, PW, PH, () => 'm', setLayers)
    expect(box.layers.map((l) => l.opacity)).toEqual([128, 255, 0])
  })

  it('keeps contour kind and explicit params; unknown kinds become raster', async () => {
    stubHydrateDom(new Uint8ClampedArray(PW * PH * 4))
    const { box, setLayers } = collect()
    const doc = mkDoc([
      {
        id: 'a', name: '勾填', kind: 'contour', visible: false,
        outline: '#abcabc', fill: '#defdef', width: 3,
        mode: 'directional', levels: 5, angle: 90, png: 'x',
      },
      { id: 'b', kind: 'weird', png: 'x' },
    ])
    await hydrateFromSidecar(doc, PW, PH, () => 'm', setLayers)
    expect(box.layers[0]).toMatchObject({
      name: '勾填', kind: 'contour', visible: false,
      outline: '#abcabc', fill: '#defdef', width: 3,
      mode: 'directional', levels: 5, angle: 90,
    })
    expect(box.layers[1].kind).toBe('raster')
  })

  it('remints empty or duplicate layer ids so buffers cannot alias', async () => {
    stubHydrateDom(new Uint8ClampedArray(PW * PH * 4))
    const { box, setLayers } = collect()
    const doc = mkDoc([{ id: 'dup', png: 'x' }, { id: 'dup', png: 'x' }, { id: '', png: 'x' }])
    let n = 0
    await hydrateFromSidecar(doc, PW, PH, () => `m${++n}`, setLayers)
    expect(box.layers.map((l) => l.id)).toEqual(['dup', 'm1', 'm2']) // first occurrence keeps its id
  })
})

describe('serialize → hydrate round-trip', () => {
  it('preserves layer metadata through the sidecar doc', async () => {
    stubSerializeDom()
    const doc = serializeLayers(
      [
        mkLayer({ id: 'L1', opacity: 255 }),
        mkLayer({ id: 'L2', kind: 'contour', visible: false, opacity: 128, mode: 'flat', levels: 3, angle: 135 }),
      ],
      PW, PH, 16,
    )
    stubHydrateDom(new Uint8ClampedArray(PW * PH * 4).fill(3))
    const { box, setLayers } = collect()
    const ok = await hydrateFromSidecar(doc, PW, PH, () => 'minted', setLayers)
    expect(ok).toBe(true)
    expect(box.layers.map((l) => l.id)).toEqual(['L1', 'L2'])
    expect(box.layers.map((l) => l.name)).toEqual(['线稿', '线稿'])
    expect(box.layers.map((l) => l.kind)).toEqual(['raster', 'contour'])
    expect(box.layers.map((l) => l.visible)).toEqual([true, false])
    expect(box.layers.map((l) => l.opacity)).toEqual([255, 128])
    expect(box.layers.map((l) => l.mode)).toEqual(['ring', 'flat'])
    expect(box.layers[0].outline).toBe('#111111')
    expect(box.layers[0].levels).toBe(4)
    expect(box.layers[0].angle).toBe(45)
  })
})
