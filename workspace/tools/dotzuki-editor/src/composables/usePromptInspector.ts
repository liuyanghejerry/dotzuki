// ───────────────────────────────────────────────────────────────────────────
// usePromptInspector — opt-in capture of the full AI request/response detail.
//
// Off by default: while disabled the client does NOT ask the server for debug
// data and nothing is collected (no extra stream parts, no memory retained).
// When enabled, send() adds `debug: true` to the /api/ai/chat body and the
// server rides transient data-debug-request / data-debug-step parts on the
// chat stream (see server/actions/chat.ts); this singleton collects them per
// turn so the panel can render the exact system prompt, message history,
// tool list and per-step tool I/O exchanged with the model.
//
// Session-only by design: full prompts are far too large for the per-thread
// localStorage snapshots, so turns live in memory (capped) and vanish on
// reload. Only the enabled flag itself is persisted.
// ───────────────────────────────────────────────────────────────────────────
import { ref, watch } from 'vue'

export interface DebugStep {
  text?: string
  toolCalls?: Array<{ toolName: string; input: unknown }>
  toolResults?: Array<{ toolName: string; output: unknown }>
  finishReason?: string
  usage?: unknown
}

export interface DebugTurn {
  id: number
  at: number
  system: string
  messages: unknown[]
  tools: string[]
  cached: boolean
  steps: DebugStep[]
}

const ENABLED_KEY = 'jrpg-assistant-inspector'
// Bound memory while the inspector is on: a turn carries the whole system
// prompt + history, so keep only the most recent handful.
const MAX_TURNS = 20

const enabled = ref(loadEnabled())
const turns = ref<DebugTurn[]>([])
let nextId = 1

function loadEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try { return localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}

watch(enabled, v => {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0') } catch { /* best effort */ }
})

export function usePromptInspector() {
  /** A new turn: the exact payload about to be sent to the model. */
  function recordRequest(d: any): void {
    turns.value.push({
      id: nextId++, at: Date.now(),
      system: String(d?.system ?? ''),
      messages: Array.isArray(d?.messages) ? d.messages : [],
      tools: Array.isArray(d?.tools) ? d.tools.map(String) : [],
      cached: !!d?.cached,
      steps: [],
    })
    if (turns.value.length > MAX_TURNS) turns.value.splice(0, turns.value.length - MAX_TURNS)
  }

  /** One model step (text chunk end / tool call round) on the latest turn. */
  function recordStep(d: any): void {
    const turn = turns.value[turns.value.length - 1]
    if (!turn) return
    turn.steps.push({
      text: d?.text || undefined,
      toolCalls: Array.isArray(d?.toolCalls) ? d.toolCalls : undefined,
      toolResults: Array.isArray(d?.toolResults) ? d.toolResults : undefined,
      finishReason: d?.finishReason,
      usage: d?.usage,
    })
  }

  function clearTurns(): void { turns.value = [] }

  return { enabled, turns, recordRequest, recordStep, clearTurns }
}
