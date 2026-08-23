<template>
  <div class="h-full flex flex-col">
    <!-- toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 bg-surface border-b border-border text-sm shrink-0">
      <div class="flex rounded-control overflow-hidden border border-border-strong">
        <button
          @click="mode = 'harvest'"
          :class="['px-3 py-1', mode === 'harvest' ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
        >采集</button>
        <button
          @click="mode = 'building'"
          :class="['px-3 py-1', mode === 'building' ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay']"
        >建筑</button>
      </div>
      <template v-if="mode === 'harvest'">
        <span class="text-ink-muted ml-1">背景图</span>
        <select v-model="selectedUrl" class="bg-raised rounded-control px-2 py-1 border border-border-strong max-w-xs">
          <option value="">（选择一张 AI 地图作为采集背景）</option>
          <option v-for="b in tilesStore.backdrops" :key="b.url" :value="b.url">
            {{ b.map }} / {{ b.file }}
          </option>
        </select>
        <label class="text-ink-muted ml-2">缩放</label>
        <input type="range" min="1" max="6" step="1" v-model.number="zoom" />
        <span class="text-ink-faint">{{ zoom }}× · {{ tileSize }}px 格</span>
        <span class="text-ink-muted ml-2">建筑名</span>
        <input v-model="harvestName" placeholder="留空用地图名" class="w-28 bg-raised rounded-control px-2 py-1 border border-border-strong" />
        <span v-if="harvesting" class="text-accent-ink">采集中…</span>
        <span v-else-if="harvestMsg" class="text-success-ink max-w-xs truncate">{{ harvestMsg }}</span>
      </template>
      <span class="ml-auto text-ink-faint">库中 {{ tilesStore.libraryTiles.length }} 块</span>
      <span v-if="tilesStore.error" class="text-danger-ink max-w-xs truncate">{{ tilesStore.error }}</span>
    </div>

    <div class="flex-1 flex overflow-hidden">
      <!-- LEFT: harvest backdrop (采集) -->
      <div v-if="mode === 'harvest'" class="flex-1 overflow-auto bg-canvas p-2">
        <div v-if="!selectedUrl" class="h-full flex items-center justify-center text-ink-disabled text-center px-8">
          选择上方的一张 AI 地图，拖拽框选一片区域，即可整片采集为一座建筑（整体一张图，到「建筑」页可精修、盖到地图）。
        </div>
        <canvas
          v-else
          ref="canvasEl"
          class="cursor-crosshair touch-none select-none"
          style="image-rendering: pixelated;"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointerleave="onLeave"
        />
      </div>

      <!-- BUILDING (建筑): pick/create a building, edit it inline in the pixel editor -->
      <template v-else>
        <!-- buildings list + create -->
        <div class="w-44 shrink-0 bg-surface border-r border-border overflow-y-auto p-2 flex flex-col gap-2">
          <button
            class="px-2 py-1 rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-50 text-[12px]"
            :disabled="creatingBlank"
            title="按 列×行 新建一座空白建筑，直接在像素编辑器里绘制 / 印章"
            @click="newBlankBuilding"
          >{{ creatingBlank ? '创建中…' : '＋ 新建空白建筑' }}</button>
          <div class="flex items-center gap-1 text-tiny text-ink-muted">
            <span>列</span>
            <input type="number" min="1" max="16" v-model.number="groupW" class="w-12 bg-raised rounded-control px-1 py-0.5 border border-border-strong" />
            <span>行</span>
            <input type="number" min="1" max="16" v-model.number="groupH" class="w-12 bg-raised rounded-control px-1 py-0.5 border border-border-strong" />
          </div>
          <input v-model="groupName" placeholder="新建名称（可空）" class="bg-raised rounded-control px-2 py-1 border border-border-strong text-[12px]" />
          <span v-if="groupMsg" class="text-success-ink text-tiny">{{ groupMsg }}</span>

          <div class="text-tiny text-ink-faint mt-1">已保存的建筑</div>
          <input
            v-if="tilesStore.groups.length"
            v-model="buildingFilter"
            placeholder="搜索建筑…"
            class="w-full px-2 py-1 text-tiny bg-inset border border-border rounded-control text-ink-secondary placeholder-gray-500 outline-none focus:border-accent-ink"
          />
          <div v-if="tilesStore.groups.length === 0" class="text-tiny text-ink-disabled">
            还没有建筑。「＋ 新建空白建筑」，或到「采集」从参考图整片采集。
          </div>
          <div v-else class="flex flex-col gap-1">
            <div v-if="filteredBuildings.length === 0" class="text-tiny text-ink-disabled">没有匹配的建筑。</div>
            <div v-for="g in filteredBuildings" :key="g.id" class="relative group/bg">
              <button
                class="w-full flex items-center gap-2 border rounded-control bg-canvas hover:border-accent-ink p-1 text-left"
                :class="editingGroupId === g.id ? 'border-accent-ink ring-1 ring-accent-ink' : 'border-border'"
                :title="`${g.name || g.id} · ${g.w}×${g.h} — 点开编辑（可在编辑器标题处重命名）`"
                @click="selectBuilding(g)"
              >
                <img :src="tilesStore.groupUrl(g.id)" class="block w-10 h-10 shrink-0 bg-surface object-contain" style="image-rendering: pixelated;" />
                <span class="text-tiny text-ink-body truncate">{{ g.name || g.id }}</span>
              </button>
              <button
                class="absolute top-0.5 right-5 w-4 h-4 rounded-control bg-black/70 text-ink-secondary text-micro hidden group-hover/bg:flex items-center justify-center hover:bg-accent disabled:opacity-50"
                title="复制为一个新的、独立的建筑" :disabled="copyingGroupId === g.id" @click.stop="copyGroup(g)"
              >⧉</button>
              <button
                class="absolute top-0.5 right-0.5 w-4 h-4 rounded-control bg-black/70 text-danger-ink-strong text-micro hidden group-hover/bg:flex items-center justify-center hover:bg-danger"
                title="删除建筑" @click.stop="deleteGroupConfirm(g)"
              >✕</button>
            </div>
          </div>
        </div>

        <!-- inline pixel editor for the selected building -->
        <div class="flex-1 min-w-0 bg-canvas">
          <TilePixelEditor
            v-if="pixelGroup"
            ref="buildingEditor"
            :key="pixelGroup.id"
            embedded
            :tile-size="tileSize"
            :px-width="pixelGroup.w * tileSize"
            :px-height="pixelGroup.h * tileSize"
            :src-url="tilesStore.groupUrl(pixelGroup.id)"
            :src-layers-url="tilesStore.groupLayersUrl(pixelGroup.id)"
            :title="pixelGroup.name || pixelGroup.id"
            title-editable
            :persist="persistGroupImage"
            @close="closeBuilding"
            @resized="onBuildingResized"
            @rename="onRenameBuilding"
          />
          <div v-else class="h-full flex items-center justify-center text-ink-disabled text-sm text-center px-6">
            选择左侧的建筑进行编辑，或「＋ 新建空白建筑」。<br />也可到「采集」从参考图整片采集为建筑。
          </div>
        </div>
      </template>

      <!-- library (harvest mode only; the building editor has its own 印章 palette) -->
      <div v-if="mode === 'harvest'" class="w-72 shrink-0 bg-surface border-l border-border overflow-y-auto p-2">
        <div class="flex items-center gap-1 mb-2">
          <span class="text-xs text-ink-muted">共享瓦片库 (data/tiles)</span>
          <button
            class="ml-auto text-tiny px-1.5 py-0.5 rounded-control border bg-raised border-border-strong text-ink-body hover:border-accent-ink disabled:opacity-50"
            :disabled="creatingBlank"
            title="新建一块空白瓦片，直接在像素编辑器里绘制（无需从参考图圈选）"
            @click="newBlankTile"
          >{{ creatingBlank ? '…' : '＋ 空白' }}</button>
          <button
            class="text-tiny px-1.5 py-0.5 rounded-control border"
            :class="selectMode ? 'bg-accent border-accent-strong text-white' : 'bg-raised border-border-strong text-ink-body hover:border-accent-ink'"
            :disabled="tilesStore.libraryTiles.length === 0"
            :title="selectMode ? '退出批量选择' : '批量选择瓦片以删除'"
            @click="toggleSelectMode"
          >{{ selectMode ? '退出选择' : '选择' }}</button>
        </div>
        <div v-if="selectMode" class="flex items-center gap-1 mb-2 text-tiny">
          <button
            class="px-1.5 py-0.5 rounded-control bg-raised border border-border-strong text-ink-body hover:border-accent-ink"
            @click="selectAllTiles"
          >全选</button>
          <button
            class="px-1.5 py-0.5 rounded-control bg-raised border border-border-strong text-ink-body hover:border-accent-ink"
            @click="clearTileSelection"
          >清空</button>
          <button
            class="ml-auto px-2 py-0.5 rounded-control bg-danger text-white hover:bg-danger-hover disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="selectedTileIds.size === 0"
            @click="deleteSelectedTiles"
          >删除选中 ({{ selectedTileIds.size }})</button>
        </div>
        <div v-if="tilesStore.libraryTiles.length === 0" class="text-ink-disabled text-xs">
          还没有瓦片。点上方「＋ 空白」从零绘制一块（「采集」现在直接生成建筑，不再拆成瓦片）。
        </div>
        <div class="grid grid-cols-4 gap-1">
          <div
            v-for="t in tilesStore.libraryTiles"
            :key="t.id"
            class="relative flex flex-col items-center group"
            :title="`${t.id}${t.source ? ' · ' + t.source : ''}`"
          >
            <img
              :src="tilesStore.tileUrl(t.id)"
              :alt="t.id"
              :class="[
                'w-12 h-12 border bg-raised cursor-pointer',
                selectMode && selectedTileIds.has(t.id)
                  ? 'border-danger-ink ring-2 ring-danger-ink'
                  : 'border-border group-hover:border-accent-ink',
              ]"
              style="image-rendering: pixelated;"
              :title="selectMode ? `选择 ${t.id}` : `编辑 ${t.id}`"
              @click="onLibraryTileClick(t.id)"
            />
            <div
              v-if="selectMode && selectedTileIds.has(t.id)"
              class="absolute top-0 left-0 w-4 h-4 bg-danger text-white text-micro leading-4 text-center rounded-br pointer-events-none"
            >✓</div>
            <button
              v-if="!selectMode"
              class="absolute -top-1 -right-1 w-4 h-4 rounded-pill bg-danger hover:bg-danger-hover text-white text-micro leading-none hidden group-hover:flex items-center justify-center"
              title="删除此瓦片"
              @click.stop="onDelete(t.id)"
            >✕</button>
            <span class="text-micro text-ink-faint truncate w-12 text-center">{{ t.id }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Stage 2: pixel-edit a library tile (clean AI noise/gradients). -->
    <TilePixelEditor
      v-if="editingTileId"
      :tile-id="editingTileId"
      :tile-size="tileSize"
      :src-url="`api/tiles/file/${editingTileId}.png?v=${tilesStore.version}`"
      :src-layers-url="tilesStore.tileLayersUrl(editingTileId)"
      @close="editingTileId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'
import { useTilesActivity, type GroupEntry, type SidecarDoc } from '../../composables/useTilesActivity'
import type { TilesActivityConfig } from '../../types/project'
import TilePixelEditor from './TilePixelEditor.vue'

const project = useProjectStore()
const editor = useEditorStore()
const tilesStore = useTilesActivity()

const cfg = computed(() => project.getActivity(editor.activeActivity)?.config as TilesActivityConfig | undefined)
const tileSize = computed(() => cfg.value?.tileSize ?? 16)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const selectedUrl = ref('')
const zoom = ref(3)
const hover = ref<{ tx: number; ty: number } | null>(null)
/** When set, the pixel editor is open for this library tile. */
const editingTileId = ref<string | null>(null)
/** True while minting a blank tile/building before opening the pixel editor. */
const creatingBlank = ref(false)
/** 共享瓦片库批量选择：开启后点瓦片 = 切换选中（而非编辑/采集），可一次删除多块。 */
const selectMode = ref(false)
const selectedTileIds = ref<Set<string>>(new Set())
/** Drag-select rubber band over backdrop cells (inclusive tile coords). */
const selRect = ref<{ tx0: number; ty0: number; tx1: number; ty1: number } | null>(null)
let selStartCell: { tx: number; ty: number } | null = null
/** True while a harvest POST is in flight. */
const harvesting = ref(false)
/** Optional name for buildings harvested from the reference (blank → map name). */
const harvestName = ref('')
/** Last-harvest feedback (the building lands in 建筑 mode, not this view). */
const harvestMsg = ref('')

// ── Mode switch: 采集 (harvest) / 建筑 (building groups) ──
const mode = ref<'harvest' | 'building'>('harvest')

// The loaded backdrop image + a natural-size offscreen canvas to crop cells from.
let backdropImg: HTMLImageElement | null = null
const srcCanvas = document.createElement('canvas')

const selectedMap = computed(
  () => tilesStore.backdrops.find((b) => b.url === selectedUrl.value)?.map ?? '',
)

onMounted(() => {
  void Promise.all([
    tilesStore.loadLibrary(),
    tilesStore.loadBackdrops(),
    tilesStore.loadGroups(),
  ])
})

watch(selectedUrl, (url) => {
  hover.value = null
  backdropImg = null
  if (!url) return
  const img = new Image()
  img.onload = () => {
    backdropImg = img
    srcCanvas.width = img.naturalWidth
    srcCanvas.height = img.naturalHeight
    const sctx = srcCanvas.getContext('2d')!
    sctx.imageSmoothingEnabled = false
    sctx.clearRect(0, 0, srcCanvas.width, srcCanvas.height)
    sctx.drawImage(img, 0, 0)
    void nextTick(redraw)
  }
  img.onerror = () => {
    tilesStore.error = `无法加载背景图：${url}`
  }
  img.src = url
})

watch([zoom, hover], () => redraw())

function redraw() {
  const cv = canvasEl.value
  if (!cv || !backdropImg) return
  const z = zoom.value
  const w = backdropImg.naturalWidth
  const h = backdropImg.naturalHeight
  cv.width = w * z
  cv.height = h * z
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.drawImage(backdropImg, 0, 0, cv.width, cv.height)

  // 16px grid overlay
  const ts = tileSize.value * z
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  for (let x = 0; x <= cv.width; x += ts) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, cv.height)
    ctx.stroke()
  }
  for (let y = 0; y <= cv.height; y += ts) {
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(cv.width, y + 0.5)
    ctx.stroke()
  }

  // hovered cell highlight (suppressed while drag-selecting)
  if (hover.value && !selRect.value) {
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = 2
    ctx.strokeRect(hover.value.tx * ts + 1, hover.value.ty * ts + 1, ts - 2, ts - 2)
  }

  // drag-select rubber band
  if (selRect.value) {
    const { tx0, ty0, tx1, ty1 } = selRect.value
    const rx = tx0 * ts
    const ry = ty0 * ts
    const rw = (tx1 - tx0 + 1) * ts
    const rh = (ty1 - ty0 + 1) * ts
    ctx.fillStyle = 'rgba(96,165,250,0.25)'
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeStyle = '#60a5fa'
    ctx.lineWidth = 2
    ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2)
  }
}

