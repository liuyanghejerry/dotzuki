<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/stores/editor'
import { useProjectStore } from '@/stores/project'
import { useAiProviders } from '@/composables/useAiProviders'
import { useAssistantChat, messageText, messageTools, markScaffoldOnboarding } from '@/composables/useAssistantChat'
import { useAiUsage } from '@/composables/useAiUsage'
import { getStoredKey, setStoredKey } from '@/composables/useAiStream'
import { renderMarkdown } from '@/composables/useMarkdown'
import { useStoryActivity } from '@/composables/useStoryActivity'
import { useDataActivity } from '@/composables/useDataActivity'
import { quickPromptsFor, type QuickPrompt } from '@/composables/useQuickPrompts'
import { useScheduler, type ScheduledJob } from '@/composables/useScheduler'
import AiKeyPrompt from '@/activities/StoryActivity/AiKeyPrompt.vue'
import ProposalCard from './ProposalCard.vue'
import PromptInspector from './PromptInspector.vue'
import { usePromptInspector } from '@/composables/usePromptInspector'
import { PROVIDER_PRESETS } from './providerPresets'
import { useQuickProviderSetup } from '@/composables/useQuickProviderSetup'
import { buildArtifacts, summarize, type Artifact } from './artifacts'
import { CONTENT_KINDS, isMetaKind } from './autoApply'
import type { ProviderProfile } from '@/types'

interface MentionItem { kind: string; id: string; label: string; table?: string }

// welcome = embedded in the welcome screen (no project open): full-width, no
// resize handle, ✕ hands back to the cards instead of toggling the dock.
// initialMessage = one-line pitch from the welcome hero, auto-sent on mount
// when a provider + API key are already configured (consumed once by the
// parent, which resets it when the chat view closes).
const props = withDefaults(defineProps<{ welcome?: boolean; initialMessage?: string }>(), { welcome: false, initialMessage: '' })
const emit = defineEmits<{ close: []; 'scaffold-applied': [] }>()

const { t } = useI18n()
const router = useRouter()
const editor = useEditorStore()
const project = useProjectStore()
const { providers, loadProviders } = useAiProviders()
const assistant = useAssistantChat()
const { messages, proposals, busy, error, phase, activeTool, stopped, plan, autoApplyKinds, threads, activeThreadId } = assistant
const usage = useAiUsage()
// Prompt inspector toggle (default off): while on, requests carry debug:true
// and the full prompt/response detail is captured for the inspector view.
const { enabled: inspectorEnabled } = usePromptInspector()

// Human-readable label for the current working state (header + activity row).
const statusLabel = computed(() => {
  if (phase.value === 'error') return t('assistant.statusError')
  if (activeTool.value) return t('assistant.runningTool', { tool: activeTool.value })
  if (phase.value === 'writing') return t('assistant.writing')
  return t('assistant.thinking')
})

// ── chat threads (multi-session) ────────────────────────────────────────────
// Thread index + active id are shared singletons, so the welcome and dock
// panels stay in sync. All mutations are locked while busy: a running stream
// is bound to the live chat instance and must not switch threads mid-flight.
const threadsOpen = ref(false)

function toggleThreads() { if (!busy.value) threadsOpen.value = !threadsOpen.value }
function onNewThread() { assistant.newThread(); threadsOpen.value = false }
function onSwitchThread(id: string) { assistant.switchThread(id); threadsOpen.value = false }
function onDeleteThread(id: string) { assistant.deleteThread(id) }

/** Compact relative timestamp for a thread row ("just now" / "5m ago" / …). */
function relTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return t('assistant.threads.justNow')
  if (mins < 60) return t('assistant.threads.minutesAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('assistant.threads.hoursAgo', { n: hours })
  return t('assistant.threads.daysAgo', { n: Math.floor(hours / 24) })
}

// ── scheduled jobs (P3) ─────────────────────────────────────────────────────
// Per-project background tasks, client-scheduled (see useScheduler). The 🕒
// button carries an unread badge while a finished run is unreviewed; opening
// the dropdown marks everything read. Jobs exist only with a project open, so
// the button is hidden in welcome mode.
const scheduler = useScheduler()
const jobsOpen = ref(false)
const jobFormOpen = ref(false)
const jobDraft = ref({ name: '', kind: 'scene-check' as ScheduledJob['kind'], prompt: '', intervalMinutes: 60 })
const unreadJobs = computed(() => scheduler.jobs.value.filter(j => j.unread).length)

function toggleJobs() {
  jobsOpen.value = !jobsOpen.value
  if (jobsOpen.value) void scheduler.markAllRead()
}

