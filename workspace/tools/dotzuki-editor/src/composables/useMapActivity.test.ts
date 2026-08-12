import { setActivePinia, createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useMapActivity,
  splitCollisionLayer,
  withCollisionLayer,
  type TmxMap,
  type TmxLayer,
} from './useMapActivity'

// A 2×2 map with two distinct paint layers so resize offsets are observable:
//   ground:  1 2 / 3 4    overlay: 0 1 / 0 0
// (Collision is NOT a layer here — it's a standalone grid set via the store.)
function makeMap(): TmxMap {
  return {
    width: 2,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      { name: 'ground', width: 2, height: 2, type: 'tilelayer', data: [1, 2, 3, 4] },
      { name: 'overlay', width: 2, height: 2, type: 'tilelayer', data: [0, 1, 0, 0] },
    ],
  }
}

describe('useMapActivity.resizeMap', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('grows top-left: old content stays at origin, new space is empty', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.resizeMap(3, 3, 'left', 'top')).toBe(true)
    expect(store.tmx!.width).toBe(3)
    expect(store.tmx!.height).toBe(3)
    expect(store.tmx!.layers[0].width).toBe(3)
    expect(store.tmx!.layers[0].data).toEqual([1, 2, 0, 3, 4, 0, 0, 0, 0])
    // every layer is re-flowed, not just the ground one
    expect(store.tmx!.layers[1].data).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('grows bottom-right: new space is added on the top/left', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.resizeMap(4, 4, 'right', 'bottom')).toBe(true)
    expect(store.tmx!.layers[0].data).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 1, 2,
      0, 0, 3, 4,
    ])
  })

  it('shrinks: cells outside the new bounds are cropped', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    // anchor top-left → keep the top-left 1×1 cell
    expect(store.resizeMap(1, 1, 'left', 'top')).toBe(true)
    expect(store.tmx!.width).toBe(1)
    expect(store.tmx!.layers[0].data).toEqual([1])
  })

  it('shifts NPCs and warps by the anchor offset', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.objects = { npcs: [{ id: 1, x: 0, y: 0 }], warps: [{ x: 1, y: 1 }] }
    store.resizeMap(4, 4, 'right', 'bottom') // offset (2,2)
    expect(store.objects!.npcs[0]).toMatchObject({ x: 2, y: 2 })
    expect(store.objects!.warps[0]).toMatchObject({ x: 3, y: 3 })
    expect(store.objectsDirty).toBe(true)
  })

  it('clamps to [1, 512] and is a no-op when the size is unchanged', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.resizeMap(2, 2)).toBe(false) // unchanged
    expect(store.resizeMap(99999, 1, 'left', 'top')).toBe(true)
    expect(store.tmx!.width).toBe(512)
    expect(store.tmx!.height).toBe(1)
  })

  it('is undoable and redoable as a single step', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.resizeMap(4, 4, 'right', 'bottom')
    expect(store.canUndo).toBe(true)

    // Undo restores the original dimensions and every layer's data.
    store.undo()
    expect(store.tmx!.width).toBe(2)
    expect(store.tmx!.height).toBe(2)
    expect(store.tmx!.layers[0].width).toBe(2)
    expect(store.tmx!.layers[0].data).toEqual([1, 2, 3, 4])
    expect(store.tmx!.layers[1].data).toEqual([0, 1, 0, 0])
    expect(store.canRedo).toBe(true)

    // Redo re-applies the resize exactly.
    store.redo()
    expect(store.tmx!.width).toBe(4)
    expect(store.tmx!.layers[0].data).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 1, 2,
      0, 0, 3, 4,
    ])
  })

  it('undo of a resize moves entities back to where they were', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.objects = { npcs: [{ id: 1, x: 0, y: 0 }], warps: [{ x: 1, y: 1 }] }
    store.resizeMap(4, 4, 'right', 'bottom') // offset (2,2)
    expect(store.objects!.npcs[0]).toMatchObject({ x: 2, y: 2 })
    store.undo()
    expect(store.objects!.npcs[0]).toMatchObject({ x: 0, y: 0 })
    expect(store.objects!.warps[0]).toMatchObject({ x: 1, y: 1 })
    store.redo()
    expect(store.objects!.npcs[0]).toMatchObject({ x: 2, y: 2 })
  })

  it('keeps paint-stroke history alongside a resize (independent undo steps)', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    // Stroke first, then resize: two distinct undo steps.
    store.beginStroke(0)
    store.setCell(0, 0, 0, 9)
    store.endStroke()
    store.resizeMap(3, 3, 'left', 'top')

    // First undo reverts only the resize…
    store.undo()
    expect(store.tmx!.width).toBe(2)
    expect(store.tmx!.layers[0].data).toEqual([9, 2, 3, 4])
    expect(store.canUndo).toBe(true)
    // …the second reverts the stroke.
    store.undo()
    expect(store.tmx!.layers[0].data).toEqual([1, 2, 3, 4])
    expect(store.canUndo).toBe(false)
  })

  it('returns false (no throw) for non-finite dimensions', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.resizeMap(NaN, 5)).toBe(false)
    // map is untouched
    expect(store.tmx!.width).toBe(2)
    expect(store.tmx!.layers[0].data).toEqual([1, 2, 3, 4])
  })

  it('returns false when no map is loaded', () => {
    const store = useMapActivity()
    expect(store.resizeMap(10, 10)).toBe(false)
  })
})

