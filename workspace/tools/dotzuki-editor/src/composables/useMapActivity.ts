import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ───────────────────────────────────────────────────────────────────────────
// Map activity store — TMX tile-painting editor state, load/save, undo/redo.
//
// Maps are Tiled-format `map.tmx.json` + a per-map `tileset.png`, served by the
// dev server under `/api/maps/{name}/…`. We preserve all unknown top-level keys
// and extra layer fields on save: only `layers[i].data` is mutated in place on
// the originally-parsed object, then the whole object is PUT back.
// ───────────────────────────────────────────────────────────────────────────

/** A directory/file entry from `GET /api/maps`. */
export interface MapFileEntry {
  name: string
  isDir: boolean
  size: number
  /** Map dir has an authored tilemap (`map.tmx.json`). */
  hasTilemap?: boolean
  /** Map dir has an AI art-reference image (`source.png`) usable as a backdrop. */
  hasBackdrop?: boolean
}

/** One file that references a map by name (from `GET /api/maps-references`). */
export interface MapRef {
  file: string
  kind: string // 'warp' | 'scene' | 'quest'
  count: number
}

/** One entry in a Tiled layer's custom `properties` array. */
export interface TmxLayerProperty {
  name: string
  type: string
  value: unknown
  [k: string]: unknown
}

/** A single TMX layer. Only `name`/`width`/`height`/`data` are required; any
 *  other fields (visible, opacity, type, …) are preserved untouched on save. */
export interface TmxLayer {
  name: string
  width: number
  height: number
  data: number[]
  visible?: boolean
  opacity?: number
  type?: string
  properties?: TmxLayerProperty[]
  [k: string]: unknown
}

/** The TMX map object. Unknown top-level keys (e.g. `tilesets`) are preserved. */
export interface TmxMap {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  layers: TmxLayer[]
  [k: string]: unknown
}

/** A placed NPC in the per-map `objects.json` sidecar. */
export interface NpcDef {
  id: number
  name?: string
  x: number
  y: number
  facing?: string
  sprite?: string
  talk?: string
  [k: string]: unknown
}

/** A warp tile in `objects.json`. */
export interface WarpDef {
  x: number
  y: number
  dest_map?: string
  dest_x?: number
  dest_y?: number
  [k: string]: unknown
}

/** A readable signpost in `objects.json` — plain text, no bilingual tag. */
export interface SignDef {
  x: number
  y: number
  text: string
  [k: string]: unknown
}

/** The per-map entity sidecar (`objects.json`). Unknown keys (e.g. a legacy
 *  `collision` grid) are preserved untouched on save. */
export interface MapObjects {
  npcs: NpcDef[]
  warps: WarpDef[]
  signs?: SignDef[]
  [k: string]: unknown
}

/** A structural snapshot for resize undo: map dimensions, per-layer (by index)
 *  data + size, the per-level collision grids, and the stairs grid. Layer
 *  metadata (name/type/…) is unchanged by a resize, so only the size-bearing
 *  fields are captured. */
interface MapShape {
  width: number
  height: number
  layers: { data: number[]; width: number; height: number }[]
  collisionLevels: (number[] | null)[]
  stairs: number[] | null
}

/** One reversible edit on the undo/redo stacks.
 *  - `cells`: one paint layer's data before/after a stroke (cheap, common).
 *  - `collision`: one elevation level's collision grid before/after a toggle.
 *  - `stairs`: the stairs grid before/after a stair paint.
 *  - `resize`: the whole-map structural change — every layer's data, the
 *    collision grids, the stairs grid, and the map dimensions — plus the
 *    (dx,dy) it translated entities by, so undo can put them back. */
type HistoryEntry =
  | { kind: 'cells'; layerIndex: number; before: number[]; after: number[] }
  | { kind: 'collision'; level: number; before: number[]; after: number[] }
  | { kind: 'stairs'; before: number[]; after: number[] }
  | { kind: 'resize'; before: MapShape; after: MapShape; dx: number; dy: number }

