<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { lightCodeTheme } from '@/composables/codeTheme'
import { basicSetup } from 'codemirror'
import { useScriptActivity } from '@/composables/useScriptActivity'
import { useAiGenerate } from '@/composables/useAiGenerate'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'

const { t } = useI18n()
const aiGen = useAiGenerate()

const store = useScriptActivity()

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
let disposed = false
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

// Compile the unsaved scene and lint flag/API usage after edits settle.
interface LintFinding { line: number; col?: number; severity: 'warn' | 'info'; message: string; flag?: string }
const lintFindings = ref<LintFinding[]>([])
const showLint = ref(false)
const isScene = computed(() => activeFile.value.endsWith('.scene'))
const fileLabel = computed(() => files.value.find(f => f.path === activeFile.value)?.displayPath || activeFile.value)
const diagnosticState = ref<'pending' | 'compile' | 'lint' | 'failed'>('pending')
let diagnosticRequest = 0
let lintTimer: ReturnType<typeof setTimeout> | null = null

async function runLint() {
  if (!activeFile.value) return
  const request = ++diagnosticRequest
  const file = activeFile.value
  const draft = content.value
  const current = () => request === diagnosticRequest && file === activeFile.value && draft === content.value
  diagnosticState.value = 'pending'
  try {
    const resp = await fetch('api/scene-lint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: draft, compile: isScene.value }),
    })
    if (!resp.ok) throw new Error(String(resp.status))
    const data = await resp.json()
    if (current()) {
      lintFindings.value = data.findings
      diagnosticState.value = data.source
    }
  } catch {
    if (current()) diagnosticState.value = 'failed'
  }
}

function scheduleLint() {
  ++diagnosticRequest
  diagnosticState.value = 'pending'
  lintFindings.value = []
  if (lintTimer) clearTimeout(lintTimer)
  lintTimer = setTimeout(runLint, 500)
}

function jumpToLine(n: number, col = 1) {
  if (!cmView) return
  const line = cmView.state.doc.line(Math.max(1, Math.min(n, cmView.state.doc.lines)))
  const offset = Array.from(line.text).slice(0, Math.max(0, col - 1)).join('').length
  cmView.dispatch({ selection: { anchor: line.from + offset }, scrollIntoView: true })
  cmView.focus()
}

watch([content, activeFile], scheduleLint)

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    handleSave()
  }
}

async function pollExternalChanges() {
  if (!activeFile.value || dirty.value) return
  try {
    const file = activeFile.value
    const url = store.apiUrl(file)
    const resp = await fetch(url, { cache: 'no-cache' })
    if (!resp.ok) return
    const text = await resp.text()
    if (file !== activeFile.value || dirty.value) return
    if (text !== originalContent.value && text !== content.value) {
      originalContent.value = text
      content.value = text
      setEditorContent(text)
    }
  } catch {
    /* ignore polling errors */
  }
}

// A new file gets its own undo history.
watch(activeFile, async () => {
  await nextTick()
  if (!disposed) createEditor(content.value)
})

onMounted(async () => {
  aiGen.ensure()
  document.addEventListener('keydown', handleKeydown)
  await store.fetchFiles()
  if (disposed) return
  const pending = store.pendingFile
  const exact = files.value.find(f => f.path === pending || f.displayPath === pending)
  const matches = pending ? files.value.filter(f => f.path.endsWith('/' + pending)) : []
  const previous = files.value.find(f => f.path === activeFile.value)
  const wanted = exact ?? (matches.length === 1 ? matches[0] : previous ?? files.value[0])
  store.pendingFile = ''
  if (wanted) {
    if (wanted.path !== activeFile.value || !dirty.value) await store.loadFile(wanted.path)
    if (disposed) return
    if (!cmView) createEditor(content.value)
    scheduleLint()
  }
  pollTimer = setInterval(pollExternalChanges, 3000)
})

onUnmounted(() => {
  disposed = true
  document.removeEventListener('keydown', handleKeydown)
  ++diagnosticRequest
  if (lintTimer) clearTimeout(lintTimer)
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
          {{ fileLabel || $t('script.noFileSelected') }}
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
        >🔍 {{ isScene ? $t('script.diagnostics') : $t('script.lint') }}<span v-if="lintFindings.length" class="ml-1 px-1 rounded-control bg-warning/30 text-warning-ink-strong text-micro">{{ lintFindings.length }}</span></button>
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
      <p v-if="diagnosticState === 'pending'" class="text-tiny text-ink-faint">{{ $t('script.checking') }}</p>
      <p v-else-if="diagnosticState === 'failed'" class="text-tiny text-danger-ink">{{ $t('script.checkFailed') }}</p>
      <p v-else-if="isScene && diagnosticState === 'lint'" class="text-tiny text-warning-ink">{{ $t('script.lintOnly') }}</p>
      <p v-else-if="!lintFindings.length" class="text-tiny text-ink-faint">{{ $t('script.lintClean') }}</p>
      <button v-for="(f, i) in lintFindings" :key="i" @click="jumpToLine(f.line, f.col)"
        class="w-full text-left flex items-start gap-2 px-1 py-0.5 text-tiny hover:bg-surface rounded-control">
        <span class="shrink-0 tabular-nums" :class="f.severity === 'warn' ? 'text-warning-ink' : 'text-ink-faint'">{{ f.severity === 'warn' ? '⚠' : 'ℹ' }} L{{ f.line }}{{ f.col ? ':' + f.col : '' }}</span>
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
