<script setup lang="ts">
// ───────────────────────────────────────────────────────────────────────────
// Sprite Studio — display + design a character's sprites across categories
// (overworld walk incl. stand/walk/run, battle 立绘, 图鉴 立绘, dialogue head).
//
// Display: an animated walk/run preview (per facing) for overworld; a scaled
// still for 1×1 categories; a per-frame grid. Design: click any frame to open it
// in the shared pixel editor (cropped to the cell; the edit is stitched back into
// the sheet on save) or AI-generate the whole set via the project's configured
// generate command. Writes the engine-native on-disk layout
// (gfxRoot/<category.dir>/<id>/sheet.png + per-frame PNGs).
// ───────────────────────────────────────────────────────────────────────────
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { pickLocalized } from '@/composables/useLocalize'
import {
  useSpriteStudio, frameName, colLabel, rowLabel,
  type SpriteCategory, type SpriteMeta,
} from '@/composables/useSpriteStudio'
import {
  loadImage, cropCell, sheetCanvasFrom, stampFrame, exportSheet,
} from '@/composables/spriteCanvas'
import TilePixelEditor from '../TilesActivity/TilePixelEditor.vue'
import AnimatedSpriteGen from './AnimatedSpriteGen.vue'
import { useAiImageProviders } from '@/composables/useAiImageProviders'
import { getStoredKey } from '@/composables/useAiStream'

const props = defineProps<{ record: any; embeddedPixelEditor?: boolean }>()
const { t, te, locale } = useI18n()
const studio = useSpriteStudio()
const { imageProviders, loadImageProviders } = useAiImageProviders()

/** The image provider (+ its browser-stored key) bridged to the generate command. */
function imageAuth(): { apiKey: string; proxyUrl?: string; model?: string } | null {
  const p = imageProviders.value.find((pr) => getStoredKey(pr.id)) ?? imageProviders.value[0]
  if (!p) return null
  return { apiKey: getStoredKey(p.id) ?? '', proxyUrl: p.proxyUrl, model: p.model }
}

const cats = ref<SpriteCategory[]>([])
const activeId = ref('')
const meta = ref<SpriteMeta | null>(null)
const version = ref(0)
const loading = ref(false)
const error = ref('')

// Working state for the active category.
const sheetImg = ref<HTMLImageElement | null>(null)
let sheetCanvas: HTMLCanvasElement | null = null
const thumbs = ref<{ row: number; col: number; label: string; url: string }[]>([])

// Preview animation.
const facing = ref(0)
const mode = ref<'stand' | 'walk' | 'run'>('walk')
const playing = ref(true)
const fps = ref(6)
const animIdx = ref(0)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
let timer: number | null = null

// Frame editing.
const editing = ref<{ row: number; col: number } | null>(null)
const editingSrc = ref('')

// Generation.
const generating = ref(false)
const genOutput = ref('')
const genError = ref('')
const saving = ref(false)

const charId = computed<string>(() => props.record?.id ?? '')
const activeCat = computed<SpriteCategory | null>(() => cats.value.find(c => c.id === activeId.value) ?? null)
const genConfigured = computed(() => !!meta.value?.generateConfigured)

function catLabel(c: SpriteCategory): string {
  return pickLocalized(c.label, locale.value, c.id)
}

const editorProps = computed(() => {
  const c = activeCat.value
  const e = editing.value
  if (!c || !e) return null
  return {
    tileSize: Math.max(c.cellW, c.cellH),
    pxWidth: c.cellW,
    pxHeight: c.cellH,
    title: `${catLabel(c)} · ${rowLabel(c, e.row)} ${colLabel(c, e.col)} (${c.cellW}×${c.cellH})`,
  }
})

/** Localized facing label for a known direction, else the raw row name. */
function facingLabel(label: string): string {
  const key = 'story.spriteStudio.facing.' + label
  return te(key) ? t(key) : label
}

const gridCols = computed(() => {
  const c = activeCat.value
  if (!c) return 1
  return Math.max(c.cols, inferredCols.value)
})
const gridRows = computed(() => activeCat.value?.rows ?? 1)
const cellW = computed(() => activeCat.value?.cellW ?? 16)
const cellH = computed(() => activeCat.value?.cellH ?? 16)
const inferredCols = computed(() => {
  const c = activeCat.value
  if (!c || !meta.value?.sheet.exists) return 0
  return Math.max(1, Math.round(meta.value.sheet.w / c.cellW))
})
const hasRun = computed(() => {
  const rc = activeCat.value?.runCols
  if (!rc || !rc.length) return false
  return inferredCols.value > Math.max(...rc)
})
const previewScale = computed(() => {
  const box = 128
  return Math.max(2, Math.floor(box / Math.max(cellW.value, cellH.value)))
})
const previewSeq = computed<number[]>(() => {
  const c = activeCat.value
  if (!c || !c.animated) return [0]
  if (mode.value === 'stand') return [c.standCol ?? 0]
  if (mode.value === 'run') {
    const rc = c.runCols ?? []
    if (hasRun.value && rc.length) return rc
    return c.walkCols ?? [1, 2]
  }
  return c.walkCols ?? [1, 2]
})