function cellFromEvent(e: MouseEvent): { tx: number; ty: number } | null {
  const cv = canvasEl.value
  if (!cv || !backdropImg) return null
  const rect = cv.getBoundingClientRect()
  const px = (e.clientX - rect.left) / zoom.value
  const py = (e.clientY - rect.top) / zoom.value
  const tx = Math.floor(px / tileSize.value)
  const ty = Math.floor(py / tileSize.value)
  const cols = Math.floor(backdropImg.naturalWidth / tileSize.value)
  const rows = Math.floor(backdropImg.naturalHeight / tileSize.value)
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return null
  return { tx, ty }
}

function onDown(e: PointerEvent) {
  const cell = cellFromEvent(e)
  if (!cell) return
  canvasEl.value?.setPointerCapture(e.pointerId)
  selStartCell = cell
  selRect.value = { tx0: cell.tx, ty0: cell.ty, tx1: cell.tx, ty1: cell.ty }
  hover.value = null
  redraw()
}

function onMove(e: PointerEvent) {
  const cell = cellFromEvent(e)
  if (selStartCell) {
    if (!cell) return // dragged outside the image — keep the last valid rect
    selRect.value = {
      tx0: Math.min(selStartCell.tx, cell.tx),
      ty0: Math.min(selStartCell.ty, cell.ty),
      tx1: Math.max(selStartCell.tx, cell.tx),
      ty1: Math.max(selStartCell.ty, cell.ty),
    }
    redraw()
    return
  }
  // hover highlight — only redraw on cell crossings, not every pixel of movement
  if (cell?.tx === hover.value?.tx && cell?.ty === hover.value?.ty) return
  hover.value = cell
}

