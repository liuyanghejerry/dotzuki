// @ts-nocheck -- extracted from vite.config.ts; types stay loose as in the source.
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import { resolveDataPath } from '../projectConfig'
import {
  tilesActivityConfig,
  tilesRoot,
  tilesIndexFile,
  tilesLayersFile,
  readTilesIndex,
  mapsDirRel,
} from '../tilesPaths'

export function registerTiles(server: any) {
  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }

  server.middlewares.use('/api/tiles', (req, res) => {
    try {
      const sub = parseUrl(req).pathname.replace('/api/tiles', '')
      if (sub.startsWith('/file/')) {
        const name = path.basename(sub.replace('/file/', ''))
        const f = path.join(tilesRoot(), name)
        if (!fs.existsSync(f)) return sendError(res, 'Tile not found')
        res.writeHead(200, { 'Content-Type': 'image/png' })
        return res.end(fs.readFileSync(f))
      }
      if (req.method === 'GET') return sendJson(res, readTilesIndex())
      return sendError(res, 'Unsupported method', 405)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // GET /api/tiles-backdrops → candidate harvest backdrops (maps' source/tileset PNGs)
  server.middlewares.use('/api/tiles-backdrops', (_req, res) => {
    try {
      const tc = tilesActivityConfig()
      const root = resolveDataPath(tc.backdropMapsDir ?? 'data/maps')
      const out: any[] = []
      if (fs.existsSync(root)) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          for (const cand of ['source.png', 'tileset.png']) {
            if (fs.existsSync(path.join(root, entry.name, cand))) {
              out.push({ map: entry.name, file: cand, url: `/api/maps/${entry.name}/${cand}` })
            }
          }
        }
      }
      sendJson(res, out)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/tiles-save → write a tile PNG into the library + index it.
  //   body: { pngBase64, id?, name?, source? }  (id omitted → next free t#### id)
  server.middlewares.use('/api/tiles-save', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { pngBase64, id, name, source, layers } = JSON.parse(await readBody(req))
      if (!pngBase64) return sendError(res, 'pngBase64 required', 400)
      const root = tilesRoot()
      fs.mkdirSync(root, { recursive: true })
      const idx = readTilesIndex()
      let tileId: string | undefined = id
      if (!tileId) {
        let n = idx.tiles.length + 1
        const has = (i: string) => idx.tiles.some((t: any) => t.id === i)
        while (has(`t${String(n).padStart(4, '0')}`)) n++
        tileId = `t${String(n).padStart(4, '0')}`
      }
      const b64 = String(pngBase64).replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(root, `${tileId}.png`), Buffer.from(b64, 'base64'))
      const existing = idx.tiles.find((t: any) => t.id === tileId)
      if (existing) {
        if (name !== undefined) existing.name = name
        if (source !== undefined) existing.source = source
      } else {
        idx.tiles.push({ id: tileId, name: name ?? '', source: source ?? '' })
      }
      fs.writeFileSync(tilesIndexFile(), JSON.stringify(idx, null, 2), 'utf-8')
      // Optional editing-time layer sidecar (the PNG stays canonical for the
      // engine; omit `layers` to leave any existing sidecar untouched, pass
      // null to clear it).
      if (layers !== undefined) {
        const lf = tilesLayersFile(tileId)
        if (layers === null) {
          if (fs.existsSync(lf)) fs.rmSync(lf)
        } else {
          fs.writeFileSync(lf, JSON.stringify(layers), 'utf-8')
        }
      }
      sendJson(res, { ok: true, id: tileId })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/tiles-save-batch → write many tiles at once (drag-select harvest).
  //   body: { tiles: [{ pngBase64, source? }, ...] }  → { ok, ids }
  server.middlewares.use('/api/tiles-save-batch', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { tiles } = JSON.parse(await readBody(req))
      if (!Array.isArray(tiles)) return sendError(res, 'tiles[] required', 400)
      const root = tilesRoot()
      fs.mkdirSync(root, { recursive: true })
      const idx = readTilesIndex()
      const has = (i: string) => idx.tiles.some((t: any) => t.id === i)
      const ids: string[] = []
      let n = idx.tiles.length + 1
      for (const t of tiles) {
        if (!t || !t.pngBase64) continue
        while (has(`t${String(n).padStart(4, '0')}`)) n++
        const id = `t${String(n).padStart(4, '0')}`
        n++
        const b64 = String(t.pngBase64).replace(/^data:image\/png;base64,/, '')
        fs.writeFileSync(path.join(root, `${id}.png`), Buffer.from(b64, 'base64'))
        idx.tiles.push({ id, name: '', source: t.source ?? '' })
        ids.push(id)
      }
      fs.writeFileSync(tilesIndexFile(), JSON.stringify(idx, null, 2), 'utf-8')
      sendJson(res, { ok: true, ids })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/tiles-delete → remove tile(s) from the library.
  //   body: { id } (single) or { ids: [...] } (batch). One index rewrite either way.
  server.middlewares.use('/api/tiles-delete', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const body = JSON.parse(await readBody(req))
      const ids: string[] = Array.isArray(body.ids)
        ? body.ids.map(String)
        : body.id ? [String(body.id)] : []
      if (ids.length === 0) return sendError(res, 'id or ids[] required', 400)
      const root = tilesRoot()
      for (const id of ids) {
        const f = path.join(root, `${path.basename(id)}.png`)
        if (fs.existsSync(f)) fs.rmSync(f)
        // also drop the pixel-editor layer sidecar, if any
        const lf = tilesLayersFile(String(id))
        if (fs.existsSync(lf)) fs.rmSync(lf)
      }
      const idx = readTilesIndex()
      const drop = new Set(ids)
      idx.tiles = idx.tiles.filter((t: any) => !drop.has(t.id))
      fs.writeFileSync(tilesIndexFile(), JSON.stringify(idx, null, 2), 'utf-8')
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // GET /api/tiles-layers?id=<id> → the tile's layer sidecar JSON, or 404.
  //   ('-layers' is a distinct route from '/api/tiles' — connect only treats
  //   '/' '.' and end-of-string as route boundaries, not '-'.)
  server.middlewares.use('/api/tiles-layers', (req, res) => {
    try {
      const id = parseUrl(req).searchParams.get('id')
      if (!id) return sendError(res, 'id query required', 400)
      const f = tilesLayersFile(id)
      if (!fs.existsSync(f)) return sendError(res, 'No sidecar', 404)
      const raw = fs.readFileSync(f) // read once; validate then serve the same bytes
      try {
        JSON.parse(raw.toString('utf-8')) // corrupt → 404 → flat-PNG fallback
      } catch {
        return sendError(res, 'Corrupt sidecar', 404)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(raw)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // GET /api/tileset?map=X → the saved tile sequence (for re-editing), or empty.
  server.middlewares.use('/api/tileset', (req, res) => {
    try {
      const map = parseUrl(req).searchParams.get('map')
      if (!map) return sendError(res, 'map query required', 400)
      const f = resolveDataPath(path.join(mapsDirRel(), path.basename(map), 'tileset.tiles.json'))
      if (!fs.existsSync(f)) return sendJson(res, { tileIds: [], cols: 8 })
      sendJson(res, JSON.parse(fs.readFileSync(f, 'utf-8')))
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/tileset-build → write an assembled tileset into a map dir.
  //   body: { map, pngBase64, tileIds, cols } → <map>/tileset.png + tileset.tiles.json
  server.middlewares.use('/api/tileset-build', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { map, pngBase64, tileIds, cols } = JSON.parse(await readBody(req))
      if (!map || !pngBase64) return sendError(res, 'map + pngBase64 required', 400)
      const dir = resolveDataPath(path.join(mapsDirRel(), path.basename(String(map))))
      fs.mkdirSync(dir, { recursive: true })
      const b64 = String(pngBase64).replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(dir, 'tileset.png'), Buffer.from(b64, 'base64'))
      fs.writeFileSync(
        path.join(dir, 'tileset.tiles.json'),
        JSON.stringify({ tileIds: tileIds ?? [], cols: cols ?? 8 }, null, 2),
        'utf-8',
      )
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}
