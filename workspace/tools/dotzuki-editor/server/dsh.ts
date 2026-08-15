// ───────────────────────────────────────────────────────────────────────────
// DeepSeek Harness (dsh) backend — the optional agent-runtime provider.
//
// When a provider profile selects backend 'dsh', the assistant chat runs
// through a LOCAL dsh runtime subprocess (stdio JSON-RPC,
// @deepseek-ai/dsh-sdk-client) instead of the Vercel AI SDK. The backend is
// orthogonal to the provider: the model still comes from the profile
// (DeepSeek model ids route through the runtime's built-in deepseek-official
// adapter). The runtime is an optional standalone install
// under dsh-runtime/ (`pnpm install` there — its deps are heavy and deliberately
// excluded from the editor's own install); without it the routes report a clear
// "not installed" status instead of crashing, and the AI SDK providers keep
// working unchanged.
//
// The dsh agent works on the game project directly with its own tools
// (persistent bash, string-replace editor, filesystem), so the assistant gains
// a real multi-step agent loop, approval/sandbox policy, and durable session
// logs — while the editor keeps its existing chat UI by streaming dsh session
// events into the same AI SDK UI-message stream the SDK providers emit.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerResponse } from 'http'
import type { ProjectContext } from './context/projectContext'
import type { ProviderProfile } from './ai'

/** The dsh deployment reads the persona from `profile.systemPrompt` (env DSH_SYSTEM_PROMPT). */
export type DshProfile = ProviderProfile & { systemPrompt?: string }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_RUNTIME_DIR = path.join(ROOT, 'dsh-runtime')
const DSH_BIN_NAME = 'dsh-jsonrpc-agent'

export interface DshStatus {
  kind: 'dsh'
  installed: boolean
  /** Absolute path of the runtime bin when installed. */
  bin: string | null
  config: string
  /** Human-readable setup hint when the runtime is missing. */
  hint?: string
}

/** Bin shim candidates for a dsh-runtime install dir, platform-aware:
 *  pnpm's .bin on Windows ships both a bash shim (no extension) and a .cmd
 *  launcher; only the .cmd is spawnable without a shell, so it wins there. */
export function dshBinCandidates(dir: string, isWin = process.platform === 'win32'): string[] {
  const base = path.join(dir, 'node_modules', '.bin', DSH_BIN_NAME)
  return isWin ? [base + '.cmd', base] : [base, base + '.cmd']
}

/**
 * Launch spec for the runtime subprocess. The SDK client spawns with
 * `child_process.spawn` (no shell), so on Windows the .cmd shim must be
 * wrapped through cmd.exe — spawn() cannot execute .cmd files directly.
 */
export function dshLaunchSpec(
  bin: string,
  config: string,
  isWin = process.platform === 'win32',
): { command: string; args: string[] } {
  if (isWin && /\.(cmd|bat)$/i.test(bin)) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', bin, config] }
  }
  return { command: bin, args: [config] }
}

/** Where the runtime lives, in preference order:
 *  1. DOTZUKI_DSH_BIN / DOTZUKI_DSH_CONFIG env overrides (the packaged app
 *     points these at Resources/dsh-runtime), then
 *  2. the bundled dsh-runtime/ install next to this server. */
export function dshStatus(): DshStatus {
  const envBin = process.env.DOTZUKI_DSH_BIN
  const bin = envBin || firstExisting(dshBinCandidates(DSH_RUNTIME_DIR))
  const config = process.env.DOTZUKI_DSH_CONFIG || path.join(DSH_RUNTIME_DIR, 'cordis.yml')
  const installed = Boolean(bin && fs.existsSync(bin) && fs.existsSync(config))
  const status: DshStatus = { kind: 'dsh', installed, bin: bin || null, config }
  if (!installed) {
    status.hint = envBin
      ? 'The packaged DeepSeek Harness runtime is missing from this build (Resources/dsh-runtime). Rebuild with `pnpm electron:build`, or install the runtime yourself and set DOTZUKI_DSH_BIN / DOTZUKI_DSH_CONFIG.'
      : `DeepSeek Harness runtime not installed. Run \`pnpm install\` in ${DSH_RUNTIME_DIR}, then retry.`
  }
  return status
}

