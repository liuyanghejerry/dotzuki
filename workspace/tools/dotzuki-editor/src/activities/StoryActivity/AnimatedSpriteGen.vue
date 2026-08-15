<script setup lang="ts">
// ───────────────────────────────────────────────────────────────────────────
// AI Animation panel — drives the ported PerfectPixel pipeline: a character
// brief + a motion preset (optionally fanned across an 8-direction set) → an
// engine-ready animated sprite sheet, generated server-side with a self-
// correcting loop. Shows live progress, per-state animated previews, quality
// scores and warnings, and a regenerate-with-feedback path.
// ───────────────────────────────────────────────────────────────────────────
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImageProviderProfile } from '@/types'
import { useAiImageProviders } from '@/composables/useAiImageProviders'
import { getStoredKey } from '@/composables/useAiStream'
import {
  type AnimGenResult, type AnimManifest, useAnimatedSprite,
} from '@/composables/useAnimatedSprite'

const props = defineProps<{ record: any }>()
const { t } = useI18n()
const { imageProviders, loadImageProviders } = useAiImageProviders()
const anim = useAnimatedSprite()

const open = ref(false)
const charId = computed<string>(() => props.record?.id ?? '')

// ── form state ──────────────────────────────────────────────────────────────
const providerId = ref('')
const description = ref('')
const styleKey = ref<'pixel' | 'chibi' | 'cartoon' | 'retro16'>('pixel')
const cellSize = ref(64)
const presetName = ref('walk')
const frames = ref(6)
const fps = ref(10)
const loop = ref(true)
const selectedDirs = ref<string[]>([])
const feedback = ref('')

const selectedProvider = computed<ImageProviderProfile | undefined>(() =>
  imageProviders.value.find((p) => p.id === providerId.value),
)
const imageReady = computed(() => !!selectedProvider.value?.model)
// Key comes from the central Settings config (browser localStorage), not this panel.
const hasKey = computed(() => !!(providerId.value && getStoredKey(providerId.value)))

const presetsByCategory = computed(() => {
  const groups = new Map<string, typeof anim.presets.value>()
  for (const p of anim.presets.value) {
    if (!groups.has(p.category)) groups.set(p.category, [])
    groups.get(p.category)!.push(p)
  }
  return [...groups.entries()]
})

// 3×3 direction grid (skip the empty center).
const dirGrid = computed(() => {
  const cells: (typeof anim.directions.value[number] | null)[] = new Array(9).fill(null)
  for (const d of anim.directions.value) cells[d.row * 3 + d.col] = d
  return cells
})

// ── generation ──────────────────────────────────────────────────────────────
const generating = ref(false)
const log = ref<string[]>([])
const error = ref('')
const result = ref<AnimGenResult | null>(null)
const version = ref(0)

watch(presetName, (name) => {
  const p = anim.presets.value.find((x) => x.name === name)
  if (p) { frames.value = p.frames; fps.value = p.fps; loop.value = p.loop }
})
onMounted(async () => {
  await Promise.all([loadImageProviders(), anim.loadCatalogs()])
  if (!providerId.value && imageProviders.value.length) providerId.value = imageProviders.value[0].id
  description.value = buildBrief()
})

function buildBrief(): string {
  const r = props.record ?? {}
  const s = r.spriteSpec ?? {}
  return [r.appearance, s.style, s.notes].filter(Boolean).join(' ')
}

function toggleDir(key: string) {
  const i = selectedDirs.value.indexOf(key)
  if (i >= 0) selectedDirs.value.splice(i, 1)
  else selectedDirs.value.push(key)
}

