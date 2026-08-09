// ───────────────────────────────────────────────────────────────────────────
// useScheduler — client-side scheduler for per-project background jobs (P3).
//
// Jobs persist server-side in `.dotzuki-editor.jobs.json` (GET/PUT /api/jobs,
// whole-array write-back). The scheduler starts once a project is loaded
// (watched from the assistant panel's setup) and ticks every 30s with a plain
// setInterval — it keeps running while the tab is hidden. Two kinds:
//
//   scene-check  — POST /api/jobs/run-scene-check (no AI, always safe to run)
//   agent-prompt — a HEADLESS chat round: POST /api/ai/chat with a single user
//                  message (same body shape DefaultChatTransport sends), then
//                  the UI message stream is folded into a summary + proposals.
//                  Proposals go into the shared review tray and are NEVER
//                  auto-applied; the API key is read from localStorage and
//                  sent per request, never stored anywhere else.
//
// Runs are serial (one job at a time) and conservative: an agent-prompt job
// due while the user is mid-conversation is recorded as 'skipped-busy'.
// ───────────────────────────────────────────────────────────────────────────
import { ref, watch, effectScope } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '@/stores/project'
import { useAiProviders } from './useAiProviders'
import { getStoredKey } from './useAiStream'
import { assistantChatBusy, addBackgroundProposal } from './useAssistantChat'

export interface ScheduledJob {
  id: string
  name: string
  kind: 'scene-check' | 'agent-prompt'
  prompt?: string
  intervalMinutes: number
  enabled: boolean
  lastRunAt: number
  lastStatus: '' | 'ok' | 'error' | 'running' | 'skipped-busy'
  lastSummary: string
  unread?: boolean
}

const TICK_MS = 30_000
/** lastSummary keeps at most this many characters of the assistant's reply. */
const SUMMARY_MAX = 120

// ── module singleton state ──────────────────────────────────────────────────
const jobs = ref<ScheduledJob[]>([])
const loaded = ref(false)
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let running = false // serial execution guard
let watchInstalled = false
// Detached scope hosting the project-config watch so it outlives whichever
// panel instance installed it (see useScheduler).
const detachedScope = effectScope(true)
// The `t` of the first component that uses the scheduler, so background runs
// (outside any setup scope) can localize their summaries.
let tFn: ((key: string, vars?: Record<string, unknown>) => string) | null = null

function tt(key: string, vars?: Record<string, unknown>): string {
  return tFn ? tFn(key, vars) : key
}

// ── pure helpers (exported for tests) ───────────────────────────────────────

/** A job is due when enabled and its interval has elapsed since the last run
 *  start (lastRunAt 0 = never ran → due immediately). */
export function isDue(job: ScheduledJob, now: number): boolean {
  return job.enabled && now - (job.lastRunAt || 0) >= job.intervalMinutes * 60_000
}

/**
 * Parse a UI message stream SSE payload (`data: <json>\n\n` lines, terminated
 * by `data: [DONE]`) into chunk objects. Blank lines and the terminator are
 * dropped; unparseable lines are skipped (never throw on wire junk).
 */
export function parseSseChunks(raw: string): any[] {
  const chunks: any[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('data:')) continue
    const payload = s.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try { chunks.push(JSON.parse(payload)) } catch { /* skip junk */ }
  }
  return chunks
}

/**
 * Fold UI message stream chunks into the final assistant text + the proposals
 * it emitted. `error` is set when the stream carried an `error` chunk — the
 * caller treats the run as failed. Tool/data-plan chunks are ignored here:
 * the background path only cares about the reply text and review proposals.
 */
export function summarizeStreamChunks(chunks: any[]): { text: string; proposals: any[]; error: string } {
  let text = ''
  const proposals: any[] = []
  let error = ''
  for (const c of chunks) {
    if (c?.type === 'text-delta' && typeof c.delta === 'string') text += c.delta
    else if (c?.type === 'data-proposal' && c.data) proposals.push(c.data)
    else if (c?.type === 'error') error = String(c.errorText || 'stream error')
  }
  return { text, proposals, error }
}

/** Clip a run summary to SUMMARY_MAX chars (single-line, ellipsis when cut). */
export function clipSummary(text: string, max = SUMMARY_MAX): string {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}

// ── persistence ─────────────────────────────────────────────────────────────

async function loadJobs(): Promise<void> {
  try {
    const resp = await fetch('/api/jobs')
    jobs.value = resp.ok ? await resp.json() : []
  } catch {
    jobs.value = []
  }
  loaded.value = true
}

/** Whole-array write-back; the server re-sanitizes every entry. */
async function persist(): Promise<void> {
  try {
    await fetch('/api/jobs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobs.value),
    })
  } catch { /* best effort — the next mutation retries */ }
}

// ── runners ─────────────────────────────────────────────────────────────────

async function runSceneCheckJob(job: ScheduledJob): Promise<void> {
  const resp = await fetch('/api/jobs/run-scene-check', { method: 'POST' })
  const report = await resp.json().catch(() => null)
  if (!resp.ok) throw new Error(report?.error || `scene check failed (${resp.status})`)
  job.lastStatus = report.failed ? 'error' : 'ok'
  job.lastSummary = tt('assistant.jobs.sceneCheckSummary', { total: report.total, failed: report.failed })
}