// ── Runtime process management ──────────────────────────────────────────────
// One runtime subprocess serves all dsh sessions; it is bound to
// (project root, model) because both cross the initialize handshake. Switching
// either tears the process down and respawns lazily on the next message.

interface CachedHarness {
  projectRoot: string
  model: string
  apiKey: string
  harness: Awaited<ReturnType<typeof spawnHarness>>
  /** threadId → dsh sessionId. One dsh session per chat thread. */
  sessions: Map<string, string>
}

let cached: CachedHarness | null = null

type HarnessLike = {
  run: (input: string, opts: { sessionId?: string; onNotification?: (n: any) => void }) => Promise<{
    sessionId: string
    finalResponse: string
    events: any[]
    notifications: any[]
  }>
  close: () => Promise<void>
}

async function spawnHarness(opts: {
  bin: string
  config: string
  projectRoot: string
  profile: DshProfile
  apiKey: string
}): Promise<HarnessLike> {
  // Dynamic import: the heavy SDK client is only loaded when the dsh backend
  // is actually used, keeping the dev-server boot path fast.
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
  const launch = dshLaunchSpec(opts.bin, opts.config)
  const harness = new DeepSeekHarness({
    launch: {
      ...launch,
      // `env` replaces the child environment entirely — spread the parent and
      // layer the transient credential + deployment knobs on top.
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: opts.apiKey,
        DSH_MODEL: opts.profile.model || 'deepseek-v4-flash',
        DSH_CWD: opts.projectRoot,
        DSH_SYSTEM_PROMPT: opts.profile.systemPrompt || defaultPersona(),
        DSH_SESSION_ROOT: path.join(opts.projectRoot, '.dsh-sessions'),
      },
    },
    cwd: opts.projectRoot,
    provider: 'deepseek-official',
    model: opts.profile.model || 'deepseek-v4-flash',
    maxTokens: 49_152,
  })
  return harness as unknown as HarnessLike
}

async function getHarness(opts: {
  projectRoot: string
  profile: DshProfile
  apiKey: string
  status: DshStatus
}): Promise<CachedHarness> {
  const key = `${opts.projectRoot}\u0000${opts.profile.model}`
  if (cached && cached.projectRoot === opts.projectRoot && cached.model === opts.profile.model && cached.apiKey === opts.apiKey) {
    return cached
  }
  if (cached) await cached.harness.close().catch(() => {})
  const harness = await spawnHarness({
    bin: opts.status.bin!,
    config: opts.status.config,
    projectRoot: opts.projectRoot,
    profile: opts.profile,
    apiKey: opts.apiKey,
  })
  cached = { projectRoot: opts.projectRoot, model: opts.profile.model, apiKey: opts.apiKey, harness, sessions: new Map() }
  return cached
}

/** Close the cached runtime (dev-server shutdown / project switch). */
export async function closeDshRuntime(): Promise<void> {
  if (cached) {
    await cached.harness.close().catch(() => {})
    cached = null
  }
}

// ── Persona ─────────────────────────────────────────────────────────────────

/** A dotzuki-editor persona summarizing the open project for the dsh agent. */
export function buildDshPersona(project: ProjectContext): string {
  const cfg = project.config()
  const parts: string[] = [
    `You are the AI assistant inside dotzuki-editor, an editor for dotzuki-engine JRPG game projects.`,
    `You work directly on the project files with your tools (bash, string-replace editor, filesystem). Make changes yourself when the user asks, keep edits minimal and consistent with the surrounding files, and report what you changed.`,
    ``,
    `Open project:`,
    `- name: ${cfg.name}`,
    `- data root: ${cfg.dataRoot}`,
  ]
  if (cfg.gfxRoot) parts.push(`- graphics root: ${cfg.gfxRoot}`)
  parts.push(`- activities:`)
  for (const a of cfg.activities) {
    parts.push(`  - ${a.type}${a.label ? ` (${String(a.label)})` : ''}`)
  }
  parts.push(
    ``,
    `Project conventions: data records are JSON files under the data root (one file per record, id field inside); scripts are .scene DSL files; maps are map JSON files; GUI layouts are .gui files; stories live under data/stories/. Text fields often use the bilingual @t("en","中文") syntax. Follow the patterns already present in the project.`,
  )
  return parts.join('\n')
}