const facings = computed(() => {
  const c = activeCat.value
  if (!c || !c.animated) return []
  return Array.from({ length: c.rows }, (_, r) => ({ row: r, label: rowLabel(c, r) }))
})

// ── lifecycle / loading ─────────────────────────────────────────────────────
onMounted(async () => {
  void loadImageProviders()
  try {
    const list = await studio.loadCategories()
    cats.value = list
    if (list.length) activeId.value = list[0].id
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'failed to load categories'
  }
})
onBeforeUnmount(stopAnim)

watch([activeId, charId], () => { if (activeId.value && charId.value) void reload() })

async function reload() {
  if (!activeCat.value || !charId.value) return
  loading.value = true
  error.value = ''
  stopAnim()
  try {
    meta.value = await studio.loadMeta(activeId.value, charId.value)
    version.value++
    await loadSheet()
    facing.value = 0
    animIdx.value = 0
    if (activeCat.value.animated) startAnim()
    await nextTick()
    drawPreview()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'failed to load sprite'
    meta.value = null
    sheetImg.value = null
    sheetCanvas = null
    thumbs.value = []
  } finally {
    loading.value = false
  }
}

async function loadSheet() {
  const c = activeCat.value!
  if (meta.value?.sheet.exists) {
    try {
      sheetImg.value = await loadImage(studio.fileUrl(activeId.value, charId.value, 'sheet.png', version.value))
    } catch {
      sheetImg.value = null
    }
  } else {
    sheetImg.value = null
  }
  sheetCanvas = sheetCanvasFrom(sheetImg.value, c.rows, gridCols.value, c.cellW, c.cellH)
  rebuildThumbs()
}

function rebuildThumbs() {
  const c = activeCat.value!
  const out: { row: number; col: number; label: string; url: string }[] = []
  for (let r = 0; r < c.rows; r++) {
    for (let col = 0; col < gridCols.value; col++) {
      const within = col < inferredCols.value && (sheetImg.value?.width ?? 0) > 0
      out.push({
        row: r, col,
        label: c.rows > 1 && c.cols > 1 ? `${rowLabel(c, r)} · ${colLabel(c, col)}` : colLabel(c, col),
        url: within ? cropCell(sheetImg.value, col, r, c.cellW, c.cellH) : '',
      })
    }
  }
  thumbs.value = out
}

// ── preview animation ───────────────────────────────────────────────────────
function startAnim() {
  stopAnim()
  if (!playing.value) return
  timer = window.setInterval(() => {
    animIdx.value = (animIdx.value + 1) % Math.max(1, previewSeq.value.length)
    drawPreview()
  }, Math.round(1000 / Math.max(1, fps.value)))
}
function stopAnim() {
  if (timer != null) { clearInterval(timer); timer = null }
}
watch([playing, fps, mode, facing], () => {
  if (activeCat.value?.animated && playing.value) startAnim()
  else { stopAnim(); animIdx.value = 0; drawPreview() }
})

function drawPreview() {
  const cv = previewCanvas.value
  const c = activeCat.value
  if (!cv || !c) return
  const scale = previewScale.value
  cv.width = c.cellW * scale
  cv.height = c.cellH * scale
  const x = cv.getContext('2d')!
  x.imageSmoothingEnabled = false
  x.clearRect(0, 0, cv.width, cv.height)
  const img = sheetImg.value
  if (!img || img.width === 0) return
  const col = c.animated ? (previewSeq.value[animIdx.value % previewSeq.value.length] ?? 0) : 0
  const row = c.animated ? facing.value : 0
  if (col >= inferredCols.value) return // unpainted frame → transparent
  x.drawImage(img, col * c.cellW, row * c.cellH, c.cellW, c.cellH, 0, 0, cv.width, cv.height)
}

// ── frame editing ───────────────────────────────────────────────────────────
function openFrame(row: number, col: number) {
  const c = activeCat.value!
  editing.value = { row, col }
  editingSrc.value = cropCell(sheetImg.value, col, row, c.cellW, c.cellH)
}

