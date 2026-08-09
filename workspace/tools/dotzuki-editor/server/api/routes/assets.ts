// @ts-nocheck -- extracted from vite.config.ts; loose dev-server types preserved
import path from 'path'
import fs from 'fs'
import { sendJson, sendError, parseUrl, readBody } from '../http'
import { getProjectRoot, resolveGfxPath } from '../projectConfig'

/** Resolve a project-relative (root, sub) pair to an absolute path, refusing any
 *  path that escapes the project root (directory-traversal guard). */
function resolveInProject(root: string, sub: string): string {
  const PROJECT_ROOT = getProjectRoot()
  const resolved = path.resolve(PROJECT_ROOT, root, sub)
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error('Access denied: path escapes the project root')
  }
  return resolved
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.json': 'application/json', '.txt': 'text/plain',
  '.js': 'application/javascript', '.ts': 'text/typescript',
  '.css': 'text/css', '.html': 'text/html',
  // audio / video — so the asset browser can preview them
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
}

/** Static gfx serving (/gfx/*) + the generic asset browser (/api/assets/*). */
export function registerAssets(server: any) {
    // ── GET /gfx/* — serve graphic assets ──
    server.middlewares.use('/gfx', (req, res) => {
      try {
        const urlPath = parseUrl(req).pathname.replace('/gfx', '').replace(/^\/+/, '')
        const resolved = resolveGfxPath(urlPath)
        if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) { res.writeHead(404); res.end(); return }
        const ext = path.extname(resolved).toLowerCase()
        const mime: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
          '.json': 'application/json',
        }
        res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' })
        res.end(fs.readFileSync(resolved))
      } catch {
        res.writeHead(404); res.end()
      }
    })

    // ── GET /api/assets/list?root=&path= — list asset files ──
    server.middlewares.use('/api/assets/list', (req, res) => {
      try {
        const PROJECT_ROOT = getProjectRoot()
        const url = parseUrl(req)
        const root = url.searchParams.get('root') ?? ''
        const subpath = url.searchParams.get('path') ?? ''
        const resolved = path.resolve(PROJECT_ROOT, root, subpath)

        // Security: prevent directory traversal outside project root
        if (!resolved.startsWith(PROJECT_ROOT)) {
          return sendError(res, 'Access denied', 403)
        }

        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          return sendJson(res, [])
        }

        const entries = fs.readdirSync(resolved).map(name => {
          const full = path.join(resolved, name)
          const stat = fs.statSync(full)
          return {
            name,
            isDir: stat.isDirectory(),
            size: stat.size,
            ext: path.extname(name).toLowerCase(),
          }
        })
        sendJson(res, entries)
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── GET /api/assets/file?root=&path= — serve raw asset file ──
    server.middlewares.use('/api/assets/file', (req, res) => {
      try {
        const PROJECT_ROOT = getProjectRoot()
        const url = parseUrl(req)
        const root = url.searchParams.get('root') ?? ''
        const filepath = url.searchParams.get('path') ?? ''
        const resolved = path.resolve(PROJECT_ROOT, root, filepath)

        if (!resolved.startsWith(PROJECT_ROOT)) {
          return sendError(res, 'Access denied', 403)
        }
        if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
          res.writeHead(404); res.end(); return
        }

        const ext = path.extname(resolved).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
        res.end(fs.readFileSync(resolved))
      } catch {
        res.writeHead(404); res.end()
      }
    })

    // ── POST /api/assets/upload?root=&path= — write/replace a file (raw body) ──
    server.middlewares.use('/api/assets/upload', async (req, res) => {
      if (req.method !== 'POST' && req.method !== 'PUT') { res.writeHead(405); res.end('Method Not Allowed'); return }
      try {
        const url = parseUrl(req)
        const root = url.searchParams.get('root') ?? ''
        const filepath = url.searchParams.get('path') ?? ''
        if (!filepath) return sendError(res, 'path is required', 400)
        const resolved = resolveInProject(root, filepath)
        const buf = await readBodyBuffer(req)
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, buf)
        sendJson(res, { ok: true, path: filepath, size: buf.length })
      } catch (e) {
        sendError(res, (e as Error).message, 400)
      }
    })

    // ── POST /api/assets/rename — { root, from, to } move/rename a file or dir ──
    server.middlewares.use('/api/assets/rename', async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return }
      try {
        const { root = '', from, to } = JSON.parse(await readBody(req) || '{}')
        if (!from || !to) return sendError(res, 'from and to are required', 400)
        const src = resolveInProject(root, from)
        const dst = resolveInProject(root, to)
        if (!fs.existsSync(src)) return sendError(res, 'source does not exist', 404)
        if (fs.existsSync(dst)) return sendError(res, 'destination already exists', 409)
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.renameSync(src, dst)
        sendJson(res, { ok: true, from, to })
      } catch (e) {
        sendError(res, (e as Error).message, 400)
      }
    })

    // ── DELETE /api/assets/delete?root=&path= — remove a file or empty dir ──
    server.middlewares.use('/api/assets/delete', (req, res) => {
      if (req.method !== 'DELETE') { res.writeHead(405); res.end('Method Not Allowed'); return }
      try {
        const url = parseUrl(req)
        const root = url.searchParams.get('root') ?? ''
        const filepath = url.searchParams.get('path') ?? ''
        if (!filepath) return sendError(res, 'path is required', 400)
        const resolved = resolveInProject(root, filepath)
        if (!fs.existsSync(resolved)) return sendError(res, 'not found', 404)
        fs.rmSync(resolved, { recursive: true, force: true })
        sendJson(res, { ok: true, path: filepath })
      } catch (e) {
        sendError(res, (e as Error).message, 400)
      }
    })

    // ── POST /api/assets/mkdir — { root, path } create a directory ──
    server.middlewares.use('/api/assets/mkdir', async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return }
      try {
        const { root = '', path: sub } = JSON.parse(await readBody(req) || '{}')
        if (!sub) return sendError(res, 'path is required', 400)
        const resolved = resolveInProject(root, sub)
        fs.mkdirSync(resolved, { recursive: true })
        sendJson(res, { ok: true, path: sub })
      } catch (e) {
        sendError(res, (e as Error).message, 400)
      }
    })
}

/** Collect the raw request body as a Buffer (for binary uploads). */
function readBodyBuffer(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