const jobDraftValid = computed(() => {
  const d = jobDraft.value
  return !!d.name.trim() && (d.kind !== 'agent-prompt' || !!d.prompt.trim())
})

async function saveJob() {
  if (!jobDraftValid.value) return
  const d = jobDraft.value
  await scheduler.addJob({
    name: d.name, kind: d.kind,
    prompt: d.prompt.trim() || undefined,
    intervalMinutes: Math.max(1, Math.round(Number(d.intervalMinutes)) || 60),
  })
  jobDraft.value = { name: '', kind: 'scene-check', prompt: '', intervalMinutes: 60 }
  jobFormOpen.value = false
}

/** Status dot color for a job row's last run. */
function jobStatusClass(j: ScheduledJob): string {
  switch (j.lastStatus) {
    case 'ok': return 'bg-success-ink'
    case 'error': return 'bg-danger-ink'
    case 'running': return 'bg-accent-ink animate-pulse'
    case 'skipped-busy': return 'bg-warning-ink'
    default: return 'bg-overlay'
  }
}

// ── session artifacts ("produced this session") ─────────────────────────────
// Derived from the shared proposal tray: everything currently applied. Clearing
// the chat empties the tray, so this list clears with it.
const artifacts = computed(() => buildArtifacts(proposals.value))
const artifactStats = computed(() => summarize(artifacts.value))
const artifactsOpen = ref(true) // collapsible, expanded by default
const autoApplyOpen = ref(false)

// Header aggregate: N files · +X/−Y lines · Z tokens (session token meter).
const summaryLine = computed(() => t('assistant.sessionSummary', {
  files: artifactStats.value.files,
  add: artifactStats.value.add,
  del: artifactStats.value.del,
  tokens: fmtTokens(usage.total.value),
}))

/** Compact "1.2k" token count (mirrors the formatting inside useAiUsage). */
function fmtTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n)
}

/** Resolve an artifact's activity TYPE to the concrete activity id (config-driven). */
function activityIdFor(a: Artifact): string | null {
  if (!a.activityType) return null
  return project.enabledActivities.find(x => x.type === a.activityType)?.id ?? null
}

/** Row click: switch to the activity owning the artifact (same path as App.vue's tab switch). */
function jumpToArtifact(a: Artifact) {
  const id = activityIdFor(a)
  if (!id || props.welcome) return
  editor.setActivity(id)
  router.push(`/edit/${id}`)
}

const providerId = ref('')
const draft = ref('')
const showKeyPrompt = ref(false)
const pendingText = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const taRef = ref<HTMLTextAreaElement | null>(null)

// ── resizable width ─────────────────────────────────────────────────────────
const MIN_W = 320, MAX_W = 760
const width = ref(clampW(Number(localStorage.getItem('jrpg-assistant-width')) || 384))
function clampW(w: number) { return Math.max(MIN_W, Math.min(MAX_W, w)) }
let dragStartX = 0, dragStartW = 0
function onDragMove(e: MouseEvent) { width.value = clampW(dragStartW + (dragStartX - e.clientX)) }
function onDragEnd() {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  document.body.style.userSelect = ''
  localStorage.setItem('jrpg-assistant-width', String(width.value))
}
function startResize(e: MouseEvent) {
  dragStartX = e.clientX; dragStartW = width.value
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}
onBeforeUnmount(onDragEnd)

// ── @mention autocomplete ───────────────────────────────────────────────────
const mentionItems = ref<MentionItem[]>([])
const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionActive = ref(0)
let mentionStart = -1
let mentionsLoaded = false

async function ensureMentions() {
  if (mentionsLoaded || props.welcome) return // no project → nothing mentionable
  mentionsLoaded = true
  try { const r = await fetch('/api/ai/mentions'); mentionItems.value = r.ok ? await r.json() : [] }
  catch { mentionItems.value = [] }
}

const mentionMatches = computed(() => {
  if (!mentionOpen.value) return []
  const q = mentionQuery.value.toLowerCase()
  return mentionItems.value
    .filter(it => !q || it.id.toLowerCase().includes(q) || String(it.label).toLowerCase().includes(q))
    .slice(0, 8)
})

function onInput() {
  const ta = taRef.value
  if (!ta) return
  const before = draft.value.slice(0, ta.selectionStart ?? draft.value.length)
  const m = before.match(/@([^\s@]*)$/)
  if (m) { mentionStart = (ta.selectionStart ?? 0) - m[0].length; mentionQuery.value = m[1]; mentionActive.value = 0; mentionOpen.value = true; ensureMentions() }
  else mentionOpen.value = false
}