async function onUp() {
  if (!selStartCell) return
  const rect = selRect.value
  selStartCell = null
  selRect.value = null
  if (rect) await harvestRect(rect)
  else redraw()
}

function onLeave() {
  if (selStartCell) return // mid-drag (pointer captured); keep the selection
  hover.value = null
}

/** Crop the whole selected tile rect from the reference as ONE building (group):
 *  a w×h composite image, saved straight into the buildings library (no
 *  per-cell tiles). It lands in 建筑 mode ready to refine / stamp onto maps. */
async function harvestRect(rect: { tx0: number; ty0: number; tx1: number; ty1: number }) {
  const ts = tileSize.value
  const w = rect.tx1 - rect.tx0 + 1
  const h = rect.ty1 - rect.ty0 + 1
  const c = document.createElement('canvas')
  c.width = w * ts
  c.height = h * ts
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(srcCanvas, rect.tx0 * ts, rect.ty0 * ts, w * ts, h * ts, 0, 0, w * ts, h * ts)
  harvesting.value = true
  const name = harvestName.value.trim() || selectedMap.value || '建筑'
  const id = await tilesStore.saveGroup({ name, w, h, pngBase64: c.toDataURL('image/png') })
  harvesting.value = false
  harvestMsg.value = id ? `已采集为建筑 ${id}（${w}×${h}），见「建筑」页` : ''
  redraw()
}