const HISTORY_LIMIT = 50
const COLLISION_LAYER = 'collision'
/** Collision layers above ground level are named `collision1`, `collision2`, … */
const COLLISION_LAYER_RE = /^collision([1-9]\d*)?$/
const STAIRS_LAYER = 'stairs'
/** Max map dimension in tiles — mirrors the server's create/create-tmx clamp. */
const MAX_MAP_DIM = 512

/** Where existing content is anchored when the canvas grows/shrinks. */
export type AnchorX = 'left' | 'center' | 'right'
export type AnchorY = 'top' | 'middle' | 'bottom'

// ── Collision/stairs (de)serialization ───────────────────────────────────────
// On disk, elevation data lives in named TMX layers — the contract the game
// runtime reads (wuxia_map.rs / dotzuki-runner):
//   - `collision`, `collision1`, `collision2`, … : per-elevation-level solid
//     grids (non-zero GID ⇒ solid at that level; `collision` = level 0).
//   - `stairs`: 1 = ascend one level, 2 = descend one level, 0 = not a stair.
// None of these are rendered. In the editor we keep them as standalone grids,
// NOT paint layers, so they can't be selected, renamed, or removed like one.
// These pure helpers split them out on load and stitch them back in on save.

/** Elevation data pulled out of a TMX's layer list. */
export interface SplitLayers {
  paint: TmxLayer[]
  /** Per-level collision grids; index = elevation level (0 = ground). */
  collisionLevels: (number[] | null)[]
  /** Stairs grid (1 = up, 2 = down), or null when absent. */
  stairs: number[] | null
}

/** Split a TMX's layers into paint layers + the per-level collision grids and
 *  stairs grid. Returns shallow copies; does not mutate. */
export function splitCollisionLayer(layers: TmxLayer[]): SplitLayers {
  const paint: TmxLayer[] = []
  const collisionLevels: (number[] | null)[] = []
  let stairs: number[] | null = null
  for (const layer of layers) {
    if (layer.name === STAIRS_LAYER) {
      stairs = (layer.data ?? []).slice()
      continue
    }
    const m = COLLISION_LAYER_RE.exec(layer.name)
    if (m) {
      collisionLevels[m[1] ? parseInt(m[1], 10) : 0] = (layer.data ?? []).slice()
      continue
    }
    paint.push(layer)
  }
  return { paint, collisionLevels, stairs }
}

/** Rebuild the on-disk layer list: paint layers, then every existing collision
 *  level (`collision`, `collision1`, …), then the `stairs` layer last — the
 *  deterministic order the runtime expects. Levels with no grid are skipped. */
export function withCollisionLayer(
  paint: TmxLayer[],
  collisionLevels: (number[] | null)[],
  stairs: number[] | null,
  width: number,
  height: number,
): TmxLayer[] {
  const out = paint.slice()
  collisionLevels.forEach((grid, level) => {
    if (!grid) return
    out.push({
      name: level === 0 ? COLLISION_LAYER : `${COLLISION_LAYER}${level}`,
      width, height, visible: true, opacity: 1, type: 'tilelayer', data: grid,
    })
  })
  if (stairs) {
    out.push({ name: STAIRS_LAYER, width, height, visible: true, opacity: 1, type: 'tilelayer', data: stairs })
  }
  return out
}

