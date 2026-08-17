// @ts-nocheck -- extracted from vite.config.ts; loose types preserved verbatim
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import { loadConfig, resolveDataPath, getProjectRoot } from '../projectConfig'

// The editor root (tools/dotzuki-editor/) — reconstructed from this module's URL since
// `__dirname` isn't defined in ESM. Vite shimmed `__dirname` for the inline config;
// the extracted /wasm handler resolves crates/dotzuki-web/pkg relative to it just as the
// original did (`<editor-root>/../../crates/dotzuki-web/pkg`).
// DOTZUKI_EDITOR_ROOT lets a host (e.g. the bundled Electron production server, where
// import.meta.url no longer lives at server/api/routes/) pin the editor root so the
// /wasm preview package still resolves. Unset (Vite dev) → original reconstruction.
const __dirname = process.env.DOTZUKI_EDITOR_ROOT
  ? path.resolve(process.env.DOTZUKI_EDITOR_ROOT)
  : path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')

export function registerContent(server: any) {
  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }

  // ── GET/PUT /api/scripts/* — script file read/write ──
  server.middlewares.use('/api/scripts', (req, res) => {
    try {
      const cfg = loadConfig()
      const scriptActivity = cfg.activities.find(a => a.type === 'script')
      if (!scriptActivity) return sendError(res, 'No script activity configured', 500)
      const sc = scriptActivity.config as { scriptsDir: string; extension?: string }

      const urlPath = parseUrl(req).pathname.replace('/api/scripts', '')
      const resolved = resolveDataPath(path.join(sc.scriptsDir, urlPath))

      if (req.method === 'GET') {
        // Directory listing: recurse under scriptsDir, returning each script
        // file's path RELATIVE to scriptsDir (the frontend GETs
        // /api/scripts/<path> to load it; scriptsDir is prepended back here).
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          const ext = sc.extension ?? '.js'
          const out: { name: string; isDir: boolean; size: number; path: string }[] = []
          const walk = (dir: string, rel: string) => {
            for (const name of fs.readdirSync(dir).sort()) {
              const full = path.join(dir, name)
              const st = fs.statSync(full)
              const childRel = rel ? `${rel}/${name}` : name
              if (st.isDirectory()) walk(full, childRel)
              else if (name.endsWith(ext)) out.push({ name, isDir: false, size: st.size, path: childRel })
            }
          }
          walk(resolved, '')
          return sendJson(res, out)
        }
        if (!fs.existsSync(resolved)) return sendError(res, 'File not found')
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(fs.readFileSync(resolved, 'utf-8'))
      } else if (req.method === 'PUT') {
        readBody(req).then(body => {
          fs.mkdirSync(path.dirname(resolved), { recursive: true })
          fs.writeFileSync(resolved, body, 'utf-8')
          sendJson(res, { ok: true })
        }).catch(e => sendError(res, (e as Error).message, 500))
      } else {
        return nextMiddleware(req, res)
      }
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET (list / read) + PUT /api/gui/* — `.gui` UI layouts ──
  // Resolved against the activity's `guiRoot` RELATIVE TO PROJECT_ROOT (game
  // UI layouts often live outside dataRoot, e.g. a crate's ui_layouts/).
  server.middlewares.use('/api/gui', (req, res) => {
    try {
      const cfg = loadConfig()
      const uiActivity = cfg.activities.find(a => a.type === 'ui')
      if (!uiActivity) return sendError(res, 'No ui activity configured', 500)
      const gc = uiActivity.config as { guiRoot: string; extension?: string }
      const ext = gc.extension ?? '.gui'
      const base = path.resolve(getProjectRoot(), gc.guiRoot)
      const urlPath = decodeURIComponent(parseUrl(req).pathname.replace('/api/gui', ''))
      const resolved = path.resolve(base, '.' + (urlPath || '/'))
      // `startsWith(base)` alone would also pass sibling dirs that share the
      // base string prefix (e.g. "ui_layouts_evil") — require an exact match
      // or a path inside base.
      if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        return sendError(res, 'Access denied', 403)
      }

      if (req.method === 'GET') {
        if (urlPath === '' || urlPath === '/') {
          if (!fs.existsSync(base)) return sendJson(res, [])
          const names = fs.readdirSync(base).filter(f => f.endsWith(ext))
          return sendJson(res, names)
        }
        if (!fs.existsSync(resolved)) return sendError(res, 'File not found')
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(fs.readFileSync(resolved, 'utf-8'))
      } else if (req.method === 'PUT') {
        readBody(req).then(body => {
          fs.mkdirSync(path.dirname(resolved), { recursive: true })
          fs.writeFileSync(resolved, body, 'utf-8')
          sendJson(res, { ok: true })
        }).catch(e => sendError(res, (e as Error).message, 500))
      } else {
        return nextMiddleware(req, res)
      }
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET /wasm/* — serve the dotzuki-web WASM preview package (built by
  //    `npm run build:wasm` into crates/dotzuki-web/pkg). Fixed to the repo,
  //    independent of PROJECT_ROOT. In a packaged Electron app the repo isn't
  //    present, so the app ships the pkg as an extraResource and points here
  //    via DOTZUKI_WASM_ROOT (see electron/main.cjs).
  //    Files not found in dotzuki-web/pkg fall back to the dotzuki-runner-web pkg
  //    (`pnpm build:wasm-runner` → crates/dotzuki-runner-web/pkg; packaged app:
  //    DOTZUKI_RUNNER_WASM_ROOT) so the playtest activity can load WasmRunner. ──
  server.middlewares.use('/wasm', (req, res, next) => {
    try {
      const wasmRoot = process.env.DOTZUKI_WASM_ROOT
        ? path.resolve(process.env.DOTZUKI_WASM_ROOT)
        : path.resolve(__dirname, '../../crates/dotzuki-web/pkg')
      const runnerRoot = process.env.DOTZUKI_RUNNER_WASM_ROOT
        ? path.resolve(process.env.DOTZUKI_RUNNER_WASM_ROOT)
        : path.resolve(__dirname, '../../crates/dotzuki-runner-web/pkg')
      const rel = decodeURIComponent(parseUrl(req).pathname.replace('/wasm', ''))
      for (const rootDir of [wasmRoot, runnerRoot]) {
        const resolved = path.join(rootDir, rel)
        if (!resolved.startsWith(rootDir) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          continue
        }
        const ext = path.extname(resolved).toLowerCase()
        const mime = ext === '.wasm' ? 'application/wasm'
          : ext === '.js' ? 'application/javascript'
          : 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': mime })
        fs.createReadStream(resolved).pipe(res)
        return
      }
      // 404 (not next()) when the asset is in neither pkg root: this middleware
      // runs in front of dev-server SPA fallbacks that would otherwise serve
      // index.html with 200 for /wasm/*.js, masking "wasm not built" as a
      // confusing dynamic-import failure (and defeating e2e not-built skips).
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `not found: /wasm${rel} — run pnpm build:wasm / build:wasm-runner` }))
    } catch {
      res.writeHead(404); res.end()
    }
  })
}