async function onDelete(id: string) {
  if (!window.confirm(`删除瓦片 ${id}？`)) return
  await tilesStore.deleteTile(id)
}

function onLibraryTileClick(id: string) {
  if (selectMode.value) {
    const next = new Set(selectedTileIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedTileIds.value = next
    return
  }
  editingTileId.value = id
}

/** A fully-transparent PNG data-URL of the given pixel size (a blank canvas). */
function blankPng(wPx: number, hPx: number): string {
  const c = document.createElement('canvas')
  c.width = wPx
  c.height = hPx
  return c.toDataURL('image/png')
}

/** Create a brand-new blank tile (not cropped from a reference image) and open
 *  the pixel editor on it so the user draws it from scratch. */
async function newBlankTile() {
  if (creatingBlank.value) return
  creatingBlank.value = true
  try {
    const id = await tilesStore.saveTile(blankPng(tileSize.value, tileSize.value), {})
    if (id) editingTileId.value = id
  } finally {
    creatingBlank.value = false
  }
}

/** Toggle batch-select mode; leaving it clears the selection. */
function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedTileIds.value = new Set()
}

function selectAllTiles() {
  selectedTileIds.value = new Set(tilesStore.libraryTiles.map((t) => t.id))
}

function clearTileSelection() {
  selectedTileIds.value = new Set()
}