async function persistFrame(dataUrl: string, _layers: any): Promise<boolean> {
  const c = activeCat.value
  const e = editing.value
  if (!c || !e || !charId.value) return false
  const canvas = sheetCanvas ?? sheetCanvasFrom(sheetImg.value, c.rows, gridCols.value, c.cellW, c.cellH)
  sheetCanvas = canvas
  try {
    saving.value = true
    error.value = ''
    await stampFrame(canvas, dataUrl, e.col, e.row, c.cellW, c.cellH)
    const { sheetBase64, frames } = exportSheet(
      canvas, c.rows, gridCols.value, c.cellW, c.cellH,
      (r, col) => frameName(c, r, col),
    )
    await studio.saveSheet(activeId.value, charId.value, sheetBase64, frames)
    linkOverworld()
    await reload()
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'save failed'
    return false
  } finally {
    saving.value = false
  }
}

/** Point the narrative record's overworld spriteAsset at the dir (back-compat). */
function linkOverworld() {
  if (activeId.value === 'overworld' && props.record?.engine && meta.value?.dir) {
    props.record.engine.spriteAsset = meta.value.dir
  }
}

// ── import / generate ───────────────────────────────────────────────────────
async function onImport(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || !activeCat.value || !charId.value) return
  const c = activeCat.value
  try {
    saving.value = true
    error.value = ''
    const url = URL.createObjectURL(file)
    const img = await loadImage(url)
    URL.revokeObjectURL(url)
    // Replace the whole sheet from the imported image (drawn at native top-left).
    const cols = Math.max(1, Math.round(img.width / c.cellW))
    const canvas = sheetCanvasFrom(img, c.rows, Math.max(c.cols, cols), c.cellW, c.cellH)
    sheetCanvas = canvas
    const { sheetBase64, frames } = exportSheet(
      canvas, c.rows, Math.max(c.cols, cols), c.cellW, c.cellH,
      (r, col) => frameName(c, r, col),
    )
    await studio.saveSheet(activeId.value, charId.value, sheetBase64, frames)
    linkOverworld()
    await reload()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'import failed'
  } finally {
    saving.value = false
    ;(ev.target as HTMLInputElement).value = ''
  }
}

function buildPrompt(): string {
  const r = props.record ?? {}
  const spec = r.spriteSpec ?? {}
  return [
    r.role ? `Role: ${r.role}.` : '',
    r.appearance ? `Appearance: ${r.appearance}.` : '',
    spec.style ? `Style: ${spec.style}.` : '',
    Array.isArray(spec.palette) && spec.palette.length ? `Palette: ${spec.palette.join(', ')}.` : '',
    spec.notes ? `Notes: ${spec.notes}.` : '',
  ].filter(Boolean).join(' ')
}

