<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useMapActivity, type AnchorX, type AnchorY } from '@/composables/useMapActivity'
import { useTilesActivity, type GroupEntry } from '@/composables/useTilesActivity'
import type { SidecarDoc } from '@/composables/useTilesActivity'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { useEditorSettings } from '@/composables/useEditorSettings'
import MapBackdropGen from './MapBackdropGen.vue'
import MapTraceDialog from './MapTraceDialog.vue'
import TilePixelEditor from '../TilesActivity/TilePixelEditor.vue'
import type { MapActivityConfig } from '@/types/project'

const { t } = useI18n()
const showBackdropGen = ref(false)
// ── Reference-backdrop → tilemap ("trace to map") dialog state ──
const showTrace = ref(false)
const tracing = ref(false)
const traceError = ref('')
const store = useMapActivity()
const tilesStore = useTilesActivity()
const project = useProjectStore()
const editorStore = useEditorStore()
const {
  tmx,
  loading,
  saving,
  dirty,
  error,
  objects,
  objectsDirty,
  mapName,
  mapList,
  loadingList,
  layers,
  activeLayer,
  layerVisible,
  selectedTile,
  hasCollision,
  levelCount,
  stairsGrid,
  canUndo,
  canRedo,
} = storeToRefs(store)

/** Whether the translucent-red collision overlay is shown (editor-only). */
const collisionVisible = ref(true)
/** Elevation level being painted/viewed with the collision tool. */
const collisionLevel = ref(0)
/** Whether the stairs overlay (▲ up / ▼ down) is shown (editor-only). */
const stairsVisible = ref(true)
/** Current stair brush: 1 = up (ascend), 2 = down (descend), 0 = clear. */
const stairBrush = ref<0 | 1 | 2>(1)

/** Whether the NPC/warp entity overlay is enabled for this project. */
const objectsEnabled = computed(() => {
  const cfg = project.getActivity(editorStore.activeActivity)?.config as MapActivityConfig | undefined
  return !!cfg?.objects
})

// ── Tools ──
type Tool = 'brush' | 'eraser' | 'bucket' | 'stamp' | 'collision' | 'stairs' | 'objects'
const tool = ref<Tool>('brush')
const toolList = computed<Tool[]>(() =>
  objectsEnabled.value
    ? ['brush', 'eraser', 'bucket', 'stamp', 'collision', 'stairs', 'objects']
    : ['brush', 'eraser', 'bucket', 'stamp', 'collision', 'stairs'],
)

// ── Entity (NPC/warp/sign) overlay selection + drag ──
const selected = ref<{ kind: 'npc' | 'warp' | 'sign'; index: number } | null>(null)
const draggingEntity = ref(false)
const selectedNpc = computed(() =>
  selected.value?.kind === 'npc' ? objects.value?.npcs[selected.value.index] ?? null : null,
)
const selectedWarp = computed(() =>
  selected.value?.kind === 'warp' ? objects.value?.warps[selected.value.index] ?? null : null,
)
const selectedSign = computed(() =>
  selected.value?.kind === 'sign' ? objects.value?.signs?.[selected.value.index] ?? null : null,
)

// ── View transform ──
const zoom = ref(1)
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

// ── Refs ──
const canvasRef = ref<HTMLCanvasElement | null>(null)
const scrollRef = ref<HTMLDivElement | null>(null)
const tilesetCanvasRef = ref<HTMLCanvasElement | null>(null)
const minimapRef = ref<HTMLCanvasElement | null>(null)

// ── Tileset image ──
const tilesetImg = ref<HTMLImageElement | null>(null)
const tilesetCols = ref(1)
const tilesetRows = ref(1)

const tileW = computed(() => tmx.value?.tilewidth ?? 16)
const tileH = computed(() => tmx.value?.tileheight ?? 16)

// ── Art-reference backdrop (the map's source.png) ──
const backdropImg = ref<HTMLImageElement | null>(null)
const showBackdrop = ref(true)
const backdropOpacity = ref(0.55)
/** A map with no authored tilemap, shown only via its source.png reference. */
const backdropOnly = computed(() => !tmx.value && !!backdropImg.value)
const mapTileSize = computed(() => {
  const cfg = project.getActivity(editorStore.activeActivity)?.config as MapActivityConfig | undefined
  return cfg?.tileSize ?? 16
})

// ── Sub-tab system (map + building editors) ──
interface SubTabEntry {
  id: string // 'map:<mapName>' or 'building:<groupId>'
  type: 'map' | 'building'
  label: string
  group?: GroupEntry
}
const subTabs = ref<SubTabEntry[]>([])
const activeSubTab = ref<string | null>(null)

/** Per-map cached state so switching map tabs is instant (no API re-fetch). */
interface MapCacheEntry {
  tmx: any
  objects: any
  mapName: string | null
  dirty: boolean
  objectsDirty: boolean
  collisionLevels: (number[] | null)[]
  stairsGrid: number[] | null
  activeLayer: number
  layerVisible: boolean[]
  zoom: number
  selectedTile: number
  selectedGroupId: string | null
  tool: string
  showCamera: boolean
  cameraPosX: number
  cameraPosY: number
  showBackdrop: boolean
  backdropOpacity: number
  collisionVisible: boolean
  collisionLevel: number
  stairsVisible: boolean
  scrollTop: number
  scrollLeft: number
}
const mapCache = ref<Map<string, MapCacheEntry>>(new Map())

/** The map name currently loaded in the Pinia store (i.e., what's on the canvas). */
const currentMapName = ref<string | null>(null)

function saveCurrentMapState(): void {
  if (!currentMapName.value) return
  const entry: MapCacheEntry = {
    tmx: store.tmx,
    objects: store.objects,
    mapName: store.mapName,
    dirty: store.dirty,
    objectsDirty: store.objectsDirty,
    collisionLevels: store.collisionLevels,
    stairsGrid: store.stairsGrid,
    activeLayer: store.activeLayer,
    layerVisible: store.layerVisible,
    zoom: zoom.value,
    selectedTile: selectedTile.value,
    selectedGroupId: selectedGroup.value?.id ?? null,
    tool: tool.value,
    showCamera: showCamera.value,
    cameraPosX: cameraPos.value.x,
    cameraPosY: cameraPos.value.y,
    showBackdrop: showBackdrop.value,
    backdropOpacity: backdropOpacity.value,
    collisionVisible: collisionVisible.value,
    collisionLevel: collisionLevel.value,
    stairsVisible: stairsVisible.value,
    scrollTop: scrollRef.value?.scrollTop ?? 0,
    scrollLeft: scrollRef.value?.scrollLeft ?? 0,
  }
  mapCache.value.set(currentMapName.value, entry)
}

function restoreMapState(name: string): void {
  const entry = mapCache.value.get(name)
  if (!entry) return
  store.tmx = entry.tmx
  store.objects = entry.objects
  store.mapName = entry.mapName ?? ''
  store.dirty = entry.dirty
  store.objectsDirty = entry.objectsDirty
  store.collisionLevels = entry.collisionLevels
  store.stairsGrid = entry.stairsGrid
  store.activeLayer = entry.activeLayer
  store.layerVisible = [...entry.layerVisible]
  zoom.value = entry.zoom
  selectedTile.value = entry.selectedTile
  const sg = entry.selectedGroupId ? tilesStore.groups.find(g => g.id === entry.selectedGroupId) ?? null : null
  selectedGroup.value = sg
  tool.value = entry.tool as any
  showCamera.value = entry.showCamera
  cameraPos.value = { x: entry.cameraPosX, y: entry.cameraPosY }
  showBackdrop.value = entry.showBackdrop
  backdropOpacity.value = entry.backdropOpacity
  collisionVisible.value = entry.collisionVisible
  collisionLevel.value = entry.collisionLevel
  stairsVisible.value = entry.stairsVisible
  currentMapName.value = name
}

/** Open a map: if already in a tab, switch to it; otherwise add a new tab and load. */
async function openMapTab(name: string): Promise<void> {
  // Already viewing this map → nop
  if (activeSubTab.value === `map:${name}`) return

  // Save the currently-active map's state (if any)
  saveCurrentMapState()

  // If already in cache, just restore (no API call needed)
  if (mapCache.value.has(name)) {
    // Ensure the tab entry exists
    if (!subTabs.value.find(t => t.id === `map:${name}`)) {
      subTabs.value.push({ id: `map:${name}`, type: 'map', label: name })
    }
    restoreMapState(name)
    activeSubTab.value = `map:${name}`
    // Reload images (tileset + backdrop) and redraw
    backdropImg.value = null
    const entry = mapList.value.find(m => m.name === name)
    if (entry?.hasBackdrop) await loadBackdrop(name)
    if (tmx.value) await loadTileset(name)
    await nextTick()
    drawMap()
    drawMinimap()
    if (showCamera.value) centerCamera()
    return
  }

  // First time opening this map → load from API
  backdropImg.value = null
  const entry = mapList.value.find(m => m.name === name)
  if (entry?.hasBackdrop) await loadBackdrop(name)
  if (entry?.hasTilemap !== false) {
    await store.loadMap(name)
    if (tmx.value) await loadTileset(name)
    if (objectsEnabled.value) await store.loadObjects(name)
  } else {
    mapName.value = name
    store.tmx = null
    store.objects = null
    store.dirty = false
    store.objectsDirty = false
    error.value = null
  }
  selected.value = null
  currentMapName.value = name
  collisionLevel.value = 0
  resetView()
  // Add tab entry (or re-use existing)
  if (!subTabs.value.find(t => t.id === `map:${name}`)) {
    subTabs.value.push({ id: `map:${name}`, type: 'map', label: name })
  }
  activeSubTab.value = `map:${name}`
  await nextTick()
  drawMap()
  drawMinimap()
  if (showCamera.value) centerCamera()
}

function closeMapTab(name: string): void {
  const tabId = `map:${name}`
  // Warn if the map is dirty and visible
  if (currentMapName.value === name && (store.dirty || store.objectsDirty)) {
    if (!confirm(t('map.confirmDiscard'))) return
  }
  // Clean up cache
  mapCache.value.delete(name)
  // Remove tab
  const idx = subTabs.value.findIndex(t => t.id === tabId)
  if (idx < 0) return
  subTabs.value.splice(idx, 1)
  // If this was the active tab, switch to sibling
  if (activeSubTab.value === tabId) {
    activeSubTab.value = subTabs.value.length > 0
      ? subTabs.value[Math.min(idx, subTabs.value.length - 1)].id
      : null
  }
  // Clear canvas if no map is active
  if (currentMapName.value === name) {
    currentMapName.value = null
    // If we fell back to another map, restore its state
    const fallbackMap = subTabs.value.find(t => t.type === 'map')
    if (fallbackMap) {
      const mn = fallbackMap.id.replace('map:', '')
      restoreMapState(mn)
      // Reload images
      backdropImg.value = null
      const entry = mapList.value.find(m => m.name === mn)
      if (entry?.hasBackdrop) loadBackdrop(mn)
      if (tmx.value) loadTileset(mn)
      nextTick(() => { drawMap(); drawMinimap() })
    } else {
      // No map tabs left → clear canvas
      store.tmx = null
      store.objects = null
      backdropImg.value = null
      tilesetImg.value = null
      selected.value = null
      store.dirty = false
      store.objectsDirty = false
    }
  }
}

function closeTab(tabId: string): void {
  if (tabId.startsWith('map:')) {
    closeMapTab(tabId.replace('map:', ''))
  } else if (tabId.startsWith('building:')) {
    closeBuildingTab(tabId)
  }
}

function openBuildingTab(g: GroupEntry): void {
  const id = `building:${g.id}`
  const existing = subTabs.value.find(t => t.id === id)
  if (existing) {
    existing.label = g.name || g.id
    existing.group = g
  } else {
    subTabs.value.push({ id, type: 'building', label: g.name || g.id, group: g })
  }
  activeSubTab.value = id
}

function closeBuildingTab(id: string): void {
  const idx = subTabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  subTabs.value.splice(idx, 1)
  if (activeSubTab.value === id) {
    const fallback = subTabs.value[Math.min(idx, subTabs.value.length - 1)]
    activeSubTab.value = fallback?.id ?? null
  }
}

/** Sub-tabs filtered by type. */
const mapTabs = computed(() => subTabs.value.filter(t => t.type === 'map'))
const buildingTabs = computed(() => subTabs.value.filter(t => t.type === 'building'))

/** The GroupEntry for the currently-active building tab (if any). */
const activeBuildingGroup = computed(() => {
  if (!activeSubTab.value?.startsWith('building:')) return null
  const tab = subTabs.value.find(t => t.id === activeSubTab.value)
  return tab?.group ?? null
})

/** The currently-active map tab's name (if any). */
const activeMapName = computed(() => {
  if (!activeSubTab.value?.startsWith('map:')) return null
  return activeSubTab.value.replace('map:', '')
})

