// ───────────────────────────────────────────────────────────────────────────
// useAssistantChat — the AI Assistant panel on the Vercel AI SDK UI stream.
//
// Wraps @ai-sdk/vue `useChat` (transport → POST /api/ai/chat). Assistant text +
// tool-call activity live in useChat's `messages` (UIMessage.parts). Review
// proposals arrive as TRANSIENT `data-proposal` parts via `onData` and go into a
// shared useProposals tray (apply/revert via /api/ai/apply-change).
//
// Multi-session: each conversation lives in a per-thread localStorage snapshot
// (see useChatThreads); tray + plan are module singletons so they survive the
// panel being toggled (the panel is kept mounted with v-show).
// ───────────────────────────────────────────────────────────────────────────
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { useProposals } from './useProposals'
import { useChatThreads } from './useChatThreads'
import { useAiUsage } from './useAiUsage'
import { usePromptInspector } from './usePromptInspector'
import {
  defaultAutoApplySettings, isMetaKind, shouldAutoApply, type AutoApplySettings,
} from '@/components/assistant/autoApply'
import { useEditorStore } from '@/stores/editor'
import { useProjectStore } from '@/stores/project'
import type { ProviderProfile } from '@/types'
import { useAiImageProviders } from './useAiImageProviders'
import { getStoredKey } from './useAiStream'

export type { DiffOp, AssistantProposal } from './useProposals'

/** Coarse working state the panel renders a status indicator from. */
export type AssistantPhase = 'idle' | 'thinking' | 'tool' | 'writing' | 'error'

export interface PlanStep { title: string; status: 'pending' | 'active' | 'done' | string }

// Legacy all-or-nothing boolean key (pre per-kind switches) — migrated on load.
const LEGACY_AUTOAPPLY_KEY = 'jrpg-assistant-autoapply'
const AUTOAPPLY_KINDS_KEY = 'jrpg-assistant-autoapply-kinds'
// Multi-session threads: index + per-thread snapshots in localStorage (see
// useChatThreads; the legacy single-conversation keys migrate on first load).
// Module singleton so the welcome and dock panel instances share the threads.
const threadStore = useChatThreads()
// The tray is a module singleton so staged proposals survive the panel being
// toggled (the panel is kept mounted with v-show). Not self-persisted anymore:
// durability is per-thread through threadStore snapshots.
const tray = useProposals()
// The agent's current working checklist (update_plan). Module-level so it
// survives panel toggles; persisted as part of the per-thread snapshot.
const plan = ref<PlanStep[]>([])
// Prompt inspector (opt-in, default off): collects the data-debug-* parts the
// server streams when a request goes out with `debug: true`. Module-level so
// it survives panel toggles; session-only (never written to localStorage).
const inspector = usePromptInspector()
// Hydrate the singletons from the active thread (page load / reload). The chat
// messages hydrate per panel instance in useAssistantChat() below.
const bootSnapshot = threadStore.activeSnapshot()
tray.replace(bootSnapshot.tray)
plan.value = bootSnapshot.plan
// Per-kind opt-in: apply a proposal the moment it arrives, per content kind.
// Meta kinds (project-config / project-scaffold / map-create) are NEVER
// auto-applied — shouldAutoApply hard-blocks them, since they reshape the
// project itself and must always pass human review. The drift guard still
// fires on auto-applied writes, so a conflict is never silently clobbered.
const autoApplyKinds = ref<AutoApplySettings>(loadAutoApplyKinds())
// Set when a project-scaffold proposal was applied: the next (post-loadConfig)
// panel instance picks this up and auto-sends the onboarding follow-up so the
// agent guides the first build steps. Module-level so it survives the welcome
// chat unmounting into the main UI's dock panel.
const onboardingPending = ref(false)

// ── background scheduled jobs (P3) bridges ──────────────────────────────────
// The scheduler (useScheduler) must not own a second useChat instance, so the
// live panels mirror their busy state here and the background path pushes its
// proposals straight into the shared tray.
const chatBusy = ref(false)

/** True while any live assistant panel is mid-run (submitted/streaming). */
export function assistantChatBusy(): boolean { return chatBusy.value }

/**
 * Push a proposal produced by a BACKGROUND job into the shared review tray.
 * Unlike the panel's onData path this NEVER auto-applies, regardless of the
 * per-kind auto-apply switches — background results always wait for review.
 */
export function addBackgroundProposal(d: any): void { tray.add(d) }

/** Arm the post-scaffold onboarding follow-up (called when a scaffold applies). */
export function markScaffoldOnboarding(): void { onboardingPending.value = true }