async function onGenerate(regen = false) {
  error.value = ''
  if (!charId.value) { error.value = t('story.aiAnim.errSaveFirst'); return }
  const profile = selectedProvider.value
  if (!profile) { error.value = t('story.aiAnim.errPickProvider'); return }
  if (!imageReady.value) { error.value = t('story.aiAnim.errNoModel'); return }
  const key = getStoredKey(providerId.value) || ''
  if (!key) { error.value = t('story.aiAnim.errKey'); return }
  if (!description.value.trim()) { error.value = t('story.aiAnim.errBrief'); return }

  generating.value = true
  log.value = []
  if (!regen) result.value = null
  const body = {
    id: charId.value, profile, apiKey: key,
    description: description.value.trim(), styleKey: styleKey.value, cellSize: cellSize.value,
    preset: presetName.value, frames: frames.value, fps: fps.value, loop: loop.value,
    directions: selectedDirs.value.length ? selectedDirs.value : undefined,
    feedback: regen && feedback.value.trim() ? feedback.value.trim() : undefined,
  }
  try {
    await anim.generate(body, (ev, data) => {
      if (ev === 'progress') log.value.push(`[${(data.stateIndex ?? 0) + 1}/${data.totalStates ?? 1}] ${data.message}`)
      else if (ev === 'error') error.value = data.message
      else if (ev === 'done') { result.value = data; void loadSheet(data) }
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('story.aiAnim.errFailed')
  } finally {
    generating.value = false
  }
}

// ── result preview ──────────────────────────────────────────────────────────
const sheetImg = ref<HTMLImageElement | null>(null)
const manifest = computed<AnimManifest | null>(() => result.value?.manifest ?? null)
const stateNames = computed<string[]>(() => (manifest.value ? Object.keys(manifest.value.animations) : []))
const previewFps = ref(8)
const canvases = new Map<string, HTMLCanvasElement>()
let frameCounter = 0
let timer: number | null = null

function setCanvas(name: string) {
  return (el: any) => { if (el) canvases.set(name, el as HTMLCanvasElement); else canvases.delete(name) }
}

async function loadSheet(r: AnimGenResult) {
  version.value++
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = anim.gfxUrl(r.dir, 'sheet.png', version.value)
  })
  sheetImg.value = img.width > 0 ? img : null
  drawAll()
}

function drawAll() {
  const m = manifest.value
  const img = sheetImg.value
  if (!m || !img) return
  const cw = m.sheet.cellWidth, ch = m.sheet.cellHeight
  const scale = Math.max(2, Math.floor(96 / Math.max(cw, ch)))
  for (const [name, entry] of Object.entries(m.animations)) {
    const cv = canvases.get(name)
    if (!cv || !entry.rects.length) continue
    cv.width = cw * scale
    cv.height = ch * scale
    const x = cv.getContext('2d')!
    x.imageSmoothingEnabled = false
    x.clearRect(0, 0, cv.width, cv.height)
    const k = frameCounter % entry.rects.length
    const rect = entry.rects[k]
    x.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, cv.width, cv.height)
  }
}

function startTimer() {
  stopTimer()
  timer = window.setInterval(() => { frameCounter++; drawAll() }, Math.round(1000 / Math.max(1, previewFps.value)))
}
function stopTimer() { if (timer != null) { clearInterval(timer); timer = null } }
watch(previewFps, startTimer)
onMounted(startTimer)
onBeforeUnmount(stopTimer)

function scoreColor(v: number): string {
  return v >= 0.85 ? 'text-success-ink' : v >= 0.7 ? 'text-lime-400' : v >= 0.5 ? 'text-warning-ink' : 'text-danger-ink'
}
function stateResult(name: string) {
  return result.value?.states.find((s) => s.name === name)
}
</script>

