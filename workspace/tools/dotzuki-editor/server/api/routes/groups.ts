// @ts-nocheck -- extracted from vite.config.ts; loose dev-server types preserved
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import {
  groupsRoot,
  groupsIndexFile,
  groupsLayersFile,
  readGroupsIndex,
} from '../tilesPaths'

export function registerGroups(server: any) {
  function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
    res.writeHead(405); res.end('Method Not Allowed')
  }

  // GET /api/groups → index; GET /api/groups/file/<id>.png → a group's image.
  server.middlewares.use('/api/groups', (req, res) => {
    try {
      const sub = parseUrl(req).pathname.replace('/api/groups', '')
      if (sub.startsWith('/file/')) {
        const name = path.basename(sub.replace('/file/', ''))
        const f = path.join(groupsRoot(), name)
        if (!fs.existsSync(f)) return sendError(res, 'Group image not found')
        res.writeHead(200, { 'Content-Type': 'image/png' })
        return res.end(fs.readFileSync(f))
      }
      if (req.method === 'GET') return sendJson(res, readGroupsIndex())
      return sendError(res, 'Unsupported method', 405)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/groups-save → write a group's composed PNG + index row.
  //   body: { id?, name, w, h, pngBase64, cells? }  (id omitted → next free g#### id)
  server.middlewares.use('/api/groups-save', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { id, name, w, h, pngBase64, cells, layers } = JSON.parse(await readBody(req))
      if (!pngBase64) return sendError(res, 'pngBase64 required', 400)
      const root = groupsRoot()
      fs.mkdirSync(root, { recursive: true })
      const idx = readGroupsIndex()
      let gid: string | undefined = id
      if (!gid) {
        let n = idx.groups.length + 1
        const has = (i: string) => idx.groups.some((g: any) => g.id === i)
        while (has(`g${String(n).padStart(4, '0')}`)) n++
        gid = `g${String(n).padStart(4, '0')}`
      }
      const b64 = String(pngBase64).replace(/^data:image\/png;base64,/, '')
      fs.writeFileSync(path.join(root, `${gid}.png`), Buffer.from(b64, 'base64'))
      const row = idx.groups.find((g: any) => g.id === gid)
      if (row) {
        if (name !== undefined) row.name = name
        if (w !== undefined) row.w = w
        if (h !== undefined) row.h = h
        if (cells !== undefined) row.cells = cells
      } else {
        idx.groups.push({ id: gid, name: name ?? '', w: w ?? 1, h: h ?? 1, cells: cells ?? [] })
      }
      fs.writeFileSync(groupsIndexFile(), JSON.stringify(idx, null, 2), 'utf-8')
      // Optional editing-time layer sidecar (PNG stays canonical; null clears).
      if (layers !== undefined) {
        const lf = groupsLayersFile(gid)
        if (layers === null) {
          if (fs.existsSync(lf)) fs.rmSync(lf)
        } else {
          fs.writeFileSync(lf, JSON.stringify(layers), 'utf-8')
        }
      }
      sendJson(res, { ok: true, id: gid })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/groups-rename → update just a group's display name. body: { id, name }
  server.middlewares.use('/api/groups-rename', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { id, name } = JSON.parse(await readBody(req))
      if (!id) return sendError(res, 'id required', 400)
      const idx = readGroupsIndex()
      const row = idx.groups.find((g: any) => g.id === id)
      if (!row) return sendError(res, 'group not found', 404)
      row.name = typeof name === 'string' ? name : ''
      fs.writeFileSync(groupsIndexFile(), JSON.stringify(idx, null, 2), 'utf-8')
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // POST /api/groups-delete → remove a group (image + index row). body: { id }
  server.middlewares.use('/api/groups-delete', async (req, res) => {
    if (req.method !== 'POST') return nextMiddleware(req, res)
    try {
      const { id } = JSON.parse(await readBody(req))
      if (!id) return sendError(res, 'id required', 400)
      const f = path.join(groupsRoot(), `${path.basename(String(id))}.png`)
      if (fs.existsSync(f)) fs.rmSync(f)
      const lf = groupsLayersFile(String(id))
      if (fs.existsSync(lf)) fs.rmSync(lf)
      const idx = readGroupsIndex()
      idx.groups = idx.groups.filter((g: any) => g.id !== id)
      fs.writeFileSync(groupsIndexFile(), JSON.stringify(idx, null, 2), 'utf-8')
      sendJson(res, { ok: true })
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })

  // GET /api/groups-layers?id=<id> → the group's layer sidecar JSON, or 404.
  server.middlewares.use('/api/groups-layers', (req, res) => {
    try {
      const id = parseUrl(req).searchParams.get('id')
      if (!id) return sendError(res, 'id query required', 400)
      const f = groupsLayersFile(id)
      if (!fs.existsSync(f)) return sendError(res, 'No sidecar', 404)
      const raw = fs.readFileSync(f) // read once; validate then serve the same bytes
      try {
        JSON.parse(raw.toString('utf-8'))
      } catch {
        return sendError(res, 'Corrupt sidecar', 404)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(raw)
    } catch (e) {
      sendError(res, (e as Error).message, 500)
    }
  })
}