describe('useMapActivity layers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('addLayer appends an empty layer sized to the map and makes it active', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.layerVisible = [true, true]
    const idx = store.addLayer()
    expect(idx).toBe(2)
    expect(store.layers.length).toBe(3)
    const layer = store.tmx!.layers[2]
    expect(layer.width).toBe(2)
    expect(layer.height).toBe(2)
    expect(layer.data).toEqual([0, 0, 0, 0])
    expect(layer.name).toBe('layer3')
    expect(store.activeLayer).toBe(2)
    expect(store.layerVisible.length).toBe(3)
    expect(store.dirty).toBe(true)
  })

  it('removeLayer drops the layer + visibility entry and re-points the active layer', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.layerVisible = [true, true]
    store.activeLayer = 1
    expect(store.removeLayer(0)).toBe(true)
    expect(store.layers.length).toBe(1)
    expect(store.tmx!.layers[0].name).toBe('overlay')
    expect(store.layerVisible.length).toBe(1)
    // active (1) was above the removed index (0) → shifts down to 0
    expect(store.activeLayer).toBe(0)
  })

  it('removeLayer refuses to remove the last remaining layer', () => {
    const store = useMapActivity()
    const m = makeMap()
    m.layers = [m.layers[0]]
    store.tmx = m
    expect(store.removeLayer(0)).toBe(false)
    expect(store.layers.length).toBe(1)
  })

  it('removeLayer clears undo history (later indices shift)', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.layerVisible = [true, true]
    store.beginStroke(0)
    store.setCell(0, 0, 0, 7)
    store.endStroke()
    expect(store.canUndo).toBe(true)
    store.removeLayer(1)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })

  it('moveLayer reorders layers + visibility and follows the active layer', () => {
    const store = useMapActivity()
    store.tmx = makeMap() // [ground, overlay]
    store.layerVisible = [true, false]
    store.activeLayer = 0
    // Move ground (0) below overlay → [overlay, ground]
    expect(store.moveLayer(0, 1)).toBe(true)
    expect(store.tmx!.layers.map(l => l.name)).toEqual(['overlay', 'ground'])
    // visibility moved with its layer (ground's `true` is now at index 1)
    expect(store.layerVisible).toEqual([false, true])
    // active followed ground from 0 → 1
    expect(store.activeLayer).toBe(1)
  })

  it('moveLayer shifts a bystander active layer by one', () => {
    const store = useMapActivity()
    const m = makeMap()
    m.layers = [
      { name: 'a', width: 2, height: 2, type: 'tilelayer', data: [0, 0, 0, 0] },
      { name: 'b', width: 2, height: 2, type: 'tilelayer', data: [0, 0, 0, 0] },
      { name: 'c', width: 2, height: 2, type: 'tilelayer', data: [0, 0, 0, 0] },
    ]
    store.tmx = m
    store.layerVisible = [true, true, true]
    store.activeLayer = 2 // 'c'
    // Move 'a' (0) to index 1 → [b, a, c]; active 'c' shifts 2 → ... unchanged?
    store.moveLayer(0, 1)
    expect(store.tmx!.layers.map(l => l.name)).toEqual(['b', 'a', 'c'])
    expect(store.activeLayer).toBe(2) // 'c' still last
  })

  it('moveLayer clamps the target and is a no-op at the boundary', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.moveLayer(0, -1)).toBe(false) // already first
    expect(store.moveLayer(1, 5)).toBe(false) // already last (clamped to 1)
    expect(store.tmx!.layers.map(l => l.name)).toEqual(['ground', 'overlay'])
  })

  it('moveLayer clears undo history (indices shuffle)', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.layerVisible = [true, true]
    store.beginStroke(0)
    store.setCell(0, 0, 0, 7)
    store.endStroke()
    expect(store.canUndo).toBe(true)
    store.moveLayer(0, 1)
    expect(store.canUndo).toBe(false)
  })

  it('renameLayer sets a trimmed name and marks the map dirty', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.renameLayer(0, '  背景  ')).toBe(true)
    expect(store.tmx!.layers[0].name).toBe('背景')
    expect(store.dirty).toBe(true)
  })

  it('renameLayer rejects blank, the reserved "collision" name, duplicates, and no-ops', () => {
    const store = useMapActivity()
    store.tmx = makeMap() // ['ground', 'overlay']
    expect(store.renameLayer(0, '   ')).toBe(false) // blank
    expect(store.renameLayer(0, 'collision')).toBe(false) // reserved
    expect(store.renameLayer(0, 'collision1')).toBe(false) // reserved (level 1)
    expect(store.renameLayer(0, 'stairs')).toBe(false) // reserved
    expect(store.renameLayer(0, 'overlay')).toBe(false) // duplicate of layer 1
    expect(store.renameLayer(0, 'ground')).toBe(false) // unchanged
    expect(store.tmx!.layers[0].name).toBe('ground')
    expect(store.renameLayer(5, 'x')).toBe(false) // out of range
  })
})