export function useAssistantChat() {
  // True only while the user deliberately interrupted the last run (chat.stop()),
  // so the panel can show a "Stopped" badge distinct from a natural finish.
  const stopped = ref(false)

  const editor = useEditorStore()
  const project = useProjectStore()
  const route = useRoute()

  const chat = useChat({
    transport: new DefaultChatTransport({ api: '/api/ai/chat' }),
    messages: threadStore.activeSnapshot().messages, // hydrate the active thread across reloads
    onData: (part: any) => {
      if (part?.type === 'data-proposal' && part.data) {
        tray.add(part.data)
        const p = tray.proposals.value[tray.proposals.value.length - 1]
        // shouldAutoApply hard-blocks meta kinds — they never auto-apply.
        if (p && shouldAutoApply(p.target?.kind, autoApplyKinds.value)) void tray.applyProposal(p)
      }
      else if (part?.type === 'data-plan' && Array.isArray(part.data?.steps)) plan.value = part.data.steps
      // Prompt inspector parts only flow when the request went out with
      // `debug: true` (see send()); they never reach the message stream itself.
      else if (part?.type === 'data-debug-request') inspector.recordRequest(part.data)
      else if (part?.type === 'data-debug-step') inspector.recordStep(part.data)
      // The ACT image skills announce map-art changes (source.png / traced tilemap):
      // relay to the Map activity so its preview refreshes without a page reload.
      else if (part?.type === 'data-backdrop' && part.data) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('jrpg:backdrop-updated', { detail: part.data }))
        }
      }
    },
    onFinish: ({ message }: any) => {
      const u = message?.metadata?.usage
      if (u) useAiUsage().record(u)
      persistCurrent() // durable snapshot once a turn settles
    },
  })

  const busy = computed(() => chat.status.value === 'submitted' || chat.status.value === 'streaming')
  // Mirror the busy state module-wide so the background scheduler can skip
  // agent-prompt jobs while the user is mid-conversation (rate limits and the
  // shared tray would otherwise interleave confusingly).
  watch(busy, v => { chatBusy.value = v }, { immediate: true })
  const error = computed(() => chat.error.value?.message || '')

  const lastMessage = computed(() => chat.messages.value[chat.messages.value.length - 1])

  /** Name of the tool currently executing (input received, output pending), or ''. */
  const activeTool = computed(() => (busy.value ? runningToolOf(lastMessage.value) : '') || '')

  /**
   * The assistant's working state, derived from the SDK status + the live parts:
   *   thinking — request sent / model reasoning, no visible output yet
   *   tool     — a read/propose tool is running (activeTool names it)
   *   writing  — response text is streaming in
   */
  const phase = computed<AssistantPhase>(() => {
    const s = chat.status.value
    if (s === 'error') return 'error'
    if (s === 'submitted') return 'thinking'
    if (s === 'streaming') {
      if (activeTool.value) return 'tool'
      const m = lastMessage.value
      return m && m.role === 'assistant' && messageText(m) ? 'writing' : 'thinking'
    }
    return 'idle'
  })

  watch(autoApplyKinds, v => saveJson(AUTOAPPLY_KINDS_KEY, v), { deep: true })

  /** Everything the current thread owns, written to its snapshot. */
  function persistCurrent(): void {
    threadStore.saveSnapshot(threadStore.activeThreadId.value, {
      messages: chat.messages.value, tray: tray.proposals.value, plan: plan.value,
    })
  }

  /** Load the active thread's snapshot into the live chat, tray and plan. */
  function loadActive(): void {
    const snap = threadStore.activeSnapshot()
    chat.messages.value = snap.messages
    tray.replace(snap.tray)
    plan.value = snap.plan
    stopped.value = false
    chat.clearError()
  }

  // Tray mutations (apply/revert/discard) happen between turns — persist them
  // through the same per-thread snapshot as the message saves.
  watch(tray.proposals, () => persistCurrent(), { deep: true })

  /** Start a fresh empty thread. Locked while busy: a running stream is bound
   *  to this chat instance, so switching mid-stream would cross the wires. */
  function newThread(): void {
    if (busy.value) return
    persistCurrent()
    threadStore.createThread()
    loadActive()
  }

  /** Switch to another thread: snapshot the current one, load the target. */
  function switchThread(id: string): void {
    if (busy.value || id === threadStore.activeThreadId.value) return
    persistCurrent()
    threadStore.setActive(id)
    loadActive()
  }

  /** Delete a thread. Deleting the open one falls back to the most recent
   *  remaining thread (or a fresh empty one) — a thread always exists. */
  function deleteThread(id: string): void {
    if (busy.value) return
    const wasActive = id === threadStore.activeThreadId.value
    threadStore.deleteThread(id)
    if (wasActive) loadActive()
  }

  async function send(text: string, provider: ProviderProfile, key: string): Promise<void> {
    if (!text.trim() || busy.value) return
    stopped.value = false
    plan.value = [] // a new task supersedes the previous turn's checklist
    // Tell the agent what the user is looking at (only meaningful with a project).
    const uiContext = project.config
      ? { activity: editor.activeActivity || undefined, route: route.fullPath }
      : undefined
    // Image-generation providers + their keys (from localStorage, never sent
    // unless the browser has a saved key) power the assistant's ACT image skills.
    const { imageProviders, loadImageProviders } = useAiImageProviders()
    await loadImageProviders()
    const imageProvidersWithKeys = imageProviders.value
      .map(p => ({ profile: p, apiKey: getStoredKey(p.id) }))
      .filter(x => x.apiKey)
    await chat.sendMessage({ text }, {
      body: {
        profile: provider, apiKey: key,
        // The dsh backend maps chat threads 1:1 to harness sessions server-side.
        threadId: threadStore.activeThreadId.value,
        ...(uiContext ? { uiContext } : {}),
        ...(imageProvidersWithKeys.length ? { imageProviders: imageProvidersWithKeys } : {}),
        // Prompt inspector is opt-in: only ask the server for the debug stream
        // while the panel toggle is on, so the default path stays lean.
        ...(inspector.enabled.value ? { debug: true } : {}),
      },
    })
  }

  /** If a scaffold was just applied, auto-send the onboarding follow-up once.
   *  Returns false when there is nothing pending (or it cannot be sent yet). */
  async function runOnboarding(text: string, provider: ProviderProfile | undefined, key: string | null): Promise<boolean> {
    if (!onboardingPending.value || !provider || !key) return false
    onboardingPending.value = false
    await send(text, provider, key)
    return true
  }

  function stop(): void { stopped.value = true; chat.stop(); persistCurrent() }

  /** Clear the current thread's content (the thread itself is kept). */
  function clear(): void {
    stopped.value = false
    chat.messages.value = []
    tray.clear()
    plan.value = []
    inspector.clearTurns()
    chat.clearError()
    persistCurrent()
  }

  return {
    messages: chat.messages, status: chat.status, busy, error,
    phase, activeTool, stopped, plan, autoApplyKinds, inspector,
    proposals: tray.proposals, send, stop, clear, runOnboarding,
    threads: threadStore.threads, activeThreadId: threadStore.activeThreadId,
    newThread, switchThread, deleteThread,
    applyProposal: tray.applyProposal, forceApply: tray.forceApply, applySubset: tray.applySubset,
    // Meta operations stay manual-only even under "Apply all" (same guard as
    // the per-proposal auto-apply path).
    applyAll: () => tray.applyAll(p => !isMetaKind(p.target?.kind)),
    revertProposal: tray.revertProposal, discard: tray.discard,
  }
}

