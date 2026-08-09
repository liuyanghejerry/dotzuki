// @ts-nocheck
import fs from 'fs'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

import { sendJson, sendError, readBody, parseUrl } from '../http'
import { loadConfig, resolveDataPath } from '../projectConfig'
import {
  storiesRoot,
  storySlug,
  resolveStoryFile,
  readStoryRecord,
  scanFlags,
  storyActivityConfig,
} from '../storyPaths'

function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(405); res.end('Method Not Allowed')
}

export function registerStories(server: any) {
    server.middlewares.use('/api/scenes', (req, res) => {
      try {
        const sc = storyActivityConfig()
        const ext = sc.scene?.ext ?? '.scene'
        const root = resolveDataPath(sc.scenesDir ?? 'maps')
        if (!fs.existsSync(root)) return sendJson(res, [])
        const out: { stem: string; names: string[]; path: string }[] = []
        const walk = (dir: string, rel: string) => {
          for (const name of fs.readdirSync(dir).sort()) {
            const full = path.join(dir, name)
            const childRel = rel ? `${rel}/${name}` : name
            if (fs.statSync(full).isDirectory()) { walk(full, childRel); continue }
            if (!name.endsWith(ext)) continue
            // Identifier (stem): the path minus extension, with a trailing
            // "/script" (the per-map `<Map>/script.scene` convention) collapsed
            // to the map dir, so a quest links to "Wangjiang", not "Wangjiang/script".
            const stem = childRel.slice(0, -ext.length).replace(/\/script$/, '')
            let names: string[] = []
            try {
              const text = fs.readFileSync(full, 'utf-8')
              names = [...text.matchAll(/@storyline\("([^"]+)"\)/g)].map(m => m[1])
              if (!names.length) names = [...text.matchAll(/game_scene\s+(\w+)/g)].map(m => m[1])
            } catch { /* unreadable — leave names empty */ }
            out.push({ stem, names, path: childRel })
          }
        }
        walk(root, '')
        sendJson(res, out)
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── /api/stories/graph  and  /api/stories/:kind[/:id] ──
    server.middlewares.use('/api/stories', async (req, res) => {
      try {
        const sub = parseUrl(req).pathname.replace('/api/stories', '').replace(/^\/+/, '')
        const root = storiesRoot()

        // graph.json — a single document
        if (sub === 'graph') {
          const file = path.join(root, 'graph.json')
          if (req.method === 'GET') {
            if (!fs.existsSync(file)) return sendJson(res, { edges: [] })
            return sendJson(res, JSON.parse(fs.readFileSync(file, 'utf-8')))
          }
          if (req.method === 'PUT') {
            const body = await readBody(req); JSON.parse(body)
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, body, 'utf-8')
            return sendJson(res, { ok: true })
          }
          return nextMiddleware(req, res)
        }

        const parts = sub.split('/').filter(Boolean)
        const kind = parts[0]
        if (!['characters', 'quests', 'arcs'].includes(kind)) {
          return sendError(res, `Unknown story kind: ${kind}`)
        }
        const dir = path.join(root, kind)

        // list
        if (parts.length === 1 && req.method === 'GET') {
          if (!fs.existsSync(dir)) return sendJson(res, [])
          const records = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) } catch { return null } })
            .filter(Boolean)
          return sendJson(res, records)
        }

        // single record — decode the id and resolve to its existing file by
        // matching record.id (filenames are kebab slugs), so an edit overwrites
        // the same file instead of forking a new <id>.json duplicate. A
        // non-GET request without an id used to coerce undefined → the literal
        // file "undefined.json"; reject it instead.
        if (parts.length < 2) return sendError(res, 'Record id is required', 400)
        const id = decodeURIComponent(parts[1])
        const file = resolveStoryFile(dir, id)
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) return sendError(res, 'Record not found')
          return sendJson(res, JSON.parse(fs.readFileSync(file, 'utf-8')))
        }
        if (req.method === 'PUT') {
          const body = await readBody(req); JSON.parse(body)
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(file, body, 'utf-8')
          return sendJson(res, { ok: true })
        }
        if (req.method === 'DELETE') {
          if (fs.existsSync(file)) fs.unlinkSync(file)
          return sendJson(res, { ok: true })
        }
        return nextMiddleware(req, res)
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── GET /api/flags — discover event flags (scan-by-default) ──
    server.middlewares.use('/api/flags', (req, res) => {
      try { sendJson(res, scanFlags(storyActivityConfig())) }
      catch (e) { sendError(res, (e as Error).message, 500) }
    })
}
