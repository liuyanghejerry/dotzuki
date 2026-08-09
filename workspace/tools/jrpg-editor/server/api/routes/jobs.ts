// @ts-nocheck -- Vite 8 middleware types changed; this is config glue, not app code
// ───────────────────────────────────────────────────────────────────────────
// Scheduled jobs (P3): per-project background tasks driven by the assistant
// panel's client-side scheduler. This module persists the job list
// (`.jrpg-editor.jobs.json` in the project root, whole-array write-back) and
// runs the no-AI `scene-check` kind server-side. `agent-prompt` jobs run
// headless from the browser against /api/ai/chat — the API key never leaves
// the client's memory, so there is no server-side runner for them.
// ───────────────────────────────────────────────────────────────────────────
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'

import { sendJson, sendError, readBody } from '../http'
import { getProjectRoot, loadConfig } from '../projectConfig'
import { getProjectContext, type ProjectContext } from '../../context/projectContext'
import { type LintFinding } from '../../sceneLint'
import { checkSceneFindings } from '../../sceneCheck'

export interface ScheduledJob {
  id: string
  name: string
  kind: 'scene-check' | 'agent-prompt'
  /** The instruction for kind 'agent-prompt' (absent on scene-check jobs). */
  prompt?: string
  intervalMinutes: number
  enabled: boolean
  /** Epoch ms of the last run START (0 = never ran). */
  lastRunAt: number
  lastStatus: '' | 'ok' | 'error' | 'running' | 'skipped-busy'
  lastSummary: string
  /** Set when a run produced a result the user hasn't seen yet. */
  unread?: boolean
}

const JOB_STATUSES = new Set(['ok', 'error', 'running', 'skipped-busy'])
const DEFAULT_INTERVAL_MINUTES = 60
const MIN_INTERVAL_MINUTES = 1

/**
 * The jobs file lives in the project root. loadConfig() is the no-project
 * probe: it throws when no .jrpg-editor.json exists, so the routes answer 500
 * exactly like the other project-scoped endpoints.
 */
export function jobsFile(): string {
  loadConfig()
  return path.join(getProjectRoot(), '.jrpg-editor.jobs.json')
}

/** Coerce one raw entry into a ScheduledJob with defaults; null for junk. */
export function sanitizeJob(raw: any): ScheduledJob | null {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '').trim()
  if (!id) return null
  const interval = Math.round(Number(raw.intervalMinutes))
  const status = String(raw.lastStatus || '')
  return {
    id,
    name: String(raw.name || '').trim() || id,
    kind: raw.kind === 'agent-prompt' ? 'agent-prompt' : 'scene-check',
    ...(raw.prompt ? { prompt: String(raw.prompt) } : {}),
    intervalMinutes: Number.isFinite(interval) && interval >= MIN_INTERVAL_MINUTES ? interval : DEFAULT_INTERVAL_MINUTES,
    enabled: raw.enabled !== false,
    lastRunAt: Math.max(0, Number(raw.lastRunAt) || 0),
    lastStatus: (JOB_STATUSES.has(status) ? status : '') as ScheduledJob['lastStatus'],
    lastSummary: String(raw.lastSummary || ''),
    ...(raw.unread ? { unread: true } : {}),
  }
}

/** Whole-list sanitize (PUT writes the array back wholesale). */
export function sanitizeJobs(parsed: unknown): ScheduledJob[] {
  return (Array.isArray(parsed) ? parsed : [])
    .map(sanitizeJob)
    .filter((j): j is ScheduledJob => j !== null)
}

export interface SceneCheckSceneReport {
  /** The listScenes stem (e.g. "ChenManor"). */
  scene: string
  /** false when any warn-level diagnostic fired (or the file was unreadable). */
  ok: boolean
  diagnostics: LintFinding[]
}

export interface SceneCheckReport {
  total: number
  failed: number
  scenes: SceneCheckSceneReport[]
}

/**
 * Check every `.scene` in the project and aggregate the findings. The default
 * per-scene check is sceneCheck's compile+lint layer (real WASM compile when
 * the pkg is available, lint otherwise — compile errors surface as a warn
 * finding at the reported line); the check fn is injectable for tests. A scene
 * that fails to read/check lands in its own diagnostics instead of aborting
 * the run.
 */
export async function runSceneCheck(
  project: ProjectContext,
  check: (p: ProjectContext, content: string) => LintFinding[] | Promise<LintFinding[]> = checkSceneFindings,
): Promise<SceneCheckReport> {
  const scenes: SceneCheckSceneReport[] = []
  for (const entry of project.listScenes()) {
    let diagnostics: LintFinding[]
    try {
      diagnostics = await check(project, project.readScene(entry.path))
    } catch (e) {
      diagnostics = [{ line: 0, severity: 'warn', message: `Failed to check scene: ${(e as Error).message}` }]
    }
    scenes.push({ scene: entry.stem, ok: !diagnostics.some(d => d.severity === 'warn'), diagnostics })
  }
  return { total: scenes.length, failed: scenes.filter(s => !s.ok).length, scenes }
}

export function registerJobs(server: any) {
  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }

  // ── POST /api/jobs/run-scene-check — compile+lint every .scene, aggregated.
  //    Registered BEFORE '/api/jobs': connect prefix-matches path segments, so
  //    the generic jobs route would otherwise swallow this path. No AI key
  //    required. ──
  server.middlewares.use('/api/jobs/run-scene-check', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      sendJson(res, await runSceneCheck(getProjectContext()))
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET/PUT /api/jobs — the project's scheduled jobs. GET sanitizes on read
  //    (hand-edited files degrade gracefully); PUT validates + writes back the
  //    whole array (the client scheduler owns ordering and run state). ──
  server.middlewares.use('/api/jobs', async (req, res) => {
    try {
      const file = jobsFile()
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return sendJson(res, [])
        return sendJson(res, sanitizeJobs(JSON.parse(fs.readFileSync(file, 'utf-8'))))
      }
      if (req.method === 'PUT') {
        const clean = sanitizeJobs(JSON.parse(await readBody(req)))
        fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf-8')
        return sendJson(res, { ok: true })
      }
      return nextMiddleware(req, res)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}
