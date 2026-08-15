<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

const { t } = useI18n()
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import type { ScriptActivityConfig } from '@/types'
import { useScriptActivity } from '@/composables/useScriptActivity'
import { useAiGenerate } from '@/composables/useAiGenerate'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'

const project = useProjectStore()
const editor = useEditorStore()
const aiGen = useAiGenerate()

const activityId = editor.activeActivity
const activity = project.getActivity(activityId)
const cfg = activity?.config as ScriptActivityConfig | undefined

const store = useScriptActivity()
store.configure(cfg?.scriptsDir ?? 'scripts', cfg?.extension ?? '.js')

const {
  files,
  activeFile,
  activeFileName,
  content,
  originalContent,
  dirty,
  loading,
  saving,
  error,
} = storeToRefs(store)

const editorContainer = ref<HTMLElement | null>(null)
let cmView: EditorView | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function createEditor(doc: string) {
  destroyEditor()

  const container = editorContainer.value
  if (!container) return

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      content.value = update.state.doc.toString()
    }
  })

  const st = EditorState.create({
    doc,
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      updateListener,
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-gutters': { borderRight: '1px solid rgba(255,255,255,0.08)' },
      }),
    ],
  })

  cmView = new EditorView({ state: st, parent: container })
}

function setEditorContent(text: string) {
  if (!cmView) return
  const current = cmView.state.doc.toString()
  if (current === text) return
  cmView.dispatch({
    changes: { from: 0, to: cmView.state.doc.length, insert: text },
  })
}

function destroyEditor() {
  if (cmView) {
    cmView.destroy()
    cmView = null
  }
}

async function handleSave() {
  if (!activeFile.value || saving.value) return
  await store.saveFile(activeFile.value, content.value)
  runLint()
}

// ── AI: NL → .scene snippet inserted at the cursor (grounded-control by real scenes) ──
const showGen = ref(false)
const genPrompt = ref('')
const genText = ref('')

function insertAtCursor(text: string) {
  const snippet = text.endsWith('\n') ? text : text + '\n'
  if (cmView) {
    const pos = cmView.state.selection.main.head
    cmView.dispatch({ changes: { from: pos, insert: snippet }, selection: { anchor: pos + snippet.length } })
    cmView.focus()
  } else {
    content.value = content.value + '\n' + snippet
  }
}

async function generateSnippet() {
  if (!genPrompt.value.trim() || aiGen.busy.value) return
  genText.value = ''
  try {
    const res = await aiGen.run(
      'generate-scene-snippet',
      { prompt: genPrompt.value.trim(), existingContent: content.value || '' },
      { onText: (d) => { genText.value += d } },
    )
    if (res?.content) { insertAtCursor(res.content); genPrompt.value = ''; scheduleLint() }
  } catch { /* surfaced via aiGen.error */ }
}

// ── Deterministic DSL lint (flags + game.* API), debounced ──
interface LintFinding { line: number; severity: 'warn' | 'info'; message: string; flag?: string }
const lintFindings = ref<LintFinding[]>([])
const showLint = ref(false)
let lintTimer: ReturnType<typeof setTimeout> | null = null

async function runLint() {
  if (!activeFile.value) { lintFindings.value = []; return }
  try {
    const resp = await fetch('/api/scene-lint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.value }),
    })
    const data = await resp.json()
    lintFindings.value = resp.ok ? (data.findings || []) : []
  } catch { lintFindings.value = [] }
}

function scheduleLint() { if (lintTimer) clearTimeout(lintTimer); lintTimer = setTimeout(runLint, 1000) }

function jumpToLine(n: number) {
  if (!cmView) return
  const line = cmView.state.doc.line(Math.max(1, Math.min(n, cmView.state.doc.lines)))
  cmView.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
  cmView.focus()
}

watch(content, scheduleLint)

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    handleSave()
  }
}

async function pollExternalChanges() {
  if (!activeFile.value || dirty.value) return
  try {
    // scriptsDir is applied server-side; the URL is the path relative to it.
    const url = `/api/scripts/${activeFile.value}`.replace(/\/+/g, '/')
    const resp = await fetch(url, { cache: 'no-cache' })
    if (!resp.ok) return
    const text = await resp.text()
    if (text !== originalContent.value && text !== content.value) {
      originalContent.value = text
      content.value = text
      setEditorContent(text)
    }
  } catch {
    /* ignore polling errors */
  }
}

// Push file content into CodeMirror whenever a different file is opened.
// loadFile() updates the store's content/activeFile; without this watcher the
// editor would keep showing the first file opened (only the header changed),
// since the editor view is created once and never re-synced on selection.
watch(activeFile, async () => {
  await nextTick()
  if (!editorContainer.value) return
  if (cmView) setEditorContent(content.value)
  else createEditor(content.value)
  runLint()
})