export const useMapActivity = defineStore('mapActivity', () => {
  // ── Map list ──
  const mapList = ref<MapFileEntry[]>([])
  const loadingList = ref(false)

  // ── Active map ──
  const mapName = ref<string>('')
  const tmx = ref<TmxMap | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const error = ref<string | null>(null)

  /** Per-elevation-level collision grids (0 = walkable, non-zero = solid),
   *  `width*height` cells each; index = level (0 = ground), null = no data at
   *  that level. Kept separate from `tmx.layers`; serialized to/from the
   *  on-disk `collision`/`collision1`/… layers on save/load. */
  const collisionLevels = ref<(number[] | null)[]>([])
  /** Ground-level (level 0) collision grid — alias of `collisionLevels[0]`. */
  const collision = computed<number[] | null>({
    get: () => collisionLevels.value[0] ?? null,
    set: v => { collisionLevels.value[0] = v },
  })
  /** Stairs grid (1 = ascend one level, 2 = descend, 0 = not a stair),
   *  `width*height` cells, or null when the map has no stairs. Serialized
   *  to/from the on-disk `stairs` layer. */
  const stairsGrid = ref<number[] | null>(null)
  /** Number of elevation levels with collision data (at least 1). */
  const levelCount = computed(() => Math.max(collisionLevels.value.length, 1))

  // ── Entity sidecar (objects.json) ──
  const objects = ref<MapObjects | null>(null)
  const objectsDirty = ref(false)

  // ── Editor view-only state ──
  /** Active layer index for painting. */
  const activeLayer = ref(0)
  /** Per-layer visibility (editor-only; not persisted unless already in TMX). */
  const layerVisible = ref<boolean[]>([])
  /** Currently selected tile id from the palette (≥ 1). */
  const selectedTile = ref(1)

  // ── Undo / redo ──
  const undoStack = ref<HistoryEntry[]>([])
  const redoStack = ref<HistoryEntry[]>([])
  /** Snapshot of a layer's data taken at stroke start. */
  let strokeLayerIndex = -1
  let strokeBefore: number[] | null = null

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  const layers = computed<TmxLayer[]>(() => tmx.value?.layers ?? [])
  const hasCollision = computed(() => collision.value != null)

  // ── List ──
  async function fetchList(): Promise<void> {
    loadingList.value = true
    error.value = null
    try {
      const resp = await fetch('api/maps')
      if (!resp.ok) throw new Error('Failed to list maps')
      const entries = (await resp.json()) as MapFileEntry[]
      mapList.value = entries
        .filter(e => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to list maps'
      mapList.value = []
    } finally {
      loadingList.value = false
    }
  }

  // ── Create a blank flat-per-tile TMX map ──
  async function createTmxMap(name: string, width: number, height: number): Promise<boolean> {
    error.value = null
    try {
      const resp = await fetch('api/maps-create-tmx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, width, height }),
      })
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'Failed to create map')
      }
      await fetchList()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create map'
      return false
    }
  }

  // ── Delete a map directory (tilemap, tileset, objects, backdrop, script) ──
  async function deleteMap(name: string): Promise<boolean> {
    error.value = null
    try {
      const resp = await fetch('api/maps-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? 'Failed to delete map')
      }
      // If the deleted map is the open one, drop all of its in-memory state.
      if (mapName.value === name) {
        mapName.value = ''
        tmx.value = null
        collisionLevels.value = []
        stairsGrid.value = null
        objects.value = null
        dirty.value = false
        objectsDirty.value = false
        undoStack.value = []
        redoStack.value = []
      }
      await fetchList()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete map'
      return false
    }
  }

  /** References to a map by name across editor-managed files (warps / scenes /
   *  quests) — used to confirm a rename before rewriting them. */
  async function mapReferences(name: string): Promise<{ refs: MapRef[]; total: number }> {
    try {
      const resp = await fetch(`api/maps-references?name=${encodeURIComponent(name)}`)
      const j = await resp.json()
      if (!resp.ok || !j.ok) throw new Error(j.error ?? 'reference scan failed')
      return { refs: j.refs ?? [], total: j.total ?? 0 }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to scan references'
      return { refs: [], total: 0 }
    }
  }

  /** Rename a map directory (names are A–Z/0–9/_/- identifiers, no spaces). When
   *  `updateRefs` is true, all editor-managed references are rewritten too.
   *  Returns the number of files whose references were updated (0 if none). */
  async function renameMap(name: string, newName: string, updateRefs = false): Promise<{ ok: boolean; updated: number }> {
    error.value = null
    try {
      const resp = await fetch('api/maps-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, newName, updateRefs }),
      })
      const j = await resp.json()
      if (!resp.ok || !j.ok) throw new Error(j.error ?? 'rename failed')
      if (mapName.value === name) mapName.value = newName // keep the open map in sync
      await fetchList()
      return { ok: true, updated: j.updated ?? 0 }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to rename map'
      return { ok: false, updated: 0 }
    }
  }

  // ── Load a map's TMX ──
  async function loadMap(name: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(`api/maps/${encodeURIComponent(name)}/map.tmx.json`)
      if (!resp.ok) throw new Error(`Failed to load ${name}`)
      const raw = (await resp.json()) as TmxMap
      // Pull the collision + stairs layers out into their own grids — in the
      // editor they are not paint layers (can't be selected/renamed/removed).
      const { paint, collisionLevels: levels, stairs } = splitCollisionLayer(raw.layers)
      raw.layers = paint
      collisionLevels.value = levels
      stairsGrid.value = stairs
      tmx.value = raw
      mapName.value = name
      activeLayer.value = 0
      layerVisible.value = paint.map(l => l.visible !== false)
      undoStack.value = []
      redoStack.value = []
      dirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load map'
      tmx.value = null
    } finally {
      loading.value = false
    }
  }

  // ── Save TMX back ──
  async function saveMap(): Promise<void> {
    if (!tmx.value || saving.value) return
    saving.value = true
    error.value = null
    try {
      // Stitch the collision level grids + stairs grid back in as on-disk layers.
      const map = tmx.value
      const out: TmxMap = {
        ...map,
        layers: withCollisionLayer(map.layers, collisionLevels.value, stairsGrid.value, map.width, map.height),
      }
      const resp = await fetch(
        `api/maps/${encodeURIComponent(mapName.value)}/map.tmx.json`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(out),
        }
      )
      if (!resp.ok) throw new Error('Save failed')
      dirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save map'
    } finally {
      saving.value = false
    }
  }

  // ── Entity sidecar (objects.json) load / save / mutate ──
  async function loadObjects(name: string): Promise<void> {
    try {
      const resp = await fetch(`api/maps/${encodeURIComponent(name)}/objects.json`)
      if (resp.ok) {
        const raw = (await resp.json()) as MapObjects
        objects.value = { ...raw, npcs: raw.npcs ?? [], warps: raw.warps ?? [], signs: raw.signs ?? [] }
      } else {
        objects.value = { npcs: [], warps: [], signs: [] }
      }
    } catch {
      objects.value = { npcs: [], warps: [], signs: [] }
    }
    objectsDirty.value = false
  }

  async function saveObjects(): Promise<void> {
    if (!objects.value || !mapName.value) return
    try {
      const resp = await fetch(`api/maps/${encodeURIComponent(mapName.value)}/objects.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(objects.value, null, 2),
      })
      if (!resp.ok) throw new Error('Failed to save objects')
      objectsDirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save objects'
    }
  }

  /** Mark the sidecar dirty (after an in-place drag/edit of an entity). */
  function markObjectsDirty(): void {
    objectsDirty.value = true
  }

  /** Add an NPC at tile (x,y) with the next free id; returns its array index. */
  function addNpc(x: number, y: number): number {
    if (!objects.value) return -1
    const ids = new Set(objects.value.npcs.map(n => n.id))
    let id = 1
    while (ids.has(id)) id++
    objects.value.npcs.push({ id, name: '', x, y, facing: 'down', sprite: '', talk: '' })
    objectsDirty.value = true
    return objects.value.npcs.length - 1
  }

  /** Add a warp at tile (x,y); returns its array index. */
  function addWarp(x: number, y: number): number {
    if (!objects.value) return -1
    objects.value.warps.push({ x, y, dest_map: '', dest_x: 0, dest_y: 0 })
    objectsDirty.value = true
    return objects.value.warps.length - 1
  }

  /** Add a sign at tile (x,y) with empty text; returns its array index. */
  function addSign(x: number, y: number): number {
    if (!objects.value) return -1
    const signs = (objects.value.signs ??= [])
    signs.push({ x, y, text: '' })
    objectsDirty.value = true
    return signs.length - 1
  }

  function removeNpc(i: number): void {
    objects.value?.npcs.splice(i, 1)
    objectsDirty.value = true
  }
  function removeWarp(i: number): void {
    objects.value?.warps.splice(i, 1)
    objectsDirty.value = true
  }
  function removeSign(i: number): void {
    objects.value?.signs?.splice(i, 1)
    objectsDirty.value = true
  }

  // ── Cell helpers ──
  function cellIndex(x: number, y: number): number {
    const map = tmx.value
    if (!map) return -1
    return y * map.width + x
  }

  function getTile(layerIndex: number, x: number, y: number): number {
    const map = tmx.value
    const layer = map?.layers[layerIndex]
    if (!map || !layer) return 0
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0
    return layer.data[cellIndex(x, y)] ?? 0
  }

  // ── Stroke lifecycle (for undo grouping) ──
  function beginStroke(layerIndex: number): void {
    const layer = tmx.value?.layers[layerIndex]
    if (!layer) return
    strokeLayerIndex = layerIndex
    strokeBefore = layer.data.slice()
  }

  function endStroke(): void {
    if (strokeBefore === null || strokeLayerIndex < 0) {
      strokeLayerIndex = -1
      strokeBefore = null
      return
    }
    const layer = tmx.value?.layers[strokeLayerIndex]
    if (layer) {
      const after = layer.data
      // Only record if something actually changed.
      let changed = after.length !== strokeBefore.length
      if (!changed) {
        for (let i = 0; i < after.length; i++) {
          if (after[i] !== strokeBefore[i]) {
            changed = true
            break
          }
        }
      }
      if (changed) {
        pushHistory({
          kind: 'cells',
          layerIndex: strokeLayerIndex,
          before: strokeBefore,
          after: after.slice(),
        })
      }
    }
    strokeLayerIndex = -1
    strokeBefore = null
  }

  /** Record a reversible edit: append to the undo stack (bounded), drop the
   *  redo stack, and mark the map dirty. */
  function pushHistory(entry: HistoryEntry): void {
    undoStack.value.push(entry)
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
    redoStack.value = []
    dirty.value = true
  }

  /** Set a single cell on a layer (no undo bookkeeping — call within a stroke). */
  function setCell(layerIndex: number, x: number, y: number, id: number): void {
    const map = tmx.value
    const layer = map?.layers[layerIndex]
    if (!map || !layer) return
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return
    const idx = cellIndex(x, y)
    if (layer.data[idx] === id) return
    layer.data[idx] = id
  }

  /** 4-connected flood fill on the active layer (own stroke). */
  function bucketFill(layerIndex: number, sx: number, sy: number, id: number): void {
    const map = tmx.value
    const layer = map?.layers[layerIndex]
    if (!map || !layer) return
    const target = getTile(layerIndex, sx, sy)
    if (target === id) return
    beginStroke(layerIndex)
    const stack: Array<[number, number]> = [[sx, sy]]
    while (stack.length) {
      const [x, y] = stack.pop()!
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      if (layer.data[cellIndex(x, y)] !== target) continue
      layer.data[cellIndex(x, y)] = id
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
    endStroke()
  }

  // ── Resize ──
  /** Anchor offset of old content's top-left within the new grid. Negative when
   *  the canvas shrinks on that side (content is cropped). */
  function anchorOffset(oldN: number, newN: number, anchor: 'start' | 'middle' | 'end'): number {
    if (anchor === 'start') return 0
    if (anchor === 'end') return newN - oldN
    return Math.floor((newN - oldN) / 2)
  }

  /** Deep-copy the size-bearing parts of the map + collision/stairs grids (for
   *  resize undo). */
  function captureShape(map: TmxMap): MapShape {
    return {
      width: map.width,
      height: map.height,
      layers: map.layers.map(l => ({ data: l.data.slice(), width: l.width, height: l.height })),
      collisionLevels: collisionLevels.value.map(g => (g ? g.slice() : null)),
      stairs: stairsGrid.value ? stairsGrid.value.slice() : null,
    }
  }

  /** Restore a captured shape onto the live map: dimensions, each layer's data
   *  and size (by index), the collision level grids, and the stairs grid.
   *  (Resize never changes the layer set, so an index-wise restore is exact.) */
  function applyShape(map: TmxMap, shape: MapShape): void {
    map.width = shape.width
    map.height = shape.height
    shape.layers.forEach((s, i) => {
      const layer = map.layers[i]
      if (!layer) return
      layer.data = s.data.slice()
      layer.width = s.width
      layer.height = s.height
    })
    collisionLevels.value = shape.collisionLevels.map(g => (g ? g.slice() : null))
    stairsGrid.value = shape.stairs ? shape.stairs.slice() : null
  }

  /** Translate every NPC/warp/sign by (dx,dy), marking the sidecar dirty. No-op
   *  when there is no sidecar or the shift is zero. Used by resize and its
   *  undo/redo so entities track the tiles they sit on. */
  function shiftEntities(dx: number, dy: number): void {
    if (!objects.value || (dx === 0 && dy === 0)) return
    for (const n of objects.value.npcs) { n.x += dx; n.y += dy }
    for (const w of objects.value.warps) { w.x += dx; w.y += dy }
    for (const s of objects.value.signs ?? []) { s.x += dx; s.y += dy }
    objectsDirty.value = true
  }

  /** Resize the map canvas to newW×newH tiles, re-flowing every layer's data and
   *  shifting entities so existing content stays put relative to `anchorX/Y`.
   *  Cells outside the new bounds are cropped; new cells are empty (0). The
   *  change is pushed onto the undo stack as a single reversible step. Returns
   *  false when there is no map or the size is unchanged. */
  function resizeMap(
    newW: number,
    newH: number,
    anchorX: AnchorX = 'left',
    anchorY: AnchorY = 'top',
  ): boolean {
    const map = tmx.value
    if (!map) return false
    newW = Math.floor(Number(newW))
    newH = Math.floor(Number(newH))
    if (!Number.isFinite(newW) || !Number.isFinite(newH)) return false
    newW = Math.max(1, Math.min(MAX_MAP_DIM, newW))
    newH = Math.max(1, Math.min(MAX_MAP_DIM, newH))
    const oldW = map.width
    const oldH = map.height
    if (newW === oldW && newH === oldH) return false

    const before = captureShape(map)
    const offX = anchorOffset(oldW, newW, anchorX === 'left' ? 'start' : anchorX === 'right' ? 'end' : 'middle')
    const offY = anchorOffset(oldH, newH, anchorY === 'top' ? 'start' : anchorY === 'bottom' ? 'end' : 'middle')

    // Re-flow a grid from old (oldW×oldH) to new (newW×newH) dims at the anchor
    // offset; cells outside the new bounds are cropped, new cells are empty.
    const reflow = (data: number[]): number[] => {
      const next = new Array(newW * newH).fill(0)
      for (let ny = 0; ny < newH; ny++) {
        const oy = ny - offY
        if (oy < 0 || oy >= oldH) continue
        for (let nx = 0; nx < newW; nx++) {
          const ox = nx - offX
          if (ox < 0 || ox >= oldW) continue
          next[ny * newW + nx] = data[oy * oldW + ox] ?? 0
        }
      }
      return next
    }

    for (const layer of map.layers) {
      layer.data = reflow(layer.data)
      layer.width = newW
      layer.height = newH
    }
    collisionLevels.value = collisionLevels.value.map(g => (g ? reflow(g) : null))
    if (stairsGrid.value) stairsGrid.value = reflow(stairsGrid.value)
    map.width = newW
    map.height = newH

    // Keep NPCs/warps/signs aligned with the tiles they sat on.
    shiftEntities(offX, offY)

    pushHistory({ kind: 'resize', before, after: captureShape(map), dx: offX, dy: offY })
    return true
  }

  // ── Layers ──
  /** A unique default name for a freshly added layer (layer1, layer2, …). */
  function uniqueLayerName(map: TmxMap): string {
    const taken = new Set(map.layers.map(l => l.name))
    let i = map.layers.length + 1
    while (taken.has(`layer${i}`)) i++
    return `layer${i}`
  }

  /** Append a new empty tile layer (drawn on top of the existing ones) and make
   *  it active. Appending keeps existing layer indices stable, so the undo
   *  history stays valid. Returns the new layer's index. */
  function addLayer(name?: string): number {
    const map = tmx.value
    if (!map) return -1
    const layer: TmxLayer = {
      name: name?.trim() || uniqueLayerName(map),
      width: map.width,
      height: map.height,
      data: new Array(map.width * map.height).fill(0),
      visible: true,
      opacity: 1,
      type: 'tilelayer',
    }
    map.layers.push(layer)
    layerVisible.value.push(true)
    activeLayer.value = map.layers.length - 1
    dirty.value = true
    return map.layers.length - 1
  }

  /** Remove the layer at `index` (and its data). Refuses to remove the last
   *  remaining layer. Removing shifts the indices of later layers, which would
   *  invalidate the per-layer undo snapshots, so the history is cleared.
   *  Returns true if a layer was removed. */
  function removeLayer(index: number): boolean {
    const map = tmx.value
    if (!map) return false
    if (index < 0 || index >= map.layers.length) return false
    if (map.layers.length <= 1) return false
    map.layers.splice(index, 1)
    layerVisible.value.splice(index, 1)
    // Keep the active layer pointing at a valid, intuitive layer.
    if (activeLayer.value > index) activeLayer.value -= 1
    if (activeLayer.value >= map.layers.length) activeLayer.value = map.layers.length - 1
    if (activeLayer.value < 0) activeLayer.value = 0
    undoStack.value = []
    redoStack.value = []
    dirty.value = true
    return true
  }

  /** Move the layer at `from` to index `to`, changing the z-order (later in the
   *  array = drawn on top). Mirrors the move in the visibility array and keeps
   *  the active layer following its layer. Reordering shifts indices, which
   *  invalidates the per-layer undo snapshots, so the history is cleared.
   *  Returns true if the order changed. */
  function moveLayer(from: number, to: number): boolean {
    const map = tmx.value
    if (!map) return false
    const n = map.layers.length
    if (from < 0 || from >= n) return false
    to = Math.max(0, Math.min(n - 1, to))
    if (from === to) return false
    const [layer] = map.layers.splice(from, 1)
    map.layers.splice(to, 0, layer)
    if (from < layerVisible.value.length) {
      const [v] = layerVisible.value.splice(from, 1)
      layerVisible.value.splice(to, 0, v ?? true)
    }
    // Track the layer the user had selected through the index shuffle.
    if (activeLayer.value === from) activeLayer.value = to
    else if (from < activeLayer.value && activeLayer.value <= to) activeLayer.value -= 1
    else if (to <= activeLayer.value && activeLayer.value < from) activeLayer.value += 1
    undoStack.value = []
    redoStack.value = []
    dirty.value = true
    return true
  }

  /** Rename the paint layer at `index`. Blank names and the reserved
   *  `collision`/`collisionN`/`stairs` names are rejected (those live in their
   *  own grids, keyed by name on save). Persisted with the next map save.
   *  Returns true if it changed. */
  function renameLayer(index: number, name: string): boolean {
    const map = tmx.value
    if (!map || index < 0 || index >= map.layers.length) return false
    const nm = name.trim()
    if (!nm || COLLISION_LAYER_RE.test(nm) || nm === STAIRS_LAYER) return false
    if (map.layers.some((l, i) => i !== index && l.name === nm)) return false // keep names unique
    if (map.layers[index].name === nm) return false
    map.layers[index].name = nm
    dirty.value = true
    return true
  }

  // ── Collision grids (one per elevation level) ──
  /** Toggle a collision cell (0 ⇄ 1) at elevation `level`, lazily creating
   *  that level's grid on first use. Recorded as one undo step. */
  function toggleCollision(x: number, y: number, level = 0): void {
    const map = tmx.value
    if (!map) return
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return
    level = Math.max(0, Math.trunc(level))
    if (!collisionLevels.value[level]) {
      collisionLevels.value[level] = new Array(map.width * map.height).fill(0)
    }
    const grid = collisionLevels.value[level]!
    const before = grid.slice()
    const ci = y * map.width + x
    grid[ci] = grid[ci] ? 0 : 1
    pushHistory({ kind: 'collision', level, before, after: grid.slice() })
  }

  // ── Stairs grid ──
  /** Paint a stair cell (1 = ascend, 2 = descend, 0 = clear), lazily creating
   *  the stairs grid on first use. Recorded as one undo step. */
  function setStair(x: number, y: number, value: 0 | 1 | 2): void {
    const map = tmx.value
    if (!map) return
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return
    if (!stairsGrid.value) stairsGrid.value = new Array(map.width * map.height).fill(0)
    const before = stairsGrid.value.slice()
    const ci = y * map.width + x
    if (stairsGrid.value[ci] === value) return
    stairsGrid.value[ci] = value
    pushHistory({ kind: 'stairs', before, after: stairsGrid.value.slice() })
  }

  // ── Layer elevation level (rendered below/above the player) ──
  /** The elevation `level` custom property of paint layer `index` (default 0). */
  function layerLevel(index: number): number {
    const layer = tmx.value?.layers[index]
    const prop = layer?.properties?.find(p => p.name === 'level')
    const v = Math.trunc(Number(prop?.value ?? 0))
    return Number.isFinite(v) && v > 0 ? v : 0
  }

  /** Set the elevation `level` custom property on paint layer `index`. Level 0
   *  is the default, so the property is removed to keep files clean. Persisted
   *  with the next map save (like renameLayer: dirty only, no undo entry).
   *  Returns true if it changed. */
  function setLayerLevel(index: number, level: number): boolean {
    const map = tmx.value
    if (!map || index < 0 || index >= map.layers.length) return false
    level = Math.max(0, Math.trunc(Number(level) || 0))
    const layer = map.layers[index]
    if (layerLevel(index) === level) return false
    const props = (layer.properties ??= [])
    const pi = props.findIndex(p => p.name === 'level')
    if (level === 0) {
      if (pi >= 0) props.splice(pi, 1)
    } else if (pi >= 0) {
      props[pi].value = level
    } else {
      props.push({ name: 'level', type: 'int', value: level })
    }
    dirty.value = true
    return true
  }

  function setLayerVisible(index: number, visible: boolean): void {
    if (index < 0 || index >= layerVisible.value.length) return
    layerVisible.value[index] = visible
  }

  // ── Undo / redo ──
  function undo(): void {
    const entry = undoStack.value.pop()
    if (!entry) return
    if (entry.kind === 'cells') {
      const layer = tmx.value?.layers[entry.layerIndex]
      if (layer) layer.data = entry.before.slice()
    } else if (entry.kind === 'collision') {
      collisionLevels.value[entry.level] = entry.before.slice()
    } else if (entry.kind === 'stairs') {
      stairsGrid.value = entry.before.slice()
    } else {
      if (tmx.value) applyShape(tmx.value, entry.before)
      shiftEntities(-entry.dx, -entry.dy)
    }
    redoStack.value.push(entry)
    dirty.value = true
  }

  function redo(): void {
    const entry = redoStack.value.pop()
    if (!entry) return
    if (entry.kind === 'cells') {
      const layer = tmx.value?.layers[entry.layerIndex]
      if (layer) layer.data = entry.after.slice()
    } else if (entry.kind === 'collision') {
      collisionLevels.value[entry.level] = entry.after.slice()
    } else if (entry.kind === 'stairs') {
      stairsGrid.value = entry.after.slice()
    } else {
      if (tmx.value) applyShape(tmx.value, entry.after)
      shiftEntities(entry.dx, entry.dy)
    }
    undoStack.value.push(entry)
    dirty.value = true
  }

  return {
    // list
    mapList,
    loadingList,
    fetchList,
    createTmxMap,
    deleteMap,
    renameMap,
    mapReferences,
    // map
    mapName,
    tmx,
    loading,
    saving,
    dirty,
    error,
    loadMap,
    saveMap,
    // entity sidecar
    objects,
    objectsDirty,
    loadObjects,
    saveObjects,
    markObjectsDirty,
    addNpc,
    addWarp,
    addSign,
    removeNpc,
    removeWarp,
    removeSign,
    // layers / selection
    layers,
    activeLayer,
    layerVisible,
    selectedTile,
    setLayerVisible,
    addLayer,
    removeLayer,
    moveLayer,
    renameLayer,
    resizeMap,
    // collision / stairs (standalone grids, not paint layers)
    collision,
    collisionLevels,
    hasCollision,
    levelCount,
    toggleCollision,
    stairsGrid,
    setStair,
    // layer elevation level (render order vs. the player)
    layerLevel,
    setLayerLevel,
    // editing
    getTile,
    setCell,
    bucketFill,
    beginStroke,
    endStroke,
    // history
    undo,
    redo,
    canUndo,
    canRedo,
  }
})
