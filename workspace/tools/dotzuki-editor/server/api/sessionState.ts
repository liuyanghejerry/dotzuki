// @ts-nocheck -- dev-server middleware; loose types match the sibling route modules
// ───────────────────────────────────────────────────────────────────────────
// Session state for the cloud platform: a request counter plus activity/write
// timestamps so the orchestrator can tell an idle session from a busy one and
// pick a safe snapshot moment. All writes are synchronous fs at request scope,
// so per-request granularity is enough. Mounted FIRST (before CORS and the
// domain routes) so every request is counted, /api ones or not.
// ───────────────────────────────────────────────────────────────────────────
import { sendJson } from './http'
import { getProjectRoot } from './projectConfig'

const startedAt = Date.now()
let activeRequests = 0
/** Epoch ms of the last completed non-GET/HEAD request (0 = none yet). */
let lastWriteAt = 0
/** Epoch ms of the last request of any kind (0 = none yet). */
let lastActivityAt = 0

/** In-flight request count — the graceful-shutdown drain poll reads this. */
export function getActiveRequests(): number {
  return activeRequests
}

export function sessionState() {
  return { activeRequests, lastWriteAt, lastActivityAt, startedAt, projectRoot: getProjectRoot() }
}

export function registerSession(server: any) {
  // ── Counter middleware — matches every path. activeRequests drops on
  //    response 'close' (fires after finish AND on client aborts/SSE drops),
  //    so long-lived SSE streams stay counted until they actually end. ──
  server.middlewares.use((req, res, next) => {
    activeRequests++
    lastActivityAt = Date.now()
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD'
    res.on('close', () => {
      activeRequests--
      if (isWrite) lastWriteAt = Date.now()
    })
    next()
  })

  // ── GET /api/health — pure liveness; answers even with no project open. ──
  server.middlewares.use('/api/health', (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('Method Not Allowed'); return }
    sendJson(res, { ok: true })
  })

  // ── GET /api/session/state — the platform's snapshot-timing signal. ──
  server.middlewares.use('/api/session/state', (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('Method Not Allowed'); return }
    sendJson(res, sessionState())
  })
}