// ── Shared clipboard (map ↔ building editors) ──
const clipboard = ref<{ kind: 'tile' | 'group'; id: string } | null>(null)

// ── Browse Buildings modal ──
const showBrowseBuildings = ref(false)
const browseFilter = ref('')
const browseCreating = ref(false)
const browseNewName = ref('')
const browseNewW = ref(3)
const browseNewH = ref(3)
const browseMsg = ref('')

const filteredBuildings = computed(() => {
  const q = browseFilter.value.trim().toLowerCase()
  if (!q) return tilesStore.groups
  return tilesStore.groups.filter(g => (g.name || '').toLowerCase().includes(q) || g.id.toLowerCase().includes(q))
})

function openBrowseBuildings(): void {
  browseFilter.value = ''
  browseCreating.value = false
  browseNewName.value = ''
  browseNewW.value = 3
  browseNewH.value = 3
  browseMsg.value = ''
  showBrowseBuildings.value = true
}

function blankPng(wPx: number, hPx: number): string {
  const c = document.createElement('canvas')
  c.width = wPx
  c.height = hPx
  return c.toDataURL('image/png')
}

async function createNewBuildingFromBrowse(): Promise<void> {
  if (browseCreating.value) return
  const w = Math.max(1, Math.min(16, Math.round(browseNewW.value) || 1))
  const h = Math.max(1, Math.min(16, Math.round(browseNewH.value) || 1))
  browseCreating.value = true
  try {
    const name = browseNewName.value.trim() || '建筑'
    const id = await tilesStore.saveGroup({ name, w, h, pngBase64: blankPng(w * mapTileSize.value, h * mapTileSize.value) })
    if (id) {
      browseMsg.value = `已创建 ${name}（${id}）`
      // Auto-open the new building
      const g = tilesStore.groups.find(gr => gr.id === id)
      if (g) openBuildingTab(g)
      setTimeout(() => { showBrowseBuildings.value = false }, 800)
    }
  } finally {
    browseCreating.value = false
  }
}

async function deleteBuildingFromBrowse(g: GroupEntry): Promise<void> {
  if (!confirm(t('map.confirmDeleteBuilding', { name: g.name || g.id }))) return
  await tilesStore.deleteGroup(g.id)
  // Close the tab if it was open
  const tabId = `building:${g.id}`
  if (subTabs.value.find(t => t.id === tabId)) {
    closeBuildingTab(tabId)
  }
}

// ── Building editor persistence callback ──
async function persistBuildingImage(dataUrl: string, layers: SidecarDoc): Promise<boolean> {
  const g = activeBuildingGroup.value
  if (!g) return false
  const id = await tilesStore.saveGroup({ id: g.id, w: g.w, h: g.h, pngBase64: dataUrl, layers })
  return !!id
}

function onBuildingResized(w: number, h: number): void {
  const g = activeBuildingGroup.value
  if (g) {
    // Update the group entry in the sub-tab's copy
    const tab = subTabs.value.find(t => t.id === activeSubTab.value)
    if (tab && tab.group) {
      tab.group = { ...tab.group, w, h }
    }
  }
}

function onBuildingRenamed(name: string): void {
  const g = activeBuildingGroup.value
  if (!g) return
  tilesStore.renameGroup(g.id, name).then(ok => {
    if (ok) {
      const tab = subTabs.value.find(t => t.id === activeSubTab.value)
      if (tab) tab.label = name
    }
  })
}

// Fetch a served asset as a data-URL (for clipboard copy).
async function fetchAsDataUrl(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`http ${r.status}`))))
      .then((blob) => {
        const fr = new FileReader()
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
        fr.onerror = () => resolve(null)
        fr.readAsDataURL(blob)
      })
      .catch(() => resolve(null))
  })
}

/** Copy a tile from the library to the clipboard. */
function copyTileToClipboard(id: string): void {
  clipboard.value = { kind: 'tile', id }
}

/** Copy a building group to the clipboard. */
function copyGroupToClipboard(g: GroupEntry): void {
  clipboard.value = { kind: 'group', id: g.id }
}

/** Load the tile library for use in building editing. */
const libraryTiles = computed(() => tilesStore.libraryTiles)

function loadBackdrop(name: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => { backdropImg.value = img; resolve() }
    img.onerror = () => { backdropImg.value = null; resolve() }
    img.src = `/api/maps/${encodeURIComponent(name)}/source.png`
  })
}

// Reload the freshly-generated backdrop (cache-busted) and repaint.
async function onBackdropGenerated(): Promise<void> {
  const name = mapName.value
  if (!name) return
  await new Promise<void>(resolve => {
    const img = new Image()
    img.onload = () => { backdropImg.value = img; resolve() }
    img.onerror = () => resolve()
    img.src = `/api/maps/${encodeURIComponent(name)}/source.png?t=${Date.now()}`
  })
  drawMap()
}

// ───────────────────────────────────────────────────────────────────────────
// Map list
// ───────────────────────────────────────────────────────────────────────────

async function openMap(name: string): Promise<void> {
  // Forward to the tab-based multi-map API
  await openMapTab(name)
}


/** Author a blank tilemap sized to the backdrop, then load it (backdrop stays
 *  underneath for tracing). */
async function createFromBackdrop(): Promise<void> {
  const img = backdropImg.value
  if (!img || !mapName.value || creating.value) return
  creating.value = true
  const ts = mapTileSize.value
  const w = Math.max(1, Math.round(img.naturalWidth / ts))
  const h = Math.max(1, Math.round(img.naturalHeight / ts))
  const ok = await store.createTmxMap(mapName.value, w, h)
  creating.value = false
  if (!ok) return
  await store.loadMap(mapName.value)
  if (tmx.value) await loadTileset(mapName.value)
  if (objectsEnabled.value) await store.loadObjects(mapName.value)
  resetView()
  await nextTick()
  drawMap()
  drawMinimap()
  centerCamera()
}

// ───────────────────────────────────────────────────────────────────────────
// Trace reference backdrop → tilemap ("参考图直接变为地图")
//
// Turn the map's art-reference backdrop (source.png) straight into a real,
// editable tilemap: slice the image into a tileSize grid, content-address +
// dedupe identical cells into tiles, assemble the map's tileset.png, and fill
// the ground layer with the matching tiles — reusing the exact building-stamp
// pipeline (hashRGBA → saveTiles → buildTileset → setCell) but over the whole
// image at once. Optional palette-harmonize / pixelize (server /api/cv-process)
// collapses flat regions into shared tiles instead of exploding into thousands
// of unique ones. Only offered on a backdrop-only map (no tilemap to clobber).
// ───────────────────────────────────────────────────────────────────────────

/** Run one deterministic CV op on a base64/data-URL PNG, return the result URL. */
async function cvProcess(operation: string, pngBase64: string, params: Record<string, unknown>): Promise<string> {
  const r = await fetch('/api/cv-process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, pngBase64, params }),
  })
  const j = await r.json()
  if (!r.ok || !j.ok) throw new Error(j.error || 'cv-process failed')
  return j.pngBase64 as string
}

async function traceBackdropToTiles(opts: { quantize: boolean; colors: number; pixelize: boolean }): Promise<void> {
  const src = backdropImg.value
  if (!src || !mapName.value || tracing.value) return
  tracing.value = true
  traceError.value = ''
  try {
    const ts = mapTileSize.value
    const W = Math.max(1, Math.round(src.naturalWidth / ts))
    const H = Math.max(1, Math.round(src.naturalHeight / ts))

    // 1. Optional color-reduction / pixelization on the full backdrop, so flat
    //    regions dedupe. Start from the loaded backdrop re-encoded as PNG.
    let srcImg: HTMLImageElement = src
    if (opts.quantize || opts.pixelize) {
      const enc = document.createElement('canvas')
      enc.width = src.naturalWidth
      enc.height = src.naturalHeight
      enc.getContext('2d')!.drawImage(src, 0, 0)
      let url = enc.toDataURL('image/png')
      if (opts.quantize) url = await cvProcess('palette-harmonize', url, { colorCount: opts.colors })
      if (opts.pixelize) url = await cvProcess('pixelize-grid', url, {})
      const processed = await loadImage(url)
      if (processed) srcImg = processed
    }

    // 2. Scale the (processed) backdrop onto an exact W×H tile grid.
    const grid = document.createElement('canvas')
    grid.width = W * ts
    grid.height = H * ts
    const gctx = grid.getContext('2d')!
    gctx.imageSmoothingEnabled = !opts.pixelize
    gctx.imageSmoothingQuality = 'high'
    gctx.drawImage(srcImg, 0, 0, grid.width, grid.height)

    // 3. Slice every cell, content-address + dedupe. Skip fully-transparent
    //    cells (they stay GID 0).
    const oc = document.createElement('canvas')
    oc.width = ts
    oc.height = ts
    const octx = oc.getContext('2d')!
    octx.imageSmoothingEnabled = false
    const cellKey: (string | null)[] = new Array(W * H).fill(null)
    const order: string[] = [] // unique keys, first-seen order → tileset slot order
    const keyUrl = new Map<string, string>()
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        octx.clearRect(0, 0, ts, ts)
        octx.drawImage(grid, cx * ts, cy * ts, ts, ts, 0, 0, ts, ts)
        const data = octx.getImageData(0, 0, ts, ts).data
        let opaque = false
        for (let p = 3; p < data.length; p += 4) {
          if (data[p] !== 0) { opaque = true; break }
        }
        if (!opaque) continue
        const key = hashRGBA(data)
        cellKey[cy * W + cx] = key
        if (!keyUrl.has(key)) { keyUrl.set(key, oc.toDataURL('image/png')); order.push(key) }
      }
    }
    if (order.length === 0) throw new Error(t('map.traceEmpty'))

    // 4. Create the tilemap, persist the unique slices to the library (tagged so
    //    they stay out of the harvest grid), and assemble tileset.png.
    if (!(await store.createTmxMap(mapName.value, W, H))) {
      throw new Error(store.error ?? t('map.createFailedGeneric'))
    }
    await store.loadMap(mapName.value)
    if (objectsEnabled.value) await store.loadObjects(mapName.value)

    const ids = await tilesStore.saveTiles(order.map(k => ({ pngBase64: keyUrl.get(k)!, source: `trace:${mapName.value}` })))
    if (ids.length !== order.length) throw new Error(tilesStore.error ?? 'tile save failed')
    const keyGid = new Map<string, number>()
    order.forEach((k, i) => keyGid.set(k, i + 1))

    const cols = 16
    const rows = Math.ceil(ids.length / cols)
    const tsCanvas = document.createElement('canvas')
    tsCanvas.width = cols * ts
    tsCanvas.height = rows * ts
    const tctx = tsCanvas.getContext('2d')!
    tctx.imageSmoothingEnabled = false
    const slices = await Promise.all(order.map(k => loadImage(keyUrl.get(k)!)))
    slices.forEach((im, i) => {
      if (im) tctx.drawImage(im, (i % cols) * ts, Math.floor(i / cols) * ts, ts, ts)
    })
    if (!(await tilesStore.buildTileset(mapName.value, tsCanvas.toDataURL('image/png'), ids, cols))) {
      throw new Error(tilesStore.error ?? 'tileset build failed')
    }
    await loadTileset(mapName.value)

    // 5. Paint the whole grid as one undo stroke, then persist.
    store.beginStroke(activeLayer.value)
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const gid = keyGid.get(cellKey[cy * W + cx] ?? '')
        if (gid) store.setCell(activeLayer.value, cx, cy, gid)
      }
    }
    store.endStroke()
    await store.saveMap()

    afterEdit()
    resetView()
    await nextTick()
    drawMap()
    drawMinimap()
    centerCamera()
    showTrace.value = false
  } catch (e) {
    traceError.value = (e as Error)?.message || 'trace failed'
  } finally {
    tracing.value = false
  }
}

// ── New map dialog ──
const showNew = ref(false)
const newName = ref('')
const newW = ref(20)
const newH = ref(20)
const creating = ref(false)

function openNewDialog(): void {
  newName.value = ''
  newW.value = 20
  newH.value = 20
  showNew.value = true
}

/** Empty-state shortcut: open the AI assistant to bootstrap a first map. */
function openAssistant(): void {
  if (!editorStore.assistantOpen) editorStore.toggleAssistant()
}

async function confirmCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value = true
  const ok = await store.createTmxMap(name, newW.value, newH.value)
  creating.value = false
  if (ok) {
    showNew.value = false
    await openMap(name)
  }
}

// ── Delete a map ──
async function deleteMapPrompt(name: string): Promise<void> {
  if (!confirm(t('map.confirmDelete', { name }))) return
  await store.deleteMap(name)
  // If we just removed the open map, the canvas is now empty — clear the view.
  if (!tmx.value) {
    backdropImg.value = null
    tilesetImg.value = null
    selected.value = null
  }
}