/** Delete every selected library tile in one batch request. */
async function deleteSelectedTiles() {
  const ids = [...selectedTileIds.value]
  if (ids.length === 0) return
  if (!window.confirm(`删除选中的 ${ids.length} 块瓦片？此操作不可撤销。`)) return
  const ok = await tilesStore.deleteTiles(ids)
  if (ok) selectedTileIds.value = new Set()
}

// ───────────────────────────────────────────────────────────────────────────
// 建筑 (building groups): create/pick a building and edit it inline in the pixel
// editor (freehand + 印章 stamp + region ops). A building is one composite PNG
// (the source of truth); the old tile-id grid assembler has been removed.
// ───────────────────────────────────────────────────────────────────────────
const groupName = ref('')
const groupW = ref(3)
const groupH = ref(3)
/** The open building's id — drives the list highlight. */
const editingGroupId = ref<string | null>(null)
const groupMsg = ref('')
/** Id of the building currently being duplicated (disables its 复制 button). */
const copyingGroupId = ref<string | null>(null)
/** The building the inline editor is editing; null → show the empty prompt. */
const pixelGroup = ref<GroupEntry | null>(null)
/** Inline building editor instance — for its unsaved-changes guard on switch. */
const buildingEditor = ref<{ isDirty: () => boolean } | null>(null)

