// ───────────────────────────────────────────────────────────────────────────
// Data-table route tests — drive registerData's handlers through the shared
// mock-connect scaffold (testUtils), with the project root pinned to a fresh
// temp dir per test. Tables resolve to <root>/<dataRoot>/<table.dir>; the
// save route is exercised through the real validateDataSave (malformed JSON,
// non-object bodies, missing/duplicate ids).
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { registerData } from './data'
import { makeServer, mockReq, call, useTempProject, writeProjectConfig } from '../testUtils'

const getRoot = useTempProject('jrpg-data-')

/** Request with a raw (not JSON-serialized) body — for malformed-JSON cases. */
function rawReq(method: string, raw: string, url: string) {
  const req = new Readable({ read() {} }) as any
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  req.push(raw)
  req.push(null)
  return req
}

/** Minimal project config exposing one data activity with the given tables. */
function writeDataConfig(tables: Record<string, unknown>[]) {
  writeProjectConfig(getRoot(), {
    activities: [{ id: 'data', type: 'data', config: { tables } }],
  })
}

/** Create and return a table dir at <root>/data/<dir>. */
function tableDir(dir: string) {
  const abs = path.join(getRoot(), 'data', dir)
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

function writeRecord(dir: string, file: string, record: unknown) {
  fs.writeFileSync(path.join(dir, file), typeof record === 'string' ? record : JSON.stringify(record))
}

const skillsTable = { id: 'skills', dir: 'skills' }

describe('GET /api/data/list/', () => {
  it('answers 500 when no project is open', async () => {
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/list/', mockReq('GET', undefined, '/api/data/list/skills'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('.jrpg-editor.json')
  })

  it('404s for an unknown table id', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/list/', mockReq('GET', undefined, '/api/data/list/items'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('Table not found: items')
  })

  it('returns [] when the table directory does not exist yet', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/list/', mockReq('GET', undefined, '/api/data/list/skills'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('lists .json records with _file, flagging unparseable files and skipping non-json', async () => {
    writeDataConfig([skillsTable])
    const dir = tableDir('skills')
    writeRecord(dir, 'zuiquan.json', { id: '醉拳', power: 60 })
    writeRecord(dir, 'broken.json', '{oops')
    writeRecord(dir, 'notes.txt', 'not a record')
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/list/', mockReq('GET', undefined, '/api/data/list/skills'))
    expect(res.status).toBe(200)
    const records = res.json()
    expect(records).toHaveLength(2)
    expect(records).toContainEqual({ _file: 'zuiquan.json', id: '醉拳', power: 60 })
    expect(records).toContainEqual({ _file: 'broken.json', _error: 'parse error' })
  })
})

describe('GET /api/data/record/', () => {
  it('returns a single record by table and file', async () => {
    writeDataConfig([skillsTable])
    const dir = tableDir('skills')
    writeRecord(dir, 'zuiquan.json', { id: '醉拳', power: 60 })
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/record/', mockReq('GET', undefined, '/api/data/record/skills/zuiquan.json'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ id: '醉拳', power: 60 })
  })

  it('404s for an unknown table id', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/record/', mockReq('GET', undefined, '/api/data/record/items/x.json'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('Table not found: items')
  })

  it('404s when the record file does not exist', async () => {
    writeDataConfig([skillsTable])
    tableDir('skills')
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/record/', mockReq('GET', undefined, '/api/data/record/skills/missing.json'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('File not found')
  })

  it('answers 500 when the record file is malformed JSON', async () => {
    writeDataConfig([skillsTable])
    const dir = tableDir('skills')
    writeRecord(dir, 'broken.json', '{oops')
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/record/', mockReq('GET', undefined, '/api/data/record/skills/broken.json'))
    expect(res.status).toBe(500)
    expect(res.json().error).toBeTruthy()
  })
})