function defaultPersona(): string {
  return 'You are the AI assistant inside dotzuki-editor, an editor for dotzuki-engine JRPG game projects. Help the user design and edit their game.'
}

// ── Chat streaming ──────────────────────────────────────────────────────────

export interface DshChatOptions {
  res: ServerResponse
  project: ProjectContext | null
  profile: ProviderProfile
  apiKey: string
  /** UIMessage[] sent by useChat (only the latest user text is submitted; history lives in the dsh session). */
  uiMessages: any[]
  /** The chat thread id — maps 1:1 to a dsh session server-side. */
  threadId: string
  signal?: AbortSignal
}

/** The last user message's plain text. */
function lastUserText(uiMessages: any[]): string {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const m = uiMessages[i]
    if (m?.role === 'user' && Array.isArray(m.parts)) {
      const text = m.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join(' ')
      if (text.trim()) return text
    }
  }
  return ''
}

/** Extract readable text from a dsh content block (text / tool-result blocks). */
export function blockText(block: any): string {
  if (!block) return ''
  if (typeof block === 'string') return block
  if (block.text != null) return String(block.text)
  if (Array.isArray(block.content)) return block.content.map(blockText).join('')
  return ''
}

/** Best-effort readable rendering of a tool output for the chat UI. */
export function toolOutputText(message: any): string {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const text = blocks.map((b: any) => blockText(b)).filter(Boolean).join('\n')
  if (text) return text
  try { return JSON.stringify(message?.content ?? null).slice(0, 4000) } catch { return '' }
}