/** Building-list search: match on name or id (case-insensitive). */
const buildingFilter = ref('')
const filteredBuildings = computed(() => {
  const q = buildingFilter.value.trim().toLowerCase()
  if (!q) return tilesStore.groups
  return tilesStore.groups.filter((g) => (g.name || '').toLowerCase().includes(q) || g.id.toLowerCase().includes(q))
})

/** Rename the open building (from the editor header's editable title). */
async function onRenameBuilding(name: string) {
  const pg = pixelGroup.value
  if (!pg) return
  const ok = await tilesStore.renameGroup(pg.id, name)
  if (ok) pixelGroup.value = { ...pg, name } // reflect it in the header immediately
}

/** Open a building in the inline editor (guarding unsaved edits on a switch). */
function selectBuilding(g: GroupEntry) {
  if (g.id === editingGroupId.value) return
  if (buildingEditor.value?.isDirty() && !window.confirm('当前建筑有未保存的修改，切换将丢弃。确定切换？')) return
  groupMsg.value = ''
  editingGroupId.value = g.id
  pixelGroup.value = g
}
/** Leave the inline editor (back to the list / empty prompt). */
function closeBuilding() {
  pixelGroup.value = null
  editingGroupId.value = null
}


/** Create a blank building of the current 列×行 size and open the whole-building
 *  pixel editor on it, so it can be drawn from scratch instead of assembled from
 *  library tiles or cropped from a reference image. */
async function newBlankBuilding() {
  if (creatingBlank.value) return
  const w = Math.max(1, Math.min(16, Math.round(groupW.value) || 1))
  const h = Math.max(1, Math.min(16, Math.round(groupH.value) || 1))
  creatingBlank.value = true
  try {
    const name = groupName.value.trim() || '建筑'
    const id = await tilesStore.saveGroup({
      name,
      w,
      h,
      pngBase64: blankPng(w * tileSize.value, h * tileSize.value),
    })
    if (id) selectBuilding({ id, name, w, h })
  } finally {
    creatingBlank.value = false
  }
}

async function deleteGroupConfirm(g: GroupEntry) {
  if (!window.confirm(`删除建筑 ${g.name || g.id}？`)) return
  await tilesStore.deleteGroup(g.id)
  if (editingGroupId.value === g.id) closeBuilding()
}

/** Fetch a served asset as a data-URL, preserving the exact bytes (no canvas
 *  re-encode) so a duplicate is pixel-identical to the source. */
function fetchAsDataUrl(url: string): Promise<string | null> {
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

/** Duplicate a building into a brand-new, independent one (fresh id): copy its
 *  composed PNG + layer sidecar. The copy lands in the list (its own thumbnail);
 *  click it to edit. Editing one never touches the other. */
async function copyGroup(g: GroupEntry) {
  if (copyingGroupId.value) return
  copyingGroupId.value = g.id
  try {
    const pngBase64 = await fetchAsDataUrl(tilesStore.groupUrl(g.id))
    if (!pngBase64) {
      tilesStore.error = `复制失败：无法读取建筑图像 ${g.id}`
      return
    }
    // Carry over the pixel-edit layer sidecar if one exists (404 → flat copy).
    let layers: SidecarDoc | null = null
    try {
      const r = await fetch(tilesStore.groupLayersUrl(g.id))
      if (r.ok) layers = (await r.json()) as SidecarDoc
    } catch {
      /* no / invalid sidecar → duplicate the flat PNG only */
    }
    const copyName = `${g.name || g.id} 副本`
    const newId = await tilesStore.saveGroup({ name: copyName, w: g.w, h: g.h, pngBase64, layers })
    if (newId) groupMsg.value = `已复制为「${copyName}」`
  } finally {
    copyingGroupId.value = null
  }
}

/** Persist callback for the inline building editor (composed PNG + layer sidecar;
 *  w/h too, so an in-editor canvas resize is saved). */
async function persistGroupImage(dataUrl: string, layers: SidecarDoc): Promise<boolean> {
  const g = pixelGroup.value
  if (!g) return false
  const id = await tilesStore.saveGroup({ id: g.id, w: g.w, h: g.h, pngBase64: dataUrl, layers })
  return !!id
}

/** The editor resized its canvas → track the building's new tile dimensions
 *  (title + next save persist them). */
function onBuildingResized(w: number, h: number) {
  if (pixelGroup.value) pixelGroup.value = { ...pixelGroup.value, w, h }
}
</script>
