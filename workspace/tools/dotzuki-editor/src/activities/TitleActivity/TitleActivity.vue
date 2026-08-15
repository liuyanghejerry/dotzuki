<template>
  <div class="h-full flex flex-col">
    <!-- toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 bg-surface border-b border-border shrink-0">
      <span class="text-sm text-ink-secondary">
        {{ layoutName }}
        <span v-if="store.dirty" class="text-warning-ink">●</span>
      </span>
      <button
        class="px-2 py-1 text-xs rounded-control bg-accent hover:bg-accent-strong disabled:opacity-40"
        :disabled="!store.dirty || store.saving"
        @click="save"
      >{{ store.saving ? $t('gui.saving') : $t('gui.save') }}</button>
      <button
        class="px-2 py-1 text-xs rounded-control"
        :class="showGen ? 'bg-accent text-white' : 'bg-raised hover:bg-overlay'"
        @click="showGen = !showGen"
      >✨ {{ $t('titlescreen.background') }}</button>
      <div class="flex items-center gap-1 text-xs text-ink-muted">
        <span>Lang</span>
        <select v-model.number="lang" class="bg-raised rounded-control px-1 py-0.5 border border-border-strong">
          <option :value="0">en</option>
          <option :value="1">zh</option>
        </select>
      </div>
      <span v-if="compileError" class="text-xs text-danger-ink truncate">⚠ {{ compileError }}</span>
      <span v-if="store.error" class="text-xs text-danger-ink truncate">{{ store.error }}</span>
    </div>

    <!-- background generation / upload panel -->
    <div v-if="showGen" class="px-3 py-2 bg-surface-deep border-b border-border shrink-0 space-y-1.5">
      <div class="flex items-center gap-2">
        <span class="text-tiny font-semibold text-ink-body">{{ $t('titlescreen.generateBackground') }}</span>
        <select v-if="imageProviders.length" v-model="providerId"
          class="bg-raised text-ink-secondary text-tiny rounded-control px-1.5 py-0.5 border border-border-strong max-w-[7rem]">
          <option v-for="p in imageProviders" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <span v-else class="text-tiny text-warning-ink">{{ $t('titlescreen.noImageProvider') }}</span>
        <button class="ml-auto px-2 py-1 text-xs rounded-control bg-raised hover:bg-overlay" @click="pickUpload">
          {{ $t('titlescreen.upload') }}
        </button>
        <input ref="uploadInput" type="file" accept="image/png" class="hidden" @change="onUpload" />
      </div>
      <div class="flex items-start gap-2">
        <textarea v-model="genPrompt" rows="2" :placeholder="$t('titlescreen.promptPlaceholder')"
          class="flex-1 resize-none bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent-strong"></textarea>
        <button :disabled="genBusy || !genPrompt.trim() || !imageProviders.length" @click="generateBg"
          class="px-2.5 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40 shrink-0">
          {{ genBusy ? $t('titlescreen.generating') : $t('titlescreen.generate') }}</button>
      </div>
      <p v-if="genError" class="text-tiny text-danger-ink">{{ genError === 'no-provider' ? $t('titlescreen.noImageProvider') : genError }}</p>
    </div>

    <AiKeyPrompt v-if="showKeyPrompt" :provider-id="providerId" @submit="onKeySubmit" @cancel="showKeyPrompt = false" />

    <div class="flex-1 flex overflow-hidden">
      <!-- source editor -->
      <div ref="editorContainer" class="w-2/5 min-w-[280px] border-r border-border overflow-hidden" />

      <!-- live preview: transparent .gui overlay drawn on top of the background layer -->
      <div class="flex-1 flex flex-col items-center justify-start gap-2 p-4 overflow-auto bg-[#0d0d10]">
        <div class="text-xs text-ink-faint">{{ cfg.width }}×{{ cfg.height }}</div>
        <div class="relative shadow-lg outline outline-1 outline-[rgba(255,255,255,0.1)]" :style="{ width: previewW + 'px', height: previewH + 'px' }">
          <!-- background: the on-disk override PNG, or a neutral placeholder when absent -->
          <div
            v-if="bgUrl"
            class="absolute inset-0"
            :style="{ backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }"
          />
          <div
            v-else
            class="absolute inset-0 flex items-center justify-center text-micro text-ink-disabled select-none"
            :style="{ background: 'repeating-linear-gradient(45deg,#15151a,#15151a 8px,#191920 8px,#191920 16px)' }"
          >{{ $t('titlescreen.noBackground') }}</div>
          <!-- overlay canvas: theme bg_color #00000000 → non-text pixels stay transparent -->
          <canvas
            ref="canvasRef"
            :width="cfg.width"
            :height="cfg.height"
            class="absolute inset-0"
            :style="{ imageRendering: 'pixelated', width: previewW + 'px', height: previewH + 'px' }"
          />
        </div>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
          <span>Zoom</span>
          <input type="range" min="1" max="3" step="0.5" v-model.number="zoom" />
          <span>{{ zoom }}×</span>
        </div>
      </div>

      <!-- mock-data panel -->
      <div class="w-72 shrink-0 border-l border-border flex flex-col bg-surface">
        <div class="px-3 py-2 text-xs font-semibold text-ink-body border-b border-border flex items-center justify-between">
          <span>{{ $t('gui.mockData') }}</span>
          <button class="px-1.5 py-0.5 rounded-control bg-raised hover:bg-overlay" @click="fillSkeleton">⟳ {{ $t('gui.fillVars') }}</button>
        </div>
        <p class="px-3 pt-2 text-tiny text-ink-faint leading-snug">
          {{ $t('gui.mockDataHint') }}
        </p>
        <div v-if="vars.length" class="px-3 pt-1 text-tiny text-ink-faint">
          {{ $t('gui.detectedVars') }}: <span class="text-ink-muted">{{ vars.join(', ') }}</span>
        </div>
        <textarea
          v-model="dataText"
          spellcheck="false"
          class="flex-1 m-2 p-2 text-xs font-mono bg-canvas text-ink-secondary rounded-control border border-border resize-none focus:outline-none focus:border-accent-strong"
          :class="{ 'border-danger-hover': dataError }"
        />
        <div v-if="dataError" class="px-3 pb-2 text-tiny text-danger-ink">{{ dataError }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { useGuiActivity } from '@/composables/useGuiActivity'
import { useWasmPreview } from '@/composables/useWasmPreview'
import { useAiImageProviders } from '@/composables/useAiImageProviders'
import { getStoredKey, setStoredKey } from '@/composables/useAiStream'
import { guiLanguage, guiFold } from '@/composables/useGuiMode'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'
import type { TitleActivityConfig, ImageProviderProfile } from '@/types'

const project = useProjectStore()
const editor = useEditorStore()
const store = useGuiActivity()
const wasm = useWasmPreview()

const act = project.getActivity(editor.activeActivity)
const cfg = (act?.config ?? { guiRoot: '', layoutFile: 'title.gui', width: 426, height: 240 }) as TitleActivityConfig

const layoutName = cfg.layoutFile || 'title.gui'
const bgRel = cfg.bgImage || 'data/gfx/title/background.png'

// A wuxia-flavoured starting prompt for the AI background (ink-wash night scene).
const DEFAULT_PROMPT =
  'Ink-wash night mountains under a starry sky, the Big Dipper / 北斗七星 constellation glowing above a crescent moon, drifting mist over layered peaks, muted parchment palette, cinematic widescreen composition, no text or UI.'

const { content } = storeToRefs(store)

const editorContainer = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const lang = ref(0)
const zoom = ref(2)
const dataText = ref('{}')
const dataError = ref<string | null>(null)
const compileError = ref<string | null>(null)
let cmView: EditorView | null = null
let renderTimer: ReturnType<typeof setTimeout> | null = null

const previewW = computed(() => cfg.width * zoom.value)
const previewH = computed(() => cfg.height * zoom.value)

// ── Background layer (on-disk override PNG) ──────────────────────────────────
const bgUrl = ref('')
async function refreshBg() {
  // Cache-bust so a freshly generated/uploaded image is picked up immediately.
  const url = `/api/assets/file?root=&path=${encodeURIComponent(bgRel)}&t=${Date.now()}`
  try {
    const resp = await fetch(url)
    bgUrl.value = resp.ok ? url : ''
  } catch {
    bgUrl.value = ''
  }
}

// Variables referenced in the source as `{name}` (top-level key only).
const vars = computed<string[]>(() => {
  const set = new Set<string>()
  const re = /\{([a-zA-Z_][\w]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content.value)) !== null) set.add(m[1])
  return [...set]
})