// ── Resize the current map ──
const showResize = ref(false)
const resizeW = ref(20)
const resizeH = ref(20)
const resizeAnchorX = ref<AnchorX>('left')
const resizeAnchorY = ref<AnchorY>('top')
const resizing = ref(false)
/** 3×3 anchor grid cells, row-major (top→bottom, left→right). */
const anchorCells: { x: AnchorX; y: AnchorY }[] = [
  { x: 'left', y: 'top' }, { x: 'center', y: 'top' }, { x: 'right', y: 'top' },
  { x: 'left', y: 'middle' }, { x: 'center', y: 'middle' }, { x: 'right', y: 'middle' },
  { x: 'left', y: 'bottom' }, { x: 'center', y: 'bottom' }, { x: 'right', y: 'bottom' },
]

function openResizeDialog(): void {
  if (!tmx.value) return
  resizeW.value = tmx.value.width
  resizeH.value = tmx.value.height
  resizeAnchorX.value = 'left'
  resizeAnchorY.value = 'top'
  showResize.value = true
}

const resizeUnchanged = computed(() =>
  !!tmx.value && resizeW.value === tmx.value.width && resizeH.value === tmx.value.height,
)
const resizeValid = computed(() =>
  Number.isFinite(resizeW.value) && Number.isFinite(resizeH.value) &&
  resizeW.value >= 1 && resizeH.value >= 1,
)

function confirmResize(): void {
  if (!tmx.value || resizing.value) return
  resizing.value = true
  const changed = store.resizeMap(resizeW.value, resizeH.value, resizeAnchorX.value, resizeAnchorY.value)
  resizing.value = false
  if (changed) {
    // The layers + collision grid were re-flowed; refresh every view that reads
    // the map dimensions (canvas, minimap, camera clamp).
    centerCamera()
    afterEdit()
  }
  showResize.value = false
}

// ── Entity (NPC/warp/sign) editing ──
function entityAt(x: number, y: number): { kind: 'npc' | 'warp' | 'sign'; index: number } | null {
  const o = objects.value
  if (!o) return null
  const ni = o.npcs.findIndex(n => n.x === x && n.y === y)
  if (ni >= 0) return { kind: 'npc', index: ni }
  const wi = o.warps.findIndex(w => w.x === x && w.y === y)
  if (wi >= 0) return { kind: 'warp', index: wi }
  const si = (o.signs ?? []).findIndex(s => s.x === x && s.y === y)
  if (si >= 0) return { kind: 'sign', index: si }
  return null
}

function onObjectsMouseDown(e: MouseEvent): void {
  const cell = cellAt(e)
  selected.value = cell ? entityAt(cell.x, cell.y) : null
  draggingEntity.value = selected.value !== null
  drawMap()
}

function onObjectsMouseMove(e: MouseEvent): void {
  if (!draggingEntity.value || !selected.value) return
  const cell = cellAt(e)
  const o = objects.value
  if (!cell || !o) return
  const ent = selected.value.kind === 'npc'
    ? o.npcs[selected.value.index]
    : selected.value.kind === 'warp'
      ? o.warps[selected.value.index]
      : o.signs?.[selected.value.index]
  if (ent && (ent.x !== cell.x || ent.y !== cell.y)) {
    ent.x = cell.x
    ent.y = cell.y
    store.markObjectsDirty()
    drawMap()
  }
}

function addNpcHere(): void {
  const map = tmx.value
  if (!map) return
  const i = store.addNpc(Math.floor(map.width / 2), Math.floor(map.height / 2))
  if (i >= 0) {
    selected.value = { kind: 'npc', index: i }
    tool.value = 'objects'
    afterEdit()
  }
}
function addWarpHere(): void {
  const map = tmx.value
  if (!map) return
  const i = store.addWarp(Math.floor(map.width / 2), Math.floor(map.height / 2))
  if (i >= 0) {
    selected.value = { kind: 'warp', index: i }
    tool.value = 'objects'
    afterEdit()
  }
}
function addSignHere(): void {
  const map = tmx.value
  if (!map) return
  const i = store.addSign(Math.floor(map.width / 2), Math.floor(map.height / 2))
  if (i >= 0) {
    selected.value = { kind: 'sign', index: i }
    tool.value = 'objects'
    afterEdit()
  }
}
function deleteSelected(): void {
  const sel = selected.value
  if (!sel) return
  if (sel.kind === 'npc') store.removeNpc(sel.index)
  else if (sel.kind === 'warp') store.removeWarp(sel.index)
  else store.removeSign(sel.index)
  selected.value = null
  afterEdit()
}

/** After editing an entity's x/y in the panel: mark dirty + redraw the marker. */
function afterObjectEdit(): void {
  store.markObjectsDirty()
  drawMap()
}

// ───────────────────────────────────────────────────────────────────────────
// Tileset
// ───────────────────────────────────────────────────────────────────────────

function loadTileset(name: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      tilesetImg.value = img
      tilesetCols.value = Math.max(1, Math.floor(img.naturalWidth / tileW.value))
      tilesetRows.value = Math.max(1, Math.ceil(img.naturalHeight / tileH.value))
      nextTick(() => drawTilesetPalette())
      resolve()
    }
    img.onerror = () => {
      tilesetImg.value = null
      resolve()
    }
    // Cache-bust with the tiles store version (bumped on saveTile/buildTileset),
    // so that after a building stamp rebuilds tileset.png we load the fresh image
    // rather than the browser-cached one — otherwise the new slices render against
    // the stale tileset and the stamped building looks wrong.
    img.src = `/api/maps/${encodeURIComponent(name)}/tileset.png?v=${tilesStore.version}`
  })
}

/** Source (col,row) in the tileset for a tile id (id ≥ 1; slot = id - 1). */
function tileSource(id: number): { col: number; row: number } {
  const slot = id - 1
  return { col: slot % tilesetCols.value, row: Math.floor(slot / tilesetCols.value) }
}

const PALETTE_SCALE = 1.5