onMounted(async () => {
  aiGen.ensure()
  document.addEventListener('keydown', handleKeydown)
  await store.fetchFiles()
  if (files.value.length > 0) {
    // A cross-activity jump (e.g. from a quest's "implementedBy") can request a
    // specific file via store.pendingFile; otherwise open the first.
    const want = store.pendingFile && files.value.some(f => f.path === store.pendingFile)
      ? store.pendingFile
      : files.value[0].path
    store.pendingFile = ''
    await store.loadFile(want)
  }
  pollTimer = setInterval(pollExternalChanges, 3000)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  destroyEditor()
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<template>
  <div class="flex flex-col h-full bg-canvas">
    <div class="flex items-center justify-between px-3 py-2 bg-surface/80 border-b border-border shrink-0">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-xs font-mono text-ink-muted truncate">
          {{ activeFile || $t('script.noFileSelected') }}
        </span>
        <span
          v-if="dirty"
          class="text-micro px-1.5 py-0.5 rounded-control bg-warning-surface text-warning-ink font-medium shrink-0"
        >
          {{ $t('script.unsaved') }}
        </span>
        <span
          v-if="saving"
          class="text-micro text-ink-faint shrink-0"
        >
          {{ $t('script.saving') }}
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-micro text-ink-disabled">
           {{ dirty ? $t('script.saveHint') : $t('script.saved') }}
        </span>
        <button
          v-if="activeFile"
          class="px-2.5 py-1 text-xs rounded-control shrink-0"
          :class="showLint ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay'"
          @click="showLint = !showLint"
        >🔍 {{ $t('script.lint') }}<span v-if="lintFindings.length" class="ml-1 px-1 rounded-control bg-warning/30 text-warning-ink-strong text-micro">{{ lintFindings.length }}</span></button>
        <button
          v-if="activeFile"
          class="px-2.5 py-1 text-xs rounded-control shrink-0"
          :class="showGen ? 'bg-accent text-white' : 'bg-raised text-ink-body hover:bg-overlay'"
          @click="showGen = !showGen"
        >✨ {{ $t('script.generate') }}</button>
        <button
          class="px-2.5 py-1 text-xs font-medium rounded-control transition-colors shrink-0"
          :class="dirty
            ? 'bg-accent text-white hover:bg-accent-strong cursor-pointer'
            : 'bg-raised text-ink-faint cursor-not-allowed'"
          :disabled="!dirty"
          @click="handleSave"
        >
          {{ $t('script.save') }}
        </button>
      </div>
    </div>

    <!-- AI generate bar -->
    <div v-if="showGen && activeFile" class="px-3 py-2 bg-surface-deep border-b border-border shrink-0 space-y-1.5">
      <div class="flex items-center gap-2">
        <select v-if="aiGen.providers.value.length" v-model="aiGen.providerId.value"
          class="bg-raised text-ink-secondary text-tiny rounded-control px-1.5 py-0.5 border border-border-strong max-w-[7rem]">
          <option v-for="p in aiGen.providers.value" :key="p.id" :value="p.id">{{ p.id }}</option>
        </select>
        <input v-model="genPrompt" :placeholder="$t('script.generatePlaceholder')" @keydown.enter="generateSnippet()"
          class="flex-1 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent-strong" />
        <button :disabled="aiGen.busy.value || !genPrompt.trim()" @click="generateSnippet()"
          class="px-2.5 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
          {{ aiGen.busy.value ? $t('script.generating') : $t('script.insert') }}</button>
      </div>
      <p v-if="aiGen.error.value" class="text-tiny text-danger-ink">{{ aiGen.error.value === 'no-provider' ? $t('script.noProvider') : aiGen.error.value }}</p>
      <p v-else-if="genText" class="text-tiny text-ink-faint max-h-16 overflow-y-auto whitespace-pre-wrap font-mono">{{ genText }}</p>
    </div>

    <AiKeyPrompt v-if="aiGen.showKeyPrompt.value" :provider-id="aiGen.providerId.value"
      @submit="aiGen.onKeySubmit" @cancel="aiGen.onKeyCancel" />

    <!-- Lint findings -->
    <div v-if="showLint && activeFile" class="px-3 py-2 bg-surface-deep border-b border-border shrink-0 max-h-40 overflow-y-auto">
      <p v-if="!lintFindings.length" class="text-tiny text-ink-faint">{{ $t('script.lintClean') }}</p>
      <button v-for="(f, i) in lintFindings" :key="i" @click="jumpToLine(f.line)"
        class="w-full text-left flex items-start gap-2 px-1 py-0.5 text-tiny hover:bg-surface rounded-control">
        <span class="shrink-0 tabular-nums" :class="f.severity === 'warn' ? 'text-warning-ink' : 'text-ink-faint'">{{ f.severity === 'warn' ? '⚠' : 'ℹ' }} L{{ f.line }}</span>
        <span class="text-ink-body">{{ f.message }}</span>
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden relative">
      <div
        v-if="!activeFile"
        class="absolute inset-0 flex items-center justify-center text-ink-disabled text-sm"
      >
        {{ $t('script.selectFromSidebar') }}
      </div>
      <div
        v-else-if="loading"
        class="absolute inset-0 flex items-center justify-center text-ink-faint text-sm"
      >
        {{ $t('script.loading') }}
      </div>
      <div
        v-else-if="error"
        class="absolute inset-0 flex items-center justify-center text-danger-ink text-sm"
      >
        {{ error }}
      </div>
      <div
        ref="editorContainer"
        class="h-full w-full"
        :class="{ hidden: !activeFile || loading }"
      />
    </div>
  </div>
</template>