describe('collision/stairs (de)serialization helpers', () => {
  const layer = (name: string, data: number[]): TmxLayer =>
    ({ name, width: 2, height: 2, type: 'tilelayer', data })

  it('splitCollisionLayer pulls the collision layer out of the paint layers', () => {
    const { paint, collisionLevels, stairs } = splitCollisionLayer([
      layer('ground', [1, 2, 3, 4]),
      layer('collision', [0, 1, 0, 1]),
    ])
    expect(paint.map(l => l.name)).toEqual(['ground'])
    expect(collisionLevels[0]).toEqual([0, 1, 0, 1])
    expect(stairs).toBeNull()
  })

  it('splitCollisionLayer returns empty levels / null stairs when absent', () => {
    const { paint, collisionLevels, stairs } = splitCollisionLayer([layer('ground', [1, 2, 3, 4])])
    expect(paint.map(l => l.name)).toEqual(['ground'])
    expect(collisionLevels).toEqual([])
    expect(stairs).toBeNull()
  })

  it('splitCollisionLayer recognizes collisionN levels and the stairs layer', () => {
    const { paint, collisionLevels, stairs } = splitCollisionLayer([
      layer('ground', [1, 2, 3, 4]),
      layer('collision', [0, 1, 0, 1]),
      layer('deco', [0, 0, 0, 0]),
      layer('collision1', [1, 0, 0, 0]),
      layer('collision2', [0, 0, 1, 0]),
      layer('stairs', [0, 0, 1, 2]),
    ])
    expect(paint.map(l => l.name)).toEqual(['ground', 'deco'])
    expect(collisionLevels[0]).toEqual([0, 1, 0, 1])
    expect(collisionLevels[1]).toEqual([1, 0, 0, 0])
    expect(collisionLevels[2]).toEqual([0, 0, 1, 0])
    expect(stairs).toEqual([0, 0, 1, 2])
  })

  it('withCollisionLayer re-appends a collision layer; round-trips with split', () => {
    const original = [layer('ground', [1, 2, 3, 4]), layer('collision', [0, 1, 0, 1])]
    const { paint, collisionLevels, stairs } = splitCollisionLayer(original)
    const rebuilt = withCollisionLayer(paint, collisionLevels, stairs, 2, 2)
    expect(rebuilt.map(l => l.name)).toEqual(['ground', 'collision'])
    expect(rebuilt[1].data).toEqual([0, 1, 0, 1])
    expect(rebuilt[1]).toMatchObject({ width: 2, height: 2, type: 'tilelayer' })
  })

  it('multi-level round-trip: paint layers, then collision levels, then stairs last', () => {
    const original = [
      layer('ground', [1, 2, 3, 4]),
      layer('collision', [0, 1, 0, 1]),
      layer('collision1', [1, 0, 0, 0]),
      layer('stairs', [0, 0, 1, 2]),
    ]
    const { paint, collisionLevels, stairs } = splitCollisionLayer(original)
    const rebuilt = withCollisionLayer(paint, collisionLevels, stairs, 2, 2)
    expect(rebuilt.map(l => l.name)).toEqual(['ground', 'collision', 'collision1', 'stairs'])
    expect(rebuilt.map(l => l.data)).toEqual(original.map(l => l.data))
  })

  it('withCollisionLayer skips null levels but keeps later ones', () => {
    const rebuilt = withCollisionLayer(
      [layer('ground', [1, 2, 3, 4])],
      [null, [1, 0, 0, 0]],
      null,
      2, 2,
    )
    expect(rebuilt.map(l => l.name)).toEqual(['ground', 'collision1'])
  })

  it('withCollisionLayer omits the layers entirely when there are no grids', () => {
    const rebuilt = withCollisionLayer([layer('ground', [1, 2, 3, 4])], [], null, 2, 2)
    expect(rebuilt.map(l => l.name)).toEqual(['ground'])
  })
})