function drawTilesetPalette(): void {
  const canvas = tilesetCanvasRef.value
  const img = tilesetImg.value
  if (!canvas || !img) return
  const w = img.naturalWidth * PALETTE_SCALE
  const h = img.naturalHeight * PALETTE_SCALE
  const dpr = window.devicePixelRatio || 1
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.width = Math.ceil(w * dpr)
  canvas.height = Math.ceil(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  // Highlight the selected tile.
  const { col, row } = tileSource(selectedTile.value)
  const tw = tileW.value * PALETTE_SCALE
  const th = tileH.value * PALETTE_SCALE
  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = 2
  ctx.strokeRect(col * tw + 1, row * th + 1, tw - 2, th - 2)
}

function onPaletteClick(e: MouseEvent): void {
  const canvas = tilesetCanvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const tw = tileW.value * PALETTE_SCALE
  const th = tileH.value * PALETTE_SCALE
  const col = Math.floor(mx / tw)
  const row = Math.floor(my / th)
  if (col < 0 || col >= tilesetCols.value) return
  const id = row * tilesetCols.value + col + 1
  selectedTile.value = id
  drawTilesetPalette()
}

// ───────────────────────────────────────────────────────────────────────────
// Building-group stamp (建筑) — drop a whole multi-tile building onto the map.
// The group is a standalone image; on stamp we slice it into tile cells, make
// sure each (content-addressed, deduped) slice is present in this map's tileset
// — auto-extending + rebuilding tileset.png when needed, append-only so existing
// GIDs stay valid — then paint the W×H GID block as one undo stroke.
// ───────────────────────────────────────────────────────────────────────────
const selectedGroup = ref<GroupEntry | null>(null)
const stamping = ref(false)
const stampHover = ref<{ x: number; y: number } | null>(null)
/** True while the mouse is held down with the stamp tool (drag-stamping). */
const stampDragging = ref(false)
/** The last footprint slot stamped during the current drag, so each grid slot is
 *  stamped once instead of re-stamping it on every mousemove. */
let lastStampCell: { x: number; y: number } | null = null
/** Anchor cell of the current stamp drag (the first mousedown cell). Buildings
 *  snap to a g.w×g.h grid relative to it, so they tile without overlapping. */
let stampOrigin: { x: number; y: number } | null = null

function selectGroup(g: GroupEntry): void {
  selectedGroup.value = g
  tool.value = 'stamp'
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// FNV-1a over a slice's RGBA bytes → a stable content-addressed tile id, so
// identical cells and repeated stamps share one tileset tile, and a pixel-
// refined group produces new ids that simply append.
function hashRGBA(d: Uint8ClampedArray): string {
  let h = 0x811c9dc5
  for (let i = 0; i < d.length; i++) {
    h ^= d[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

async function stampBuilding(atX: number, atY: number): Promise<void> {
  const g = selectedGroup.value
  const map = tmx.value
  if (!g || !map || stamping.value) return
  stamping.value = true
  try {
    const ts = tileW.value
    const img = await loadImage(tilesStore.groupUrl(g.id))
    if (!img) return
    // Slice the building into g.h×g.w cells: skip fully-transparent ones, and
    // content-address the rest.
    const oc = document.createElement('canvas')
    oc.width = ts
    oc.height = ts
    const octx = oc.getContext('2d')!
    octx.imageSmoothingEnabled = false
    const cellId: (string | null)[] = new Array(g.w * g.h).fill(null)
    const freshPng = new Map<string, string>() // slice id → data URL (this stamp)
    for (let cy = 0; cy < g.h; cy++) {
      for (let cx = 0; cx < g.w; cx++) {
        octx.clearRect(0, 0, ts, ts)
        octx.drawImage(img, cx * ts, cy * ts, ts, ts, 0, 0, ts, ts)
        const data = octx.getImageData(0, 0, ts, ts).data
        let opaque = false
        for (let p = 3; p < data.length; p += 4) {
          if (data[p] !== 0) { opaque = true; break }
        }
        if (!opaque) continue
        const id = `${g.id}_${hashRGBA(data)}`
        cellId[cy * g.w + cx] = id
        if (!freshPng.has(id)) freshPng.set(id, oc.toDataURL('image/png'))
      }
    }
    // Persist the group's own slice tiles (tagged so they stay hidden from the
    // harvest library) — keeps the tileset rebuildable from tileset.tiles.json.
    await Promise.all(
      [...freshPng].map(([id, url]) => tilesStore.saveTile(url, { id, source: `group:${g.id}` })),
    )
    // Ensure every slice id is in the map's tileset (append-only).
    const seq = await tilesStore.loadTilesetSeq(mapName.value)
    const ids = [...seq.tileIds]
    const cols = seq.cols || 8
    let changed = false
    for (const id of new Set(cellId.filter(Boolean) as string[])) {
      if (!ids.includes(id)) {
        ids.push(id)
        changed = true
      }
    }
    if (changed) {
      // Compose tileset.png: existing tiles from the library, fresh slices from
      // their in-memory data URLs (no write-then-read race).
      const rows = Math.ceil(ids.length / cols)
      const canvas = document.createElement('canvas')
      canvas.width = cols * ts
      canvas.height = rows * ts
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      const imgs = await Promise.all(
        ids.map((id) => loadImage(freshPng.get(id) ?? tilesStore.tileUrl(id))),
      )
      imgs.forEach((im, i) => {
        if (im) ctx.drawImage(im, (i % cols) * ts, Math.floor(i / cols) * ts, ts, ts)
      })
      await tilesStore.buildTileset(mapName.value, canvas.toDataURL('image/png'), ids, cols)
      await loadTileset(mapName.value)
    }
    // Paint the footprint as a single undo stroke (skip empty cells).
    store.beginStroke(activeLayer.value)
    for (let cy = 0; cy < g.h; cy++) {
      for (let cx = 0; cx < g.w; cx++) {
        const id = cellId[cy * g.w + cx]
        if (!id) continue
        store.setCell(activeLayer.value, atX + cx, atY + cy, ids.indexOf(id) + 1)
      }
    }
    store.endStroke()
    afterEdit()
  } finally {
    stamping.value = false
  }
}

// Snap a hovered cell to the footprint grid anchored at the drag origin, so
// dragging tiles buildings edge-to-edge (no overlap) instead of one per cell.
// Without an active drag origin the cell is returned unchanged (free hover).
function snapStampCell(cell: { x: number; y: number }): { x: number; y: number } {
  const g = selectedGroup.value
  if (!g || !stampOrigin) return cell
  const gw = Math.max(1, g.w)
  const gh = Math.max(1, g.h)
  return {
    x: stampOrigin.x + Math.floor((cell.x - stampOrigin.x) / gw) * gw,
    y: stampOrigin.y + Math.floor((cell.y - stampOrigin.y) / gh) * gh,
  }
}

// Stamp at `cell` if it differs from the last stamped slot, then — while still
// dragging — catch up to wherever the cursor has moved to. stampBuilding's own
// `stamping` guard serializes the async pipeline (slice → ensure tileset →
// paint), so moves that arrive mid-stamp are dropped; this trailing catch-up
// makes sure the final hovered slot still gets a building when the drag pauses.
async function stampAt(cell: { x: number; y: number }): Promise<void> {
  if (stamping.value) return
  if (lastStampCell && lastStampCell.x === cell.x && lastStampCell.y === cell.y) return
  lastStampCell = { x: cell.x, y: cell.y }
  await stampBuilding(cell.x, cell.y)
  if (
    stampDragging.value && stampHover.value &&
    (stampHover.value.x !== lastStampCell.x || stampHover.value.y !== lastStampCell.y)
  ) {
    void stampAt(stampHover.value)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Map canvas render
// ───────────────────────────────────────────────────────────────────────────

const canvasPxW = computed(() =>
  tmx.value ? tmx.value.width * tileW.value * zoom.value
  : backdropImg.value ? backdropImg.value.naturalWidth * zoom.value : 0)
const canvasPxH = computed(() =>
  tmx.value ? tmx.value.height * tileH.value * zoom.value
  : backdropImg.value ? backdropImg.value.naturalHeight * zoom.value : 0)

/** Render only the source.png reference (a map with no authored tilemap yet). */
function drawBackdropOnly(): void {
  const canvas = canvasRef.value
  const img = backdropImg.value
  if (!canvas || !img) return
  const w = img.naturalWidth * zoom.value
  const h = img.naturalHeight * zoom.value
  const dpr = window.devicePixelRatio || 1
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.width = Math.ceil(w * dpr)
  canvas.height = Math.ceil(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
}

function drawMap(): void {
  const canvas = canvasRef.value
  const map = tmx.value
  if (!canvas) return
  if (!map) { drawBackdropOnly(); return }

  const cell = tileW.value * zoom.value
  const cellH = tileH.value * zoom.value
  const w = map.width * cell
  const h = map.height * cellH
  const dpr = window.devicePixelRatio || 1
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.width = Math.ceil(w * dpr)
  canvas.height = Math.ceil(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false

  // Dark checker background for empty cells.
  const checkA = '#0f172a'
  const checkB = '#1e293b'
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? checkA : checkB
      ctx.fillRect(x * cell, y * cellH, cell, cellH)
    }
  }

  // Art-reference backdrop, stretched to the map area, under the tile layers.
  if (showBackdrop.value && backdropImg.value) {
    ctx.globalAlpha = backdropOpacity.value
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(backdropImg.value, 0, 0, w, h)
    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = 1
  }

  const img = tilesetImg.value
  const tw = tileW.value
  const th = tileH.value

  // Draw all paint layers in order (collision is a separate overlay, not a layer).
  map.layers.forEach((layer, li) => {
    if (layerVisible.value[li] === false) return
    if (img) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const id = layer.data[y * map.width + x] ?? 0
          if (id <= 0) continue
          const { col, row } = tileSource(id)
          ctx.drawImage(
            img,
            col * tw, row * th, tw, th,
            x * cell, y * cellH, cell, cellH
          )
        }
      }
    }
  })

  // Collision overlay: the selected elevation level at full alpha, other levels
  // dimmed in distinct hues so authors can see overlap between levels.
  if (collisionVisible.value) {
    const LEVEL_HUES = ['239, 68, 68', '59, 130, 246', '34, 197, 94', '168, 85, 247']
    store.collisionLevels.forEach((grid, level) => {
      if (!grid) return
      const hue = LEVEL_HUES[level] ?? '168, 85, 247'
      const alpha = level === collisionLevel.value ? 0.45 : 0.2
      ctx.fillStyle = `rgba(${hue}, ${alpha})`
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (grid[y * map.width + x]) {
            ctx.fillRect(x * cell, y * cellH, cell, cellH)
          }
        }
      }
    })
  }

  // Stairs overlay: ▲ = ascend one level (1), ▼ = descend one level (2).
  const stairGrid = stairsGrid.value
  if (stairGrid && stairsVisible.value) {
    const fontPx = Math.max(8, Math.floor(Math.min(cell, cellH) * 0.6))
    ctx.font = `bold ${fontPx}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const v = stairGrid[y * map.width + x]
        if (!v) continue
        const up = v === 1
        ctx.fillStyle = up ? 'rgba(34, 197, 94, 0.4)' : 'rgba(245, 158, 11, 0.4)'
        ctx.fillRect(x * cell, y * cellH, cell, cellH)
        ctx.fillStyle = '#fff'
        ctx.fillText(up ? '▲' : '▼', x * cell + cell / 2, y * cellH + cellH / 2)
      }
    }
  }

  // Grid lines when zoomed in enough.
  if (zoom.value >= 1) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= map.width; x++) {
      const px = Math.round(x * cell) + 0.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, h)
    }
    for (let y = 0; y <= map.height; y++) {
      const py = Math.round(y * cellH) + 0.5
      ctx.moveTo(0, py)
      ctx.lineTo(w, py)
    }
    ctx.stroke()
  }

  // Entity overlay (NPCs / warps / signs).
  if (objects.value) drawEntities(ctx, cell, cellH)

  // Building-stamp footprint preview (where the selected building will land).
  if (tool.value === 'stamp' && selectedGroup.value && stampHover.value) {
    const g = selectedGroup.value
    const hx = stampHover.value.x * cell
    const hy = stampHover.value.y * cellH
    ctx.fillStyle = 'rgba(59,130,246,0.18)'
    ctx.fillRect(hx, hy, g.w * cell, g.h * cellH)
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.strokeRect(hx + 1, hy + 1, g.w * cell - 2, g.h * cellH - 2)
  }
}

function drawEntities(ctx: CanvasRenderingContext2D, cell: number, cellH: number): void {
  const o = objects.value
  if (!o) return
  const fontPx = Math.max(8, Math.floor(Math.min(cell, cellH) * 0.5))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${fontPx}px sans-serif`
  const marker = (x: number, y: number, fill: string, label: string, sel: boolean) => {
    const px = x * cell
    const py = y * cellH
    ctx.fillStyle = fill
    ctx.fillRect(px + 1, py + 1, cell - 2, cellH - 2)
    ctx.lineWidth = sel ? 3 : 1.5
    ctx.strokeStyle = sel ? '#fde047' : 'rgba(0,0,0,0.7)'
    ctx.strokeRect(px + 1, py + 1, cell - 2, cellH - 2)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, px + cell / 2, py + cellH / 2)
  }
  o.warps.forEach((w, i) =>
    marker(w.x, w.y, 'rgba(34,197,94,0.75)', '↦',
      selected.value?.kind === 'warp' && selected.value.index === i),
  )
  o.npcs.forEach((n, i) =>
    marker(n.x, n.y, 'rgba(59,130,246,0.8)', String(n.id),
      selected.value?.kind === 'npc' && selected.value.index === i),
  )
  for (const [i, s] of (o.signs ?? []).entries()) {
    marker(s.x, s.y, 'rgba(146,64,14,0.8)', 'i',
      selected.value?.kind === 'sign' && selected.value.index === i)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Minimap
// ───────────────────────────────────────────────────────────────────────────

const MINIMAP_MAX = 160

function drawMinimap(): void {
  const canvas = minimapRef.value
  const map = tmx.value
  if (!canvas || !map) return
  const scale = Math.min(MINIMAP_MAX / map.width, MINIMAP_MAX / map.height, 4)
  const w = Math.max(1, Math.round(map.width * scale))
  const h = Math.max(1, Math.round(map.height * scale))
  const dpr = window.devicePixelRatio || 1
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.width = Math.ceil(w * dpr)
  canvas.height = Math.ceil(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, w, h)

  const img = tilesetImg.value
  const tw = tileW.value
  const th = tileH.value
  if (img) {
    map.layers.forEach((layer, li) => {
      if (layerVisible.value[li] === false) return
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const id = layer.data[y * map.width + x] ?? 0
          if (id <= 0) continue
          const { col, row } = tileSource(id)
          ctx.drawImage(img, col * tw, row * th, tw, th, x * scale, y * scale, scale, scale)
        }
      }
    })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Painting interaction
// ───────────────────────────────────────────────────────────────────────────

const isPainting = ref(false)
const isPanning = ref(false)
const panStart = ref({ x: 0, y: 0, sx: 0, sy: 0 })
const spaceDown = ref(false)

function cellAt(e: MouseEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value
  const map = tmx.value
  if (!canvas || !map) return null
  const rect = canvas.getBoundingClientRect()
  const cell = tileW.value * zoom.value
  const cellH = tileH.value * zoom.value
  const x = Math.floor((e.clientX - rect.left) / cell)
  const y = Math.floor((e.clientY - rect.top) / cellH)
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null
  return { x, y }
}

function paintCell(x: number, y: number): void {
  if (tool.value === 'brush') {
    store.setCell(activeLayer.value, x, y, selectedTile.value)
  } else if (tool.value === 'eraser') {
    store.setCell(activeLayer.value, x, y, 0)
  }
}

function onCanvasMouseDown(e: MouseEvent): void {
  if (!tmx.value) return
  // Pan: middle button, or space held + left.
  if (e.button === 1 || (e.button === 0 && spaceDown.value)) {
    e.preventDefault()
    const sc = scrollRef.value
    if (!sc) return
    isPanning.value = true
    panStart.value = { x: e.clientX, y: e.clientY, sx: sc.scrollLeft, sy: sc.scrollTop }
    return
  }
  if (e.button !== 0) return
  if (tool.value === 'objects') {
    onObjectsMouseDown(e)
    return
  }
  const cell = cellAt(e)
  if (!cell) return

  if (tool.value === 'bucket') {
    store.bucketFill(activeLayer.value, cell.x, cell.y, selectedTile.value)
    afterEdit()
    return
  }
  if (tool.value === 'collision') {
    store.toggleCollision(cell.x, cell.y, collisionLevel.value)
    afterEdit()
    return
  }
  if (tool.value === 'stairs') {
    store.setStair(cell.x, cell.y, stairBrush.value)
    afterEdit()
    return
  }
  if (tool.value === 'stamp') {
    // Begin a stamp drag: this cell is the anchor; dragging tiles more buildings
    // on a footprint-aligned grid from here.
    stampDragging.value = true
    stampOrigin = { x: cell.x, y: cell.y }
    lastStampCell = null
    stampHover.value = cell
    void stampAt(cell)
    return
  }
  // Brush / eraser: continuous stroke.
  isPainting.value = true
  store.beginStroke(activeLayer.value)
  paintCell(cell.x, cell.y)
  drawMap()
}

function onCanvasMouseMove(e: MouseEvent): void {
  if (isPanning.value) {
    const sc = scrollRef.value
    if (!sc) return
    sc.scrollLeft = panStart.value.sx - (e.clientX - panStart.value.x)
    sc.scrollTop = panStart.value.sy - (e.clientY - panStart.value.y)
    return
  }
  if (tool.value === 'objects') {
    onObjectsMouseMove(e)
    return
  }
  if (tool.value === 'stamp') {
    const raw = cellAt(e)
    // While dragging, snap to the footprint grid so buildings tile without
    // overlapping; otherwise the preview follows the cursor freely.
    const cell = raw && stampDragging.value ? snapStampCell(raw) : raw
    if (cell && (cell.x !== stampHover.value?.x || cell.y !== stampHover.value?.y)) {
      stampHover.value = cell
      drawMap()
    }
    // While dragging, stamp another building at each new grid slot entered.
    if (stampDragging.value && cell) void stampAt(cell)
    return
  }
  if (!isPainting.value) return
  const cell = cellAt(e)
  if (!cell) return
  paintCell(cell.x, cell.y)
  drawMap()
}

function onCanvasMouseUp(): void {
  if (isPanning.value) {
    isPanning.value = false
    return
  }
  if (draggingEntity.value) {
    draggingEntity.value = false
    return
  }
  if (stampDragging.value) {
    stampDragging.value = false
    lastStampCell = null
    stampOrigin = null
    return
  }
  if (isPainting.value) {
    isPainting.value = false
    store.endStroke()
    afterEdit()
  }
}

function onCanvasMouseLeave(): void {
  onCanvasMouseUp()
  if (stampHover.value) {
    stampHover.value = null
    drawMap()
  }
}

function afterEdit(): void {
  drawMap()
  drawMinimap()
}

// ── Zoom ──
function onWheel(e: WheelEvent): void {
  if (!tmx.value && !backdropImg.value) return
  if (!(e.ctrlKey || e.metaKey)) return // plain wheel = scroll
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.25 : 0.25
  setZoom(zoom.value + delta)
}

function setZoom(z: number): void {
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
  nextTick(() => drawMap())
}

function zoomIn(): void { setZoom(zoom.value + 0.25) }
function zoomOut(): void { setZoom(zoom.value - 0.25) }
function resetView(): void { zoom.value = 1 }

// ───────────────────────────────────────────────────────────────────────────
// Screen-camera helper box
//   An overlay sized to the game's on-screen camera so the author can see how
//   much of the map the real game frames at once. The size is the game's
//   logical framebuffer in px (map config `screen`, e.g. 426×240 for 星令传奇,
//   defaulting to a 160×144 Game Boy frame). The editor draws 1 game-px =
//   `zoom` CSS-px, so the box is just that size scaled by zoom. Drag it by its
//   label to move it; the body is click-through so painting still works.
// ───────────────────────────────────────────────────────────────────────────
/** The game's logical screen size in px — drives the camera helper box. Comes
 *  from the Config tab's editable setting (falling back to the map activity's
 *  declared default, then a Game Boy frame); see useEditorSettings. */
const editorSettings = useEditorSettings()
const cameraScreen = computed(() => {
  const s = editorSettings.screen.value
  return { w: s.width, h: s.height }
})
const showCamera = ref(false)
/** Top-left corner of the camera box, in map tile coordinates. */
const cameraPos = ref({ x: 0, y: 0 })
/** Camera span in whole tiles (rounded-control up) — for clamping/centering the box. */
const cameraTilesW = computed(() => Math.max(1, Math.ceil(cameraScreen.value.w / tileW.value)))
const cameraTilesH = computed(() => Math.max(1, Math.ceil(cameraScreen.value.h / tileH.value)))
/** Box geometry in CSS px, matching the canvas so it scrolls and scales with it. */
const cameraBox = computed(() => ({
  left: cameraPos.value.x * tileW.value * zoom.value,
  top: cameraPos.value.y * tileH.value * zoom.value,
  width: cameraScreen.value.w * zoom.value,
  height: cameraScreen.value.h * zoom.value,
}))

function clampCamera(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(0, (tmx.value?.width ?? cameraTilesW.value) - cameraTilesW.value)
  const maxY = Math.max(0, (tmx.value?.height ?? cameraTilesH.value) - cameraTilesH.value)
  return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) }
}
/** Place the box at the map centre (also re-clamps it into bounds). */
function centerCamera(): void {
  const mw = tmx.value?.width ?? cameraTilesW.value
  const mh = tmx.value?.height ?? cameraTilesH.value
  cameraPos.value = clampCamera(
    Math.floor((mw - cameraTilesW.value) / 2),
    Math.floor((mh - cameraTilesH.value) / 2),
  )
}
function toggleCamera(): void {
  showCamera.value = !showCamera.value
  if (showCamera.value) centerCamera()
}

let camDrag: { cx: number; cy: number; ox: number; oy: number } | null = null
function onCameraDown(e: PointerEvent): void {
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  camDrag = { cx: e.clientX, cy: e.clientY, ox: cameraPos.value.x, oy: cameraPos.value.y }
}
function onCameraMove(e: PointerEvent): void {
  if (!camDrag) return
  const dx = Math.round((e.clientX - camDrag.cx) / (tileW.value * zoom.value))
  const dy = Math.round((e.clientY - camDrag.cy) / (tileH.value * zoom.value))
  cameraPos.value = clampCamera(camDrag.ox + dx, camDrag.oy + dy)
}
function onCameraUp(): void { camDrag = null }

// ───────────────────────────────────────────────────────────────────────────
// Layers panel
// ───────────────────────────────────────────────────────────────────────────

/** Panel rows, top-of-list = topmost (drawn last / in front). The store keeps
 *  layers in draw order (index 0 = bottom-most), so we present them reversed to
 *  match the familiar "top layer is on top" convention. Each row carries its
 *  real array index, which every row action uses. */
const layerRows = computed(() =>
  layers.value.map((layer, index) => ({ layer, index })).reverse(),
)

function selectLayer(i: number): void { activeLayer.value = i }
function toggleLayerVisible(i: number): void {
  store.setLayerVisible(i, !(layerVisible.value[i] !== false))
  afterEdit()
}
function addLayer(): void {
  store.addLayer()
  afterEdit()
}
function removeLayerPrompt(i: number): void {
  const name = layers.value[i]?.name ?? ''
  if (!confirm(t('map.confirmRemoveLayer', { name }))) return
  if (store.removeLayer(i)) afterEdit()
}
function moveLayerBy(i: number, delta: number): void {
  if (store.moveLayer(i, i + delta)) afterEdit()
}

/** Elevation slots in the collision level selector: every level that has data,
 *  plus the currently-selected one (so a just-added empty level stays visible
 *  until painted). */
const collisionLevelSlots = computed(() => {
  const n = Math.max(levelCount.value, collisionLevel.value + 1)
  return Array.from({ length: n }, (_, i) => i)
})

/** Select the next elevation level beyond the current max — its collision grid
 *  is created lazily on the first paint at that level. */
function addCollisionLevel(): void {
  collisionLevel.value = collisionLevelSlots.value.length
}

/** Layer row elevation-level stepper → the layer's `level` custom property. */
function onLayerLevelChange(i: number, e: Event): void {
  const v = Math.max(0, Math.trunc(Number((e.target as HTMLInputElement).value) || 0))
  store.setLayerLevel(i, v)
}

/** Autofocus + select an inline-rename field the moment it mounts. */
function onRenameFocus(el: unknown): void {
  if (el) { const i = el as HTMLInputElement; i.focus(); i.select() }
}

// ── Map list: search filter + inline rename ──
const mapFilter = ref('')
const filteredMapList = computed(() => {
  const q = mapFilter.value.trim().toLowerCase()
  return q ? mapList.value.filter(m => m.name.toLowerCase().includes(q)) : mapList.value
})
const renamingMap = ref<string | null>(null)
const mapRenameDraft = ref('')
function startRenameMap(name: string): void {
  renamingMap.value = name
  mapRenameDraft.value = name
}
function cancelRenameMap(): void { renamingMap.value = null }
async function commitRenameMap(name: string): Promise<void> {
  if (renamingMap.value !== name) return // esc already cancelled (fires blur)
  const nn = mapRenameDraft.value.trim()
  renamingMap.value = null
  if (!nn || nn === name) return
  // Find references first; if any exist, confirm a synced rewrite — otherwise the
  // rename would silently break warps/scenes/quests pointing at the old name.
  const { refs, total } = await store.mapReferences(name)
  let updateRefs = false
  if (total > 0) {
    const list = refs.map(r => `  • ${r.file} (${r.count})`).join('\n')
    if (!window.confirm(t('map.renameRefsConfirm', { name, count: total, files: refs.length, list }))) return
    updateRefs = true
  }
  const res = await store.renameMap(name, nn, updateRefs) // server rejects invalid chars; error surfaces via store.error
  if (res.ok && res.updated > 0) window.alert(t('map.renameRefsDone', { count: res.updated }))
}

// ── Layer inline rename ──
const renamingLayer = ref<number | null>(null)
const layerRenameDraft = ref('')
function startRenameLayer(i: number): void {
  renamingLayer.value = i
  layerRenameDraft.value = layers.value[i]?.name ?? ''
}
function cancelRenameLayer(): void { renamingLayer.value = null }
function commitRenameLayer(i: number): void {
  if (renamingLayer.value !== i) return
  const nn = layerRenameDraft.value.trim()
  renamingLayer.value = null
  store.renameLayer(i, nn) // reactive layer name updates the panel; no redraw needed
}

// ── Save / undo / redo ──
async function handleSave(): Promise<void> {
  await store.saveMap()
  if (objectsEnabled.value) await store.saveObjects()
}
// Undo/redo may reverse a resize (changing the map dimensions), so re-clamp the
// camera box and repaint everything that reads the map size.
function handleUndo(): void { store.undo(); cameraPos.value = clampCamera(cameraPos.value.x, cameraPos.value.y); afterEdit() }
function handleRedo(): void { store.redo(); cameraPos.value = clampCamera(cameraPos.value.x, cameraPos.value.y); afterEdit() }

// ── Keyboard ──
function onKeyDown(e: KeyboardEvent): void {
  if (e.code === 'Space') { spaceDown.value = true; return }
  // Delete the selected NPC/warp with Delete/Backspace — unless typing in a field.
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value) {
    const el = e.target as HTMLElement | null
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    if (!typing) { e.preventDefault(); deleteSelected(); return }
  }
  const meta = e.metaKey || e.ctrlKey
  if (meta && (e.key === 's' || e.key === 'S')) { e.preventDefault(); handleSave(); return }
  if (meta && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    if (e.shiftKey) handleRedo()
    else handleUndo()
    return
  }
  if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); handleRedo() }
}
function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') spaceDown.value = false
}

