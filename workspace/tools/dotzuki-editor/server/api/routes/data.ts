// @ts-nocheck
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { sendJson, sendError, readBody, parseUrl } from '../http'
import { loadConfig, resolveDataPath, type TableDef } from '../projectConfig'
import { validateDataSave, type ExistingRecord } from '../dataValidate'

export function registerData(server: any) {
    function nextMiddleware(_req: IncomingMessage, res: ServerResponse) {
      res.writeHead(405); res.end('Method Not Allowed')
    }

    // ── GET /api/data/:tableId — list records in a table directory ──
    server.middlewares.use('/api/data/list/', (req, res) => {
      if (req.method !== 'GET') return nextMiddleware(req, res)
      try {
        const cfg = loadConfig()
        const tableId = parseUrl(req).pathname.split('/').pop()!
        const table: TableDef | undefined = cfg.activities
          .flatMap(a => a.type === 'data' ? (a.config as { tables: TableDef[] }).tables : [])
          .find(t => t.id === tableId)
        if (!table) return sendError(res, `Table not found: ${tableId}`)

        const dir = resolveDataPath(table.dir)
        if (!fs.existsSync(dir)) return sendJson(res, [])

        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        const records = files.map(f => {
          const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
          try { return { _file: f, ...JSON.parse(raw) } } catch { return { _file: f, _error: 'parse error' } }
        })
        sendJson(res, records)
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── GET /api/data/:tableId/:file — read a single record ──
    server.middlewares.use('/api/data/record/', (req, res) => {
      if (req.method !== 'GET') return nextMiddleware(req, res)
      try {
        const cfg = loadConfig()
        const parts = parseUrl(req).pathname.split('/')
        const tableId = parts[parts.length - 2]
        const fileName = parts[parts.length - 1]
        const table = cfg.activities
          .flatMap(a => a.type === 'data' ? (a.config as { tables: TableDef[] }).tables : [])
          .find(t => t.id === tableId)
        if (!table) return sendError(res, `Table not found: ${tableId}`)

        const filePath = path.join(resolveDataPath(table.dir), fileName)
        if (!fs.existsSync(filePath)) return sendError(res, 'File not found')
        sendJson(res, JSON.parse(fs.readFileSync(filePath, 'utf-8')))
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── PUT /api/data/:tableId/:file — save a record ──
    server.middlewares.use('/api/data/save/', async (req, res) => {
      if (req.method !== 'PUT') return nextMiddleware(req, res)
      try {
        const cfg = loadConfig()
        const parts = parseUrl(req).pathname.split('/')
        const tableId = parts[parts.length - 2]
        const fileName = parts[parts.length - 1]
        const table = cfg.activities
          .flatMap(a => a.type === 'data' ? (a.config as { tables: TableDef[] }).tables : [])
          .find(t => t.id === tableId)
        if (!table) return sendError(res, `Table not found: ${tableId}`)

        const body = await readBody(req)
        const dir = resolveDataPath(table.dir)
        // Gather sibling records (id values) for the uniqueness / object / required-field
        // validation, so a malformed JSON value, a missing id, or a duplicate id is
        // rejected instead of silently corrupting the table.
        const existing: ExistingRecord[] = []
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
            try { existing.push({ file: f, id: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))[table.idField ?? 'id'] }) } catch { /* skip unparseable sibling */ }
          }
        }
        const check = validateDataSave({ idField: table.idField ?? 'id', fileName, body, existing })
        if (!check.ok) return sendError(res, check.error, 400)

        const filePath = path.join(dir, fileName)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        // Write canonical pretty JSON (the validator already parsed it).
        fs.writeFileSync(filePath, JSON.stringify(check.json, null, 2) + '\n', 'utf-8')
        sendJson(res, { ok: true })
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })

    // ── DELETE /api/data/:tableId/:file — delete a record ──
    server.middlewares.use('/api/data/delete/', (req, res) => {
      if (req.method !== 'DELETE') return nextMiddleware(req, res)
      try {
        const cfg = loadConfig()
        const parts = parseUrl(req).pathname.split('/')
        const tableId = parts[parts.length - 2]
        const fileName = parts[parts.length - 1]
        const table = cfg.activities
          .flatMap(a => a.type === 'data' ? (a.config as { tables: TableDef[] }).tables : [])
          .find(t => t.id === tableId)
        if (!table) return sendError(res, `Table not found: ${tableId}`)

        const filePath = path.join(resolveDataPath(table.dir), fileName)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        sendJson(res, { ok: true })
      } catch (e) {
        sendError(res, (e as Error).message, 500)
      }
    })
}