describe('useMapActivity collision grid', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('toggleCollision lazily creates the grid, flips a cell, and is undoable', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.collision).toBeNull()
    expect(store.hasCollision).toBe(false)

    store.toggleCollision(1, 0) // index 1
    expect(store.collision).toEqual([0, 1, 0, 0])
    expect(store.hasCollision).toBe(true)
    expect(store.canUndo).toBe(true)

    store.toggleCollision(1, 0) // flip back off
    expect(store.collision).toEqual([0, 0, 0, 0])

    store.undo()
    expect(store.collision).toEqual([0, 1, 0, 0])
    store.undo()
    expect(store.collision).toEqual([0, 0, 0, 0])
  })

  it('resize re-flows the collision grid and undo restores it', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.collision = [0, 1, 0, 0] // solid at (1,0)
    store.resizeMap(3, 3, 'left', 'top')
    expect(store.collision).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0])
    store.undo()
    expect(store.collision).toEqual([0, 1, 0, 0])
    store.redo()
    expect(store.collision).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('toggleCollision paints per level, lazily creating collisionN grids', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.levelCount).toBe(1)

    store.toggleCollision(1, 0, 1) // level 1, index 1
    expect(store.collisionLevels[0] ?? null).toBeNull()
    expect(store.collisionLevels[1]).toEqual([0, 1, 0, 0])
    expect(store.levelCount).toBe(2)
    // Level 0 is untouched by the level-1 paint.
    store.toggleCollision(0, 0, 0)
    expect(store.collision).toEqual([1, 0, 0, 0])
    expect(store.collisionLevels[1]).toEqual([0, 1, 0, 0])

    // Undo is per level: the level-1 toggle is two steps back.
    store.undo() // reverts level 0 toggle
    expect(store.collision).toEqual([0, 0, 0, 0])
    expect(store.collisionLevels[1]).toEqual([0, 1, 0, 0])
    store.undo() // reverts level 1 toggle
    expect(store.collisionLevels[1]).toEqual([0, 0, 0, 0])
    store.redo()
    expect(store.collisionLevels[1]).toEqual([0, 1, 0, 0])
  })

  it('resize re-flows every collision level and the stairs grid', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.collisionLevels = [[0, 1, 0, 0], [1, 0, 0, 0]]
    store.stairsGrid = [0, 0, 0, 2]
    store.resizeMap(3, 3, 'left', 'top')
    expect(store.collisionLevels[0]).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0])
    expect(store.collisionLevels[1]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(store.stairsGrid).toEqual([0, 0, 0, 0, 2, 0, 0, 0, 0])
    store.undo()
    expect(store.collisionLevels[0]).toEqual([0, 1, 0, 0])
    expect(store.collisionLevels[1]).toEqual([1, 0, 0, 0])
    expect(store.stairsGrid).toEqual([0, 0, 0, 2])
  })
})