// ── Restore after remount ──
/** Repaint the open map after the component remounts (e.g. leaving the map
 *  activity for another one and coming back). Remounting hands us a fresh blank
 *  <canvas> and resets the component-local image refs (backdropImg/tilesetImg)
 *  to null, while the Pinia store still holds the open map and any unsaved
 *  edits. So we reload just the images and redraw — deliberately WITHOUT
 *  re-fetching the map data, which would discard edits and reset undo history. */
async function restoreView(): Promise<void> {
  const name = mapName.value
  if (!name) return
  const entry = mapList.value.find(m => m.name === name)
  if (entry?.hasBackdrop) await loadBackdrop(name)
  if (tmx.value) await loadTileset(name)
  await nextTick()
  drawMap()
  drawMinimap()
}

// ── Lifecycle ──
/** The assistant's ACT image skills announce map art changes here. */
function onBackdropUpdated(e: Event): void {
  const detail = (e as CustomEvent<{ map?: string | null; kind?: string }>).detail
  if (!detail || !mapName.value) return
  if (detail.map != null && detail.map !== mapName.value) return
  void store.fetchList()
  if (detail.kind === 'traced') {
    // The map gained a real tilemap: drop the cached backdrop-only state and
    // reopen it so the editor switches to the editable tilemap.
    mapCache.value.delete(mapName.value)
    void openMapTab(mapName.value)
  } else {
    void onBackdropGenerated()
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  window.addEventListener('jrpg:backdrop-updated', onBackdropUpdated)
  void editorSettings.load()
  // No longer restore a stale single-map view — the user opens maps
  // via sidebar clicks, which go through openMapTab() with save/restore.
  store.fetchList()
  tilesStore.loadGroups()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('jrpg:backdrop-updated', onBackdropUpdated)
})

// Redraw palette when selection changes.
watch(selectedTile, () => drawTilesetPalette())
// Switching tools refreshes the canvas (e.g. clears the stamp footprint).
watch(tool, () => drawMap())
// Switching back to any map sub-tab: browser may have discarded the hidden
// canvas backing buffer (especially under memory pressure), so proactively
// redraw from the in-memory tile data.
watch(activeSubTab, (tab, prev) => {
  if (!tab || !prev || tab === prev) return
  if (tab.startsWith('map:') && !prev.startsWith('map:')) {
    // Coming from a non-map tab → redraw the canvas
    nextTick(() => { drawMap(); drawMinimap() })
  } else if (tab.startsWith('map:') && prev.startsWith('map:')) {
    // Switching between maps → state was already restored in openMapTab,
    // but images (tileset/backdrop) may still be loading. Redraw after nextTick.
    nextTick(() => { drawMap(); drawMinimap() })
  }
})
</script>

