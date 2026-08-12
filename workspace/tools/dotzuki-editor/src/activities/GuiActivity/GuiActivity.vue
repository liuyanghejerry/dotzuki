<template>
  <div class="h-full flex flex-col">
    <!-- toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <span class="text-sm text-gray-200">
        {{ store.activeFile || $t('common.none') }}
        <span v-if="store.dirty" class="text-amber-400">●</span>
      </span>
      <button
        class="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40"
        :disabled="!store.activeFile || !store.dirty || store.saving"
        @click="save"
      >{{ store.saving ? $t('gui.saving') : $t('gui.save') }}</button>
      <button
        v-if="store.activeFile"
        class="px-2 py-1 text-xs rounded"
        :class="showGen ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'"
        @click="showGen = !showGen"
      >✨ {{ $t('gui.generate') }}</button>
      <div class="flex items-center gap-1 text-xs text-gray-400">
        <span>Lang</span>
        <select v-model.number="lang" class="bg-gray-700 rounded px-1 py-0.5 border border-gray-600">
          <option :value="0">en</option>
          <option :value="1">zh</option>
        </select>
      </div>
      <span v-if="compileError" class="text-xs text-red-400 truncate">⚠ {{ compileError }}</span>
      <span v-if="store.error" class="text-xs text-red-400 truncate">{{ store.error }}</span>
    </div>

    <!-- AI generate bar -->
    <div v-if="showGen && store.activeFile" class="px-3 py-2 bg-gray-850 border-b border-gray-700 shrink-0 space-y-1.5">
      <div class="flex items-center gap-2">
        <select v-if="aiGen.providers.value.length" v-model="aiGen.providerId.value"
          class="bg-gray-700 text-gray-200 text-[11px] rounded px-1.5 py-0.5 border border-gray-600 max-w-[7rem]">
          <option v-for="p in aiGen.providers.value" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <input v-model="genPrompt" :placeholder="$t('gui.generatePlaceholder')"
          @keydown.enter="generateLayout()"
          class="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-blue-500" />
        <button :disabled="aiGen.busy.value || !genPrompt.trim()" @click="generateLayout()"
          class="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">
          {{ aiGen.busy.value ? $t('gui.generating') : $t('gui.generate') }}</button>
        <button v-if="compileError && !aiGen.busy.value" @click="generateLayout(compileError || undefined)"
          :title="$t('gui.fixHint')" class="px-2 py-1 text-xs rounded bg-amber-700 text-white hover:bg-amber-600">{{ $t('gui.fix') }}</button>
      </div>
      <p v-if="aiGen.error.value" class="text-[11px] text-red-400">{{ aiGen.error.value === 'no-provider' ? $t('gui.noProvider') : aiGen.error.value }}</p>
      <p v-else-if="genText" class="text-[11px] text-gray-500 max-h-16 overflow-y-auto whitespace-pre-wrap">{{ genText }}</p>
    </div>

    <AiKeyPrompt v-if="aiGen.showKeyPrompt.value" :provider-id="aiGen.providerId.value"
      @submit="aiGen.onKeySubmit" @cancel="aiGen.onKeyCancel" />

    <div v-if="!store.activeFile" class="flex-1 flex items-center justify-center text-gray-500">
      {{ $t('gui.selectLayout') }}
    </div>

    <div v-else class="flex-1 flex overflow-hidden">
      <!-- source editor -->
      <div ref="editorContainer" class="w-2/5 min-w-[280px] border-r border-gray-700 overflow-hidden" />

      <!-- live preview -->
      <div class="flex-1 flex flex-col items-center justify-start gap-2 p-4 overflow-auto bg-[#0d0d10]">
        <div class="text-xs text-gray-500">{{ cfg.width }}×{{ cfg.height }}</div>
        <canvas
          ref="canvasRef"
          :width="cfg.width"
          :height="cfg.height"
          class="border border-[rgba(255,255,255,0.1)]"
          :style="{ imageRendering: 'pixelated', width: previewW + 'px', height: previewH + 'px' }"
        />
        <div class="flex items-center gap-2 text-xs text-gray-400">
          <span>Zoom</span>
          <input type="range" min="1" max="3" step="0.5" v-model.number="zoom" />
          <span>{{ zoom }}×</span>
        </div>
      </div>

      <!-- mock-data panel -->
      <div class="w-72 shrink-0 border-l border-gray-700 flex flex-col bg-gray-800">
        <div class="px-3 py-2 text-xs font-semibold text-gray-300 border-b border-gray-700 flex items-center justify-between">
          <span>{{ $t('gui.mockData') }}</span>
          <button class="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600" @click="fillSkeleton">⟳ {{ $t('gui.fillVars') }}</button>
        </div>
        <p class="px-3 pt-2 text-[11px] text-gray-500 leading-snug">
          {{ $t('gui.mockDataHint') }}
        </p>
        <div v-if="vars.length" class="px-3 pt-1 text-[11px] text-gray-500">
          {{ $t('gui.detectedVars') }}: <span class="text-gray-400">{{ vars.join(', ') }}</span>
        </div>
        <textarea
          v-model="dataText"
          spellcheck="false"
          class="flex-1 m-2 p-2 text-xs font-mono bg-gray-900 text-gray-200 rounded border border-gray-700 resize-none focus:outline-none focus:border-blue-500"
          :class="{ 'border-red-500': dataError }"
        />
        <div v-if="dataError" class="px-3 pb-2 text-[11px] text-red-400">{{ dataError }}</div>
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
import { useAiGenerate } from '@/composables/useAiGenerate'
import { guiLanguage, guiFold } from '@/composables/useGuiMode'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'
import type { GuiActivityConfig } from '@/types'

