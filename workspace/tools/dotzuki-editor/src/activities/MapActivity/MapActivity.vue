<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { applyConnectionStroke, type ConnectionSet, type ConnectionCell } from '../../lib/wallConnections'
import type { PreparedComponent } from '../../lib/mapComponents'
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
import AutotileSetDialog from './AutotileSetDialog.vue'
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
type Tool = 'brush' | 'eraser' | 'bucket' | 'stamp' | 'collision' | 'stairs' | 'objects' | 'connections'
const tool = ref<Tool>('brush')
const connectionSets = ref<ConnectionSet[]>([])
const connectionSetId = ref('')
const connectionBrush = ref<'paint' | 'erase'>('paint')
const connectionBrushSize = ref<1 | 2 | 3>(1)
const toolList = computed<Tool[]>(() => {
  const tools: Tool[] = ['brush', 'eraser', 'bucket', 'stamp', 'connections', 'collision', 'stairs']
  if (objectsEnabled.value) tools.push('objects')
  return tools
})
const showAutotileConfig = ref(false)
const savingAutotileConfig = ref(false)
const autotileConfigError = ref('')

type PreparedConnection = {
  map: string
  setId: string
  signature: string
  tilesVersion: number
  sources: PreparedComponent[]
}
const preparedConnection = ref<PreparedConnection | null>(null)
const connectionPreparing = ref(false)
let connectionPrepareSeq = 0

function connectionSignature(set: ConnectionSet): string {
  return JSON.stringify([set.mode ?? 'cardinal', set.variants])
}

function currentConnectionSources(set: ConnectionSet): PreparedComponent[] | null {
  const prepared = preparedConnection.value
  return prepared
    && prepared.map === mapName.value
    && prepared.setId === set.id
    && prepared.signature === connectionSignature(set)
    && prepared.tilesVersion === tilesStore.version
    ? prepared.sources
    : null
}

async function prepareConnectionSet(force = false): Promise<PreparedComponent[] | null> {
  const set = connectionSets.value.find(item => item.id === connectionSetId.value)
  const name = mapName.value
  if (!set || !name || !tmx.value) return null
  if (!force) {
    const cached = currentConnectionSources(set)
    if (cached) return cached
  }
  const seq = ++connectionPrepareSeq
  connectionPreparing.value = true
  componentMessage.value = t('map.autotile.preparing')
  const sources = await tilesStore.prepareComponents(name, [...new Set(Object.values(set.variants))])
  if (seq !== connectionPrepareSeq || mapName.value !== name || !sources) {
    if (seq === connectionPrepareSeq) {
      connectionPreparing.value = false
      componentMessage.value = tilesStore.error ?? ''
    }
    return null
  }
  await loadTileset(name)
  if (seq !== connectionPrepareSeq || mapName.value !== name) return null
  preparedConnection.value = {
    map: name,
    setId: set.id,
    signature: connectionSignature(set),
    tilesVersion: tilesStore.version,
    sources,
  }
  connectionPreparing.value = false
  componentMessage.value = ''
  drawMap()
  return sources
}

function selectTool(next: Tool): void {
  tool.value = next
  if (next !== 'connections') return
  if (!connectionSets.value.length) {
    showAutotileConfig.value = true
    return
  }
  void prepareConnectionSet()
}