<template>
  <div class="flex h-full overflow-hidden bg-canvas text-ink-secondary">
    <!-- ═══ Map list ═══ -->
    <aside class="w-48 bg-surface border-r border-border flex flex-col shrink-0">
      <div class="px-3 py-2 border-b border-border flex items-center justify-between">
        <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          {{ $t('map.title') }}
        </h2>
        <button
          @click="openNewDialog"
          class="text-xs px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay text-ink-secondary"
          :title="$t('map.newMap')"
        >＋</button>
      </div>
      <div class="px-2 py-1.5 border-b border-border">
        <input
          v-model="mapFilter"
          :placeholder="$t('map.searchMaps')"
          class="w-full px-2 py-1 text-xs bg-inset border border-border rounded-control text-ink-secondary placeholder-gray-500 outline-none focus:border-accent-strong"
        />
      </div>
      <div class="flex-1 overflow-y-auto p-1">
        <div v-if="loadingList" class="p-3 text-sm text-ink-faint">{{ $t('map.loading') }}</div>
        <div v-else-if="mapList.length === 0" class="p-3 space-y-3">
          <p class="text-sm text-ink-faint">{{ $t('map.noMaps') }}</p>
          <!-- First-run guidance: create a map by hand or let the AI draft one -->
          <div class="flex flex-col gap-2">
            <button
              @click="openNewDialog"
              class="px-3 py-1.5 rounded-control text-xs font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
            >{{ $t('map.newMap') }}</button>
            <button
              @click="openAssistant"
              class="px-3 py-1.5 rounded-control text-xs font-medium bg-raised hover:bg-overlay text-ink-secondary transition-colors"
            >{{ $t('map.askAi') }}</button>
          </div>
        </div>
        <div v-else-if="filteredMapList.length === 0" class="p-3 text-sm text-ink-faint">
          {{ $t('map.noMapsMatch') }}
        </div>
        <div v-for="m in filteredMapList" :key="m.name" class="group relative">
          <!-- inline rename -->
          <div v-if="renamingMap === m.name" class="p-1">
            <input
              :ref="onRenameFocus"
              v-model="mapRenameDraft"
              maxlength="40"
              :title="$t('map.renameMapRule')"
              class="w-full px-2 py-1 text-sm bg-canvas border border-accent-strong rounded-control text-ink outline-none"
              @keydown.enter.prevent="commitRenameMap(m.name)"
              @keydown.esc.prevent="cancelRenameMap()"
              @blur="commitRenameMap(m.name)"
            />
          </div>
          <template v-else>
            <button
              @click="openMapTab(m.name)"
              :class="[
                'w-full text-left pl-3 pr-12 py-1.5 text-sm rounded-control transition-colors flex items-center gap-1.5',
                activeSubTab === `map:${m.name}`
                  ? 'bg-accent-surface text-accent-ink-strong font-medium'
                  : m.hasTilemap
                    ? 'text-ink-body hover:bg-raised/50 hover:text-ink'
                    : 'text-ink-faint hover:bg-raised/50 hover:text-ink-body',
              ]"
            >
              <span class="truncate flex-1">{{ m.name }}</span>
              <span
                v-if="!m.hasTilemap"
                class="text-[9px] px-1 rounded-control shrink-0"
                :class="m.hasBackdrop ? 'bg-warning/20 text-warning-ink' : 'bg-overlay/40 text-ink-faint'"
              >{{ m.hasBackdrop ? $t('map.refOnly') : $t('map.empty') }}</span>
            </button>
            <button
              @click.stop="startRenameMap(m.name)"
              class="absolute right-6 top-1/2 -translate-y-1/2 px-1 leading-none rounded-control text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-accent-surface hover:text-accent-ink-strong transition-opacity"
              :title="$t('map.renameMapHint')"
            >✎</button>
            <button
              @click.stop="deleteMapPrompt(m.name)"
              class="absolute right-1 top-1/2 -translate-y-1/2 px-1 leading-none rounded-control text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-danger/30 hover:text-danger-ink-strong transition-opacity"
              :title="$t('map.deleteMapHint')"
            >🗑</button>
          </template>
        </div>
      </div>
    </aside>

    <!-- ═══ Center: sub-tab system (map + building editors) ═══ -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Sub-tab bar -->
      <div class="flex items-center bg-surface border-b border-border shrink-0 pl-1 pr-2 min-h-[32px] overflow-x-auto">
        <button
          v-for="tab in mapTabs"
          :key="tab.id"
          @click="activeSubTab = tab.id"
          :class="[
            'px-3 py-1.5 text-xs border-b-2 transition-colors leading-none shrink-0 whitespace-nowrap flex items-center gap-1',
            activeSubTab === tab.id ? 'border-accent-ink text-accent-ink' : 'border-transparent text-ink-muted hover:text-ink-secondary',
          ]"
        >
          <span>🗺</span>
          <span class="truncate max-w-[120px]">{{ tab.label }}</span>
          <span
            @click.stop="closeTab(tab.id)"
            class="ml-0.5 w-3.5 h-3.5 rounded-control flex items-center justify-center text-micro leading-none hover:bg-overlay hover:text-ink"
          >×</span>
        </button>
        <button
          v-for="bt in buildingTabs"
          :key="bt.id"
          @click="activeSubTab = bt.id"
          :class="[
            'px-3 py-1.5 text-xs border-b-2 transition-colors leading-none shrink-0 whitespace-nowrap flex items-center gap-1',
            activeSubTab === bt.id ? 'border-accent-ink text-accent-ink' : 'border-transparent text-ink-muted hover:text-ink-secondary',
          ]"
        >
          <span>🏗</span>
          <span class="truncate max-w-[120px]">{{ bt.label }}</span>
          <span
            @click.stop="closeTab(bt.id)"
            class="ml-0.5 w-3.5 h-3.5 rounded-control flex items-center justify-center text-micro leading-none hover:bg-overlay hover:text-ink"
          >×</span>
        </button>
        <div v-if="subTabs.length === 0" class="px-3 py-1.5 text-xs text-ink-faint">
          {{ $t('map.selectToEdit') }}
        </div>
      </div>

      <!-- ═══ Map editor (v-show = keep canvas alive when switching tabs) ═══ -->
      <div v-show="activeSubTab?.startsWith('map:')" class="flex flex-col flex-1 min-h-0">
        <!-- Toolbar -->
        <div class="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border shrink-0 flex-wrap">
        <span v-if="mapName" class="text-sm text-ink-body font-medium truncate">{{ mapName }}</span>
        <span v-else class="text-sm text-ink-faint italic">{{ $t('map.selectToEdit') }}</span>

        <button v-if="mapName" @click="showBackdropGen = true"
          class="px-2 py-0.5 text-xs rounded-control bg-raised hover:bg-overlay text-ink-secondary"
        >✨ {{ $t('map.backdrop') }}</button>

        <!-- Backdrop-only: this map is just an art reference — offer to author over it -->
        <template v-if="backdropOnly">
          <span class="text-micro px-1.5 py-0.5 rounded-control bg-warning/20 text-warning-ink-strong">{{ $t('map.refOnly') }}</span>
          <button
            @click="showTrace = true"
            :disabled="creating || tracing"
            :title="$t('map.traceDesc')"
            class="px-2 py-0.5 text-xs rounded-control bg-success hover:bg-success-strong text-white disabled:opacity-50"
          >🗺 {{ tracing ? '…' : $t('map.traceToMap') }}</button>
          <button
            @click="createFromBackdrop"
            :disabled="creating || tracing"
            :title="$t('map.newFromBackdropHint')"
            class="px-2 py-0.5 text-xs rounded-control bg-accent hover:bg-accent-strong text-white disabled:opacity-50"
          >{{ creating ? '…' : $t('map.newFromBackdrop') }}</button>
          <span class="text-ink-disabled mx-1">|</span>
          <button @click="zoomOut" class="px-2 py-0.5 text-sm bg-raised hover:bg-overlay rounded-control text-ink-body">−</button>
          <span class="text-xs text-ink-faint w-10 text-center tabular-nums">{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn" class="px-2 py-0.5 text-sm bg-raised hover:bg-overlay rounded-control text-ink-body">+</button>
        </template>

        <!-- Backdrop reference toggle when a tilemap + backdrop coexist -->
        <template v-if="tmx && backdropImg">
          <span class="text-ink-disabled mx-1">|</span>
          <button
            @click="showBackdrop = !showBackdrop; drawMap()"
            :class="['px-2 py-0.5 text-xs rounded-control', showBackdrop ? 'bg-accent text-white' : 'bg-raised hover:bg-overlay text-ink-body']"
            :title="$t('map.backdrop')"
          >🖼 {{ $t('map.backdrop') }}</button>
          <input
            v-show="showBackdrop"
            type="range" min="0.1" max="1" step="0.05"
            v-model.number="backdropOpacity"
            @input="drawMap()"
            class="w-16 align-middle"
            :title="$t('map.backdropOpacity')"
          />
        </template>

        <template v-if="tmx">
          <span class="text-ink-disabled mx-1">|</span>
          <!-- Tools -->
          <div class="flex gap-1">
            <button
              v-for="tl in toolList"
              :key="tl"
              @click="tool = tl"
              :class="[
                'px-2 py-0.5 text-xs rounded-control transition-colors',
                tool === tl ? 'bg-accent text-white' : 'bg-raised hover:bg-overlay text-ink-body',
              ]"
            >
              {{ $t('map.tool.' + tl) }}
            </button>
          </div>

          <span class="text-ink-disabled mx-1">|</span>
          <!-- Undo / redo -->
          <button
            @click="handleUndo"
            :disabled="!canUndo"
            :class="['px-2 py-0.5 text-xs rounded-control', canUndo ? 'bg-raised hover:bg-overlay text-ink-body' : 'bg-surface text-ink-disabled cursor-not-allowed']"
            :title="$t('map.undo')"
          >↶</button>
          <button
            @click="handleRedo"
            :disabled="!canRedo"
            :class="['px-2 py-0.5 text-xs rounded-control', canRedo ? 'bg-raised hover:bg-overlay text-ink-body' : 'bg-surface text-ink-disabled cursor-not-allowed']"
            :title="$t('map.redo')"
          >↷</button>

          <span class="text-ink-disabled mx-1">|</span>
          <!-- Zoom -->
          <button @click="zoomOut" class="px-2 py-0.5 text-sm bg-raised hover:bg-overlay rounded-control text-ink-body">−</button>
          <span class="text-xs text-ink-faint w-10 text-center tabular-nums">{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn" class="px-2 py-0.5 text-sm bg-raised hover:bg-overlay rounded-control text-ink-body">+</button>
          <button @click="resetView" class="px-2 py-0.5 text-sm bg-raised hover:bg-overlay rounded-control text-ink-body" :title="$t('map.resetView')">↺</button>

          <span class="text-ink-disabled mx-1">|</span>
          <!-- Screen-camera helper box -->
          <button
            @click="toggleCamera"
            :class="['px-2 py-0.5 text-xs rounded-control', showCamera ? 'bg-warning text-gray-900' : 'bg-raised hover:bg-overlay text-ink-body']"
            :title="$t('map.cameraBoxHint')"
          >🎥 {{ $t('map.cameraBox') }}</button>

          <span class="text-ink-disabled mx-1">|</span>
          <!-- Resize the map canvas -->
          <button
            @click="openResizeDialog"
            class="px-2 py-0.5 text-xs rounded-control bg-raised hover:bg-overlay text-ink-body"
            :title="$t('map.resizeHint')"
          >⤡ {{ $t('map.resize') }}</button>

          <div class="flex-1" />
          <span
            v-if="dirty || objectsDirty"
            class="text-micro px-1.5 py-0.5 rounded-control bg-warning-surface text-warning-ink font-medium"
          >{{ $t('map.unsaved') }}</span>
          <button
            @click="handleSave"
            :disabled="(!dirty && !objectsDirty) || saving"
            :class="[
              'px-3 py-0.5 text-sm rounded-control transition-colors',
              (dirty || objectsDirty) && !saving ? 'bg-success-hover hover:bg-success text-green-200' : 'bg-raised text-ink-faint cursor-not-allowed',
            ]"
          >{{ saving ? $t('map.saving') : $t('map.save') }}</button>
        </template>
      </div>

      <!-- Canvas scroll area -->
      <div
        ref="scrollRef"
        class="flex-1 overflow-auto bg-canvas relative"
        :class="{ 'cursor-grab': spaceDown && !isPanning, 'cursor-grabbing': isPanning }"
        @wheel="onWheel"
        @mousedown="onCanvasMouseDown"
        @mousemove="onCanvasMouseMove"
        @mouseup="onCanvasMouseUp"
        @mouseleave="onCanvasMouseLeave"
        @contextmenu.prevent
      >
        <div v-if="!tmx && !backdropImg && !loading" class="absolute inset-0 flex items-center justify-center text-ink-disabled">
          <div class="text-center">
            <div class="text-3xl mb-2">🗺</div>
            <p class="text-sm">{{ activeMapName ? $t('map.noMapData', { name: activeMapName }) : $t('map.selectFromSidebar') }}</p>
          </div>
        </div>
        <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-ink-faint text-sm">
          {{ $t('map.loading') }}
        </div>
        <canvas
          v-show="tmx || backdropImg"
          ref="canvasRef"
          class="block"
          :style="{ width: canvasPxW + 'px', height: canvasPxH + 'px', imageRendering: 'pixelated' }"
        />

        <!-- Screen-camera helper: outlines the in-game viewport (160×144). The
             body is click-through; drag the label to reposition the box. -->
        <div
          v-if="showCamera && tmx"
          class="absolute border-2 border-warning-ink pointer-events-none z-10"
          :style="{ left: cameraBox.left + 'px', top: cameraBox.top + 'px', width: cameraBox.width + 'px', height: cameraBox.height + 'px' }"
        >
          <div
            class="absolute top-0 left-0 px-1.5 py-0.5 bg-warning-ink text-gray-900 text-micro font-medium leading-none cursor-move pointer-events-auto select-none whitespace-nowrap"
            @pointerdown="onCameraDown"
            @pointermove="onCameraMove"
            @pointerup="onCameraUp"
            @mousedown.stop
          >🎥 {{ cameraScreen.w }}×{{ cameraScreen.h }}</div>
        </div>
      </div>

      <!-- Status bar -->
      <div
        v-if="tmx"
        class="flex items-center gap-4 px-3 py-1 bg-surface border-t border-border text-xs text-ink-faint shrink-0"
      >
        <span>{{ $t('map.width') }} {{ tmx.width }} × {{ $t('map.height') }} {{ tmx.height }}</span>
        <span>{{ $t('map.selectedTile') }}: {{ selectedTile }}</span>
        <span v-if="error" class="text-danger-ink">{{ error }}</span>
        <span class="ml-auto text-ink-disabled">{{ $t('map.panHint') }}</span>
        </div>
      </div>

      <!-- ═══ Building editors (v-show = keep TilePixelEditor alive when switching tabs) ═══ -->
      <div v-show="activeSubTab?.startsWith('building:')" class="flex flex-col flex-1 min-h-0">
        <div
          v-for="bt in buildingTabs"
          :key="bt.id"
          v-show="activeSubTab === bt.id"
          class="flex-1 min-h-0"
        >
          <TilePixelEditor
            v-if="bt.group"
            embedded
            :key="bt.id"
            :tile-size="mapTileSize"
            :px-width="bt.group.w * mapTileSize"
            :px-height="bt.group.h * mapTileSize"
            :src-url="tilesStore.groupUrl(bt.group.id)"
            :src-layers-url="tilesStore.groupLayersUrl(bt.group.id)"
            :title="bt.group.name || bt.group.id"
            title-editable
            :persist="persistBuildingImage"
            @close="closeBuildingTab(bt.id)"
            @resized="onBuildingResized"
            @rename="onBuildingRenamed"
          />
        </div>
      </div>
    </div>

    <!-- ═══ Right sidebar ═══ -->
    <aside class="w-64 bg-surface border-l border-border flex flex-col shrink-0 overflow-hidden">
      <!-- ═══ Building groups (建筑) — always visible ═══ -->
      <div class="border-b border-border shrink-0">
        <div class="px-3 py-2 flex items-center justify-between">
          <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">{{ $t('map.buildings') }}</h2>
          <div class="flex items-center gap-1">
            <span v-if="stamping" class="text-micro text-accent-ink">{{ $t('map.stamping') }}</span>
            <button
              @click="openBrowseBuildings"
              class="text-micro px-1.5 py-0.5 rounded-control bg-accent-hover hover:bg-accent text-accent-ink-faint"
            >{{ $t('map.browseBuildings') }}</button>
          </div>
        </div>
        <div class="px-2 pb-2 max-h-40 overflow-y-auto">
          <div v-if="tilesStore.groups.length === 0" class="text-xs text-ink-faint px-1 pb-1">
            {{ $t('map.noBuildings') }}
          </div>
          <div v-else class="flex flex-wrap gap-1.5">
            <button
              v-for="g in tilesStore.groups"
              :key="g.id"
              @click="selectGroup(g)"
              @dblclick="openBuildingTab(g)"
              :class="[
                'border rounded-control p-0.5 bg-canvas hover:border-accent-ink',
                selectedGroup?.id === g.id ? 'border-accent-ink ring-1 ring-accent-ink' : 'border-border',
              ]"
              :title="`${g.name || g.id} · ${g.w}×${g.h} — ${$t('map.buildingEditor')}`"
            >
              <img :src="tilesStore.groupUrl(g.id)" class="block max-w-[64px] max-h-[64px]" style="image-rendering: pixelated" />
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ Map panels (map sub-tab only) ═══ -->
      <template v-if="activeSubTab?.startsWith('map:')">
        <template v-if="tmx">
        <!-- Entities (NPC / warp) -->
        <div v-if="objectsEnabled" class="border-b border-border">
          <div class="px-3 py-2 flex items-center justify-between">
            <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">{{ $t('map.entities') }}</h2>
            <div class="flex gap-1">
              <button @click="addNpcHere" class="text-micro px-1.5 py-0.5 rounded-control bg-accent-hover hover:bg-accent text-accent-ink-faint">{{ $t('map.addNpc') }}</button>
              <button @click="addWarpHere" class="text-micro px-1.5 py-0.5 rounded-control bg-success-hover hover:bg-success text-green-100">{{ $t('map.addWarp') }}</button>
              <button @click="addSignHere" class="text-micro px-1.5 py-0.5 rounded-control bg-warning-strong hover:bg-warning-hover text-on-warning">{{ $t('map.addSign') }}</button>
              <button v-if="selected" @click="deleteSelected" :title="$t('map.deleteSelectedHint')" class="text-micro px-1.5 py-0.5 rounded-control bg-red-700 hover:bg-danger text-red-100">{{ $t('common.delete') }}</button>
            </div>
          </div>
          <div class="px-3 pb-2 text-xs max-h-56 overflow-y-auto">
            <div v-if="selectedNpc" class="space-y-1.5">
              <div class="text-ink-muted">NPC #{{ selectedNpc.id }}</div>
              <label class="block text-ink-muted">名称
                <input v-model="selectedNpc.name" @input="store.markObjectsDirty()" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
              </label>
              <div class="flex gap-2">
                <label class="flex-1 text-ink-muted">x
                  <input type="number" v-model.number="selectedNpc.x" @input="afterObjectEdit" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
                <label class="flex-1 text-ink-muted">y
                  <input type="number" v-model.number="selectedNpc.y" @input="afterObjectEdit" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
              </div>
              <label class="block text-ink-muted">朝向
                <select v-model="selectedNpc.facing" @change="store.markObjectsDirty()" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary">
                  <option value="down">down</option>
                  <option value="up">up</option>
                  <option value="left">left</option>
                  <option value="right">right</option>
                </select>
              </label>
              <label class="block text-ink-muted">sprite
                <input v-model="selectedNpc.sprite" @input="store.markObjectsDirty()" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
              </label>
              <label class="block text-ink-muted">talk
                <input v-model="selectedNpc.talk" @input="store.markObjectsDirty()" placeholder="@story 或 storyline 名" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
              </label>
            </div>
            <div v-else-if="selectedWarp" class="space-y-1.5">
              <div class="text-ink-muted">Warp</div>
              <div class="flex gap-2">
                <label class="flex-1 text-ink-muted">x
                  <input type="number" v-model.number="selectedWarp.x" @input="afterObjectEdit" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
                <label class="flex-1 text-ink-muted">y
                  <input type="number" v-model.number="selectedWarp.y" @input="afterObjectEdit" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
              </div>
              <label class="block text-ink-muted">dest_map
                <input v-model="selectedWarp.dest_map" @input="store.markObjectsDirty()" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
              </label>
              <div class="flex gap-2">
                <label class="flex-1 text-ink-muted">dest_x
                  <input type="number" v-model.number="selectedWarp.dest_x" @input="store.markObjectsDirty()" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
                <label class="flex-1 text-ink-muted">dest_y
                  <input type="number" v-model.number="selectedWarp.dest_y" @input="store.markObjectsDirty()" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
              </div>
            </div>
            <div v-else-if="selectedSign" class="space-y-1.5">
              <div class="text-ink-muted">{{ $t('map.sign') }}</div>
              <div class="flex gap-2">
                <label class="flex-1 text-ink-muted">x
                  <input type="number" v-model.number="selectedSign.x" @input="afterObjectEdit" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
                <label class="flex-1 text-ink-muted">y
                  <input type="number" v-model.number="selectedSign.y" @input="afterObjectEdit" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
                </label>
              </div>
              <label class="block text-ink-muted">{{ $t('map.signText') }}
                <textarea v-model="selectedSign.text" @input="store.markObjectsDirty()" rows="3" class="w-full mt-0.5 px-1 py-0.5 bg-raised border border-border-strong rounded-control text-ink-secondary" />
              </label>
            </div>
            <div v-else class="text-ink-faint py-1">{{ $t('map.noObjects') }}</div>
          </div>
        </div>

        <!-- Layers -->
        <div class="border-b border-border">
          <div class="px-3 py-2 flex items-center justify-between">
            <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">{{ $t('map.layers') }}</h2>
            <button
              @click="addLayer"
              class="text-micro px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay text-ink-body"
              :title="$t('map.addLayerHint')"
            >{{ $t('map.addLayer') }}</button>
          </div>
          <div class="px-1 pb-2 max-h-40 overflow-y-auto">
            <div
              v-for="row in layerRows"
              :key="row.index"
              @click="selectLayer(row.index)"
              :class="[
                'group flex items-center gap-2 px-2 py-1 text-sm rounded-control cursor-pointer',
                activeLayer === row.index ? 'bg-accent-surface text-accent-ink-strong' : 'text-ink-muted hover:bg-raised/50',
              ]"
            >
              <button
                @click.stop="toggleLayerVisible(row.index)"
                class="w-4 text-center shrink-0"
                :title="$t('map.toggleVisible')"
              >{{ layerVisible[row.index] !== false ? '👁' : '–' }}</button>
              <input
                v-if="renamingLayer === row.index"
                :ref="onRenameFocus"
                v-model="layerRenameDraft"
                maxlength="40"
                class="flex-1 min-w-0 px-1 py-0.5 text-sm bg-canvas border border-accent-strong rounded-control text-ink outline-none"
                @click.stop
                @keydown.enter.prevent="commitRenameLayer(row.index)"
                @keydown.esc.prevent="cancelRenameLayer()"
                @blur="commitRenameLayer(row.index)"
              />
              <template v-else>
                <span class="truncate flex-1" @dblclick.stop="startRenameLayer(row.index)">{{ row.layer.name }}</span>
                <button
                  @click.stop="startRenameLayer(row.index)"
                  class="shrink-0 px-0.5 text-micro leading-none rounded-control text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink-secondary transition-opacity"
                  :title="$t('map.renameLayerHint')"
                >✎</button>
              </template>
              <input
                type="number"
                min="0"
                max="9"
                :value="store.layerLevel(row.index)"
                :title="$t('map.layerLevelHint')"
                class="shrink-0 w-8 px-0.5 text-micro text-center bg-inset border border-border rounded-control text-ink-muted outline-none focus:border-accent-strong"
                @click.stop
                @change="onLayerLevelChange(row.index, $event)"
              />
              <button
                @click.stop="moveLayerBy(row.index, 1)"
                :disabled="row.index === layers.length - 1"
                :class="[
                  'shrink-0 px-0.5 text-micro leading-none rounded-control transition-opacity',
                  row.index === layers.length - 1 ? 'opacity-0 cursor-default' : 'text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink-secondary',
                ]"
                :title="$t('map.moveLayerUp')"
              >▲</button>
              <button
                @click.stop="moveLayerBy(row.index, -1)"
                :disabled="row.index === 0"
                :class="[
                  'shrink-0 px-0.5 text-micro leading-none rounded-control transition-opacity',
                  row.index === 0 ? 'opacity-0 cursor-default' : 'text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink-secondary',
                ]"
                :title="$t('map.moveLayerDown')"
              >▼</button>
              <button
                v-if="layers.length > 1"
                @click.stop="removeLayerPrompt(row.index)"
                class="shrink-0 px-1 leading-none rounded-control text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-danger/30 hover:text-danger-ink-strong transition-opacity"
                :title="$t('map.removeLayerHint')"
              >🗑</button>
            </div>
          </div>
        </div>

        <!-- Collision (per elevation level) -->
        <div class="border-b border-border px-3 py-2">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">{{ $t('map.collision') }}</h2>
            <div class="flex items-center gap-2">
              <span class="text-micro" :class="hasCollision ? 'text-danger-ink' : 'text-ink-disabled'">
                {{ hasCollision ? $t('map.collisionOn') : $t('map.collisionEmpty') }}
              </span>
              <button
                @click="collisionVisible = !collisionVisible; drawMap()"
                class="w-5 text-center rounded-control hover:bg-raised"
                :title="$t('map.collisionToggleHint')"
              >{{ collisionVisible ? '👁' : '–' }}</button>
            </div>
          </div>
          <!-- Elevation level selector: paint/view each level's collision grid;
               "+" selects a level beyond the current max (grid created lazily
               on first paint). -->
          <div class="flex items-center gap-1 mt-1.5">
            <span class="text-micro text-ink-faint mr-0.5" :title="$t('map.collisionLevelHint')">{{ $t('map.collisionLevel') }}</span>
            <button
              v-for="lv in collisionLevelSlots"
              :key="lv"
              @click="collisionLevel = lv; drawMap()"
              :class="[
                'w-5 h-5 text-micro rounded-control leading-none',
                collisionLevel === lv ? 'bg-accent text-white' : 'bg-raised hover:bg-overlay text-ink-body',
              ]"
            >{{ lv }}</button>
            <button
              @click="addCollisionLevel(); drawMap()"
              class="w-5 h-5 text-micro rounded-control leading-none bg-raised hover:bg-overlay text-ink-body"
              :title="$t('map.collisionAddLevel')"
            >+</button>
          </div>
        </div>

        <!-- Stairs (ascend/descend one elevation level) -->
        <div class="border-b border-border px-3 py-2">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">{{ $t('map.stairs') }}</h2>
            <div class="flex items-center gap-2">
              <span class="text-micro" :class="stairsGrid ? 'text-success-ink' : 'text-ink-disabled'">
                {{ stairsGrid ? $t('map.collisionOn') : $t('map.collisionEmpty') }}
              </span>
              <button
                @click="stairsVisible = !stairsVisible; drawMap()"
                class="w-5 text-center rounded-control hover:bg-raised"
                :title="$t('map.stairsToggleHint')"
              >{{ stairsVisible ? '👁' : '–' }}</button>
            </div>
          </div>
          <!-- 3-state stair brush, used by the 楼梯 tool. -->
          <div class="flex items-center gap-1 mt-1.5">
            <button
              v-for="opt in ([1, 2, 0] as const)"
              :key="opt"
              @click="stairBrush = opt"
              :class="[
                'px-1.5 h-5 text-micro rounded-control leading-none',
                stairBrush === opt ? 'bg-accent text-white' : 'bg-raised hover:bg-overlay text-ink-body',
              ]"
            >{{ opt === 1 ? `▲ ${$t('map.stairUp')}` : opt === 2 ? `▼ ${$t('map.stairDown')}` : $t('map.stairClear') }}</button>
          </div>
        </div>

        <!-- Minimap -->
        <div class="border-b border-border px-3 py-2">
          <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">{{ $t('map.minimap') }}</h2>
          <div class="flex justify-center bg-canvas rounded-control p-1">
            <canvas ref="minimapRef" style="image-rendering: pixelated" />
          </div>
        </div>

        <!-- Tileset palette -->
        <div class="flex-1 flex flex-col min-h-0">
          <div class="px-3 py-2 border-b border-border shrink-0">
            <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider">{{ $t('map.palette') }}</h2>
          </div>
          <div class="flex-1 overflow-auto p-2">
            <div v-if="!tilesetImg" class="text-xs text-ink-faint">{{ $t('map.noTileset') }}</div>
            <canvas
              v-show="tilesetImg"
              ref="tilesetCanvasRef"
              class="cursor-pointer"
              style="image-rendering: pixelated"
              @click="onPaletteClick"
            />
          </div>
        </div>
        </template>
        <div v-if="!tmx" class="flex-1 flex items-center justify-center text-xs text-ink-faint p-4">
          {{ $t('map.selectToEdit') }}
        </div>
      </template>

      <!-- ═══ Building editor panels (building sub-tab) ═══ -->
      <template v-if="activeSubTab?.startsWith('building:')">
        <div class="flex-1 flex flex-col min-h-0 p-3">
          <h2 class="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{{ $t('map.tileset') }}</h2>
          <div v-if="libraryTiles.length === 0" class="text-xs text-ink-faint">
            {{ $t('map.noTileset') }}
          </div>
          <div v-else class="grid grid-cols-4 gap-1 overflow-y-auto flex-1">
            <div v-for="t in libraryTiles.slice(0, 40)" :key="t.id" class="relative group">
              <img
                :src="tilesStore.tileUrl(t.id)"
                :alt="t.id"
                class="w-12 h-12 border border-border bg-canvas cursor-pointer hover:border-accent-ink"
                style="image-rendering: pixelated"
                :title="`${t.id} — ${$t('map.selectedTile')}`"
                @click="copyTileToClipboard(t.id)"
              />
              <div v-if="clipboard?.kind === 'tile' && clipboard.id === t.id"
                class="absolute top-0 left-0 w-full h-full border-2 border-accent-ink pointer-events-none"
              ></div>
            </div>
          </div>
          <div v-if="clipboard" class="mt-2 text-micro text-accent-ink">
            📋 {{ clipboard.kind === 'tile' ? clipboard.id : $t('map.buildings') }}
          </div>
          <div v-else class="mt-2 text-micro text-ink-faint">
            {{ $t('map.selectedTile') }}: {{ $t('map.noTileset') }}
          </div>
        </div>
      </template>
    </aside>

    <!-- ═══ New map dialog ═══ -->
    <div
      v-if="showNew"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="showNew = false"
    >
      <div class="bg-surface border border-border-strong rounded-card p-4 w-80 shadow-popover">
        <h3 class="text-sm font-semibold text-ink-secondary mb-3">{{ $t('map.newMap') }}</h3>
        <label class="block text-xs text-ink-muted mb-1">{{ $t('map.name') }}</label>
        <input
          v-model="newName"
          :placeholder="$t('map.newMapName')"
          class="w-full mb-3 px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary"
          @keydown.enter="confirmCreate"
        />
        <div class="flex gap-3 mb-3">
          <div class="flex-1">
            <label class="block text-xs text-ink-muted mb-1">{{ $t('map.width') }}</label>
            <input type="number" min="1" max="512" v-model.number="newW"
              class="w-full px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary" />
          </div>
          <div class="flex-1">
            <label class="block text-xs text-ink-muted mb-1">{{ $t('map.height') }}</label>
            <input type="number" min="1" max="512" v-model.number="newH"
              class="w-full px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary" />
          </div>
        </div>
        <p class="text-tiny text-ink-faint mb-3">
          {{ $t('map.newMapHint') }}
        </p>
        <div class="flex justify-end gap-2">
          <button @click="showNew = false"
            class="px-3 py-1 text-sm rounded-control bg-raised hover:bg-overlay text-ink-body">
            {{ $t('common.cancel') }}
          </button>
          <button
            @click="confirmCreate"
            :disabled="!newName.trim() || creating"
            class="px-3 py-1 text-sm rounded-control bg-accent hover:bg-accent-strong text-white disabled:opacity-50"
          >{{ creating ? '…' : $t('map.create') }}</button>
        </div>
        <p v-if="error" class="text-xs text-danger-ink mt-2">{{ error }}</p>
      </div>
    </div>

    <!-- ═══ Resize map dialog ═══ -->
    <div
      v-if="showResize && tmx"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="showResize = false"
    >
      <div class="bg-surface border border-border-strong rounded-card p-4 w-80 shadow-popover">
        <h3 class="text-sm font-semibold text-ink-secondary mb-1">{{ $t('map.resizeMap') }}</h3>
        <p class="text-tiny text-ink-faint mb-3">
          {{ $t('map.resizeCurrent', { w: tmx.width, h: tmx.height }) }}
        </p>
        <div class="flex gap-3 mb-3">
          <div class="flex-1">
            <label class="block text-xs text-ink-muted mb-1">{{ $t('map.width') }}</label>
            <input type="number" min="1" max="512" v-model.number="resizeW"
              @keydown.enter="confirmResize"
              class="w-full px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary" />
          </div>
          <div class="flex-1">
            <label class="block text-xs text-ink-muted mb-1">{{ $t('map.height') }}</label>
            <input type="number" min="1" max="512" v-model.number="resizeH"
              @keydown.enter="confirmResize"
              class="w-full px-2 py-1 bg-raised border border-border-strong rounded-control text-sm text-ink-secondary" />
          </div>
        </div>
        <label class="block text-xs text-ink-muted mb-1">{{ $t('map.anchor') }}</label>
        <div class="grid grid-cols-3 gap-1 w-24 mb-2">
          <button
            v-for="(c, i) in anchorCells"
            :key="i"
            @click="resizeAnchorX = c.x; resizeAnchorY = c.y"
            :title="$t('map.anchor')"
            :class="[
              'h-7 rounded-control border text-xs flex items-center justify-center leading-none',
              resizeAnchorX === c.x && resizeAnchorY === c.y
                ? 'bg-accent border-accent-ink text-white'
                : 'bg-raised border-border-strong text-ink-faint hover:bg-overlay',
            ]"
          >{{ resizeAnchorX === c.x && resizeAnchorY === c.y ? '●' : '·' }}</button>
        </div>
        <p class="text-tiny text-ink-faint mb-3">{{ $t('map.anchorHint') }}</p>
        <div class="flex justify-end gap-2">
          <button @click="showResize = false"
            class="px-3 py-1 text-sm rounded-control bg-raised hover:bg-overlay text-ink-body">
            {{ $t('common.cancel') }}
          </button>
          <button
            @click="confirmResize"
            :disabled="resizeUnchanged || !resizeValid || resizing"
            class="px-3 py-1 text-sm rounded-control bg-accent hover:bg-accent-strong text-white disabled:opacity-50"
          >{{ $t('map.resize') }}</button>
        </div>
      </div>
    </div>

    <MapBackdropGen v-if="showBackdropGen && mapName" :map-name="mapName"
      @close="showBackdropGen = false" @done="onBackdropGenerated" />

    <MapTraceDialog v-if="showTrace && mapName && backdropImg" :map-name="mapName"
      :img-w="backdropImg.naturalWidth" :img-h="backdropImg.naturalHeight" :tile-size="mapTileSize"
      :busy="tracing" :error="traceError"
      @close="showTrace = false" @convert="traceBackdropToTiles" />

    <!-- ═══ Browse Buildings modal ═══ -->
    <div
      v-if="showBrowseBuildings"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="showBrowseBuildings = false"
    >
      <div class="bg-surface border border-border-strong rounded-card shadow-popover flex flex-col max-w-lg w-full max-h-[80vh]">
        <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h3 class="text-sm font-semibold text-ink-secondary">{{ $t('map.buildings') }}</h3>
          <button @click="showBrowseBuildings = false" class="text-ink-muted hover:text-ink-secondary">✕</button>
        </div>

        <!-- Search + new building form -->
        <div class="px-4 py-2 border-b border-border space-y-2 shrink-0">
          <input
            v-model="browseFilter"
            :placeholder="$t('map.searchMaps')"
            class="w-full px-2 py-1 text-xs bg-inset border border-border rounded-control text-ink-secondary placeholder-gray-500 outline-none focus:border-accent-strong"
          />
          <details class="text-xs">
            <summary class="cursor-pointer text-accent-ink hover:text-accent-ink-strong">{{ $t('map.newBuildingTitle') }}</summary>
            <div class="mt-2 space-y-2 p-2 bg-canvas rounded-control border border-border">
              <input
                v-model="browseNewName"
                :placeholder="$t('map.newBuildingName')"
                class="w-full px-2 py-1 text-xs bg-raised border border-border-strong rounded-control text-ink-secondary placeholder-gray-500 outline-none focus:border-accent-ink"
              />
              <div class="flex gap-2 items-center">
                <span class="text-ink-muted">{{ $t('map.newBuildingCols') }}</span>
                <input type="number" min="1" max="16" v-model.number="browseNewW" class="w-14 px-1 py-0.5 text-xs bg-raised border border-border-strong rounded-control text-ink-secondary" />
                <span class="text-ink-muted">{{ $t('map.newBuildingRows') }}</span>
                <input type="number" min="1" max="16" v-model.number="browseNewH" class="w-14 px-1 py-0.5 text-xs bg-raised border border-border-strong rounded-control text-ink-secondary" />
                <button
                  @click="createNewBuildingFromBrowse"
                  :disabled="browseCreating"
                  class="ml-auto px-2 py-0.5 text-xs rounded-control bg-accent hover:bg-accent-strong text-white disabled:opacity-50"
                >{{ browseCreating ? '…' : $t('map.create') }}</button>
              </div>
              <span v-if="browseMsg" class="text-success-ink">{{ browseMsg }}</span>
            </div>
          </details>
        </div>

        <!-- Building list -->
        <div class="flex-1 overflow-y-auto p-2">
          <div v-if="filteredBuildings.length === 0" class="text-xs text-ink-faint p-3 text-center">
            {{ browseFilter ? $t('map.noMapsMatch') : $t('map.noBuildings') }}
          </div>
          <div v-for="g in filteredBuildings" :key="g.id" class="group flex items-center gap-2 px-2 py-1.5 rounded-control hover:bg-raised/50">
            <img :src="tilesStore.groupUrl(g.id)" class="w-10 h-10 shrink-0 bg-canvas border border-border" style="image-rendering: pixelated" />
            <div class="flex-1 min-w-0">
              <div class="text-xs text-ink-secondary truncate">{{ g.name || g.id }}</div>
              <div class="text-micro text-ink-faint">{{ g.id }} · {{ g.w }}×{{ g.h }}</div>
            </div>
            <button
              @click="openBuildingTab(g)"
              class="px-2 py-0.5 text-micro rounded-control bg-accent-hover hover:bg-accent text-accent-ink-faint"
              :title="$t('map.buildingEditor')"
            >{{ $t('map.buildingEditor') }}</button>
            <button
              @click="deleteBuildingFromBrowse(g)"
              class="px-1 py-0.5 text-micro rounded-control bg-red-700/50 hover:bg-danger text-red-200 opacity-0 group-hover:opacity-100"
            >{{ $t('common.delete') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