async function onGenerate() {
  if (!activeCat.value || !charId.value) return
  const auth = imageAuth()
  if (!auth || !auth.apiKey) { genError.value = t('story.spriteStudio.noImageKey'); return }
  generating.value = true
  genError.value = ''
  genOutput.value = ''
  try {
    const res = await studio.generate(activeId.value, charId.value, buildPrompt(), auth)
    genOutput.value = res.output || ''
    if (!res.ok) genError.value = t('story.spriteStudio.genFailed')
    linkOverworld()
    await reload()
  } catch (e) {
    genError.value = e instanceof Error ? e.message : 'generation failed'
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="border border-blue-900/40 bg-blue-950/10 rounded-lg p-4">
    <div class="flex items-center gap-2 mb-3">
      <span class="text-sm">🎬</span>
      <h3 class="text-sm font-semibold text-blue-300">{{ t('story.spriteStudio.title') }}</h3>
    </div>

    <p v-if="!charId" class="text-[11px] text-amber-400/80">{{ t('story.spriteStudio.saveFirst') }}</p>

    <template v-else>
      <!-- category tabs -->
      <div class="flex flex-wrap gap-1 mb-3 border-b border-gray-800 pb-2">
        <button
          v-for="c in cats" :key="c.id"
          @click="activeId = c.id"
          class="px-2.5 py-1 text-xs rounded"
          :class="activeId === c.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200 bg-gray-800/60'"
        >{{ catLabel(c) }}</button>
      </div>

      <p v-if="error" class="text-xs text-red-400 mb-2">{{ error }}</p>

      <div v-if="activeCat" class="flex gap-5">
        <!-- preview -->
        <div class="shrink-0">
          <div class="sprite-checker rounded border border-gray-700 inline-flex items-center justify-center p-2">
            <canvas ref="previewCanvas" class="block" style="image-rendering: pixelated;" />
          </div>
          <div class="text-[10px] text-gray-500 mt-1 text-center">
            {{ activeCat.cellW }}×{{ activeCat.cellH }}
            <span v-if="meta?.sheet.exists">· {{ meta.sheet.w }}×{{ meta.sheet.h }}</span>
            <span v-else class="text-amber-500/70">· {{ t('story.spriteStudio.noSheet') }}</span>
          </div>

          <!-- animated controls (overworld) -->
          <div v-if="activeCat.animated" class="mt-2 space-y-1.5">
            <div class="flex gap-1 justify-center">
              <button
                v-for="f in facings" :key="f.row"
                @click="facing = f.row"
                class="px-2 py-0.5 text-[10px] rounded"
                :class="facing === f.row ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'"
              >{{ facingLabel(f.label) }}</button>
            </div>
            <div class="flex gap-1 justify-center">
              <button
                v-for="m in (['stand','walk','run'] as const)" :key="m"
                @click="mode = m"
                class="px-2 py-0.5 text-[10px] rounded"
                :class="[
                  mode === m ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200',
                  m === 'run' && !hasRun ? 'opacity-50' : '',
                ]"
                :title="m === 'run' && !hasRun ? t('story.spriteStudio.runFallback') : ''"
              >{{ t('story.spriteStudio.mode.' + m) }}</button>
            </div>
            <div class="flex items-center gap-2 justify-center">
              <button @click="playing = !playing" class="px-2 py-0.5 text-[10px] rounded bg-gray-800 text-gray-300 hover:text-white">
                {{ playing ? '⏸' : '▶' }}
              </button>
              <input v-model.number="fps" type="range" min="1" max="16" class="w-20" />
              <span class="text-[10px] text-gray-500 w-10">{{ fps }} fps</span>
            </div>
          </div>
        </div>

        <!-- frame grid + actions -->
        <div class="flex-1 min-w-0">
          <div class="text-[10px] uppercase tracking-wide text-gray-500 mb-1">{{ t('story.spriteStudio.frames') }}</div>
          <div
            class="grid gap-1 mb-3"
            :style="{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`, maxWidth: (gridCols * 56) + 'px' }"
          >
            <button
              v-for="tb in thumbs" :key="tb.row + '-' + tb.col"
              @click="openFrame(tb.row, tb.col)"
              class="sprite-checker relative rounded border border-gray-700 hover:border-blue-500 aspect-square flex items-center justify-center overflow-hidden group"
              :title="tb.label + ' — ' + t('story.spriteStudio.editFrame')"
            >
              <img v-if="tb.url" :src="tb.url" class="max-w-full max-h-full" style="image-rendering: pixelated;" alt="" />
              <span v-else class="text-gray-600 text-lg group-hover:text-blue-400">＋</span>
              <span class="absolute bottom-0 inset-x-0 text-[8px] text-gray-400 bg-black/50 truncate px-0.5">{{ tb.label }}</span>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="genConfigured"
              @click="onGenerate" :disabled="generating || saving"
              class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
            >{{ generating ? t('story.spriteStudio.generating') : t('story.spriteStudio.generate') }}</button>

            <label class="px-3 py-1 text-xs rounded bg-gray-700 text-gray-100 hover:bg-gray-600 cursor-pointer">
              {{ t('story.spriteStudio.import') }}
              <input type="file" accept="image/png,image/*" class="hidden" @change="onImport" />
            </label>

            <span v-if="saving" class="text-[10px] text-gray-500">{{ t('story.spriteStudio.saving') }}</span>
            <span v-if="loading" class="text-[10px] text-gray-500">…</span>
          </div>

          <p v-if="genError" class="text-xs text-red-400 mt-2">{{ genError }}</p>
          <pre
            v-if="genOutput"
            class="mt-2 max-h-32 overflow-auto text-[10px] text-gray-400 bg-black/40 rounded p-2 whitespace-pre-wrap"
          >{{ genOutput }}</pre>
          <p class="text-[10px] text-gray-500 mt-2">{{ t('story.spriteStudio.editHint') }}</p>
        </div>
      </div>
    </template>

    <!-- per-frame pixel editor (cropped cell → stitched back into the sheet) -->
    <TilePixelEditor
      v-if="editorProps"
      :tile-size="editorProps.tileSize"
      :px-width="editorProps.pxWidth"
      :px-height="editorProps.pxHeight"
      :src-url="editingSrc"
      :title="editorProps.title"
      :persist="persistFrame"
      :embedded="embeddedPixelEditor"
      @close="editing = null"
    />

    <!-- AI Animation (PerfectPixel-style multi-frame / 8-direction generation) -->
    <AnimatedSpriteGen :record="props.record" />
  </div>
</template>

<style scoped>
.sprite-checker {
  background-image:
    linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
    linear-gradient(-45deg, transparent 75%, #3a3a3a 75%);
  background-size: 12px 12px;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-color: #2a2a2a;
}
</style>