export async function streamDshChat(opts: DshChatOptions): Promise<void> {
  const { createUIMessageStream, pipeUIMessageStreamToResponse } = await import('ai')

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const status = dshStatus()
      if (!status.installed) {
        writer.write({ type: 'error', errorText: status.hint || 'DeepSeek Harness runtime not installed.' })
        return
      }
      if (!opts.project) {
        writer.write({ type: 'error', errorText: 'DeepSeek Harness needs an open project to work on. Open a project first.' })
        return
      }
      const userText = lastUserText(opts.uiMessages)
      if (!userText) {
        writer.write({ type: 'error', errorText: 'Empty message.' })
        return
      }

      const persona = buildDshPersona(opts.project)
      const cachedHarness = await getHarness({
        projectRoot: opts.project.root,
        profile: { ...opts.profile, systemPrompt: persona },
        apiKey: opts.apiKey,
        status,
      })
      const sessionId = cachedHarness.sessions.get(opts.threadId)

      // Live dsh session events → the AI SDK UI-message part stream the
      // existing chat UI already renders (text deltas, tool parts, plan).
      const TEXT_ID = 'dsh'
      let textOpen = false
      let wroteText = false
      let failure: string | null = null
      let lastUsage: any = undefined

      const onNotification = (n: any) => {
        if (n?.method !== 'session.event') return
        const ev = n.params?.event
        if (!ev || typeof ev.type !== 'string') return
        switch (ev.type) {
          case 'assistant/chunk': {
            const chunk = ev.data?.chunk
            if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
              if (!textOpen) { writer.write({ type: 'text-start', id: TEXT_ID }); textOpen = true }
              writer.write({ type: 'text-delta', id: TEXT_ID, delta: chunk.text })
              wroteText = true
            }
            break
          }
          case 'tool/call': {
            const callId = String(ev.data?.callId ?? 'dsh-call')
            writer.write({
              type: 'tool-input-available', toolCallId: callId, toolName: String(ev.data?.name ?? 'tool'),
              input: safeJsonInput(ev.data?.arguments), dynamic: true,
            })
            break
          }
          case 'tool/result': {
            const callId = String(ev.data?.message?.callId ?? 'dsh-call')
            if (ev.data?.error) {
              writer.write({ type: 'tool-output-error', toolCallId: callId, errorText: `${ev.data.error.name ?? 'error'}: ${ev.data.error.code ?? ''}`, dynamic: true })
            } else {
              writer.write({ type: 'tool-output-available', toolCallId: callId, output: toolOutputText(ev.data?.message), dynamic: true })
            }
            break
          }
          case 'todo/write': {
            const todos = Array.isArray(ev.data?.todos) ? ev.data.todos : []
            writer.write({
              type: 'data-plan',
              data: { steps: todos.map((t: any) => ({ title: t.content, status: t.status === 'in_progress' ? 'active' : t.status })) },
              transient: true,
            })
            break
          }
          case 'turn/end': {
            const reason = ev.data?.reason
            if (reason?.kind === 'error') failure = reason?.error?.message || 'The dsh agent turn failed.'
            break
          }
          case 'assistant/message': {
            if (ev.data?.usage) lastUsage = ev.data.usage
            break
          }
        }
      }

      let result: Awaited<ReturnType<HarnessLike['run']>>
      try {
        result = await cachedHarness.harness.run(userText, { sessionId, onNotification })
      } catch (e) {
        writer.write({ type: 'error', errorText: (e as Error).message })
        return
      }
      cachedHarness.sessions.set(opts.threadId, result.sessionId)

      if (failure) {
        writer.write({ type: 'error', errorText: failure })
        return
      }
      // The chunk stream may have missed the final message (or the adapter
      // streamed nothing) — fall back to the interval's assembled response.
      if (!wroteText && result.finalResponse) {
        writer.write({ type: 'text-start', id: TEXT_ID })
        writer.write({ type: 'text-delta', id: TEXT_ID, delta: result.finalResponse })
        wroteText = true
      }
      if (textOpen) writer.write({ type: 'text-end', id: TEXT_ID })

      // Surface token usage so the client cost meter records it (same shape
      // the AI SDK's usage carries).
      const usage = lastUsage
        ? {
            inputTokens: lastUsage.inputTokens ?? 0,
            outputTokens: lastUsage.outputTokens ?? 0,
            totalTokens: (lastUsage.inputTokens ?? 0) + (lastUsage.outputTokens ?? 0),
            ...(lastUsage.cacheReadTokens != null ? { cachedInputTokens: lastUsage.cacheReadTokens } : {}),
          }
        : undefined
      writer.write({ type: 'finish', finishReason: 'stop', ...(usage ? { usage } : {}) })
    },
    onError: (err) => (err instanceof Error ? err.message : String(err)),
  })

  pipeUIMessageStreamToResponse({ response: opts.res, stream })
}

/** Parse a tool-call arguments JSON string; fall back to the raw text. */
export function safeJsonInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {}
  try { return JSON.parse(raw) } catch { return { raw } }
}

// ── Smoke test ──────────────────────────────────────────────────────────────

/** Smoke-test the dsh backend with a tiny prompt (mirrors server/ai.ts testProvider). */
export async function testDsh(opts: {
  project: ProjectContext | null
  profile: ProviderProfile
  apiKey: string
  prompt?: string
}): Promise<{ ok: boolean; text?: string; error?: string }> {
  const status = dshStatus()
  if (!status.installed) return { ok: false, error: status.hint || 'DeepSeek Harness runtime not installed.' }
  if (!opts.project) return { ok: false, error: 'DeepSeek Harness needs an open project. Open a project first.' }
  try {
    const cachedHarness = await getHarness({
      projectRoot: opts.project.root,
      profile: { ...opts.profile, systemPrompt: buildDshPersona(opts.project) },
      apiKey: opts.apiKey,
      status,
    })
    const result = await cachedHarness.harness.run(opts.prompt?.trim() || 'Reply with a single word: OK.', { sessionId: undefined })
    return { ok: true, text: (result.finalResponse || '').trim() }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (fs.existsSync(p)) return p
  return null
}
