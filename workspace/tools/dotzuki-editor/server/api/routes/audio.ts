// @ts-nocheck
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import { loadConfig, resolveDataPath } from '../projectConfig'

// Audio tracks live as one JSON file per track (the `dotzuki-audio` file-based
// format) under <dataRoot>/<audioDir>/{music,sfx}/. This route is the CRUD
// backend for the editor's Audio activity; track content is validated shallowly
// here — the deep byte-code semantics belong to the engine.

interface AudioConfig {
  audioDir?: string
  musicSubdir?: string
  sfxSubdir?: string
}

function audioConfig() {
  const cfg = loadConfig()
  const act = cfg.activities.find((a: any) => a.type === 'audio')
  if (!act) return null
  const c = (act.config ?? {}) as AudioConfig
  return {
    root: resolveDataPath(c.audioDir ?? 'audio'),
    music: c.musicSubdir ?? 'music',
    sfx: c.sfxSubdir ?? 'sfx',
  }
}

/** Resolve a track path relative to the audio root, rejecting traversal. */
function resolveTrack(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

function methodNotAllowed(res: ServerResponse) {
  res.writeHead(405)
  res.end('Method Not Allowed')
}

export function registerAudio(server: any) {
  // ── GET /api/audio/list — lightweight summaries of every track ──
  server.middlewares.use('/api/audio/list', (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const ac = audioConfig()
      if (!ac) return sendJson(res, [])
      const out: any[] = []
      for (const kind of ['music', 'sfx'] as const) {
        const sub = kind === 'music' ? ac.music : ac.sfx
        const dir = path.join(ac.root, sub)
        if (!fs.existsSync(dir)) continue
        for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
          const rel = path.join(sub, f)
          try {
            const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
            out.push({
              file: rel,
              id: t.id ?? f.replace(/\.json$/, ''),
              kind: t.kind ?? kind,
              name: t.name ?? null,
              tempo: t.tempo ?? null,
              channels: Array.isArray(t.channels) ? t.channels.length : 0,
            })
          } catch {
            out.push({ file: rel, id: f.replace(/\.json$/, ''), kind, name: null, error: 'parse error' })
          }
        }
      }
      out.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind < b.kind ? -1 : 1))
      sendJson(res, out)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── GET /api/audio/record?file=music/StartTown.json — read one track ──
  server.middlewares.use('/api/audio/record', (req: IncomingMessage, res: ServerResponse) => {
    try {
      const ac = audioConfig()
      if (!ac) return sendError(res, 'No audio activity configured')
      const rel = parseUrl(req).searchParams.get('file')
      if (!rel) return sendError(res, 'Missing file', 400)
      const p = resolveTrack(ac.root, rel)
      if (!p) return sendError(res, 'Invalid path', 400)
      if (!fs.existsSync(p)) return sendError(res, 'File not found')
      sendJson(res, JSON.parse(fs.readFileSync(p, 'utf-8')))
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── PUT /api/audio/save?file=… (body: full track JSON) ──
  server.middlewares.use('/api/audio/save', async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'PUT') return methodNotAllowed(res)
    try {
      const ac = audioConfig()
      if (!ac) return sendError(res, 'No audio activity configured')
      const rel = parseUrl(req).searchParams.get('file')
      if (!rel) return sendError(res, 'Missing file', 400)
      const p = resolveTrack(ac.root, rel)
      if (!p) return sendError(res, 'Invalid path', 400)

      let json: any
      try {
        json = JSON.parse(await readBody(req))
      } catch {
        return sendError(res, 'Invalid JSON', 400)
      }
      if (!json.id || typeof json.id !== 'string') return sendError(res, 'Track requires a string "id"', 400)
      if (json.kind !== 'music' && json.kind !== 'sfx') return sendError(res, 'Track "kind" must be "music" or "sfx"', 400)
      if (!Array.isArray(json.channels)) return sendError(res, 'Track requires a "channels" array', 400)

      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf-8')
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── POST /api/audio/create (body: { id, kind }) — new skeleton track ──
  server.middlewares.use('/api/audio/create', async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') return methodNotAllowed(res)
    try {
      const ac = audioConfig()
      if (!ac) return sendError(res, 'No audio activity configured')
      const body = JSON.parse(await readBody(req))
      const id = String(body.id ?? '').trim()
      const kind = body.kind === 'sfx' ? 'sfx' : 'music'
      if (!/^[A-Za-z0-9_]+$/.test(id)) return sendError(res, 'id must be letters, digits or underscore', 400)

      const sub = kind === 'music' ? ac.music : ac.sfx
      const rel = path.join(sub, id + '.json')
      const p = resolveTrack(ac.root, rel)
      if (!p) return sendError(res, 'Invalid path', 400)
      if (fs.existsSync(p)) return sendError(res, 'Track already exists', 409)

      const skeleton =
        kind === 'music'
          ? { id, kind, tempo: 256, channels: [{ hw: 'pulse1', commands: [] }] }
          : { id, kind, channels: [{ hw: 'pulse1', commands: [] }] }
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8')
      sendJson(res, { ok: true, file: rel })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // ── DELETE /api/audio/delete?file=… ──
  server.middlewares.use('/api/audio/delete', (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'DELETE') return methodNotAllowed(res)
    try {
      const ac = audioConfig()
      if (!ac) return sendError(res, 'No audio activity configured')
      const rel = parseUrl(req).searchParams.get('file')
      if (!rel) return sendError(res, 'Missing file', 400)
      const p = resolveTrack(ac.root, rel)
      if (!p) return sendError(res, 'Invalid path', 400)
      if (fs.existsSync(p)) fs.unlinkSync(p)
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}