/**
 * Headless chat round: one user message, no thread state (the server chat
 * route is stateless — every request carries its full message list). The reply
 * stream is folded locally; proposals go to the shared tray review-only.
 */
async function runAgentPromptJob(job: ScheduledJob): Promise<void> {
  const { providers, loadProviders } = useAiProviders()
  await loadProviders()
  const provider = providers.value[0]
  const key = provider ? getStoredKey(provider.id) : null
  if (!provider || !key) {
    job.lastStatus = 'error'
    job.lastSummary = tt('assistant.jobs.noProvider')
    return
  }
  const now = Date.now()
  const resp = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Same shape DefaultChatTransport POSTs: transport fields (id, trigger,
      // messages) + the panel's per-request body extras (profile, apiKey).
      id: `job-${job.id}-${now}`,
      trigger: 'send-message',
      messages: [{ id: `job-msg-${now}`, role: 'user', parts: [{ type: 'text', text: job.prompt }] }],
      profile: provider,
      apiKey: key,
    }),
  })
  if (!resp.ok) {
    const err = await resp.json().then(j => j.error).catch(() => '')
    throw new Error(err || `chat failed (${resp.status})`)
  }
  const { text, proposals, error } = summarizeStreamChunks(parseSseChunks(await resp.text()))
  if (error) throw new Error(error)
  for (const p of proposals) addBackgroundProposal(p)
  job.lastStatus = 'ok'
  job.lastSummary = clipSummary(text) || tt('assistant.jobs.emptySummary')
}

/**
 * Execute one job now (due or not) and persist the outcome. lastRunAt stamps
 * the run START so the interval counts from the attempt, not the finish.
 */
async function runJob(job: ScheduledJob): Promise<void> {
  job.lastRunAt = Date.now()
  job.lastStatus = 'running'
  try {
    if (job.kind === 'scene-check') {
      await runSceneCheckJob(job)
    } else if (assistantChatBusy()) {
      // The user is mid-conversation: skip this round instead of competing for
      // the provider and the shared review tray.
      job.lastStatus = 'skipped-busy'
      job.lastSummary = tt('assistant.jobs.skippedBusy')
    } else {
      await runAgentPromptJob(job)
    }
    // Only executed runs raise the unread badge; a skipped round has nothing
    // new to review.
    if (job.lastStatus !== 'skipped-busy') job.unread = true
  } catch (e: any) {
    job.lastStatus = 'error'
    job.lastSummary = clipSummary(e?.message || 'job failed')
    job.unread = true
  } finally {
    await persist()
  }
}

/** Serial tick: run due jobs one at a time; re-entrant ticks are dropped. */
async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = Date.now()
    for (const job of jobs.value) {
      if (isDue(job, now)) await runJob(job)
    }
  } finally {
    running = false
  }
}

// ── public API ──────────────────────────────────────────────────────────────

export function useScheduler() {
  const project = useProjectStore()
  const i18n = useI18n()
  tFn = (key, vars) => i18n.t(key, vars ?? {})

  // Start once a project config is loaded (jobs are per-project). One watch
  // for the app lifetime; start() itself is idempotent. The watch lives in a
  // DETACHED effect scope: created from the first panel that mounts (possibly
  // the welcome screen, which unmounts on project open), it must not be
  // disposed with that component. A config (re)load also re-reads the jobs
  // file, so a project switch picks up the new project's jobs.
  if (!watchInstalled) {
    watchInstalled = true
    detachedScope.run(() =>
      watch(() => project.config, (cfg) => { if (cfg) { void loadJobs(); void start() } }, { immediate: true }),
    )
  }

  /** Idempotent: load the jobs file and begin the 30s tick. */
  async function start(): Promise<void> {
    if (started) return
    started = true
    await loadJobs()
    void tick()
    timer = setInterval(() => { void tick() }, TICK_MS)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
    started = false
  }

  async function addJob(data: Pick<ScheduledJob, 'name' | 'kind' | 'intervalMinutes'> & { prompt?: string }): Promise<void> {
    jobs.value.push({
      id: `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: data.name.trim(),
      kind: data.kind,
      ...(data.kind === 'agent-prompt' && data.prompt ? { prompt: data.prompt } : {}),
      intervalMinutes: data.intervalMinutes,
      enabled: true,
      lastRunAt: 0,
      lastStatus: '',
      lastSummary: '',
    })
    await persist()
  }

  async function removeJob(id: string): Promise<void> {
    jobs.value = jobs.value.filter(j => j.id !== id)
    await persist()
  }

  async function toggleJob(job: ScheduledJob): Promise<void> {
    job.enabled = !job.enabled
    await persist()
  }

  /** ▶ run-now: executes immediately regardless of the schedule. */
  async function runNow(job: ScheduledJob): Promise<void> {
    await runJob(job)
  }

  /** Opening the jobs dropdown clears every unread badge. */
  async function markAllRead(): Promise<void> {
    if (!jobs.value.some(j => j.unread)) return
    for (const j of jobs.value) j.unread = false
    await persist()
  }

  return { jobs, loaded, start, stop, addJob, removeJob, toggleJob, runNow, markAllRead }
}
