// ───────────────────────────────────────────────────────────────────────────
// Story route tests — /api/scenes, /api/stories (graph + characters/quests/
// arcs kinds), /api/flags. Same mock-connect scaffold as the other route
// tests; the story activity points storiesDir/scenesDir under dataRoot, so a
// project looks like <root>/data/story/<kind> + <root>/data/maps/<scene>.
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { registerStories } from './stories'
import { makeServer, mockReq, call, useTempProject, writeProjectConfig } from '../testUtils'

const getRoot = useTempProject('jrpg-stories-')

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

/** Config with a story activity (storiesDir 'story', scenesDir 'maps') plus any extra activities. */
function writeStoryConfig(storyConfig: Record<string, unknown> = {}, extraActivities: unknown[] = []) {
  writeProjectConfig(getRoot(), {
    activities: [
      { id: 'story', type: 'story', config: { storiesDir: 'story', scenesDir: 'maps', ...storyConfig } },
      ...extraActivities,
    ],
  })
}

/** Write a scene file at <root>/data/maps/<rel>. */
function writeScene(rel: string, text: string) {
  const abs = path.join(getRoot(), 'data', 'maps', rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}

/** Create and return the kind dir at <root>/data/story/<kind>. */
function storyDir(kind: string) {
  const abs = path.join(getRoot(), 'data', 'story', kind)
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

function storyPath(...segs: string[]) {
  return path.join(getRoot(), 'data', 'story', ...segs)
}

describe('GET /api/scenes', () => {
  it('answers 500 when no story activity is configured', async () => {
    writeProjectConfig(getRoot()) // activities: []
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/scenes', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No story activity configured')
  })

  it('returns [] when the scenes directory does not exist yet', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/scenes', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('walks recursively, extracts storyline/game_scene names, and collapses /script stems', async () => {
    writeStoryConfig()
    writeScene('Wangjiang/script.scene', 'scene Wangjiang\n  @storyline("main")\n  @storyline("rival")\n')
    writeScene('Town/intro.scene', 'game_scene Intro\ngame_scene IntroExtra\n')
    writeScene('Town/notes.txt', '@storyline("ignored") — wrong extension\n')

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/scenes', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([
      { stem: 'Town/intro', names: ['Intro', 'IntroExtra'], path: 'Town/intro.scene' },
      { stem: 'Wangjiang', names: ['main', 'rival'], path: 'Wangjiang/script.scene' },
    ])
  })

  it('honors a custom scene extension from the story config', async () => {
    writeStoryConfig({ scene: { ext: '.quest' } })
    writeScene('Quests/a.quest', '@storyline("side")\n')
    writeScene('Quests/b.scene', '@storyline("ignored")\n')

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/scenes', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([
      { stem: 'Quests/a', names: ['side'], path: 'Quests/a.quest' },
    ])
  })
})

describe('/api/stories/graph', () => {
  it('returns { edges: [] } when graph.json does not exist yet', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/graph'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ edges: [] })
  })

  it('round-trips a PUT through disk', async () => {
    writeStoryConfig()
    const graph = { edges: [{ from: 'a', to: 'b' }] }
    const server = makeServer()
    registerStories(server)

    const put = await call(server.routes, '/api/stories', mockReq('PUT', graph, '/api/stories/graph'))
    expect(put.status).toBe(200)
    expect(put.json()).toEqual({ ok: true })
    expect(JSON.parse(fs.readFileSync(storyPath('graph.json'), 'utf-8'))).toEqual(graph)

    const get = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/graph'))
    expect(get.json()).toEqual(graph)
  })

  it('answers 500 on a malformed JSON body and writes nothing', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', rawReq('PUT', '{nope', '/api/stories/graph'))
    expect(res.status).toBe(500)
    expect(fs.existsSync(storyPath('graph.json'))).toBe(false)
  })

  it('rejects other methods with 405', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('POST', {}, '/api/stories/graph'))
    expect(res.status).toBe(405)
  })
})

describe('/api/stories/:kind', () => {
  it('404s for an unknown story kind', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/spells'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('Unknown story kind: spells')
  })

  it('404s for a bare /api/stories URL (no kind segment)', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories'))
    expect(res.status).toBe(404)
    expect(res.json().error).toContain('Unknown story kind')
  })

  it('returns [] when the kind directory does not exist yet', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/characters'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('lists parsed records, skipping unparseable files and non-json entries', async () => {
    writeStoryConfig()
    const dir = storyDir('quests')
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'A' }))
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ id: 'B' }))
    fs.writeFileSync(path.join(dir, 'broken.json'), '{oops')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a record')

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/quests'))
    expect(res.status).toBe(200)
    const records = res.json()
    expect(records).toHaveLength(2)
    expect(records).toContainEqual({ id: 'A' })
    expect(records).toContainEqual({ id: 'B' })
  })
})

