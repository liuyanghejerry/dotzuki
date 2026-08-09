// ───────────────────────────────────────────────────────────────────────────
// Map-route tests — drive registerMaps' handlers through the shared
// mock-connect scaffold (testUtils), with the project root pinned to a fresh
// temp dir per test (setProjectRootDir). The AI-backed
// /api/maps/generate-backdrop route is intentionally not covered (needs an
// external image provider).
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { registerMaps } from './maps'
import { makeServer, mockReq, call, useTempProject, writeProjectConfig } from '../testUtils'

const root = useTempProject('jrpg-maps-')

/** Standard project: a map activity (mapsDir under dataRoot) + a story
 *  activity whose quests dir backs map-reference scanning. */
function writeMapsConfig(extraActivities: unknown[] = []) {
  writeProjectConfig(root(), {
    activities: [
      { id: 'maps', type: 'map', config: { mapsDir: 'maps' } },
      { id: 'story', type: 'story', config: { storiesDir: 'story', scenesDir: 'maps' } },
      ...(extraActivities as object[]),
    ],
  })
}

/** Create <root>/data/maps/<name>/ with the given files inside. */
function makeMapDir(name: string, files: Record<string, string> = {}) {
  const dir = path.join(root(), 'data', 'maps', name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [f, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, f), content)
  }
  return dir
}

/**
 * Drive a route whose PUT handler reads the body fire-and-forget
 * (`readBody(req).then(...)` without awaiting) — give the promise a tick to
 * settle before asserting on the response.
 */
async function callSettled(routes: Map<string, import('../testUtils').Handler>, route: string, req: any) {
  const res = await call(routes, route, req)
  await new Promise(r => setImmediate(r))
  return res
}

function makeQuest(file: string, implementedBy: unknown[]) {
  const dir = path.join(root(), 'data', 'story', 'quests')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, file), JSON.stringify({ id: file, implementedBy }))
}

describe('GET /api/maps', () => {
  it('answers 500 when no project is open', async () => {
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('.dotzuki-editor.json')
  })

  it('answers 500 when the project has no map activity', async () => {
    writeProjectConfig(root()) // activities: []
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No map activity configured')
  })

  it('lists map dirs, flagging tilemaps and AI backdrops', async () => {
    writeMapsConfig()
    makeMapDir('Alpha', { 'map.tmx.json': '{}' })
    makeMapDir('Beta', { 'source.png': 'png-bytes' })
    makeMapDir('Gamma')
    fs.writeFileSync(path.join(root(), 'data', 'maps', 'notes.txt'), 'hi')

    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET', undefined, '/api/maps'))
    expect(res.status).toBe(200)
    const byName = new Map(res.json().map((e: any) => [e.name, e]))
    expect([...byName.keys()].sort()).toEqual(['Alpha', 'Beta', 'Gamma', 'notes.txt'])
    expect(byName.get('Alpha')).toMatchObject({ isDir: true, hasTilemap: true, hasBackdrop: false })
    expect(byName.get('Beta')).toMatchObject({ isDir: true, hasTilemap: false, hasBackdrop: true })
    expect(byName.get('Gamma')).toMatchObject({ isDir: true, hasTilemap: false, hasBackdrop: false })
    // Plain files get no map badges.
    expect(byName.get('notes.txt')).toMatchObject({ isDir: false })
    expect(byName.get('notes.txt').hasTilemap).toBeUndefined()
  })

  it('reads a map file as parsed JSON', async () => {
    writeMapsConfig()
    makeMapDir('Alpha', { 'map.json': JSON.stringify({ name: 'Alpha', width: 20 }) })
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET', undefined, '/api/maps/Alpha/map.json'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ name: 'Alpha', width: 20 })
  })

  it('serves binary assets (tileset.png) raw, not as JSON', async () => {
    writeMapsConfig()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    fs.writeFileSync(path.join(makeMapDir('Alpha'), 'tileset.png'), png)
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET', undefined, '/api/maps/Alpha/tileset.png'))
    expect(res.status).toBe(200)
    expect(Buffer.isBuffer(res.body)).toBe(true)
    expect(Buffer.compare(res.body as unknown as Buffer, png)).toBe(0)
  })
})

describe('PUT /api/maps', () => {
  it('writes the body verbatim, creating parent dirs', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const body = { name: 'NewMap', width: 12 }
    const res = await callSettled(server.routes, '/api/maps', mockReq('PUT', body, '/api/maps/NewMap/map.json'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const onDisk = fs.readFileSync(path.join(root(), 'data', 'maps', 'NewMap', 'map.json'), 'utf-8')
    expect(onDisk).toBe(JSON.stringify(body))
  })
})

describe('POST /api/maps-create', () => {
  it('creates the map dir with a minimal map.json', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-create', mockReq('POST', { name: 'Town' }))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, name: 'Town' })
    const dir = path.join(root(), 'data', 'maps', 'Town')
    expect(fs.statSync(dir).isDirectory()).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'map.json'), 'utf-8'))).toEqual({
      name: 'Town',
      width: 20, height: 18,
      tileset: '', music: '',
      warps: [], signs: [], npcs: [],
    })
  })

  it('rejects non-POST methods with 405', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-create', mockReq('GET'))
    expect(res.status).toBe(405)
  })

  it('answers 500 when the project has no map activity', async () => {
    writeProjectConfig(root())
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-create', mockReq('POST', { name: 'Town' }))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No map activity configured')
  })

  it('answers 500 when no project is open', async () => {
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-create', mockReq('POST', { name: 'Town' }))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('.dotzuki-editor.json')
  })
})