function applyMention(it: MentionItem) {
  const ta = taRef.value
  const pos = ta?.selectionStart ?? draft.value.length
  const token = '@' + it.id + ' '
  draft.value = draft.value.slice(0, mentionStart) + token + draft.value.slice(pos)
  mentionOpen.value = false
  nextTick(() => { if (ta) { const c = mentionStart + token.length; ta.selectionStart = ta.selectionEnd = c; ta.focus() } })
}

function onKeydown(e: KeyboardEvent) {
  const matches = mentionMatches.value
  if (mentionOpen.value && matches.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionActive.value = (mentionActive.value + 1) % matches.length; return }
    if (e.key === 'ArrowUp') { e.preventDefault(); mentionActive.value = (mentionActive.value - 1 + matches.length) % matches.length; return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(matches[mentionActive.value]); return }
    if (e.key === 'Escape') { e.preventDefault(); mentionOpen.value = false; return }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
}

// ── quick-prompt chips ──────────────────────────────────────────────────────
// Context-aware canned instructions above the input; a click sends one like a
// typed message. Selection comes from the activity singletons: story record
// kinds are 'characters' | 'quests' | 'arcs', data exposes the open table.
const story = useStoryActivity()
const data = useDataActivity()
const quickPrompts = computed(() => {
  let selection: { kind: string; id: string } | null = null
  if (editor.activeActivity === 'story' && story.selectedKind.value && story.selectedRecord.value?.id) {
    selection = { kind: story.selectedKind.value, id: story.selectedRecord.value.id }
  } else if (editor.activeActivity === 'data' && data.selectedTableId.value) {
    selection = { kind: 'table', id: data.selectedTableId.value }
  }
  return quickPromptsFor({ welcome: props.welcome, activity: editor.activeActivity || null, selection })
})

// ── providers + send ────────────────────────────────────────────────────────
onMounted(async () => {
  await loadProviders()
  providerId.value = providerId.value || providers.value[0]?.id || ''
  // Welcome-hero handoff: only auto-send when a provider and a stored API key
  // both exist. Otherwise park the text in the draft — the quick-setup form /
  // key prompt flows take over and the user sends it manually afterwards.
  const initial = props.initialMessage.trim()
  if (initial) {
    const provider = pickProvider()
    if (provider && getStoredKey(provider.id)) sendText(initial)
    else draft.value = initial
  }
  // A scaffold was applied while another panel instance was up (welcome → main
  // UI handoff): pick the conversation up with the onboarding follow-up.
  void onboardIfPending()
})

function pickProvider(): ProviderProfile | undefined {
  return providers.value.find(p => p.id === providerId.value) || providers.value[0]
}

/** Auto-send the post-scaffold onboarding message, if one is pending. */
async function onboardIfPending() {
  const provider = pickProvider()
  await assistant.runOnboarding(t('assistant.onboardingPrompt'), provider, provider ? getStoredKey(provider.id) : null)
}

// A project-scaffold proposal flipping to applied = the new project now exists
// server-side (apply switched the editor root to it). Welcome mode hands off to
// the welcome screen (which loads the project and opens the dock panel, where
// the onboarding fires); dock mode refreshes the config and onboards in place.
watch(() => proposals.value.find(p => p.target?.kind === 'project-scaffold')?.status, async (st) => {
  if (st !== 'applied') return
  markScaffoldOnboarding()
  if (props.welcome) emit('scaffold-applied')
  else { await project.loadConfig(); await onboardIfPending() }
})

// ── inline quick setup (welcome mode, no provider profile yet) ───────────────
// Saved via the regular providers API — server-side the profile falls back to a
// global file when no project is open; the key only goes to localStorage.
// Vendor picker driven by PROVIDER_PRESETS: picking a vendor pre-fills
// id/kind/baseURL; the model example is a placeholder hint, never a value.
const {
  qpVendor, qpPreset, qp, qpSaving, qpError, qpReady,
  onVendorChange, saveQuickProvider,
} = useQuickProviderSetup()

async function saveQuickProviderAndSelect() {
  const id = await saveQuickProvider()
  if (id) providerId.value = id
}

function onClose() {
  if (props.welcome) emit('close')
  else editor.toggleAssistant()
}

function submit() {
  sendText(draft.value.trim())
}

/** One-click chip: resolve the canned instruction and send it like typed text. */
function runQuickPrompt(p: QuickPrompt) {
  sendText(t(p.promptKey, p.vars ?? {}))
}

/** Shared send path (textarea + chips): resolve provider → API key → fire. */
function sendText(text: string) {
  if (!text || busy.value) return
  const provider = pickProvider()
  if (!provider) return
  const key = getStoredKey(provider.id)
  if (!key) { pendingText.value = text; showKeyPrompt.value = true; return }
  fire(text, provider, key)
}