<template>
  <div class="border border-ai-deep/40 bg-ai-surface rounded-card mt-3">
    <button
      class="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      @click="open = !open"
    >
      <span class="text-sm">✨</span>
      <h3 class="text-sm font-semibold text-ai-ink-strong flex-1">{{ t('story.aiAnim.title') }} <span class="text-micro font-normal text-ink-faint">{{ t('story.aiAnim.subtitle') }}</span></h3>
      <span class="text-ink-faint text-xs">{{ open ? '▾' : '▸' }}</span>
    </button>

    <div v-if="open" class="px-4 pb-4 space-y-3">
      <p v-if="!charId" class="text-tiny text-warning-ink/80">{{ t('story.aiAnim.saveFirst') }}</p>

      <template v-else>
        <!-- provider (key + proxy come from Settings, not re-entered here) -->
        <label class="block text-tiny text-ink-muted">
          {{ t('story.aiAnim.provider') }}
          <select v-model="providerId" class="w-full mt-0.5 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink-secondary">
            <option v-for="p in imageProviders" :key="p.id" :value="p.id">{{ p.id }} ({{ p.kind }}: {{ p.model }})</option>
            <option v-if="!imageProviders.length" value="">{{ t('common.none') }}</option>
          </select>
        </label>
        <p v-if="!imageProviders.length" class="text-micro text-warning-ink/80">{{ t('story.aiAnim.noProviders') }}</p>
        <p v-else-if="providerId && !hasKey" class="text-micro text-warning-ink/80">{{ t('story.aiAnim.errKey') }}</p>
        <p v-else class="text-micro text-ink-faint">{{ t('story.aiAnim.keyFromSettings') }}</p>

        <!-- brief -->
        <label class="block text-tiny text-ink-muted">
          {{ t('story.aiAnim.brief') }}
          <textarea v-model="description" rows="2" class="w-full mt-0.5 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink-secondary" :placeholder="t('story.aiAnim.briefPlaceholder')" />
        </label>

        <!-- style / cell / motion -->
        <div class="grid grid-cols-3 gap-2">
          <label class="text-tiny text-ink-muted">
            {{ t('story.aiAnim.style') }}
            <select v-model="styleKey" class="w-full mt-0.5 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink-secondary">
              <option value="pixel">pixel</option>
              <option value="chibi">chibi</option>
              <option value="cartoon">cartoon</option>
              <option value="retro16">retro16</option>
            </select>
          </label>
          <label class="text-tiny text-ink-muted">
            {{ t('story.aiAnim.cell') }}
            <select v-model.number="cellSize" class="w-full mt-0.5 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink-secondary">
              <option :value="32">32</option>
              <option :value="48">48</option>
              <option :value="64">64</option>
              <option :value="128">128</option>
            </select>
          </label>
          <label class="text-tiny text-ink-muted">
            {{ t('story.aiAnim.motion') }}
            <select v-model="presetName" class="w-full mt-0.5 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink-secondary">
              <optgroup v-for="[cat, list] in presetsByCategory" :key="cat" :label="cat">
                <option v-for="p in list" :key="p.name" :value="p.name">{{ p.label }}</option>
              </optgroup>
            </select>
          </label>
        </div>

        <!-- frames / fps / loop -->
        <div class="flex items-center gap-3 text-tiny text-ink-muted">
          <label class="flex items-center gap-1">{{ t('story.aiAnim.frames') }} <input v-model.number="frames" type="number" min="1" max="10" class="w-12 bg-inset border border-border rounded-control px-1 py-0.5 text-xs text-ink-secondary" /></label>
          <label class="flex items-center gap-1">{{ t('story.aiAnim.fps') }} <input v-model.number="fps" type="number" min="1" max="24" class="w-12 bg-inset border border-border rounded-control px-1 py-0.5 text-xs text-ink-secondary" /></label>
          <label class="flex items-center gap-1"><input v-model="loop" type="checkbox" /> {{ t('story.aiAnim.loop') }}</label>
        </div>

        <!-- 8-direction set (optional) -->
        <div>
          <div class="text-micro uppercase tracking-wide text-ink-faint mb-1">{{ t('story.aiAnim.directions') }} <span class="normal-case text-ink-disabled">{{ t('story.aiAnim.directionsHint') }}</span></div>
          <div class="grid grid-cols-3 gap-1 w-[8.5rem]">
            <template v-for="(d, i) in dirGrid" :key="i">
              <button
                v-if="d"
                @click="toggleDir(d.key)"
                class="aspect-square text-micro rounded-control border"
                :class="selectedDirs.includes(d.key) ? 'bg-ai-hover border-ai text-white' : 'bg-surface border-border text-ink-muted hover:text-ink-secondary'"
                :title="d.label + (d.mirrorOf ? ` (mirror of ${d.mirrorOf})` : '')"
              >{{ d.short }}</button>
              <span v-else />
            </template>
          </div>
        </div>

        <!-- actions -->
        <div class="flex items-center gap-2">
          <button
            @click="onGenerate(false)" :disabled="generating"
            class="px-3 py-1 text-xs rounded-control bg-ai text-white hover:bg-ai-hover disabled:opacity-40"
          >{{ generating ? t('story.aiAnim.generating') : t('story.aiAnim.generate') }}</button>
          <span v-if="generating" class="text-micro text-ink-faint">{{ t('story.aiAnim.selfCorrect') }}</span>
        </div>

        <p v-if="error" class="text-xs text-danger-ink">{{ error }}</p>

        <!-- progress log -->
        <pre v-if="log.length" class="max-h-28 overflow-auto text-micro text-ink-muted bg-black/40 rounded-control p-2 whitespace-pre-wrap">{{ log.join('\n') }}</pre>

        <!-- result -->
        <div v-if="result" class="space-y-2">
          <div class="flex items-center gap-3">
            <div class="text-micro uppercase tracking-wide text-ink-faint">{{ t('story.aiAnim.result') }}</div>
            <label class="flex items-center gap-1 text-micro text-ink-faint">{{ t('story.aiAnim.preview') }} <input v-model.number="previewFps" type="range" min="1" max="16" class="w-16" /> {{ previewFps }}fps</label>
            <a :href="anim.gfxUrl(result.dir, 'sheet.png', version)" target="_blank" class="text-micro text-ai-ink hover:underline">{{ t('story.aiAnim.openSheet') }}</a>
            <a :href="anim.gfxUrl(result.dir, 'manifest.json', version)" target="_blank" class="text-micro text-ai-ink hover:underline">{{ t('story.aiAnim.manifest') }}</a>
          </div>
          <div class="flex flex-wrap gap-3">
            <div v-for="name in stateNames" :key="name" class="shrink-0">
              <div class="sprite-checker rounded-control border border-border inline-flex items-center justify-center p-1">
                <canvas :ref="setCanvas(name)" class="block" style="image-rendering: pixelated;" />
              </div>
              <div class="text-[9px] text-ink-muted text-center mt-0.5 max-w-[6rem] truncate" :title="name">{{ name }}</div>
              <div v-if="stateResult(name)" class="text-[9px] text-center">
                <span :class="stateResult(name)!.found === stateResult(name)!.expected ? 'text-ink-faint' : 'text-warning-ink'">
                  {{ stateResult(name)!.found }}/{{ stateResult(name)!.expected }}f
                </span>
                <span :class="scoreColor(stateResult(name)!.scores.overall)"> · {{ Math.round(stateResult(name)!.scores.overall * 100) }}</span>
              </div>
            </div>
          </div>

          <!-- warnings -->
          <ul v-if="result.states.some(s => s.warnings.length)" class="text-micro text-warning-ink/80 space-y-0.5">
            <li v-for="(w, i) in result.states.flatMap(s => s.warnings.map(x => `${s.name}: ${x}`))" :key="i">⚠ {{ w }}</li>
          </ul>

          <!-- regenerate with feedback -->
          <div class="flex items-end gap-2">
            <label class="flex-1 text-tiny text-ink-muted">
              {{ t('story.aiAnim.feedback') }}
              <input v-model="feedback" :placeholder="t('story.aiAnim.feedbackPlaceholder')" class="w-full mt-0.5 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink-secondary" />
            </label>
            <button
              @click="onGenerate(true)" :disabled="generating"
              class="px-3 py-1 text-xs rounded-control bg-raised text-ink hover:bg-overlay disabled:opacity-40"
            >{{ t('story.aiAnim.regenerate') }}</button>
          </div>
        </div>
      </template>
    </div>
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
