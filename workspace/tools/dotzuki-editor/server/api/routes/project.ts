// @ts-nocheck
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import { getProjectRoot, setProjectRootDir, loadConfig } from '../projectConfig'
import { PROJECT_TEMPLATES, scaffoldProject, slugify } from '../../scaffold'

// The heavy lifting (template catalog + on-disk layout) lives in
// server/scaffold.ts; this module is only request parsing + validation.

export function registerProject(server: any) {
    function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
      res.writeHead(405); res.end('Method Not Allowed')
    }

    server.middlewares.use('/api/project/templates', (req, res) => {
      // ?lang=zh localizes name/description; unknown languages fall back to en.
      const lang = parseUrl(req).searchParams.get('lang') ?? 'en'
      sendJson(res, PROJECT_TEMPLATES.map(tpl => ({
        id: tpl.id,
        name: tpl.name[lang] ?? tpl.name.en,
        description: tpl.description[lang] ?? tpl.description.en,
        icon: tpl.icon,
        tables: tpl.tables,
      })))
    })

    server.middlewares.use('/api/project/create', async (req, res) => {
      if (req.method !== 'POST') return nextMiddleware(req, res)
      try {
        const body = JSON.parse(await readBody(req))
        const { name, template, dir, dataRoot = './data', gfxRoot = './gfx' } = body

        if (!name || !template) {
          return sendError(res, '"name" and "template" are required', 400)
        }
        if (!PROJECT_TEMPLATES.some(t => t.id === template)) {
          return sendError(res, `Unknown template: ${template}`, 400)
        }

        // Target dir: a slug under the current project root, or an absolute
        // path (the Electron "Browse…" parent-folder picker sends those).
        const dirName = typeof dir === 'string' && dir.trim() ? dir.trim() : slugify(name)
        let target: string
        if (path.isAbsolute(dirName)) {
          target = path.normalize(dirName)
        } else {
          if (!/^[a-z0-9][a-z0-9-]*$/.test(dirName)) {
            return sendError(res, `Invalid directory name: ${dirName} (use lowercase letters, digits and dashes)`, 400)
          }
          target = path.join(getProjectRoot(), dirName)
        }

        if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
          return sendError(res, `Target directory is not empty: ${target}`, 409)
        }

        const { config, files } = scaffoldProject(target, { name, templateId: template, dataRoot, gfxRoot })

        // Switch the editor to the freshly created project.
        setProjectRootDir(target)
        sendJson(res, { ok: true, config, files, projectRoot: getProjectRoot() })
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // The browser navigates the editor's launch directory. Retain that root
    // when opening a game so sibling projects stay available in one session.
    const browseRoot = path.resolve(getProjectRoot())
    server.middlewares.use('/api/project/folders', (req, res) => {
      if (req.method !== 'GET') return nextMiddleware(req, res)
      try {
        const rel = parseUrl(req).searchParams.get('dir') ?? ''
        const segments = rel.split('/').filter(Boolean)
        if (segments.some(s => s === '.' || s === '..' || s.includes('\\') || s.includes(':'))) {
          return sendError(res, 'Invalid folder', 400)
        }
        const dir = path.join(browseRoot, ...segments)
        if (!fs.existsSync(dir)) {
          if (segments.length === 0) return sendJson(res, { dir: '', project: null, folders: [] })
          return sendError(res, 'Folder not found')
        }
        const canonical = path.relative(fs.realpathSync(browseRoot), fs.realpathSync(dir))
        if (canonical === '..' || canonical.startsWith('..' + path.sep) || path.isAbsolute(canonical)) {
          return sendError(res, 'Folder outside project directory', 403)
        }
        const folders = fs.readdirSync(dir, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
          .map(entry => entry.name).sort()
        const manifest = path.join(dir, '.dotzuki-editor.json')
        const project = fs.statSync(manifest, { throwIfNoEntry: false })?.isFile() ? dir : null
        sendJson(res, { dir: segments.join('/'), project, folders })
      } catch (e) {
        sendError(res, (e as Error).message, 400)
      }
    })

    // ── POST /api/project/open — switch to a different project ──
    server.middlewares.use('/api/project/open', async (req, res) => {
      if (req.method !== 'POST') return nextMiddleware(req, res)
      try {
        const { path: projectPath } = JSON.parse(await readBody(req))
        if (!projectPath || typeof projectPath !== 'string') {
          return sendError(res, '"path" is required', 400)
        }
        const absPath = path.resolve(projectPath)
        const cfgPath = path.join(absPath, '.dotzuki-editor.json')
        if (!fs.existsSync(cfgPath)) {
          return sendError(res, `No .dotzuki-editor.json found in ${absPath}`, 404)
        }
        setProjectRootDir(absPath)
        const cfg = loadConfig()
        sendJson(res, { ok: true, config: cfg, projectRoot: getProjectRoot() })
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── GET /api/project/root — base dir new projects are created in ──
    // Registered before the catch-all /api/project handler (connect matches
    // by prefix) and always succeeds, even with no project open — the welcome
    // wizard needs it to preview the target path.
    server.middlewares.use('/api/project/root', (_req, res) => {
      sendJson(res, { projectRoot: getProjectRoot() })
    })

    // ── GET /api/project — returns the project config ──
    server.middlewares.use('/api/project', (_req, res) => {
      try {
        const cfg = loadConfig()
        sendJson(res, cfg)
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })
}
