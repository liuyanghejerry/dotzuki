// ───────────────────────────────────────────────────────────────────────────
// Project create/scaffold tests — drive the real route handlers through a
// minimal mock of the connect `server.middlewares.use` surface, with the
// project root pinned to a fresh temp dir per test (setProjectRootDir, not
// DOTZUKI_PROJECT_ROOT, which projectConfig reads only once at module load).
// ───────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { PNG } from 'pngjs'
import { registerProject } from './project'
import { getProjectRoot, setProjectRootDir } from '../projectConfig'

type Handler = (req: any, res: any) => unknown

function makeServer() {
  const routes = new Map<string, Handler>()
  return {
    routes,
    middlewares: { use(route: string, fn: Handler) { routes.set(route, fn) } },
  }
}

function mockReq(method: string, body?: unknown, url = '/') {
  const req = new Readable({ read() {} }) as any
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  if (body !== undefined) req.push(JSON.stringify(body))
  req.push(null)
  return req
}

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(status: number) { res.status = status },
    end(chunk?: string) { res.body = chunk ?? '' },
    json() { return JSON.parse(res.body) },
  }
  return res
}

async function call(routes: Map<string, Handler>, route: string, req: any) {
  const handler = routes.get(route)!
  const res = mockRes()
  await handler(req, res)
  return res
}

let ROOT = ''

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-create-'))
  setProjectRootDir(ROOT)
})

afterEach(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* ignore */ }
})

async function createProject(body: unknown) {
  const server = makeServer()
  registerProject(server)
  return call(server.routes, '/api/project/create', mockReq('POST', body))
}

function readConfig(target: string) {
  return JSON.parse(fs.readFileSync(path.join(target, '.dotzuki-editor.json'), 'utf-8'))
}

/** A seeded record must have every required field, and select values must
 *  come from the schema's options. */
function assertRecordMatchesSchema(rec: any, table: any) {
  expect(table, 'table schema').toBeDefined()
  for (const field of table.fields) {
    if (field.required) expect(rec[field.key], `${table.id}.${field.key}`).toBeDefined()
    if (field.type === 'select' && rec[field.key] !== undefined) {
      expect(field.options, `${table.id}.${field.key}`).toContain(rec[field.key])
    }
  }
  expect(typeof rec[table.idField]).toBe('string')
}