describe('/api/stories/:kind/:id', () => {
  it('GET resolves a record by its id field, not the filename', async () => {
    writeStoryConfig()
    const dir = storyDir('characters')
    fs.writeFileSync(path.join(dir, 'lin-wan.json'), JSON.stringify({ id: 'Lin Wan', hp: 10 }))

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/characters/Lin%20Wan'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ id: 'Lin Wan', hp: 10 })
  })

  it('GET 404s for a nonexistent record', async () => {
    writeStoryConfig()
    storyDir('characters')
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('GET', undefined, '/api/stories/characters/Nobody'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('Record not found')
  })

  it('PUT creates a new record in a kebab-slug file derived from the id', async () => {
    writeStoryConfig()
    const body = { id: 'Main Quest', title: 'Find the herb' }
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('PUT', body, '/api/stories/quests/Main%20Quest'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(JSON.parse(fs.readFileSync(storyPath('quests', 'main-quest.json'), 'utf-8'))).toEqual(body)
  })

  it('PUT overwrites the existing file matched by id instead of forking a duplicate', async () => {
    writeStoryConfig()
    const dir = storyDir('characters')
    fs.writeFileSync(path.join(dir, 'lin-wan.json'), JSON.stringify({ id: 'Lin Wan', hp: 1 }))

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('PUT', { id: 'Lin Wan', hp: 2 }, '/api/stories/characters/Lin%20Wan'))
    expect(res.status).toBe(200)
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    expect(files).toEqual(['lin-wan.json'])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'lin-wan.json'), 'utf-8'))).toEqual({ id: 'Lin Wan', hp: 2 })
  })

  it('PUT falls back to the sanitized id as filename when it has no ASCII slug', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('PUT', { id: '林晚' }, `/api/stories/characters/${encodeURIComponent('林晚')}`))
    expect(res.status).toBe(200)
    expect(JSON.parse(fs.readFileSync(storyPath('characters', '林晚.json'), 'utf-8'))).toEqual({ id: '林晚' })
  })

  it('PUT answers 500 on a malformed JSON body and writes nothing', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', rawReq('PUT', '{nope', '/api/stories/quests/x'))
    expect(res.status).toBe(500)
    expect(fs.existsSync(storyPath('quests'))).toBe(false)
  })

  it('DELETE removes the record file matched by id', async () => {
    writeStoryConfig()
    const dir = storyDir('characters')
    fs.writeFileSync(path.join(dir, 'lin-wan.json'), JSON.stringify({ id: 'Lin Wan' }))

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('DELETE', undefined, '/api/stories/characters/Lin%20Wan'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(fs.existsSync(path.join(dir, 'lin-wan.json'))).toBe(false)
  })

  it('DELETE is idempotent for a nonexistent record', async () => {
    writeStoryConfig()
    storyDir('characters')
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('DELETE', undefined, '/api/stories/characters/Nobody'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('rejects unsupported methods with 405', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('POST', {}, '/api/stories/characters/x'))
    expect(res.status).toBe(405)
  })
})

describe('GET /api/flags', () => {
  it('answers 500 when no story activity is configured', async () => {
    writeProjectConfig(getRoot()) // activities: []
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/flags', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No story activity configured')
  })

  it('scans the scenes dir by default, recursively, honoring the extension filter', async () => {
    writeStoryConfig()
    writeScene('A/script.scene', `scene A
  setFlag("MET_RIVAL")
  getFlag('HAS_OAK')
  setFlag(NO_QUOTES)
`)
    writeScene('A/Nested/deep.scene', 'setFlag("DEEP_FLAG")\n')
    writeScene('A/ignored.txt', 'setFlag("TXT_FLAG")\n')

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/flags', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual(['DEEP_FLAG', 'HAS_OAK', 'MET_RIVAL'])
  })

  it('reads flags from a data table when scanning is disabled (scan: null)', async () => {
    writeStoryConfig(
      { flagSource: { scan: null, table: 'flags' } },
      [{ id: 'data', type: 'data', config: { tables: [{ id: 'flags', dir: 'flags' }] } }],
    )
    const dir = path.join(getRoot(), 'data', 'flags')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'FLAG_B' }))
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ id: 'FLAG_A' }))
    fs.writeFileSync(path.join(dir, 'broken.json'), '{oops')
    // Must NOT appear: scanning is disabled.
    writeScene('X/script.scene', 'setFlag("SCANNED")\n')

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/flags', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual(['FLAG_A', 'FLAG_B'])
  })

  it('merges scan and table sources, sorted and deduplicated', async () => {
    writeStoryConfig(
      { flagSource: { table: 'flags' } }, // scan undefined → scanning still on
      [{ id: 'data', type: 'data', config: { tables: [{ id: 'flags', dir: 'flags' }] } }],
    )
    writeScene('X/script.scene', 'setFlag("ZETA")\n')
    const dir = path.join(getRoot(), 'data', 'flags')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'ALPHA' }))
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ id: 'ZETA' }))

    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/flags', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual(['ALPHA', 'ZETA'])
  })
})


describe('route hardening', () => {
  it('PUT /api/stories/:kind without an id answers 400 and writes no "undefined.json"', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('PUT', { id: 'x' }, '/api/stories/characters'))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('Record id is required')
    expect(fs.existsSync(path.join(getRoot(), 'data', 'story', 'characters', 'undefined.json'))).toBe(false)
  })

  it('DELETE /api/stories/:kind without an id answers 400', async () => {
    writeStoryConfig()
    const server = makeServer()
    registerStories(server)
    const res = await call(server.routes, '/api/stories', mockReq('DELETE', undefined, '/api/stories/quests'))
    expect(res.status).toBe(400)
  })
})
