// applyChange tests — verify accepted proposals write to the right resolved file
// per target kind, return a backup, and that delete (revert-of-create) works.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProjectContext } from '../context/projectContext'
import { getProjectRoot, setProjectRootDir } from '../api/projectConfig'
import { applyChange } from './apply'

let ROOT = ''
function write(rel: string, content: string) {
  const abs = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf-8')
}
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dotzuki-apply-'))
  write('.dotzuki-editor.json', JSON.stringify({
    name: 'F', dataRoot: '.', activities: [
      { id: 'story', type: 'story', config: { storiesDir: 'data/story', scenesDir: 'data/maps', scene: { ext: '.scene' } } },
      { id: 'data', type: 'data', config: { tables: [{ id: 'skills', dir: 'data/skills', idField: 'id' }] } },
      { id: 'ui', type: 'ui', config: { guiRoot: 'ui_layouts', extension: '.gui' } },
      { id: 'map', type: 'map', config: { mapsDir: 'data/maps' } },
    ],
  }))
  write('data/story/characters/hero.json', JSON.stringify({ id: 'hero', motivation: 'old' }))
  write('data/skills/fireball.json', JSON.stringify({ id: 'fireball', power: 10 }))
})
afterAll(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('applyChange', () => {
  it('writes a story record to its resolved file and returns the backup', () => {
    const p = createProjectContext(ROOT)
    const res = applyChange(p, { target: { kind: 'story', storyKind: 'characters', id: 'hero', path: 'characters/hero' }, after: '{"id":"hero","motivation":"new"}' })
    expect(res.backup).toContain('old')
    expect(JSON.parse(read('data/story/characters/hero.json')).motivation).toBe('new')
  })

  it('writes a data record by matching idField', () => {
    const p = createProjectContext(ROOT)
    applyChange(p, { target: { kind: 'data', table: 'skills', id: 'fireball', path: 'skills/fireball' }, after: '{"id":"fireball","power":99}' })
    expect(JSON.parse(read('data/skills/fireball.json')).power).toBe(99)
  })

  it('creates a new scene file then deletes it on revert-of-create', () => {
    const p = createProjectContext(ROOT)
    const created = applyChange(p, { target: { kind: 'scene', scene: 'NewMap', path: '' }, after: '@storyline("n")\n' })
    expect(created.backup).toBeNull()
    expect(fs.existsSync(path.join(ROOT, 'data/maps/NewMap/script.scene'))).toBe(true)
    applyChange(p, { target: { kind: 'scene', scene: 'NewMap', path: '' }, op: 'delete' })
    expect(fs.existsSync(path.join(ROOT, 'data/maps/NewMap/script.scene'))).toBe(false)
  })

  it('writes a gui file under guiRoot', () => {
    const p = createProjectContext(ROOT)
    applyChange(p, { target: { kind: 'gui', name: 'menu.gui', path: 'menu.gui' }, after: 'screen menu {}' })
    expect(read('ui_layouts/menu.gui')).toContain('screen menu')
  })

  it('writes a map objects.json under mapsDir/<map>/', () => {
    const p = createProjectContext(ROOT)
    const res = applyChange(p, { target: { kind: 'map', map: 'Town', path: 'maps/Town/objects.json' }, after: '{"npcs":[{"id":1}],"warps":[]}' })
    expect(res.backup).toBeNull() // newly created
    expect(JSON.parse(read('data/maps/Town/objects.json')).npcs[0].id).toBe(1)
  })

  it('refuses a stale write when the file drifted from `expect`, and honors force', () => {
    const p = createProjectContext(ROOT)
    write('data/skills/blast.json', '{"id":"blast","power":1}')
    const target = { kind: 'data', table: 'skills', id: 'blast', path: 'skills/blast' } as const
    // The proposal was built against power:1, but the file now says power:5.
    write('data/skills/blast.json', '{"id":"blast","power":5}')

    const conflict = applyChange(p, { target, after: '{"id":"blast","power":2}', expect: '{"id":"blast","power":1}' })
    expect(conflict.ok).toBe(false)
    expect(conflict.conflict).toBe(true)
    expect(JSON.parse(read('data/skills/blast.json')).power).toBe(5) // NOT clobbered

    // force overrides the guard.
    const forced = applyChange(p, { target, after: '{"id":"blast","power":2}', expect: '{"id":"blast","power":1}', force: true })
    expect(forced.ok).toBe(true)
    expect(JSON.parse(read('data/skills/blast.json')).power).toBe(2)
  })

  it('treats expect=null as "must not exist yet" (create-collision guard)', () => {
    const p = createProjectContext(ROOT)
    write('data/skills/exists.json', '{"id":"exists","power":7}')
    // A "create" proposal (before=null) but the file now exists → conflict, no write.
    const res = applyChange(p, { target: { kind: 'data', table: 'skills', id: 'exists', path: 'skills/exists' }, after: '{"id":"exists","power":0}', expect: null })
    expect(res.conflict).toBe(true)
    expect(JSON.parse(read('data/skills/exists.json')).power).toBe(7)
  })

  it('skips the guard entirely when expect is undefined (legacy / revert path)', () => {
    const p = createProjectContext(ROOT)
    write('data/skills/legacy.json', '{"id":"legacy","power":3}')
    const res = applyChange(p, { target: { kind: 'data', table: 'skills', id: 'legacy', path: 'skills/legacy' }, after: '{"id":"legacy","power":9}' })
    expect(res.ok).toBe(true)
    expect(JSON.parse(read('data/skills/legacy.json')).power).toBe(9)
  })
})

describe('applyChange — project kinds', () => {
  // Scaffold targets resolve against the GLOBAL project root (same convention
  // as the project create route), so pin it to a fresh temp dir per test.
  let PARENT = ''
  beforeEach(() => {
    PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'dotzuki-apply-proj-'))
    setProjectRootDir(PARENT)
  })
  afterEach(() => { try { fs.rmSync(PARENT, { recursive: true, force: true }) } catch { /* ignore */ } })

  it('writes .dotzuki-editor.json for project-config, resets the cache, and honors the stale guard', () => {
    const p = createProjectContext(ROOT)
    const before = read('.dotzuki-editor.json')
    const next = JSON.stringify({ ...JSON.parse(before), name: 'Renamed' }, null, 2)

    const res = applyChange(p, { target: { kind: 'project-config', path: '.dotzuki-editor.json' }, after: next, expect: before })
    expect(res.ok).toBe(true)
    expect(res.backup).toBe(before)
    expect(JSON.parse(read('.dotzuki-editor.json')).name).toBe('Renamed')
    // The context cache was dropped, so config() re-reads the new file.
    expect(p.config().name).toBe('Renamed')

    // The proposal was built against `before`; the file has since drifted.
    const conflict = applyChange(p, { target: { kind: 'project-config', path: '.dotzuki-editor.json' }, after: next, expect: before })
    expect(conflict.ok).toBe(false)
    expect(conflict.conflict).toBe(true)
  })

  const scaffoldTarget = { kind: 'project-scaffold', dir: 'ai-game', name: 'AI Game', path: 'ai-game' } as const
  const scaffoldPayload = JSON.stringify({ name: 'AI Game', dir: 'ai-game', templateId: 'dotzuki', dataRoot: './data', gfxRoot: './gfx' })

  it('scaffolds a project, switches the editor root, and reverts by deleting the new dir', () => {
    const p = createProjectContext(ROOT)
    const res = applyChange(p, { target: scaffoldTarget, after: scaffoldPayload, expect: null })
    expect(res.ok).toBe(true)

    const target = path.join(PARENT, 'ai-game')
    expect(getProjectRoot()).toBe(target) // editor root switched to the new project
    expect(fs.existsSync(path.join(target, '.dotzuki-editor.json'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'assets', 'scenes', 'main.scene'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'data', 'maps'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'Cargo.toml'))).toBe(false) // pure editor content, no Rust

    // Revert of a create: recursively delete the new project dir, root back to parent.
    const rev = applyChange(p, { target: scaffoldTarget, op: 'delete' })
    expect(rev.ok).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
    expect(getProjectRoot()).toBe(PARENT)
  })

  it('refuses to scaffold into a non-empty directory (conflict-style)', () => {
    const target = path.join(PARENT, 'ai-game')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'keep.txt'), 'hi')
    const p = createProjectContext(ROOT)
    const res = applyChange(p, { target: scaffoldTarget, after: scaffoldPayload, expect: null })
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    expect(fs.existsSync(path.join(target, '.dotzuki-editor.json'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true)
  })

  it('refuses to delete a directory this proposal did not create', () => {
    const target = path.join(PARENT, 'ai-game')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'keep.txt'), 'hi') // no .dotzuki-editor.json marker
    const p = createProjectContext(ROOT)
    expect(() => applyChange(p, { target: scaffoldTarget, op: 'delete' })).toThrow(/refusing to delete/)
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true)
  })

  it('creates a map via map-create and reverts by deleting the new map dir', () => {
    const p = createProjectContext(ROOT)
    const target = { kind: 'map-create', map: 'NewTown', path: 'data/maps/NewTown/' } as const
    const res = applyChange(p, { target, after: '{"name":"NewTown"}', expect: null })
    expect(res.ok).toBe(true)
    expect(JSON.parse(read('data/maps/NewTown/map.json')).name).toBe('NewTown')

    // The proposal expected to CREATE the map; an existing map.json collides.
    const conflict = applyChange(p, { target, after: '{"name":"NewTown"}', expect: null })
    expect(conflict.ok).toBe(false)
    expect(conflict.conflict).toBe(true)

    applyChange(p, { target, op: 'delete' })
    expect(fs.existsSync(path.join(ROOT, 'data/maps/NewTown'))).toBe(false)
  })

  it('map-create with width/height also writes a blank tilemap (revert still deletes the dir)', () => {
    const p = createProjectContext(ROOT)
    const target = { kind: 'map-create', map: 'BigTown', path: 'data/maps/BigTown/' } as const
    const res = applyChange(p, { target, after: '{"name":"BigTown","width":30,"height":20}', expect: null })
    expect(res.ok).toBe(true)
    expect(JSON.parse(read('data/maps/BigTown/map.json')).name).toBe('BigTown')
    const tmx = JSON.parse(read('data/maps/BigTown/map.tmx.json'))
    expect(tmx.width).toBe(30)
    expect(tmx.height).toBe(20)
    expect(tmx.tilewidth).toBe(16)
    expect(tmx.layers.map((l: any) => l.name)).toEqual(['ground', 'collision'])

    // Revert-of-create removes the whole map dir, tilemap included.
    applyChange(p, { target, op: 'delete' })
    expect(fs.existsSync(path.join(ROOT, 'data/maps/BigTown'))).toBe(false)
  })

  it('map-create without dimensions stays tilemap-less (legacy shape)', () => {
    const p = createProjectContext(ROOT)
    const target = { kind: 'map-create', map: 'Plain', path: 'data/maps/Plain/' } as const
    applyChange(p, { target, after: '{"name":"Plain"}', expect: null })
    expect(fs.existsSync(path.join(ROOT, 'data/maps/Plain/map.json'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/Plain/map.tmx.json'))).toBe(false)
    applyChange(p, { target, op: 'delete' })
  })

  it('rejects a map-create name that could escape mapsDir', () => {
    const p = createProjectContext(ROOT)
    expect(() => applyChange(p, { target: { kind: 'map-create', map: '../evil', path: '' }, after: '{}' })).toThrow()
  })
})

describe('applyChange — map-tilemap (delete / restore the authored tilemap)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04])

  function writeTilemapSet(name: string): { tmx: string; tiles: string } {
    write(`${name}/map.json`, JSON.stringify({ name: path.basename(name) }))
    const tmx = JSON.stringify({ width: 2, height: 2, layers: [{ name: 'ground', data: [1, 0, 0, 1] }] })
    const tiles = JSON.stringify({ tiles: [{ id: 1 }] })
    write(`${name}/map.tmx.json`, tmx)
    fs.writeFileSync(path.join(ROOT, name, 'tileset.png'), PNG)
    write(`${name}/tileset.tiles.json`, tiles)
    return { tmx, tiles }
  }

  it('deletes the tmx + per-map tileset set but keeps the map itself', () => {
    const p = createProjectContext(ROOT)
    const { tmx } = writeTilemapSet('data/maps/TileTown')
    const del = applyChange(p, { target: { kind: 'map-tilemap', map: 'TileTown', path: 'data/maps/TileTown/map.tmx.json' }, op: 'delete', expect: tmx })
    expect(del.ok).toBe(true)
    expect(del.path).toBe('data/maps/TileTown/map.tmx.json')
    // The tilemap artifact set is gone…
    expect(fs.existsSync(path.join(ROOT, 'data/maps/TileTown/map.tmx.json'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/TileTown/tileset.png'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/TileTown/tileset.tiles.json'))).toBe(false)
    // …but the map dir + map.json survive.
    expect(JSON.parse(read('data/maps/TileTown/map.json')).name).toBe('TileTown')
    // The backup carries the WHOLE set (tmx + base64 png + tiles) for Revert.
    const b = JSON.parse(del.backup!)
    expect(b.tmx).toBe(tmx)
    expect(Buffer.from(b.tilesetPng, 'base64')).toEqual(PNG)
    expect(b.tiles).toContain('"id":1')
  })

  it('restores the whole set on revert (write with the backup payload)', () => {
    const p = createProjectContext(ROOT)
    const { tmx } = writeTilemapSet('data/maps/RestoreTown')
    const del = applyChange(p, { target: { kind: 'map-tilemap', map: 'RestoreTown', path: '' }, op: 'delete', expect: tmx })
    // Revert sends `after` = the delete's backup (the client's revert path).
    const rev = applyChange(p, { target: { kind: 'map-tilemap', map: 'RestoreTown', path: '' }, after: del.backup! })
    expect(rev.ok).toBe(true)
    expect(read('data/maps/RestoreTown/map.tmx.json')).toBe(tmx)
    expect(fs.readFileSync(path.join(ROOT, 'data/maps/RestoreTown/tileset.png'))).toEqual(PNG)
    expect(read('data/maps/RestoreTown/tileset.tiles.json')).toContain('"id":1')
  })

  it('refuses a stale delete when the tmx drifted from `expect`, and honors force', () => {
    const p = createProjectContext(ROOT)
    const { tmx } = writeTilemapSet('data/maps/DriftTown')
    // The proposal was built against the original tmx; it has since changed.
    write('data/maps/DriftTown/map.tmx.json', JSON.stringify({ width: 9, layers: [] }))
    const target = { kind: 'map-tilemap', map: 'DriftTown', path: '' } as const
    const conflict = applyChange(p, { target, op: 'delete', expect: tmx })
    expect(conflict.ok).toBe(false)
    expect(conflict.conflict).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/DriftTown/map.tmx.json'))).toBe(true) // NOT deleted
    const forced = applyChange(p, { target, op: 'delete', expect: tmx, force: true })
    expect(forced.ok).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/DriftTown/map.tmx.json'))).toBe(false)
  })

  it('throws when the map has no tilemap, and never deletes a map without the tmx', () => {
    const p = createProjectContext(ROOT)
    write('data/maps/BareTown/map.json', '{"name":"BareTown"}')
    expect(() => applyChange(p, { target: { kind: 'map-tilemap', map: 'BareTown', path: '' }, op: 'delete' })).toThrow(/no tilemap/)
    expect(fs.existsSync(path.join(ROOT, 'data/maps/BareTown'))).toBe(true)
    expect(() => applyChange(p, { target: { kind: 'map-tilemap', map: '../evil', path: '' }, op: 'delete' })).toThrow()
  })
})