function fillSkeleton() {
  let existing: Record<string, unknown> = {}
  try { existing = JSON.parse(dataText.value) } catch { /* keep */ }
  for (const v of vars.value) {
    if (!(v in existing)) existing[v] = guessDefault(v)
  }
  dataText.value = JSON.stringify(existing, null, 2)
}

// Heuristic default per variable name (lists for plural-ish keys, etc.).
function guessDefault(name: string): unknown {
  if (/items|members|list|options|rows|entries/i.test(name)) return ['新的征程', '继续江湖', '退出']
  if (/cursor|index|count|num/i.test(name)) return 0
  if (/^(has|show|is)_|blink/i.test(name)) return true
  return name
}

function seedMockData() {
  dataText.value = JSON.stringify({ items: ['新的征程', '继续江湖', '退出'], cursor: 0, show_blink: true }, null, 2)
  fillSkeleton()
}

function createEditor(doc: string) {
  destroyEditor()
  const container = editorContainer.value
  if (!container) return
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) content.value = u.state.doc.toString()
  })
  const st = EditorState.create({
    doc,
    extensions: [
      basicSetup,
      guiLanguage(),
      guiFold(),
      oneDark,
      updateListener,
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ],
  })
  cmView = new EditorView({ state: st, parent: container })
}

function destroyEditor() {
  cmView?.destroy()
  cmView = null
}

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(renderPreview, 180)
}