describe('useMapActivity stairs grid', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('setStair lazily creates the grid, paints up/down/clear, and is undoable', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.stairsGrid).toBeNull()

    store.setStair(1, 0, 1) // ascend at (1,0)
    expect(store.stairsGrid).toEqual([0, 1, 0, 0])
    store.setStair(0, 1, 2) // descend at (0,1)
    expect(store.stairsGrid).toEqual([0, 1, 2, 0])
    store.setStair(1, 0, 0) // clear (1,0)
    expect(store.stairsGrid).toEqual([0, 0, 2, 0])

    // Painting the same value is a no-op (no extra undo step).
    store.setStair(0, 1, 2)
    expect(store.stairsGrid).toEqual([0, 0, 2, 0])

    store.undo() // reverts the clear
    expect(store.stairsGrid).toEqual([0, 1, 2, 0])
    store.undo() // reverts the descend
    expect(store.stairsGrid).toEqual([0, 1, 0, 0])
    store.redo()
    expect(store.stairsGrid).toEqual([0, 1, 2, 0])
  })

  it('load→save round-trips collisionN + stairs layers (split/stitch)', () => {
    // Pure-helper round trip mirroring loadMap → saveMap.
    const layer = (name: string, data: number[]): TmxLayer =>
      ({ name, width: 2, height: 2, type: 'tilelayer', data })
    const original = [
      layer('ground', [1, 2, 3, 4]),
      layer('collision', [0, 1, 0, 1]),
      layer('collision1', [1, 0, 0, 0]),
      layer('stairs', [0, 0, 1, 2]),
    ]
    const { paint, collisionLevels, stairs } = splitCollisionLayer(original)
    const rebuilt = withCollisionLayer(paint, collisionLevels, stairs, 2, 2)
    expect(rebuilt.map(l => l.name)).toEqual(['ground', 'collision', 'collision1', 'stairs'])
  })
})

describe('useMapActivity layer elevation level', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('layerLevel defaults to 0; setLayerLevel writes a Tiled int property', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    expect(store.layerLevel(0)).toBe(0)

    expect(store.setLayerLevel(0, 2)).toBe(true)
    expect(store.tmx!.layers[0].properties).toEqual([{ name: 'level', type: 'int', value: 2 }])
    expect(store.layerLevel(0)).toBe(2)
    expect(store.dirty).toBe(true)

    expect(store.setLayerLevel(0, 1)).toBe(true)
    expect(store.tmx!.layers[0].properties).toEqual([{ name: 'level', type: 'int', value: 1 }])
  })

  it('setLayerLevel(0) removes the property to keep files clean', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.setLayerLevel(1, 3)
    expect(store.layerLevel(1)).toBe(3)
    expect(store.setLayerLevel(1, 0)).toBe(true)
    expect(store.tmx!.layers[1].properties).toEqual([])
    expect(store.layerLevel(1)).toBe(0)
  })

  it('setLayerLevel is a no-op when unchanged and reads existing properties', () => {
    const store = useMapActivity()
    const m = makeMap()
    m.layers[0].properties = [{ name: 'level', type: 'int', value: 1 }, { name: 'other', type: 'string', value: 'x' }]
    store.tmx = m
    expect(store.layerLevel(0)).toBe(1)
    expect(store.setLayerLevel(0, 1)).toBe(false) // unchanged
    expect(store.setLayerLevel(0, 2)).toBe(true)
    // Other custom properties are preserved.
    expect(m.layers[0].properties).toEqual([
      { name: 'level', type: 'int', value: 2 },
      { name: 'other', type: 'string', value: 'x' },
    ])
    expect(store.setLayerLevel(9, 1)).toBe(false) // out of range
  })
})