function onKeySubmit(key: string, remember: boolean) {
  showKeyPrompt.value = false
  const provider = pickProvider()
  if (!provider) return
  if (remember) setStoredKey(provider.id, key)
  fire(pendingText.value, provider, key)
}

async function fire(text: string, provider: ProviderProfile, key: string) {
  draft.value = ''
  mentionOpen.value = false
  await assistant.send(text, provider, key)
}

watch(
  () => [messages.value.length, messages.value.length ? messageText(messages.value[messages.value.length - 1]) : '', proposals.value.length, plan.value.length, phase.value, activeTool.value],
  async () => { await nextTick(); if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight },
)
</script>

<template>
  <aside
    :class="props.welcome
      ? 'relative bg-surface border border-border rounded-card flex flex-col w-full max-w-2xl mx-auto min-h-0'
      : 'relative bg-surface border-l border-border flex flex-col shrink-0'"
    :style="props.welcome ? undefined : { width: width + 'px' }"
  >
    <!-- drag-to-resize handle on the left edge -->
    <div v-if="!props.welcome" class="absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-col-resize hover:bg-accent-strong/50 z-20" @mousedown.prevent="startResize" />

    <div class="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
      <span class="text-sm font-bold text-accent-ink">✨ {{ t('assistant.title') }}</span>
      <!-- live working-state indicator: a pulsing dot + label, hidden when idle -->
      <span v-if="phase !== 'idle'" :title="statusLabel"
        class="flex items-center gap-1 max-w-[9rem] text-micro"
        :class="phase === 'error' ? 'text-danger-ink' : 'text-accent-ink-strong'">
        <span class="status-dot" :class="phase === 'error' ? 'is-error' : 'is-busy'" />
        <span class="truncate">{{ statusLabel }}</span>
      </span>
      <button @click="toggleThreads" :disabled="busy"
        :title="busy ? t('assistant.threads.busyLocked') : t('assistant.threads.list')"
        class="text-ink-faint hover:text-ink-body text-xs disabled:opacity-40 disabled:hover:text-ink-faint">🗂</button>
      <button @click="onNewThread" :disabled="busy"
        :title="busy ? t('assistant.threads.busyLocked') : t('assistant.threads.new')"
        class="text-ink-faint hover:text-ink-body text-xs disabled:opacity-40 disabled:hover:text-ink-faint">＋</button>
      <button v-if="!props.welcome" @click="toggleJobs" :title="t('assistant.jobs.title')"
        class="relative text-ink-faint hover:text-ink-body text-xs">
        🕒
        <span v-if="unreadJobs"
          class="absolute -top-1.5 -right-1.5 min-w-[12px] h-3 px-0.5 rounded-pill bg-accent-strong text-white text-[8px] leading-3 text-center">{{ unreadJobs }}</span>
      </button>
      <button @click="inspectorEnabled = !inspectorEnabled" :title="t('assistant.inspector.toggle')"
        :class="['text-xs', inspectorEnabled ? 'text-warning-ink' : 'text-ink-faint hover:text-ink-body']">🐞</button>
      <select v-if="providers.length" v-model="providerId"
        class="ml-auto bg-raised text-ink-secondary text-tiny rounded-control px-1.5 py-0.5 border border-border-strong max-w-[8rem]">
        <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.id }}</option>
      </select>
      <span v-if="usage.total.value > 0" :title="t('assistant.tokens', { calls: usage.calls.value })"
        class="text-micro text-ink-faint tabular-nums">{{ usage.label.value }}</span>
      <button @click="assistant.clear()" :title="t('assistant.clear')" class="text-ink-faint hover:text-ink-body text-xs">⟲</button>
      <button @click="onClose" class="text-ink-faint hover:text-ink-body text-sm">✕</button>
    </div>

    <!-- chat threads dropdown: one row per session, most recently active first -->
    <div v-if="threadsOpen"
      class="absolute left-2 right-2 top-9 z-30 max-h-72 overflow-y-auto bg-inset border border-border rounded-control shadow-popover">
      <div v-for="th in threads" :key="th.id" @click="onSwitchThread(th.id)"
        :title="busy ? t('assistant.threads.busyLocked') : undefined"
        :class="['flex items-center gap-2 px-2.5 py-1.5 text-xs',
          th.id === activeThreadId ? 'bg-accent/20 text-ink' : 'text-ink-body hover:bg-surface',
          busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer']">
        <span class="flex-1 min-w-0 truncate">{{ th.title || t('assistant.threads.new') }}</span>
        <span class="shrink-0 text-micro text-ink-faint tabular-nums">{{ relTime(th.updatedAt) }}</span>
        <button @click.stop="onDeleteThread(th.id)" :disabled="busy"
          :title="busy ? t('assistant.threads.busyLocked') : t('assistant.threads.delete')"
          class="shrink-0 text-ink-disabled hover:text-danger-ink disabled:opacity-40 disabled:hover:text-ink-disabled">✕</button>
      </div>
    </div>

    <!-- scheduled jobs dropdown: one row per job + an inline new-job form -->
    <div v-if="jobsOpen"
      class="absolute left-2 right-2 top-9 z-30 max-h-80 overflow-y-auto bg-inset border border-border rounded-control shadow-popover">
      <div class="flex items-center gap-2 px-2.5 py-1.5 border-b border-border-subtle">
        <span class="text-tiny font-semibold text-ink-muted">{{ t('assistant.jobs.title') }}</span>
        <button @click="jobFormOpen = !jobFormOpen"
          class="ml-auto text-micro px-2 py-0.5 rounded-control bg-accent text-white hover:bg-accent-strong">
          {{ t('assistant.jobs.new') }}
        </button>
      </div>

      <!-- new-job form -->
      <div v-if="jobFormOpen" class="px-2.5 py-2 space-y-1.5 border-b border-border-subtle">
        <input v-model="jobDraft.name" :placeholder="t('assistant.jobs.name')"
          class="w-full bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
        <div class="flex items-center gap-1.5">
          <select v-model="jobDraft.kind" :aria-label="t('assistant.jobs.kind')"
            class="flex-1 bg-surface border border-border rounded-control px-1.5 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none">
            <option value="scene-check">{{ t('assistant.jobs.kindSceneCheck') }}</option>
            <option value="agent-prompt">{{ t('assistant.jobs.kindAgentPrompt') }}</option>
          </select>
          <input v-model.number="jobDraft.intervalMinutes" type="number" min="1" :title="t('assistant.jobs.intervalMinutes')"
            class="w-16 bg-surface border border-border rounded-control px-1.5 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
          <span class="text-micro text-ink-faint">{{ t('assistant.jobs.intervalUnit') }}</span>
        </div>
        <textarea v-if="jobDraft.kind === 'agent-prompt'" v-model="jobDraft.prompt" rows="2" :placeholder="t('assistant.jobs.prompt')"
          class="w-full resize-none bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
        <button @click="saveJob" :disabled="!jobDraftValid"
          class="px-2.5 py-1 text-tiny rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
          {{ t('assistant.jobs.save') }}
        </button>
      </div>

      <p v-if="!scheduler.jobs.value.length" class="px-2.5 py-2 text-tiny text-ink-faint">{{ t('assistant.jobs.empty') }}</p>
      <div v-for="j in scheduler.jobs.value" :key="j.id"
        class="flex items-center gap-2 px-2.5 py-1.5 text-xs text-ink-body hover:bg-surface">
        <span class="shrink-0" :title="t(j.kind === 'scene-check' ? 'assistant.jobs.kindSceneCheck' : 'assistant.jobs.kindAgentPrompt')">{{ j.kind === 'scene-check' ? '🔍' : '✨' }}</span>
        <div class="flex-1 min-w-0">
          <div class="truncate" :class="j.enabled ? '' : 'opacity-50'">{{ j.name }}</div>
          <div class="flex items-center gap-1 text-micro text-ink-faint">
            <span class="inline-block w-1.5 h-1.5 rounded-pill shrink-0" :class="jobStatusClass(j)" />
            <span class="shrink-0">{{ j.lastRunAt ? relTime(j.lastRunAt) : t('assistant.jobs.never') }}</span>
            <span v-if="j.lastSummary" class="truncate" :title="j.lastSummary">· {{ j.lastSummary }}</span>
          </div>
        </div>
        <span class="shrink-0 text-micro text-ink-faint tabular-nums">{{ t('assistant.jobs.interval', { n: j.intervalMinutes }) }}</span>
        <input type="checkbox" :checked="j.enabled" @change="scheduler.toggleJob(j)" :title="t('assistant.jobs.enable')"
          class="accent-emerald-500 shrink-0" />
        <button @click="scheduler.runNow(j)" :disabled="j.kind === 'agent-prompt' && busy"
          :title="j.kind === 'agent-prompt' && busy ? t('assistant.jobs.busyRunDisabled') : t('assistant.jobs.run')"
          class="shrink-0 text-ink-faint hover:text-ink-secondary disabled:opacity-40 disabled:hover:text-ink-faint">▶</button>
        <button @click="scheduler.removeJob(j.id)" :title="t('assistant.jobs.delete')"
          class="shrink-0 text-ink-disabled hover:text-danger-ink">✕</button>
      </div>
    </div>

    <!-- inline quick setup: welcome mode with no provider profile yet -->
    <div v-if="props.welcome && !providers.length" class="border-b border-border px-3 py-2.5 space-y-1.5 shrink-0">
      <div class="text-tiny font-semibold text-warning-ink">{{ t('assistant.quickSetup.title') }}</div>
      <select v-model="qpVendor" @change="onVendorChange" :aria-label="t('assistant.quickSetup.vendor')"
        class="w-full bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none">
        <option v-for="p in PROVIDER_PRESETS" :key="p.id" :value="p.id">
          {{ p.id === 'custom' ? t('assistant.quickSetup.vendorCustom') : p.label }}
        </option>
      </select>
      <input v-model="qp.id" :placeholder="t('assistant.quickSetup.name')"
        class="w-full bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
      <input v-model="qp.baseURL" :placeholder="qpPreset.baseURL || t('assistant.quickSetup.baseUrl')"
        class="w-full bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
      <input v-model="qp.model"
        :placeholder="qpPreset.modelExample ? t('assistant.quickSetup.modelExample', { model: qpPreset.modelExample }) : t('assistant.quickSetup.model')"
        class="w-full bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
      <div class="flex items-center gap-2">
        <input v-model="qp.key" type="password" :placeholder="t('assistant.quickSetup.key')"
          class="flex-1 min-w-0 bg-inset border border-border rounded-control px-2 py-1 text-xs text-ink focus:border-accent-strong focus:outline-none" />
        <a v-if="qpPreset.keyUrl" :href="qpPreset.keyUrl" target="_blank" rel="noopener noreferrer"
          class="shrink-0 text-micro text-accent-ink hover:text-accent-ink-strong whitespace-nowrap">
          {{ t('assistant.quickSetup.getKey') }}
        </a>
      </div>
      <div class="flex items-center gap-2">
        <button @click="saveQuickProviderAndSelect" :disabled="!qpReady || qpSaving"
          class="px-2.5 py-1 text-tiny rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
          {{ qpSaving ? t('assistant.quickSetup.saving') : t('assistant.quickSetup.save') }}
        </button>
        <span v-if="qpError" class="text-micro text-danger-ink truncate">{{ qpError }}</span>
      </div>
    </div>

    <div ref="scrollEl" class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      <p v-if="!messages.length" class="text-xs text-ink-faint leading-relaxed">{{ props.welcome ? t('assistant.emptyWelcome') : t('assistant.empty') }}</p>

      <template v-for="(m, i) in messages" :key="m.id || i">
        <div v-if="m.role === 'user'" class="flex justify-end">
          <div class="max-w-[85%] bg-accent/90 text-white text-xs rounded-card rounded-br-sm px-2.5 py-1.5 whitespace-pre-wrap break-words">{{ messageText(m) }}</div>
        </div>
        <div v-else class="space-y-1.5">
          <div v-if="messageTools(m).length" class="text-micro text-ink-faint">
            <span class="opacity-70">{{ t('assistant.tools') }}:</span> {{ messageTools(m).join(' · ') }}
          </div>
          <div v-if="messageText(m)" class="md text-xs text-ink-secondary leading-relaxed break-words" v-html="renderMarkdown(messageText(m))" />
        </div>
      </template>

      <!-- the agent's working checklist (update_plan) -->
      <div v-if="plan.length" class="rounded-control border border-border/70 bg-surface-deep/40 px-2.5 py-2 space-y-1">
        <div class="text-micro font-semibold text-ink-muted flex items-center gap-1">📋 {{ t('assistant.plan') }}</div>
        <div v-for="(s, i) in plan" :key="i" class="flex items-start gap-1.5 text-tiny">
          <span class="mt-[1px] shrink-0"
            :class="s.status === 'done' ? 'text-success-ink' : s.status === 'active' ? 'text-accent-ink' : 'text-ink-disabled'">{{ s.status === 'done' ? '✓' : s.status === 'active' ? '▸' : '○' }}</span>
          <span :class="s.status === 'done' ? 'text-ink-faint line-through' : s.status === 'active' ? 'text-ink' : 'text-ink-muted'">{{ s.title }}</span>
        </div>
      </div>

      <div v-if="proposals.length" class="pt-1 space-y-2">
        <div class="flex items-center gap-2">
          <span class="text-tiny font-semibold text-ink-muted">{{ t('assistant.proposalsTitle') }} ({{ proposals.length }})</span>
          <!-- meta operations (project config/scaffold/map-create) are excluded: they always need a manual apply -->
          <button v-if="proposals.some(p => p.status === 'pending' && !isMetaKind(p.target?.kind))" @click="assistant.applyAll()"
            class="ml-auto text-micro px-2 py-0.5 rounded-control bg-success-hover text-white hover:bg-success">{{ t('assistant.applyAll') }}</button>
        </div>
        <ProposalCard v-for="p in proposals" :key="p.uid" :proposal="p"
          @apply="assistant.applyProposal(p)" @apply-subset="(acc) => assistant.applySubset(p, new Set(acc))"
          @force-apply="assistant.forceApply(p)"
          @discard="assistant.discard(p)" @revert="assistant.revertProposal(p)" />
      </div>

      <!-- session artifacts: proposals currently applied; a row jumps to the owning activity -->
      <div v-if="artifacts.length" class="pt-1">
        <button @click="artifactsOpen = !artifactsOpen" class="flex w-full items-center gap-1.5 text-left">
          <span class="inline-block w-2.5 shrink-0 text-micro text-ink-faint">{{ artifactsOpen ? '▾' : '▸' }}</span>
          <span class="text-tiny font-semibold text-ink-muted">{{ t('assistant.artifacts.title') }}</span>
          <span class="ml-auto text-micro text-ink-faint tabular-nums">{{ summaryLine }}</span>
        </button>
        <div v-if="artifactsOpen" class="mt-1 space-y-0.5">
          <button v-for="a in artifacts" :key="a.uid" @click="jumpToArtifact(a)" :disabled="!activityIdFor(a)"
            :title="activityIdFor(a) ? a.path : undefined"
            class="flex w-full items-center gap-1.5 px-1.5 py-1 rounded-control text-left hover:bg-raised/40 disabled:hover:bg-transparent disabled:cursor-default">
            <span class="shrink-0 text-tiny">{{ a.icon }}</span>
            <span class="min-w-0 flex-1 truncate text-tiny" :class="activityIdFor(a) ? 'text-ink-body' : 'text-ink-faint'">{{ a.path }}</span>
            <span class="shrink-0 text-micro tabular-nums"><span class="text-success-strong">+{{ a.add }}</span><span v-if="a.del" class="text-danger ml-1">−{{ a.del }}</span></span>
          </button>
        </div>
      </div>

      <!-- prompt inspector: captured full AI requests (opt-in via the 🐞 header toggle) -->
      <PromptInspector />

      <!-- persistent working-state footer: always visible while busy (even mid-stream),
           so the user can always tell the assistant is still working vs. finished -->
      <div v-if="busy" class="flex items-center gap-2 text-tiny text-accent-ink-strong">
        <span class="typing-dots"><i /><i /><i /></span>
        <span>{{ statusLabel }}</span>
      </div>
      <div v-else-if="stopped" class="flex items-center gap-1.5 text-tiny text-warning-ink/90">
        <span class="text-micro">⏹</span>{{ t('assistant.stopped') }}
      </div>
    </div>

    <div v-if="error" class="px-3 py-1 text-tiny text-danger-ink border-t border-border shrink-0">{{ error }}</div>

    <div class="relative border-t border-border p-2 shrink-0">
      <!-- @mention autocomplete -->
      <div v-if="mentionOpen && mentionMatches.length"
        class="absolute bottom-full left-2 right-2 mb-1 max-h-52 overflow-y-auto bg-inset border border-border rounded-control shadow-popover z-30">
        <button v-for="(it, idx) in mentionMatches" :key="it.kind + it.id"
          @mousedown.prevent="applyMention(it)" @mouseenter="mentionActive = idx"
          :class="['w-full flex items-center gap-2 px-2 py-1 text-left text-xs', idx === mentionActive ? 'bg-accent-surface' : 'hover:bg-surface']">
          <span class="text-[9px] uppercase text-ink-faint w-10 shrink-0">{{ it.kind }}</span>
          <span class="text-ink-secondary truncate">{{ it.label }}</span>
          <span v-if="String(it.label) !== it.id" class="text-ink-faint truncate text-micro">{{ it.id }}</span>
        </button>
      </div>

      <p v-if="!providers.length && !props.welcome" class="text-tiny text-warning-ink px-1 pb-1">{{ t('assistant.noProvider') }}</p>
      <!-- per-kind auto-apply: content kinds get a switch; meta operations never auto-apply -->
      <div class="px-1 pb-1">
        <button @click="autoApplyOpen = !autoApplyOpen" :title="t('assistant.autoApplyHint')"
          class="flex items-center gap-1 text-micro text-ink-faint hover:text-ink-body select-none">
          <span class="inline-block w-2.5">{{ autoApplyOpen ? '▾' : '▸' }}</span>{{ t('assistant.autoApply') }}
        </button>
        <div v-if="autoApplyOpen" class="mt-1 pl-3.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <!-- labels reuse the raw proposal-kind text shown on the review-card badges -->
          <label v-for="k in CONTENT_KINDS" :key="k" class="flex items-center gap-1 text-micro text-ink-muted cursor-pointer select-none">
            <input type="checkbox" v-model="autoApplyKinds[k]" class="accent-emerald-500" />{{ k }}
          </label>
          <span class="text-micro text-ink-disabled">{{ t('assistant.autoApplyMetaNote') }}</span>
        </div>
      </div>
      <!-- context-aware quick prompts: one click sends a canned instruction -->
      <div v-if="quickPrompts.length" class="flex flex-wrap gap-1 px-1 pb-1">
        <button v-for="p in quickPrompts" :key="p.id" @click="runQuickPrompt(p)" :disabled="busy || !providers.length"
          class="text-micro px-2 py-0.5 rounded-pill border border-border bg-surface hover:border-border-strongest text-ink-body disabled:opacity-40 disabled:hover:border-border">
          {{ p.icon }} {{ t(p.labelKey) }}
        </button>
      </div>
      <div class="flex items-end gap-1.5">
        <textarea ref="taRef" v-model="draft" rows="2" :placeholder="t('assistant.placeholder')"
          @input="onInput" @keydown="onKeydown"
          class="flex-1 resize-none bg-inset border border-border rounded-control px-2 py-1.5 text-xs text-ink focus:border-accent-strong focus:outline-none"></textarea>
        <button v-if="!busy" @click="submit" :disabled="!draft.trim() || !providers.length"
          class="px-3 py-1.5 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">{{ t('assistant.send') }}</button>
        <button v-else @click="assistant.stop()" :title="statusLabel"
          class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-control bg-overlay text-white hover:bg-overlay-strong">
          <span class="inline-block w-2 h-2 rounded-[1px] bg-white/90" />{{ t('assistant.stop') }}</button>
      </div>
    </div>

    <AiKeyPrompt v-if="showKeyPrompt" :provider-id="providerId" @submit="onKeySubmit" @cancel="showKeyPrompt = false" />
  </aside>
