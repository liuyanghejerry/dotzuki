// ──────────────────────────────────────────────────────────────────────────
// Production API server for the Electron build.
//
// In dev the editor's /api surface is served by the Vite dev-server plugin
// (see vite.config.ts). A packaged Electron app has no Vite, so this module
// rebuilds the *same* surface on a plain Node http server: it mounts every
// route module from server/api/routes/* onto a `connect` app — the exact
// { middlewares } shape those handlers expect — then serves the built Vue app
// (dist/) as static files with SPA fallback.
//
// The renderer talks to relative URLs (/api/*, /gfx/*, /wasm/*), so API and
// static assets MUST share one origin. That's why the Electron window loads an
// http:// URL from this server rather than a file:// path.
//
// This file is bundled by electron/build-server.mjs (esbuild) into
// dist-electron/api-server.mjs, with node_modules kept external.
// ──────────────────────────────────────────────────────────────────────────
import http from 'http'
import path from 'path'
import { pathToFileURL } from 'url'
import connect from 'connect'
import sirv from 'sirv'

import { registerBuiltinActions } from '../server/actions'
import { registerSession, getActiveRequests } from '../server/api/sessionState'
import { registerProject } from '../server/api/routes/project'
import { registerData } from '../server/api/routes/data'
import { registerContent } from '../server/api/routes/content'
import { registerMaps } from '../server/api/routes/maps'
import { registerTitle } from '../server/api/routes/title'
import { registerTiles } from '../server/api/routes/tiles'
import { registerGroups } from '../server/api/routes/groups'
import { registerStories } from '../server/api/routes/stories'
import { registerAi } from '../server/api/routes/ai'
import { registerJobs } from '../server/api/routes/jobs'
import { registerCv } from '../server/api/routes/cv'
import { registerSprites } from '../server/api/routes/sprites'
import { registerAssets } from '../server/api/routes/assets'
import { registerAudio } from '../server/api/routes/audio'
import { registerPlay } from '../server/api/routes/play'
import { setProjectRootDir, getProjectRoot } from '../server/api/projectConfig'

export interface StartOptions {
  /** Absolute path of the project root (dir holding .dotzuki-editor.json). */
  projectRoot?: string
  /** Directory of the built Vue app to serve statically (dist/). */
  staticDir?: string
  /** Port to listen on; 0 (default) picks a free ephemeral port. */
  port?: number
  /** Host to bind; defaults to 127.0.0.1 (loopback only). */
  host?: string
}

export interface RunningServer {
  url: string
  port: number
  host: string
  close: () => Promise<void>
}

/** Re-point the API at a different project root at runtime (File → Open Project). */
export function setProjectRoot(dir: string): void {
  setProjectRootDir(path.resolve(dir))
}

export { getProjectRoot }

/**
 * Build the Vite-parity /api surface on a connect app and start listening.
 * Mirrors vite.config.ts apiPlugin(): CORS first, then the domain routes in
 * their original order, so behavior matches the dev server exactly.
 */
export async function startApiServer(opts: StartOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1'
  if (opts.projectRoot) setProjectRootDir(path.resolve(opts.projectRoot))

  registerBuiltinActions()

  const app = connect()
  // The route modules were written against Vite's `server.middlewares`; hand
  // them a connect app under the same property name and they register verbatim.
  const server = { middlewares: app }

  // ── Session state (health + activity counters) — FIRST, so every request
  //    is counted; /api/health answers even with no project open. ──
  registerSession(server)

  // ── CORS — ahead of the domain routes, matches all /api/* and falls through. ──
  app.use('/api', (req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return
    }
    next()
  })

  // ── Domain routes — same order as the dev server. ──
  registerProject(server)
  registerData(server)
  registerContent(server)
  registerMaps(server)
  registerTitle(server)
  registerTiles(server)
  registerGroups(server)
  registerStories(server)
  registerAi(server)
  registerJobs(server)
  registerCv(server)
  registerSprites(server)
  registerAssets(server)
  registerAudio(server)
  registerPlay(server)

  // ── Anything under an API/asset prefix that fell through is a genuine 404;
  //    answer with JSON so the SPA fallback below never masks it as index.html. ──
  app.use((req: any, res: any, next: any) => {
    const url: string = req.url || '/'
    if (url.startsWith('/api/') || url.startsWith('/gfx/') || url.startsWith('/wasm/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `Not found: ${url}` }))
      return
    }
    next()
  })

  // ── Static: the built Vue app, with SPA history fallback. ──
  if (opts.staticDir) {
    app.use(sirv(opts.staticDir, { single: true, dev: false, etag: true }))
  }

  const httpServer = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port ?? 0, host, () => resolve())
  })

  const addr = httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0)
  const url = `http://${host}:${port}`

  // Graceful shutdown is ONLY for the standalone cloud-session process — see
  // installGracefulShutdown for why Electron must never get these handlers.
  if (process.env.DOTZUKI_STANDALONE === '1' || !process.versions.electron) {
    installGracefulShutdown(httpServer)
  }

  return {
    url,
    port,
    host,
    close: () =>
      new Promise<void>((resolve) => httpServer.close(() => resolve())),
  }
}

// ── Graceful shutdown (standalone cloud sessions only) ─────────────────────
// The cloud platform reclaims a session by signaling this process. Sequence:
// stop accepting new connections (httpServer.close) → wait for in-flight
// requests to drain, polled via the session-state counter → after the grace
// window (DOTZUKI_SHUTDOWN_GRACE_MS, default 5s) force-close whatever is left
// (closeAllConnections is what actually drops SSE long-connections) → exit 0.
//
// NOT installed inside Electron: the desktop shell already closes this server
// from app 'will-quit' (electron/main.cjs) and owns its own exit path — a
// process.exit() here would kill Electron mid-shutdown. Standalone is
// detected by DOTZUKI_STANDALONE=1 (the standalone entry below sets it) or by
// the absence of process.versions.electron.
function installGracefulShutdown(httpServer: http.Server): void {
  const graceMs = Math.max(0, Number(process.env.DOTZUKI_SHUTDOWN_GRACE_MS) || 5000)
  let shuttingDown = false // idempotent: repeated signals don't re-run
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    httpServer.close() // stop accepting new connections
    const force = setTimeout(() => {
      httpServer.closeAllConnections()
      process.exit(0)
    }, graceMs)
    force.unref()
    // In-flight requests may finish well before the grace window; when the
    // counter hits zero there is nothing left worth waiting for.
    const drain = setInterval(() => {
      if (getActiveRequests() === 0) {
        clearInterval(drain)
        clearTimeout(force)
        httpServer.closeAllConnections()
        process.exit(0)
      }
    }, 50)
    drain.unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// ── Standalone entry: `node dist-electron/api-server.mjs` ──────────────────
// The cloud platform runs the editor backend as one child process per
// session. The project root comes from DOTZUKI_PROJECT_ROOT (projectConfig's
// default); port/host optionally from DOTZUKI_PORT / DOTZUKI_HOST. Guarded by
// "executed directly" so importing this module from Electron's main process
// never auto-starts a second server.
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  process.env.DOTZUKI_STANDALONE ||= '1'
  startApiServer({
    ...(process.env.DOTZUKI_PORT ? { port: Number(process.env.DOTZUKI_PORT) } : {}),
    ...(process.env.DOTZUKI_HOST ? { host: process.env.DOTZUKI_HOST } : {}),
  })
    .then((s) => console.log(`[dotzuki-api] standalone server listening on ${s.url} (project root: ${getProjectRoot()})`))
    .catch((e) => { console.error(e); process.exit(1) })
}