async function renderPreview() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Empty/missing layout → clear to fully transparent so the background shows.
  if (!content.value) { ctx.clearRect(0, 0, cfg.width, cfg.height); compileError.value = null; return }

  // Parse mock data (lenient — empty on error, surfaced to the user).
  let data: Record<string, unknown> = {}
  dataError.value = null
  if (dataText.value.trim()) {
    try { data = JSON.parse(dataText.value) } catch (e) { dataError.value = (e as Error).message }
  }

  // Report compile errors (the render also fails silently on bad source).
  const compiled = await wasm.compileScreen(content.value)
  compileError.value = compiled.ok ? null : `${compiled.line}:${compiled.col} ${compiled.error}`

  // The theme's transparent bg_color (#00000000) makes render_gui clear the
  // framebuffer to alpha=0, so putImageData leaves non-text pixels transparent
  // and the background layer beneath the canvas shows through.
  const bytes = await wasm.renderGui(content.value, cfg.width, cfg.height, cfg.theme, data, lang.value)
  if (bytes.length === 0) {
    ctx.clearRect(0, 0, cfg.width, cfg.height)
    return
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes), cfg.width, cfg.height), 0, 0)
}

async function save() {
  await store.saveFile(layoutName, content.value)
}

// ── AI background generation + upload ────────────────────────────────────────
const showGen = ref(false)
const { imageProviders, loadImageProviders } = useAiImageProviders()
const providerId = ref('')
const genPrompt = ref(DEFAULT_PROMPT)
const genBusy = ref(false)
const genError = ref('')
const showKeyPrompt = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)

function provider(): ImageProviderProfile | undefined {
  return imageProviders.value.find(p => p.id === providerId.value) || imageProviders.value[0]
}

function generateBg() {
  if (!genPrompt.value.trim() || genBusy.value) return
  const p = provider()
  if (!p) { genError.value = 'no-provider'; return }
  const key = getStoredKey(p.id)
  if (!key) { showKeyPrompt.value = true; return }
  runGen(p, key)
}

function onKeySubmit(key: string, remember: boolean) {
  showKeyPrompt.value = false
  const p = provider(); if (!p) return
  if (remember) setStoredKey(p.id, key)
  runGen(p, key)
}

async function runGen(p: ImageProviderProfile, key: string) {
  genBusy.value = true; genError.value = ''
  try {
    const resp = await fetch('/api/title/generate-bg', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: genPrompt.value.trim(), profile: p, apiKey: key }),
    })
    const data = await resp.json()
    if (!resp.ok || !data.ok) throw new Error(data.error || 'generation failed')
    await refreshBg()
  } catch (e: any) { genError.value = e?.message || 'generation failed' }
  finally { genBusy.value = false }
}

function pickUpload() { uploadInput.value?.click() }

async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  genBusy.value = true; genError.value = ''
  try {
    const buf = await file.arrayBuffer()
    const resp = await fetch(`/api/assets/upload?root=&path=${encodeURIComponent(bgRel)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf,
    })
    const data = await resp.json()
    if (!resp.ok || !data.ok) throw new Error(data.error || 'upload failed')
    await refreshBg()
  } catch (e: any) { genError.value = e?.message || 'upload failed' }
  finally { genBusy.value = false; input.value = '' }
}

watch([content, dataText, lang], scheduleRender)

onMounted(async () => {
  await loadImageProviders()
  providerId.value = imageProviders.value[0]?.id ?? ''
  await refreshBg()

  await store.loadFile(layoutName)
  if (store.activeFile !== layoutName) {
    // title.gui doesn't exist yet (created by a separate workstream) — start a
    // clean, empty session bound to layoutName so Save creates it. Reset any
    // content left over from the shared `useGuiActivity` store (e.g. the ui tab).
    store.activeFile = layoutName
    store.content = ''
    store.originalContent = ''
    store.error = null
  }

  await nextTick()
  createEditor(content.value)
  seedMockData()
  scheduleRender()
})

onBeforeUnmount(() => {
  destroyEditor()
  if (renderTimer) clearTimeout(renderTimer)
})
</script>
