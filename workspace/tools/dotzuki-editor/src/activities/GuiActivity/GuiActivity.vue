<template>
  <div class="h-full flex flex-col">
    <!-- toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 bg-surface border-b border-border shrink-0">
      <span class="text-sm text-ink-secondary">
        {{ store.activeFile || $t('common.none') }}
        <span v-if="store.dirty" class="text-warning-ink">●</span>
      </span>
      <button
        class="px-2 py-1 text-xs rounded-control bg-accent hover:bg-accent-strong disabled:opacity-40"
        :disabled="!store.activeFile || !store.dirty || store.saving"
        @click="save"
      >{{ store.saving ? $t('gui.saving') : $t('gui.save') }}</button>
      <button
        v-if="store.activeFile"
        class="px-2 py-1 text-xs rounded-control"
        :class="showGen ? 'bg-accent text-white' : 'bg-raised hover:bg-overlay'"
        @click="showGen = !showGen"
      >✨ {{ $t('gui.generate') }}</button>
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

    <!-- AI generate bar -->
    <div v-if="showGen && store.activeFile" class="px-3 py-2 bg-surface-deep border-b border-border shrink-0 space-y-1.5">
      <div class="flex items-center gap-2">
        <select v-if="aiGen.providers.value.length" v-model="aiGen.providerId.value"
          class="bg-raised text-ink-secondary text-tiny rounded-control px-1.5 py-0.5 border border-border-strong max-w-[7rem]">
          <option v-for="p in aiGen.providers.value" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <input v-model="genPrompt" :placeholder="$t('gui.generatePlaceholder')"
          @keydown.enter="generateLayout()"
          class="flex-1 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent-strong" />
        <button :disabled="aiGen.busy.value || !genPrompt.trim()" @click="generateLayout()"
          class="px-2.5 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
          {{ aiGen.busy.value ? $t('gui.generating') : $t('gui.generate') }}</button>
        <button v-if="compileError && !aiGen.busy.value" @click="generateLayout(compileError || undefined)"
          :title="$t('gui.fixHint')" class="px-2 py-1 text-xs rounded-control bg-warning-strong text-white hover:bg-warning-hover">{{ $t('gui.fix') }}</button>
      </div>
      <p v-if="aiGen.error.value" class="text-tiny text-danger-ink">{{ aiGen.error.value === 'no-provider' ? $t('gui.noProvider') : aiGen.error.value }}</p>
      <p v-else-if="genText" class="text-tiny text-ink-faint max-h-16 overflow-y-auto whitespace-pre-wrap">{{ genText }}</p>
    </div>

    <AiKeyPrompt v-if="aiGen.showKeyPrompt.value" :provider-id="aiGen.providerId.value"
      @submit="aiGen.onKeySubmit" @cancel="aiGen.onKeyCancel" />

    <div v-if="!store.activeFile" class="flex-1 flex items-center justify-center text-ink-faint">
      {{ $t('gui.selectLayout') }}
    </div>

    <div v-else class="flex-1 flex overflow-hidden">
      <!-- source editor -->
      <div ref="editorContainer" class="w-2/5 min-w-[280px] border-r border-border overflow-hidden" />

      <!-- live preview -->
      <div class="flex-1 flex flex-col items-center justify-start gap-2 p-4 overflow-auto bg-canvas-deep">
        <!-- Declarations-only component prelude: no screen to preview. -->
        <div v-if="componentLib" class="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <div class="text-sm text-ink-secondary">{{ $t('gui.componentLibrary') }}</div>
          <div class="text-xs text-ink-faint">{{ componentLib.join(', ') }}</div>
        </div>
        <template v-else>
          <div class="text-xs text-ink-faint">{{ cfg.width }}×{{ cfg.height }}</div>
          <canvas
            ref="canvasRef"
            :width="cfg.width"
            :height="cfg.height"
            class="border border-[rgba(255,255,255,0.1)]"
            :style="{ imageRendering: 'pixelated', width: previewW + 'px', height: previewH + 'px' }"
          />
          <div class="flex items-center gap-2 text-xs text-ink-muted">
            <span>Zoom</span>
            <input type="range" min="1" max="3" step="0.5" v-model.number="zoom" />
            <span>{{ zoom }}×</span>
          </div>
        </template>
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
import { lightCodeTheme } from '@/composables/codeTheme'
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
const componentLib = ref<string[] | null>(null)
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
      lightCodeTheme,
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
  if (!content.value) return

  // Report compile errors (the render also fails silently on bad source).
  // A declarations-only component prelude is not an error: show an
  // informational state instead of a screen preview.
  const compiled = await wasm.compileScreen(content.value)
  if (compiled.ok && compiled.kind === 'components') {
    compileError.value = null
    componentLib.value = compiled.names
    return
  }
  componentLib.value = null
  compileError.value = compiled.ok ? null : `${compiled.line}:${compiled.col} ${compiled.error}`

  // The canvas is unmounted while a component prelude is shown — wait for the
  // re-mount when transitioning back to a screen source.
  await nextTick()
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Parse mock data (lenient — empty on error, surfaced to the user).
  let data: Record<string, unknown> = {}
  dataError.value = null
  if (dataText.value.trim()) {
    try { data = JSON.parse(dataText.value) } catch (e) { dataError.value = (e as Error).message }
  }

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