describe('useMapActivity entity sidecar (objects.json) signs', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  function mockObjectsFetch(status: number, body?: unknown) {
    const calls: { url: string; method: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body })
      return new Response(JSON.stringify(body ?? {}), { status })
    }))
    return calls
  }

  it('loadObjects brings signs out explicitly and preserves unknown keys', async () => {
    mockObjectsFetch(200, {
      npcs: [{ id: 1, x: 2, y: 3 }],
      signs: [{ x: 13, y: 9, text: 'hello' }],
      collision: [0, 1], // legacy unknown key, passed through untouched
    })
    const store = useMapActivity()
    await store.loadObjects('TestMap')
    expect(store.objects!.signs).toEqual([{ x: 13, y: 9, text: 'hello' }])
    expect(store.objects!.npcs).toHaveLength(1)
    expect(store.objects!.warps).toEqual([])
    expect(store.objects!.collision).toEqual([0, 1])
    expect(store.objectsDirty).toBe(false)
  })

  it('loadObjects defaults signs to [] when absent (and on 404)', async () => {
    mockObjectsFetch(200, { npcs: [], warps: [] })
    const store = useMapActivity()
    await store.loadObjects('TestMap')
    expect(store.objects!.signs).toEqual([])

    mockObjectsFetch(404)
    await store.loadObjects('Nope')
    expect(store.objects).toEqual({ npcs: [], warps: [], signs: [] })
  })

  it('saveObjects round-trips signs (and unknown keys) back to the server', async () => {
    const calls = mockObjectsFetch(200, {
      npcs: [],
      warps: [],
      signs: [{ x: 13, y: 9, text: 'hello' }],
      collision: [1, 0],
    })
    const store = useMapActivity()
    await store.loadObjects('TestMap')
    store.mapName = 'TestMap'

    const i = store.addSign(1, 1)
    expect(i).toBe(1)
    expect(store.objectsDirty).toBe(true)

    await store.saveObjects()
    const put = calls.find(c => c.method === 'PUT')
    expect(put?.url).toBe('/api/maps/TestMap/objects.json')
    expect(JSON.parse(put!.body!)).toEqual({
      npcs: [],
      warps: [],
      signs: [
        { x: 13, y: 9, text: 'hello' },
        { x: 1, y: 1, text: '' },
      ],
      collision: [1, 0],
    })
    expect(store.objectsDirty).toBe(false)
  })

  it('addSign / removeSign mutate the list and mark the sidecar dirty', () => {
    const store = useMapActivity()
    store.objects = { npcs: [], warps: [] } // no signs yet — lazily created
    expect(store.addSign(4, 5)).toBe(0)
    expect(store.objects!.signs).toEqual([{ x: 4, y: 5, text: '' }])
    expect(store.objectsDirty).toBe(true)
    store.removeSign(0)
    expect(store.objects!.signs).toEqual([])
  })

  it('resize shifts signs along with NPCs and warps', () => {
    const store = useMapActivity()
    store.tmx = makeMap()
    store.objects = { npcs: [], warps: [], signs: [{ x: 0, y: 0, text: 'hi' }] }
    store.resizeMap(4, 4, 'right', 'bottom') // offset (2,2)
    expect(store.objects!.signs![0]).toMatchObject({ x: 2, y: 2 })
    store.undo()
    expect(store.objects!.signs![0]).toMatchObject({ x: 0, y: 0 })
  })
})