// ── UIMessage.parts helpers (text + tool activity) ───────────────────────────

export function messageText(m: any): string {
  return (m?.parts ?? []).filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
}

export function messageTools(m: any): string[] {
  const names: string[] = []
  for (const p of (m?.parts ?? [])) {
    const n = toolPartName(p)
    if (n) names.push(n)
  }
  return [...new Set(names)]
}

// ── auto-apply persistence (browser only; no-op under node/test) ─────────────
/**
 * Load the per-kind auto-apply switches, migrating the legacy all-or-nothing
 * boolean: it used to mean "apply everything", so `1` maps to all CONTENT
 * kinds on. Meta kinds stay manual-only either way (they reshape the project,
 * so auto-applying them was never acceptable).
 */
function loadAutoApplyKinds(): AutoApplySettings {
  if (typeof localStorage === 'undefined') return defaultAutoApplySettings()
  try {
    const s = localStorage.getItem(AUTOAPPLY_KINDS_KEY)
    if (s) return { ...defaultAutoApplySettings(), ...JSON.parse(s) }
    if (localStorage.getItem(LEGACY_AUTOAPPLY_KEY) === '1') {
      const migrated = defaultAutoApplySettings(true)
      localStorage.setItem(AUTOAPPLY_KINDS_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_AUTOAPPLY_KEY)
      return migrated
    }
  } catch { /* corrupted value → fall through to the defaults */ }
  return defaultAutoApplySettings()
}
function saveJson(key: string, v: unknown): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* best effort */ }
}

/** Tool name of a UIMessage part, whether a static `tool-<name>` or `dynamic-tool`. */
function toolPartName(p: any): string | null {
  if (typeof p?.type === 'string' && p.type.startsWith('tool-')) return p.type.slice(5)
  if (p?.type === 'dynamic-tool' && p.toolName) return String(p.toolName)
  return null
}

/**
 * The tool currently executing in a message: a tool part whose args have been
 * received but whose output hasn't arrived yet (`input-streaming` /
 * `input-available`). '' once it resolves to `output-available` / `output-error`.
 */
function runningToolOf(m: any): string {
  for (const p of (m?.parts ?? [])) {
    const name = toolPartName(p)
    if (name && (p?.state === 'input-streaming' || p?.state === 'input-available')) return name
  }
  return ''
}