describe('PUT /api/data/save/', () => {
  it('rejects non-PUT methods with 405', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/save/', mockReq('POST', { id: 'x' }, '/api/data/save/skills/x.json'))
    expect(res.status).toBe(405)
    expect(res.body).toBe('Method Not Allowed')
  })

  it('404s for an unknown table id', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/save/', mockReq('PUT', { id: 'x' }, '/api/data/save/items/x.json'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('Table not found: items')
  })

  it('creates the table dir and writes canonical pretty JSON with a trailing newline', async () => {
    writeDataConfig([skillsTable])
    const body = { id: 'zuiquan', power: 60 }
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/save/', mockReq('PUT', body, '/api/data/save/skills/zuiquan.json'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const file = path.join(getRoot(), 'data', 'skills', 'zuiquan.json')
    expect(fs.readFileSync(file, 'utf-8')).toBe(JSON.stringify(body, null, 2) + '\n')
  })

  it('400s on a body that is not valid JSON, writing nothing', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/save/', rawReq('PUT', '{not json', '/api/data/save/skills/x.json'))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('Body is not valid JSON')
    expect(fs.existsSync(path.join(getRoot(), 'data', 'skills', 'x.json'))).toBe(false)
  })

  it('400s on a JSON body that is not an object', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/save/', mockReq('PUT', [1, 2, 3], '/api/data/save/skills/x.json'))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('must be a JSON object')
  })

  it('400s when the id field is missing or blank', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const missing = await call(server.routes, '/api/data/save/', mockReq('PUT', { name: 'x' }, '/api/data/save/skills/x.json'))
    expect(missing.status).toBe(400)
    expect(missing.json().error).toContain('missing required id field "id"')
    const blank = await call(server.routes, '/api/data/save/', mockReq('PUT', { id: '   ' }, '/api/data/save/skills/x.json'))
    expect(blank.status).toBe(400)
  })

  it('400s on a duplicate id from another file, but allows re-saving the same file', async () => {
    writeDataConfig([skillsTable])
    const dir = tableDir('skills')
    writeRecord(dir, 'zuiquan.json', { id: '醉拳', power: 60 })
    const server = makeServer()
    registerData(server)

    const dup = await call(server.routes, '/api/data/save/', mockReq('PUT', { id: '醉拳' }, '/api/data/save/skills/other.json'))
    expect(dup.status).toBe(400)
    expect(dup.json().error).toContain('already used by "zuiquan.json"')
    expect(fs.existsSync(path.join(dir, 'other.json'))).toBe(false)

    // The clash check excludes the file being saved, so an in-place edit is fine.
    const own = await call(server.routes, '/api/data/save/', mockReq('PUT', { id: '醉拳', power: 90 }, '/api/data/save/skills/zuiquan.json'))
    expect(own.status).toBe(200)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'zuiquan.json'), 'utf-8')).power).toBe(90)
  })

  it('honors a table-level custom idField', async () => {
    writeDataConfig([{ id: 'characters', dir: 'characters', idField: 'name' }])
    const server = makeServer()
    registerData(server)
    const missing = await call(server.routes, '/api/data/save/', mockReq('PUT', { id: 'x' }, '/api/data/save/characters/lin.json'))
    expect(missing.status).toBe(400)
    expect(missing.json().error).toContain('missing required id field "name"')
    const ok = await call(server.routes, '/api/data/save/', mockReq('PUT', { name: '林晚' }, '/api/data/save/characters/lin.json'))
    expect(ok.status).toBe(200)
    expect(JSON.parse(fs.readFileSync(path.join(getRoot(), 'data', 'characters', 'lin.json'), 'utf-8'))).toEqual({ name: '林晚' })
  })
})

describe('DELETE /api/data/delete/', () => {
  it('rejects non-DELETE methods with 405', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/delete/', mockReq('GET', undefined, '/api/data/delete/skills/x.json'))
    expect(res.status).toBe(405)
  })

  it('404s for an unknown table id', async () => {
    writeDataConfig([skillsTable])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/delete/', mockReq('DELETE', undefined, '/api/data/delete/items/x.json'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('Table not found: items')
  })

  it('deletes an existing record file', async () => {
    writeDataConfig([skillsTable])
    const dir = tableDir('skills')
    writeRecord(dir, 'zuiquan.json', { id: '醉拳' })
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/delete/', mockReq('DELETE', undefined, '/api/data/delete/skills/zuiquan.json'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(fs.existsSync(path.join(dir, 'zuiquan.json'))).toBe(false)
  })

  it('is idempotent — deleting a nonexistent file still returns ok', async () => {
    writeDataConfig([skillsTable])
    tableDir('skills')
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/delete/', mockReq('DELETE', undefined, '/api/data/delete/skills/missing.json'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})


describe('method guards', () => {
  it('POST /api/data/list/ answers 405', async () => {
    writeDataConfig([{ id: 'skills', dir: 'skills' }])
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/list/', mockReq('POST', {}, '/api/data/list/skills'))
    expect(res.status).toBe(405)
  })

  it('POST /api/data/record/ answers 405', async () => {
    writeDataConfig([{ id: 'skills', dir: 'skills' }])
    tableDir('skills')
    const server = makeServer()
    registerData(server)
    const res = await call(server.routes, '/api/data/record/', mockReq('POST', {}, '/api/data/record/skills/x.json'))
    expect(res.status).toBe(405)
  })
})