describe('POST /api/project/create', () => {
  it.each(['empty', 'wuxia', 'dotzuki'])('scaffolds the %s template by id', async (id) => {
    const res = await createProject({ name: 'My Game', template: id, dir: `game-${id}` })
    expect(res.status).toBe(200)
    const target = path.join(ROOT, `game-${id}`)
    // Creating switches the editor's project root to the new project.
    expect(getProjectRoot()).toBe(target)

    const cfg = readConfig(target)
    expect(cfg.name).toBe('My Game')
    // Scripts use the .scene DSL; the tiles activity backs the map editor.
    const script = cfg.activities.find((a: any) => a.type === 'script')
    expect(script.config.extension).toBe('.scene')
    const tiles = cfg.activities.find((a: any) => a.type === 'tiles')
    expect(tiles.config.tilesDir).toBe('tiles')
    // Every template gets the Story Designer activity.
    const story = cfg.activities.find((a: any) => a.type === 'story')
    expect(story).toBeDefined()
    expect(story.config).toEqual({ storiesDir: 'stories', scenesDir: 'maps', locales: ['en', 'zh'] })

    // Starter content, and NO Rust scaffolding.
    expect(fs.existsSync(path.join(target, 'assets', 'scenes', 'main.scene'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'Cargo.toml'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'src', 'main.rs'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'data', 'maps'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'gfx'))).toBe(true)
  })

  it.each(['empty', 'wuxia', 'dotzuki'])('scaffolds the StartTown demo map for %s', async (id) => {
    const res = await createProject({ name: 'Demo', template: id, dir: `demo-${id}` })
    expect(res.status).toBe(200)
    const mapDir = path.join(ROOT, `demo-${id}`, 'data', 'maps', 'StartTown')
    for (const f of ['map.tmx.json', 'map.json', 'script.scene', 'tileset.png', 'tileset.tiles.json']) {
      expect(fs.existsSync(path.join(mapDir, f)), f).toBe(true)
    }
    // The Scripts pane lists per-map scenes under data/maps/.
    const scene = fs.readFileSync(path.join(mapDir, 'script.scene'), 'utf-8')
    expect(scene).toContain('game_scene StartTown')

    const meta = JSON.parse(fs.readFileSync(path.join(mapDir, 'map.json'), 'utf-8'))
    expect(meta).toMatchObject({ name: 'StartTown', warps: [], npcs: [] })
    // The signpost tile at (13,9) gets a demo sign (face it, press A to read).
    expect(meta.signs).toEqual([{ x: 13, y: 9, text: 'StartTown — population: you (for now)' }])

    // TMX shape matches what POST /api/maps-create-tmx writes.
    const tmx = JSON.parse(fs.readFileSync(path.join(mapDir, 'map.tmx.json'), 'utf-8'))
    expect(tmx.tilewidth).toBe(16)
    expect(tmx.tileheight).toBe(16)
    expect(tmx.layers.map((l: any) => l.name)).toEqual(['ground', 'collision'])
    for (const layer of tmx.layers) {
      expect(layer.data.length).toBe(tmx.width * tmx.height)
    }
    // Ground tiles reference the starter tileset (1-based, 16 tiles).
    for (const id of tmx.layers[0].data) {
      expect(id).toBeGreaterThanOrEqual(1)
      expect(id).toBeLessThanOrEqual(16)
    }

    // The map canvas loads /api/maps/<name>/tileset.png — a real 128×32 PNG.
    const png = PNG.sync.read(fs.readFileSync(path.join(mapDir, 'tileset.png')))
    expect(png.width).toBe(128)
    expect(png.height).toBe(32)

    // The shared tile library is seeded and the map's tileset references it.
    const lib = JSON.parse(fs.readFileSync(path.join(ROOT, `demo-${id}`, 'data', 'tiles', 'library.json'), 'utf-8'))
    expect(lib.tiles).toHaveLength(16)
    const tilesetRef = JSON.parse(fs.readFileSync(path.join(mapDir, 'tileset.tiles.json'), 'utf-8'))
    expect(tilesetRef.tileIds).toEqual(lib.tiles.map((t: any) => t.id))
  })

  it.each(['empty', 'wuxia', 'dotzuki'])('returns the complete written file list for %s', async (id) => {
    const res = await createProject({ name: 'Files', template: id, dir: `files-${id}` })
    expect(res.status).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.files)).toBe(true)
    expect(body.files).toEqual([...body.files].sort())
    expect(body.files).toContain('.dotzuki-editor.json')
    expect(body.files).toContain(path.join('data', 'maps', 'StartTown', 'tileset.png'))

    // Completeness: every file on disk is reported, and every reported file exists.
    const target = path.join(ROOT, `files-${id}`)
    const onDisk: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else onDisk.push(path.relative(target, full))
      }
    }
    walk(target)
    expect([...body.files].sort()).toEqual(onDisk.sort())
  })

  it('jrpg template seeds sample records that satisfy their table schemas', async () => {
    const res = await createProject({ name: 'Jrpg', template: 'dotzuki', dir: 'jrpg-rec' })
    expect(res.status).toBe(200)
    const target = path.join(ROOT, 'jrpg-rec')
    const cfg = readConfig(target)
    const tables = cfg.activities.find((a: any) => a.type === 'data').config.tables

    for (const [tableId, file] of [['heroes', 'aria.json'], ['heroes', 'bryn.json'], ['monsters', 'slime.json'], ['items', 'potion.json'], ['encounters', 'bug-catcher.json']]) {
      const recPath = path.join(target, 'data', tableId, file as string)
      expect(fs.existsSync(recPath), recPath).toBe(true)
      const rec = JSON.parse(fs.readFileSync(recPath, 'utf-8'))
      assertRecordMatchesSchema(rec, tables.find((t: any) => t.id === tableId))
    }
    expect(JSON.parse(fs.readFileSync(path.join(target, 'data', 'heroes', 'aria.json'), 'utf-8'))).toMatchObject({
      id: 'aria', name: 'Aria', job: 'Warrior', ability: 'intimidate',
    })
    expect(JSON.parse(fs.readFileSync(path.join(target, 'data', 'heroes', 'bryn.json'), 'utf-8'))).toMatchObject({
      id: 'bryn', name: 'Bryn', job: 'Mage', element: 'Fire', skills: ['fire-bolt', 'slash'], heldItem: 'leftovers',
    })
    expect(JSON.parse(fs.readFileSync(path.join(target, 'data', 'items', 'leftovers.json'), 'utf-8'))).toMatchObject({
      id: 'leftovers', name: 'Leftovers', healHp: 0,
    })
  })

  it('jrpg template is battle-ready: battle section, skills, spells, rules.ron', async () => {
    const res = await createProject({ name: 'Battle', template: 'dotzuki', dir: 'jrpg-battle' })
    expect(res.status).toBe(200)
    const target = path.join(ROOT, 'jrpg-battle')
    const cfg = readConfig(target)

    // Manifest battle section wires the declared tables (defaults cover the
    // stat/skill field names — `dotzuki check` validates these against schemas).
    expect(cfg.battle).toMatchObject({
      party: { table: 'heroes' },
      enemies: { table: 'monsters' },
      encounters: { table: 'encounters' },
      skills: { table: 'spells' },
      resource: 'mp',
      rules: 'data/rules.ron',
      items: { table: 'items', healField: 'healHp', starting: { potion: 3 } },
      // EXP/level growth out of the box (the spec's defaults): the seeded
      // Slime's `exp` pays out on a win; heroes have no `level` field ⇒ 1.
      levels: {
        expField: 'exp',
        levelField: 'level',
        curve: { base: 8, exponent: 3 },
        growth: 0.05,
        maxLevel: 100,
      },
    })
    // Shop section: the seeded Potion (price 20) is buyable on day one.
    expect(cfg.shop).toMatchObject({ currency: 'G', startMoney: 100 })

    // Combatants carry skill lists; the skills table has the referenced spells.
    const tables = cfg.activities.find((a: any) => a.type === 'data').config.tables
    const aria = JSON.parse(fs.readFileSync(path.join(target, 'data', 'heroes', 'aria.json'), 'utf-8'))
    const bryn = JSON.parse(fs.readFileSync(path.join(target, 'data', 'heroes', 'bryn.json'), 'utf-8'))
    const slime = JSON.parse(fs.readFileSync(path.join(target, 'data', 'monsters', 'slime.json'), 'utf-8'))
    expect(aria.skills).toEqual(['slash', 'fire-bolt'])
    expect(bryn.skills).toEqual(['fire-bolt', 'slash'])
    expect(slime.skills).toEqual(['tackle', 'venom-sting'])
    // The levels block's fields: the Slime pays 8 EXP; heroes start at
    // level 1 (no `level` field on their records).
    expect(slime.exp).toBe(8)
    expect(aria.level).toBeUndefined()
    expect(bryn.level).toBeUndefined()
    // RON hooks (v2-e): Aria's ability and Bryn's held item name rules.ron
    // records; the heroes schema declares both fields.
    expect(aria.ability).toBe('intimidate')
    expect(bryn.heldItem).toBe('leftovers')
    const heroesTable = tables.find((t: any) => t.id === 'heroes')
    expect(heroesTable.fields.map((f: any) => f.key)).toEqual(
      expect.arrayContaining(['ability', 'heldItem']),
    )
    // The encounters table declares the `enemies` list the battle section
    // points at, and the seeded Bug Catcher demonstrates the trainer path.
    const encountersTable = tables.find((t: any) => t.id === 'encounters')
    expect(encountersTable.fields.map((f: any) => f.key)).toEqual(
      expect.arrayContaining(['id', 'name', 'enemies', 'trainer', 'money']),
    )
    const bugCatcher = JSON.parse(
      fs.readFileSync(path.join(target, 'data', 'encounters', 'bug-catcher.json'), 'utf-8'),
    )
    expect(bugCatcher).toMatchObject({
      id: 'bug-catcher', name: 'Bug Catcher', enemies: ['slime'], trainer: true, money: 32,
    })
    assertRecordMatchesSchema(bugCatcher, encountersTable)
    // The items table declares the heal field the battle section points at,
    // and the seeded Potion is battle-usable (healHp > 0).
    const itemsTable = tables.find((t: any) => t.id === 'items')
    expect(itemsTable.fields.map((f: any) => f.key)).toContain('healHp')
    const potion = JSON.parse(fs.readFileSync(path.join(target, 'data', 'items', 'potion.json'), 'utf-8'))
    expect(potion).toMatchObject({ id: 'potion', healHp: 50 })
    assertRecordMatchesSchema(potion, itemsTable)
    const spellsTable = tables.find((t: any) => t.id === 'spells')
    for (const f of ['slash.json', 'fire-bolt.json', 'tackle.json', 'venom-sting.json']) {
      const rec = JSON.parse(fs.readFileSync(path.join(target, 'data', 'spells', f), 'utf-8'))
      assertRecordMatchesSchema(rec, spellsTable)
    }
    const venomSting = JSON.parse(fs.readFileSync(path.join(target, 'data', 'spells', 'venom-sting.json'), 'utf-8'))
    expect(venomSting).toMatchObject({ id: 'venom-sting', type: 'Attack', power: 15 })

    // The rules file declares the hook vocabularies and demonstrates live
    // RON effect hooks: venom-sting (Move, 30% poison on hit) + poison
    // (Status, residual 1/8 max-HP chip).
    const rules = fs.readFileSync(path.join(target, 'data', 'rules.ron'), 'utf-8')
    expect(rules).toContain('Ruleset(')
    expect(rules).toContain('type_chart')
    expect(rules).toContain('stats: ["hp", "attack", "defense", "speed"]')
    expect(rules).toContain('resources: ["mp"]')
    expect(rules).toContain('Effect(id: "venom-sting", kind: Move')
    expect(rules).toContain('Hook(on: "DamagingHit", chance: [30, 100]')
    expect(rules).toContain('InflictStatus(status: "poison", target: Target)')
    expect(rules).toContain('Effect(id: "poison", kind: Status')
    expect(rules).toContain('Hook(on: "Residual"')
    // Ability / held-item / weather records (v2-e): intimidate (SwitchIn −1
    // foe attack), leftovers (Residual 1/16 heal), sandstorm (FieldResidual
    // 1/16 chip, armed by game.setWeather).
    expect(rules).toContain('Effect(id: "intimidate", kind: Ability')
    expect(rules).toContain('Hook(on: "SwitchIn"')
    expect(rules).toContain('Boost(stat: "attack", stages: -1, target: Foe)')
    expect(rules).toContain('Effect(id: "leftovers", kind: Item')
    expect(rules).toContain('HealFraction(num: 1, den: 16, of: MaxHp, target: Target)')
    expect(rules).toContain('Effect(id: "sandstorm", kind: Weather')
    expect(rules).toContain('Hook(on: "FieldResidual"')
  })

  it('wuxia template seeds sample records that satisfy their table schemas', async () => {
    const res = await createProject({ name: 'Wuxia', template: 'wuxia', dir: 'wuxia-rec' })
    expect(res.status).toBe(200)
    const target = path.join(ROOT, 'wuxia-rec')
    const cfg = readConfig(target)
    const tables = cfg.activities.find((a: any) => a.type === 'data').config.tables

    for (const [tableId, file] of [['characters', 'shen-qing.json'], ['skills', 'taiji-sword.json']]) {
      const recPath = path.join(target, 'data', tableId, file as string)
      expect(fs.existsSync(recPath), recPath).toBe(true)
      const rec = JSON.parse(fs.readFileSync(recPath, 'utf-8'))
      assertRecordMatchesSchema(rec, tables.find((t: any) => t.id === tableId))
    }
  })

  it.each(['wuxia', 'dotzuki'])('seeds the story bible for %s', async (id) => {
    const res = await createProject({ name: 'Story', template: id, dir: `story-${id}` })
    expect(res.status).toBe(200)
    const storiesDir = path.join(ROOT, `story-${id}`, 'data', 'stories')

    const character = JSON.parse(fs.readFileSync(path.join(storiesDir, 'characters', 'elder-mira.json'), 'utf-8'))
    expect(character.id).toBe('elder-mira')
    expect(character.name.en).toBeTruthy()
    expect(character.name.zh).toBeTruthy()
    expect(character.status).toBe('drafted')

    const quest = JSON.parse(fs.readFileSync(path.join(storiesDir, 'quests', 'welcome-to-starttown.json'), 'utf-8'))
    expect(quest.type).toBe('main')
    expect(quest.objectives.length).toBeGreaterThanOrEqual(1)
    for (const obj of quest.objectives) {
      expect(obj.text.en).toBeTruthy()
      expect(obj.text.zh).toBeTruthy()
    }
    // Linked to the demo scene (map rename tooling rewrites implementedBy[].scene).
    expect(quest.implementedBy).toEqual([{ scene: 'StartTown', storyline: 'StartTown' }])

    expect(JSON.parse(fs.readFileSync(path.join(storiesDir, 'graph.json'), 'utf-8'))).toEqual({ edges: [] })
  })

  it('empty template gets the stories/ dir but no story seeds', async () => {
    const res = await createProject({ name: 'Empty', template: 'empty', dir: 'empty-story' })
    expect(res.status).toBe(200)
    const storiesDir = path.join(ROOT, 'empty-story', 'data', 'stories')
    expect(fs.existsSync(storiesDir)).toBe(true)
    expect(fs.existsSync(path.join(storiesDir, 'graph.json'))).toBe(false)
    expect(fs.readdirSync(path.join(storiesDir, 'characters'))).toEqual([])
  })

  it('wuxia template seeds its data tables', async () => {
    const res = await createProject({ name: 'Wuxia', template: 'wuxia', dir: 'wuxia-game' })
    expect(res.status).toBe(200)
    const target = path.join(ROOT, 'wuxia-game')
    const cfg = readConfig(target)
    const data = cfg.activities.find((a: any) => a.type === 'data')
    expect(data.config.tables.map((t: any) => t.id)).toEqual(['characters', 'skills', 'items', 'status'])
    expect(fs.existsSync(path.join(target, 'data', 'characters'))).toBe(true)
  })

  it('rejects a template NAME (the old wizard payload) with 400', async () => {
    const res = await createProject({ name: 'My Game', template: 'Empty Project', dir: 'game-x' })
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('Unknown template')
  })

  it('rejects an invalid directory name with 400', async () => {
    const res = await createProject({ name: 'My Game', template: 'empty', dir: 'Bad Dir!' })
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('Invalid directory name')
  })

  it('rejects a non-empty target directory with 409', async () => {
    const target = path.join(ROOT, 'occupied')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'keep.txt'), 'hi')
    const res = await createProject({ name: 'My Game', template: 'empty', dir: 'occupied' })
    expect(res.status).toBe(409)
    // The existing directory is left untouched.
    expect(fs.existsSync(path.join(target, '.dotzuki-editor.json'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true)
  })

  it('scaffolds into an existing EMPTY directory', async () => {
    fs.mkdirSync(path.join(ROOT, 'empty-dir'), { recursive: true })
    const res = await createProject({ name: 'My Game', template: 'empty', dir: 'empty-dir' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(ROOT, 'empty-dir', '.dotzuki-editor.json'))).toBe(true)
  })

  it('accepts an absolute directory path (Electron folder picker)', async () => {
    const target = path.join(ROOT, 'abs-game')
    const res = await createProject({ name: 'Abs Game', template: 'empty', dir: target })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(target, '.dotzuki-editor.json'))).toBe(true)
    expect(getProjectRoot()).toBe(target)
  })

  it('derives the directory from the game name when dir is omitted', async () => {
    const res = await createProject({ name: 'My Cool Game', template: 'empty' })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(ROOT, 'my-cool-game', '.dotzuki-editor.json'))).toBe(true)
  })
})

describe('GET /api/project/templates', () => {
  it('localizes name/description via ?lang= and falls back to English', async () => {
    const server = makeServer()
    registerProject(server)

    const zh = await call(server.routes, '/api/project/templates', mockReq('GET', undefined, '/?lang=zh'))
    const zhList = zh.json()
    expect(zhList.map((t: any) => t.id)).toEqual(['empty', 'wuxia', 'dotzuki'])
    expect(zhList[0].name).toBe('空白项目')

    const en = await call(server.routes, '/api/project/templates', mockReq('GET'))
    expect(en.json()[0].name).toBe('Empty Project')

    const fr = await call(server.routes, '/api/project/templates', mockReq('GET', undefined, '/?lang=fr'))
    expect(fr.json()[0].name).toBe('Empty Project')
  })
})

describe('GET /api/project/root', () => {
  it('always reports the current project root', async () => {
    const server = makeServer()
    registerProject(server)
    const res = await call(server.routes, '/api/project/root', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json().projectRoot).toBe(ROOT)
  })
})