describe('POST /api/maps-delete', () => {
  it('removes the map directory recursively', async () => {
    writeMapsConfig()
    const dir = makeMapDir('Town', { 'map.json': '{}', 'script.scene': 'scene Town' })
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-delete', mockReq('POST', { name: 'Town' }))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, name: 'Town' })
    expect(fs.existsSync(dir)).toBe(false)
  })

  it.each([{}, { name: '' }, { name: 'Bad Name!' }, { name: '../escape' }])(
    'rejects invalid names with 400: %j', async (body) => {
      writeMapsConfig()
      const server = makeServer()
      registerMaps(server)
      const res = await call(server.routes, '/api/maps-delete', mockReq('POST', body))
      expect(res.status).toBe(400)
      expect(res.json().error).toContain('a valid map name')
    },
  )

  it('answers 404 for a map that does not exist', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-delete', mockReq('POST', { name: 'Ghost' }))
    expect(res.status).toBe(404)
    expect(res.json().error).toContain('map not found')
  })

  it('rejects non-POST methods with 405', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-delete', mockReq('DELETE'))
    expect(res.status).toBe(405)
  })

  it('answers 500 when the project has no map activity', async () => {
    writeProjectConfig(root())
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-delete', mockReq('POST', { name: 'Town' }))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No map activity configured')
  })
})

describe('GET /api/maps-references', () => {
  it('counts warp, scene and quest references, with whole-word scene matching', async () => {
    writeMapsConfig()
    makeMapDir('Town', {
      'objects.json': JSON.stringify({ warps: [{ dest_map: 'Cave' }, { dest_map: 'Cave' }, { dest_map: 'Other' }] }),
      // Two whole-word hits; CaveB / MyCave must NOT match.
      'script.scene': 'scene Town\n  warpTo("Cave") -- CaveB MyCave\n  -- back to Cave\n',
    })
    makeQuest('q1.json', [{ scene: 'Cave' }, { scene: 'Other' }])

    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-references', mockReq('GET', undefined, '/api/maps-references?name=Cave'))
    expect(res.status).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(5)
    const byFile = new Map(body.refs.map((r: any) => [r.file, r]))
    expect(byFile.get('maps/Town/objects.json')).toMatchObject({ kind: 'warp', count: 2 })
    expect(byFile.get('maps/Town/script.scene')).toMatchObject({ kind: 'scene', count: 2 })
    expect(byFile.get('story/quests/q1.json')).toMatchObject({ kind: 'quest', count: 1 })
  })

  it('returns an empty list when nothing references the map', async () => {
    writeMapsConfig()
    makeMapDir('Cave', { 'map.json': '{}' })
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-references', mockReq('GET', undefined, '/api/maps-references?name=Cave'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, refs: [], total: 0 })
  })

  it.each(['/api/maps-references', '/api/maps-references?name=', '/api/maps-references?name=Bad%20Name'])(
    'rejects a missing/invalid name with 400: %s', async (url) => {
      writeMapsConfig()
      const server = makeServer()
      registerMaps(server)
      const res = await call(server.routes, '/api/maps-references', mockReq('GET', undefined, url))
      expect(res.status).toBe(400)
      expect(res.json().error).toContain('a valid name is required')
    },
  )

  it('rejects non-GET methods with 405', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-references', mockReq('POST', undefined, '/api/maps-references?name=Cave'))
    expect(res.status).toBe(405)
  })
})

