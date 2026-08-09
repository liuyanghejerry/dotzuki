// ───────────────────────────────────────────────────────────────────────────
// Shared scaffolding for server route tests. Route modules register their
// handlers through `registerX(server)` where `server` is `{ middlewares:
// connect }` — these helpers drive the handlers directly through a minimal
// mock of `server.middlewares.use`, no real HTTP server needed.
//
// The project root is pinned to a fresh temp dir per test via
// `setProjectRootDir` (the JRPG_PROJECT_ROOT env var is read only once at
// module load, so tests must not rely on it).
// ───────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { setProjectRootDir } from './projectConfig'

export type Handler = (req: any, res: any) => unknown

/** Minimal stand-in for the vite dev server's connect middleware surface. */
export function makeServer() {
  const routes = new Map<string, Handler>()
  return {
    routes,
    middlewares: { use(route: string, fn: Handler) { routes.set(route, fn) } },
  }
}

/** A readable-stream request; `body` is JSON-serialized when provided. */
export function mockReq(method: string, body?: unknown, url = '/') {
  const req = new Readable({ read() {} }) as any
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  if (body !== undefined) req.push(JSON.stringify(body))
  req.push(null)
  return req
}

/** A write-capturing response; call `res.json()` to parse the body. */
export function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(status: number) { res.status = status },
    end(chunk?: string | Buffer) { res.body = chunk ?? '' },
    json() { return JSON.parse(res.body as string) },
  }
  return res
}

/** Invoke a registered route handler, returning the captured response. */
export async function call(routes: Map<string, Handler>, route: string, req: any) {
  const handler = routes.get(route)
  if (!handler) throw new Error(`route not registered: ${route}`)
  const res = mockRes()
  await handler(req, res)
  return res
}

/**
 * Register beforeEach/afterEach hooks that create a fresh temp project root
 * and pin it via setProjectRootDir. Returns a getter for the current root
 * (valid inside tests; a new dir per test).
 */
export function useTempProject(prefix: string): () => string {
  let root = ''
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    setProjectRootDir(root)
  })
  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  })
  return () => root
}

/** Write a `.jrpg-editor.json` into `root`; extra fields are merged in. */
export function writeProjectConfig(root: string, config: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(root, '.jrpg-editor.json'),
    JSON.stringify({ name: 'Test', dataRoot: 'data', activities: [], ...config }),
  )
}