const project = useProjectStore()
const editor = useEditorStore()
const store = useGuiActivity()
const wasm = useWasmPreview()
const aiGen = useAiGenerate()

const act = project.getActivity(editor.activeActivity)
const cfg = (act?.config ?? { guiRoot: '', width: 160, height: 144 }) as GuiActivityConfig

const { content, activeFile } = storeToRefs(store)

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
  if (/items|members|list|options|rows|auras|skills|entries/i.test(name)) {
    return [['示例', '1'], ['示例', '2']]
  }
  if (/cursor|index|count|num|hp|max|money|atk|def|spd|matk|mdef/i.test(name)) return 0
  if (/^(has|show|is)_/i.test(name)) return true
  return name
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
  if (!canvas || !content.value) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Parse mock data (lenient — empty on error, surfaced to the user).
  let data: Record<string, unknown> = {}
  dataError.value = null
  if (dataText.value.trim()) {
    try { data = JSON.parse(dataText.value) } catch (e) { dataError.value = (e as Error).message }
  }

  // Report compile errors (the render also fails silently on bad source).
  const compiled = await wasm.compileScreen(content.value)
  compileError.value = compiled.ok ? null : `${compiled.line}:${compiled.col} ${compiled.error}`

  const bytes = await wasm.renderGui(content.value, cfg.width, cfg.height, cfg.theme, data, lang.value)
  if (bytes.length === 0) {
    ctx.clearRect(0, 0, cfg.width, cfg.height)
    return
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes), cfg.width, cfg.height), 0, 0)
}

async function save() {
  if (!store.activeFile) return
  await store.saveFile(store.activeFile, content.value)
}

// ── AI: NL → .gui, with a generate→compile→fix loop (compileScreen is the oracle) ──
const showGen = ref(false)
const genPrompt = ref('')
const genText = ref('')

function applyGenerated(text: string) {
  if (cmView) cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: text } })
  else content.value = text
}

async function generateLayout(previousError?: string) {
  if (!genPrompt.value.trim() || aiGen.busy.value) return
  genText.value = ''
  try {
    const res = await aiGen.run(
      'generate-gui',
      { prompt: genPrompt.value.trim(), existingContent: content.value || '', previousError },
      { onText: (d) => { genText.value += d } },
    )
    if (res?.content) applyGenerated(res.content) // triggers scheduleRender → compileScreen
  } catch { /* surfaced via aiGen.error */ }
}

// Re-create the editor + reset mock data whenever a different file loads.
watch(activeFile, async (name) => {
  if (!name) return
  await nextTick()
  createEditor(content.value)
  fillSkeleton()
  scheduleRender()
})

watch([content, dataText, lang], scheduleRender)

onMounted(async () => {
  aiGen.ensure()
  await store.fetchFiles()
  if (store.activeFile && content.value) {
    await nextTick()
    createEditor(content.value)
    fillSkeleton()
    scheduleRender()
  }
})

onBeforeUnmount(() => {
  destroyEditor()
  if (renderTimer) clearTimeout(renderTimer)
})
</script>