describe('POST /api/maps-rename', () => {
  it('renames the directory and rewrites every reference when updateRefs is true', async () => {
    writeMapsConfig()
    makeMapDir('Old', {
      // The map's own scene references itself — rewritten after the move.
      'script.scene': 'scene Old\n  warpTo("Old")\n',
      'map.json': JSON.stringify({ name: 'Old' }),
    })
    makeMapDir('Town', { 'objects.json': JSON.stringify({ warps: [{ dest_map: 'Old' }] }) })
    makeQuest('q1.json', [{ scene: 'Old' }])

    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('POST', { name: 'Old', newName: 'New', updateRefs: true }))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, name: 'New', updated: 3 })

    expect(fs.existsSync(path.join(root(), 'data', 'maps', 'Old'))).toBe(false)
    const newDir = path.join(root(), 'data', 'maps', 'New')
    expect(fs.statSync(newDir).isDirectory()).toBe(true)
    // The moved scene was rewritten in place.
    const scene = fs.readFileSync(path.join(newDir, 'script.scene'), 'utf-8')
    expect(scene).toContain('New')
    expect(scene).not.toContain('Old')
    // Structured JSON refs were rewritten by value.
    const warps = JSON.parse(fs.readFileSync(path.join(root(), 'data', 'maps', 'Town', 'objects.json'), 'utf-8'))
    expect(warps.warps[0].dest_map).toBe('New')
    const quest = JSON.parse(fs.readFileSync(path.join(root(), 'data', 'story', 'quests', 'q1.json'), 'utf-8'))
    expect(quest.implementedBy[0].scene).toBe('New')
  })

  it('renames without touching references when updateRefs is false', async () => {
    writeMapsConfig()
    makeMapDir('Old', { 'script.scene': 'scene Old\n' })
    makeMapDir('Town', { 'objects.json': JSON.stringify({ warps: [{ dest_map: 'Old' }] }) })

    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('POST', { name: 'Old', newName: 'New' }))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, name: 'New', updated: 0 })
    expect(fs.existsSync(path.join(root(), 'data', 'maps', 'New', 'script.scene'))).toBe(true)
    const warps = JSON.parse(fs.readFileSync(path.join(root(), 'data', 'maps', 'Town', 'objects.json'), 'utf-8'))
    expect(warps.warps[0].dest_map).toBe('Old')
  })

  it('accepts a rename to the same name as a no-op', async () => {
    writeMapsConfig()
    makeMapDir('Town', { 'map.json': '{}' })
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('POST', { name: 'Town', newName: 'Town', updateRefs: true }))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, name: 'Town', updated: 0 })
    expect(fs.existsSync(path.join(root(), 'data', 'maps', 'Town', 'map.json'))).toBe(true)
  })

  it('refuses to overwrite an existing map with 409', async () => {
    writeMapsConfig()
    makeMapDir('Old', { 'map.json': '{}' })
    makeMapDir('New', { 'map.json': '{}' })
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('POST', { name: 'Old', newName: 'New' }))
    expect(res.status).toBe(409)
    expect(res.json().error).toContain('a map with that name already exists')
    // Both directories survive untouched.
    expect(fs.existsSync(path.join(root(), 'data', 'maps', 'Old', 'map.json'))).toBe(true)
    expect(fs.existsSync(path.join(root(), 'data', 'maps', 'New', 'map.json'))).toBe(true)
  })

  it('answers 404 for a map that does not exist', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('POST', { name: 'Ghost', newName: 'New' }))
    expect(res.status).toBe(404)
    expect(res.json().error).toContain('map not found')
  })

  it.each([{ newName: 'New' }, { name: 'Old' }, { name: 'Bad Name', newName: 'New' }, { name: 'Old', newName: '../x' }])(
    'rejects invalid names with 400: %j', async (body) => {
      writeMapsConfig()
      makeMapDir('Old')
      const server = makeServer()
      registerMaps(server)
      const res = await call(server.routes, '/api/maps-rename', mockReq('POST', body))
      expect(res.status).toBe(400)
      expect(res.json().error).toContain('valid map names')
    },
  )

  it('rejects non-POST methods with 405', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('GET'))
    expect(res.status).toBe(405)
  })

  it('answers 500 when the project has no map activity', async () => {
    writeProjectConfig(root())
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-rename', mockReq('POST', { name: 'Old', newName: 'New' }))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No map activity configured')
  })
})


describe('route hardening', () => {
  it('GET /api/maps answers [] when the mapsDir does not exist yet', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('GET /api/maps/<missing-file> answers 404 (statSync used to throw → 500)', async () => {
    writeMapsConfig()
    makeMapDir('Alpha')
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('GET', undefined, '/api/maps/Alpha/nope.json'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('File not found')
  })

  it('GET /api/maps rejects non-GET/PUT methods with 405 (used to hang)', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps', mockReq('DELETE'))
    expect(res.status).toBe(405)
  })

  it('POST /api/maps-create rejects a traversal name with 400 and writes nothing', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    const res = await call(server.routes, '/api/maps-create', mockReq('POST', { name: '../escape' }))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('valid map name')
    expect(fs.existsSync(path.join(root(), 'data', 'escape'))).toBe(false)
    expect(fs.existsSync(path.join(root(), 'escape'))).toBe(false)
  })

  it('POST /api/maps-create rejects missing/illegal names with 400', async () => {
    writeMapsConfig()
    const server = makeServer()
    registerMaps(server)
    for (const body of [{}, { name: '' }, { name: 'bad name' }, { name: 'a/b' }]) {
      const res = await call(server.routes, '/api/maps-create', mockReq('POST', body))
      expect(res.status).toBe(400)
    }
    // In particular: no literal "undefined/" dir (the old coercion bug).
    expect(fs.existsSync(path.join(root(), 'data', 'maps', 'undefined'))).toBe(false)
  })
})