async function saveAutotileSets(sets: ConnectionSet[]): Promise<void> {
  if (savingAutotileConfig.value) return
  savingAutotileConfig.value = true
  autotileConfigError.value = ''
  try {
    const response = await fetch('api/connection-sets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sets }),
    })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error ?? t('map.autotile.saveFailed'))
    connectionSets.value = data.sets
    if (!sets.some(set => set.id === connectionSetId.value)) connectionSetId.value = sets[0]?.id ?? ''
    preparedConnection.value = null
    showAutotileConfig.value = false
    if (tool.value === 'connections') void prepareConnectionSet(true)
  } catch (cause) {
    autotileConfigError.value = (cause as Error).message
  } finally {
    savingAutotileConfig.value = false
  }
}

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
    img.src = `api/maps/${encodeURIComponent(name)}/source.png`
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
    img.src = `api/maps/${encodeURIComponent(name)}/source.png?t=${Date.now()}`
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
  const r = await fetch('api/cv-process', {
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
  const map = tmx.value
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      if (mapName.value !== name || tmx.value !== map) { resolve(); return }
      tilesetImg.value = img
      tilesetCols.value = Math.max(1, Math.floor(img.naturalWidth / tileW.value))
      tilesetRows.value = Math.max(1, Math.ceil(img.naturalHeight / tileH.value))
      nextTick(() => drawTilesetPalette())
      resolve()
    }
    img.onerror = () => {
      if (mapName.value === name && tmx.value === map) tilesetImg.value = null
      resolve()
    }
    // Cache-bust with the tiles store version (bumped on saveTile/buildTileset),
    // so that after a building stamp rebuilds tileset.png we load the fresh image
    // rather than the browser-cached one — otherwise the new slices render against
    // the stale tileset and the stamped building looks wrong.
    img.src = `api/maps/${encodeURIComponent(name)}/tileset.png?v=${tilesStore.version}`
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

const linkComponents = ref(true)
const componentMessage = ref('')
const updatingComponents = ref(false)
const componentCount = computed(() => tmx.value?.layers.reduce((n, l) => n + (l.components?.length ?? 0), 0) ?? 0)

async function stampBuilding(atX: number, atY: number): Promise<void> {
  const g = selectedGroup.value
  const map = tmx.value
  const name = mapName.value
  const layer = activeLayer.value
  if (!g || !map || stamping.value || updatingComponents.value) return
  const activeLayerBefore = map.layers[layer]
  const linked = linkComponents.value
  // Do not append anything when the footprint cannot be placed.
  if (atX < 0 || atY < 0 || atX + g.w > map.width || atY + g.h > map.height) return
  stamping.value = true
  componentMessage.value = ''
  try {
    const sources = await tilesStore.prepareComponents(name, [g.id])
    if (!sources) throw new Error(tilesStore.error ?? 'Component preparation failed')
    // A tab may have changed while the request was in flight.
    if (tmx.value !== map || mapName.value !== name) return
    await loadTileset(name)
    if (tmx.value !== map || mapName.value !== name || map.layers[layer] !== activeLayerBefore) return
    store.placeComponent(layer, atX, atY, sources[0], linked)
    afterEdit()
  } catch (error) {
    componentMessage.value = (error as Error).message
  } finally {
    stamping.value = false
  }
}

async function updateMapComponents(): Promise<void> {
  const map = tmx.value
  const name = mapName.value
  if (!map || stamping.value || updatingComponents.value) return
  const ids = [...new Set(map.layers.flatMap(l => (l.components ?? []).map(c => c.groupId)))]
  if (!ids.length) return
  updatingComponents.value = true
  componentMessage.value = ''
  try {
    const sources = await tilesStore.prepareComponents(name, ids)
    if (!sources) throw new Error(tilesStore.error ?? 'Component preparation failed')
    if (tmx.value !== map || mapName.value !== name) return
    await loadTileset(name)
    if (tmx.value !== map || mapName.value !== name) return
    const result = store.updateComponents(sources)
    componentMessage.value = t('map.componentsUpdated', {
      count: result.updated, skipped: result.conflicts + result.resized + result.missing,
    })
    afterEdit()
  } catch (error) {
    componentMessage.value = (error as Error).message
  } finally {
    updatingComponents.value = false
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
      const layerData = connectionStroke?.layer === li && connectionStroke.previewData
        ? connectionStroke.previewData
        : layer.data
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const id = layerData[y * map.width + x] ?? 0
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
let connectionStroke: {
  map: NonNullable<typeof tmx.value>; name: string; layer: number; set: ConnectionSet;
  sources: PreparedComponent[]; changes: Map<number, ConnectionCell>;
  last: {x:number;y:number}; solid: boolean; size: number; previewData: number[] | null;
} | null = null
let connectionPreviewFrame = 0

function addConnectionCells(stroke: NonNullable<typeof connectionStroke>, x: number, y: number): void {
  const before = Math.floor((stroke.size - 1) / 2)
  const after = stroke.size - before - 1
  for (let dy = -before; dy <= after; dy++) {
    for (let dx = -before; dx <= after; dx++) {
      const px = x + dx, py = y + dy
      if (px < 0 || py < 0 || px >= stroke.map.width || py >= stroke.map.height) continue
      stroke.changes.set(py * stroke.map.width + px, { x: px, y: py, solid: stroke.solid })
    }
  }
}

function renderConnectionPreview(): void {
  connectionPreviewFrame = 0
  const stroke = connectionStroke
  if (!stroke) return
  const layer = stroke.map.layers[stroke.layer]
  if (layer) {
    const preview = { data: layer.data, components: layer.components }
    try {
      applyConnectionStroke(preview, stroke.map.width, stroke.map.height, stroke.set,
        stroke.sources, [...stroke.changes.values()])
      stroke.previewData = preview.data
    } catch (cause) {
      componentMessage.value = (cause as Error).message
      stroke.previewData = null
    }
  }
  drawMap()
}

function addConnectionPoint(cell: {x:number;y:number}) {
  const stroke = connectionStroke
  if (!stroke) return
  const steps = Math.max(Math.abs(cell.x - stroke.last.x), Math.abs(cell.y - stroke.last.y), 1)
  let previous = stroke.last
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(stroke.last.x + (cell.x - stroke.last.x) * i / steps)
    const y = Math.round(stroke.last.y + (cell.y - stroke.last.y) * i / steps)
    // Bridge a diagonal pointer sample with an orthogonal step.
    if (x !== previous.x && y !== previous.y) addConnectionCells(stroke, x, previous.y)
    addConnectionCells(stroke, x, y)
    previous = {x,y}
  }
  stroke.last = cell
  if (!connectionPreviewFrame) connectionPreviewFrame = requestAnimationFrame(renderConnectionPreview)
}

function finishConnectionStroke() {
  const stroke = connectionStroke
  connectionStroke = null
  if (connectionPreviewFrame) cancelAnimationFrame(connectionPreviewFrame)
  connectionPreviewFrame = 0
  if (!stroke || tmx.value !== stroke.map || mapName.value !== stroke.name) return
  componentMessage.value = ''
  try {
    store.paintConnections(stroke.layer,stroke.set,stroke.sources,[...stroke.changes.values()])
    afterEdit()
  } catch (error) { componentMessage.value = (error as Error).message }
}

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
  if (stamping.value || updatingComponents.value) return
  if (tool.value === 'connections' && (e.button === 0 || e.button === 2)) {
    const cell = cellAt(e)
    const set = connectionSets.value.find(s => s.id === connectionSetId.value)
    if (!set) { showAutotileConfig.value = true; return }
    const sources = currentConnectionSources(set)
    if (!cell || !sources) { void prepareConnectionSet(); return }
    e.preventDefault()
    connectionStroke = {map:tmx.value,name:mapName.value,layer:activeLayer.value,set,
      sources,changes:new Map(),last:cell,
      solid:e.button===2 ? false : connectionBrush.value==='paint',
      size:connectionBrushSize.value,previewData:null}
    addConnectionPoint(cell)
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
  if (connectionStroke) {
    const cell = cellAt(e)
    if (cell) addConnectionPoint(cell)
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
  if (connectionStroke) { void finishConnectionStroke(); return }
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
  if (tool.value === 'connections' && connectionSets.value.length) void prepareConnectionSet()
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
  try {
    const response = await fetch('api/connection-sets')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    connectionSets.value = data.sets
    connectionSetId.value = data.sets[0]?.id ?? ''
  } catch (error) { componentMessage.value = (error as Error).message }
})
onUnmounted(() => {
  if (connectionPreviewFrame) cancelAnimationFrame(connectionPreviewFrame)
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

<template src="./MapActivity.template.html"></template>