</template>

<style scoped>
/* ── working-state indicators ─────────────────────────────────────────────── */
/* header status dot: pulses while busy, solid red on error */
.status-dot { width: 6px; height: 6px; border-radius: 9999px; flex: none; }
.status-dot.is-busy { background: #60a5fa; animation: statusPulse 1s ease-in-out infinite; }
.status-dot.is-error { background: #f87171; }
@keyframes statusPulse { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }

/* bottom activity row: three bouncing dots */
.typing-dots { display: inline-flex; align-items: center; gap: 3px; }
.typing-dots i { width: 5px; height: 5px; border-radius: 9999px; background: currentColor; display: inline-block; animation: typingBounce 1.2s ease-in-out infinite; }
.typing-dots i:nth-child(2) { animation-delay: 0.15s; }
.typing-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes typingBounce { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

/* Markdown rendered into v-html — :deep so scoped styles reach the injected nodes. */
.md :deep(p) { margin: 0 0 0.45rem; }
.md :deep(p:last-child) { margin-bottom: 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) { font-weight: 600; color: #f3f4f6; margin: 0.5rem 0 0.3rem; line-height: 1.25; }
.md :deep(h1) { font-size: 0.95rem; }
.md :deep(h2) { font-size: 0.9rem; }
.md :deep(h3), .md :deep(h4) { font-size: 0.82rem; }
.md :deep(ul) { list-style: disc; padding-left: 1.1rem; margin: 0.3rem 0; }
.md :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin: 0.3rem 0; }
.md :deep(li) { margin: 0.1rem 0; }
.md :deep(code) { background: #0f172a; padding: 0.05rem 0.25rem; border-radius: 3px; font-size: 0.92em; }
.md :deep(pre) { background: #0f172a; padding: 0.5rem; border-radius: 4px; overflow-x: auto; margin: 0.4rem 0; }
.md :deep(pre code) { background: transparent; padding: 0; }
.md :deep(a) { color: #60a5fa; text-decoration: underline; }
.md :deep(strong) { font-weight: 600; color: #e5e7eb; }
.md :deep(em) { font-style: italic; }
.md :deep(blockquote) { border-left: 2px solid #475569; padding-left: 0.5rem; color: #94a3b8; margin: 0.3rem 0; }
.md :deep(hr) { border: none; border-top: 1px solid #374151; margin: 0.5rem 0; }
</style>
