// ───────────────────────────────────────────────────────────────────────────
// Starter content — the demo files every freshly scaffolded project gets.
//
// Pure generators (no fs): each function returns project-relative path +
// content, and scaffold.ts writes them and reports the file list. Everything
// is deterministic — no RNG, no timestamps.
//
// The demo map StartTown ships with its own procedurally generated tileset:
//   - data/maps/StartTown/tileset.png is what the map editor actually renders
//     (MapActivity loads `/api/maps/<name>/tileset.png`; map.tmx.json tile ids
//     are 1-based slots into that atlas).
//   - data/tiles/library.json + t####.png seed the shared tile library so the
//     Tiles activity isn't empty and the tiles are harvestable; the map's
//     tileset.tiles.json references them so the atlas stays rebuildable.
// ───────────────────────────────────────────────────────────────────────────
import path from 'path'
import { PNG } from 'pngjs'

export interface StarterFile {
  /** Project-relative path (uses the platform separator via path.join). */
  rel: string
  content: string | Buffer
}

// ── Starter tileset ─────────────────────────────────────────────────────────

const T = 16 // tile size in pixels
const COLS = 8
const ROWS = 2

type RGB = [number, number, number]
type SetPx = (x: number, y: number, c: RGB) => void

/** Deterministic speckle hash — stable per (x, y), no RNG. */
function hash(x: number, y: number): number {
  return (x * 7 + y * 13 + x * y * 3) >>> 0
}

const GRASS: RGB = [0x4c, 0xa6, 0x52]
const GRASS_DARK: RGB = [0x3e, 0x92, 0x46]
const GRASS_LIGHT: RGB = [0x64, 0xba, 0x66]
const BROWN: RGB = [0x8a, 0x64, 0x38]
const BROWN_DARK: RGB = [0x5c, 0x3c, 0x20]

function fillGrass(set: SetPx): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const h = hash(x, y)
      set(x, y, h % 9 === 0 ? GRASS_DARK : h % 11 === 0 ? GRASS_LIGHT : GRASS)
    }
  }
}

function fillSolid(set: SetPx, base: RGB, speck: RGB, mod: number): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) set(x, y, hash(x, y) % mod === 0 ? speck : base)
  }
}

function circle(set: SetPx, cx: number, cy: number, r: number, c: RGB): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r) set(x, y, c)
    }
  }
}

function rect(set: SetPx, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) set(x, y, c)
  }
}

function fillWall(set: SetPx): void {
  const base: RGB = [0xd8, 0xc8, 0xa8]
  const mortar: RGB = [0xb0, 0x9d, 0x7c]
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const horizontal = y % 4 === 3
      const vertical = (x + ((y >> 2) & 1) * 4) % 8 === 0
      set(x, y, horizontal || vertical ? mortar : base)
    }
  }
}

interface StarterTile {
  name: string
  draw: (set: SetPx) => void
}

/** Tile slots in atlas order; map.tmx.json references them 1-based (slot + 1). */
const STARTER_TILES: StarterTile[] = [
  { name: 'grass', draw: set => fillGrass(set) },
  { name: 'flowers', draw: set => {
      fillGrass(set)
      const blooms: [number, number, RGB][] = [
        [3, 4, [0xe0, 0x48, 0x48]],
        [11, 9, [0xf0, 0xf0, 0xe8]],
        [6, 13, [0xf0, 0xd0, 0x40]],
      ]
      for (const [bx, by, petal] of blooms) {
        set(bx, by, petal); set(bx + 1, by, petal); set(bx, by + 1, petal); set(bx + 1, by + 1, petal)
      }
    } },
  { name: 'path', draw: set => fillSolid(set, [0xc2, 0xa0, 0x6b], [0xa8, 0x87, 0x4f], 7) },
  { name: 'water', draw: set => {
      const base: RGB = [0x3d, 0x7d, 0xe0]
      const wave: RGB = [0x6a, 0xa2, 0xf0]
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          set(x, y, (y === 4 || y === 11) && x % 6 < 3 ? wave : base)
        }
      }
    } },
  { name: 'tree', draw: set => {
      fillGrass(set)
      circle(set, 7.5, 6, 7, [0x1e, 0x6b, 0x2f])
      circle(set, 7.5, 6, 5.5, [0x27, 0x7d, 0x38])
      circle(set, 6, 4.5, 2.5, [0x2f, 0x8f, 0x42])
      rect(set, 7, 12, 8, 15, [0x6b, 0x4a, 0x2b])
    } },
  { name: 'rock', draw: set => {
      fillSolid(set, [0x77, 0x77, 0x80], [0x6a, 0x6a, 0x74], 13)
      for (let y = 3; y < T; y++) {
        for (let x = 0; x < T; x++) {
          if (Math.abs(x - 7.5) <= (y - 3) * 0.75) set(x, y, y <= 6 ? [0xee, 0xee, 0xf2] : [0x9a, 0x9a, 0xa2])
        }
      }
    } },
  { name: 'sand', draw: set => fillSolid(set, [0xe0, 0xcf, 0x92], [0xcc, 0xb4, 0x74], 9) },
  { name: 'bush', draw: set => {
      fillGrass(set)
      circle(set, 7.5, 9, 5, [0x1e, 0x6b, 0x2f])
      circle(set, 7.5, 9, 3.8, [0x2f, 0x8f, 0x42])
    } },
  { name: 'wall', draw: set => fillWall(set) },
  { name: 'roof', draw: set => {
      const base: RGB = [0xb0, 0x48, 0x3c]
      const seam: RGB = [0x8c, 0x36, 0x2e]
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) set(x, y, y % 4 === 3 ? seam : base)
      }
    } },
  { name: 'door', draw: set => {
      fillWall(set)
      rect(set, 4, 3, 11, 15, BROWN_DARK)
      rect(set, 5, 4, 10, 15, [0x7a, 0x52, 0x2e])
      set(9, 10, [0xd8, 0xb8, 0x58])
    } },
  { name: 'window', draw: set => {
      fillWall(set)
      rect(set, 3, 4, 12, 11, BROWN)
      rect(set, 4, 5, 11, 10, [0x8f, 0xc8, 0xe8])
      rect(set, 7, 5, 8, 10, BROWN)
      rect(set, 4, 7, 11, 8, BROWN)
    } },
  { name: 'fence', draw: set => {
      fillGrass(set)
      rect(set, 0, 6, 15, 7, BROWN)
      rect(set, 0, 11, 15, 12, BROWN)
      rect(set, 2, 4, 3, 15, BROWN_DARK)
      rect(set, 12, 4, 13, 15, BROWN_DARK)
    } },
  { name: 'sign', draw: set => {
      fillGrass(set)
      rect(set, 7, 8, 8, 15, [0x6b, 0x4a, 0x2b])
      rect(set, 3, 2, 12, 8, BROWN_DARK)
      rect(set, 4, 3, 11, 7, BROWN)
    } },
  { name: 'wood', draw: set => {
      const base: RGB = [0xa9, 0x7c, 0x4f]
      const seam: RGB = [0x86, 0x5e, 0x3a]
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) set(x, y, x % 4 === 3 ? seam : base)
      }
    } },
  { name: 'flower', draw: set => {
      fillGrass(set)
      rect(set, 7, 8, 8, 14, [0x2f, 0x8f, 0x42])
      circle(set, 7.5, 5.5, 3, [0xf0, 0xf0, 0xe8])
      circle(set, 7.5, 5.5, 1.2, [0xf0, 0xd0, 0x40])
    } },
]

/** Library ids (t0001…) in the same order as STARTER_TILES. */
export const STARTER_TILE_IDS = STARTER_TILES.map((_, i) => `t${String(i + 1).padStart(4, '0')}`)

function encodePng(width: number, height: number, data: Uint8ClampedArray): Buffer {
  const png = new PNG({ width, height })
  png.data = Buffer.from(data)
  return PNG.sync.write(png)
}

function renderTile(tile: StarterTile): Buffer {
  const data = new Uint8ClampedArray(T * T * 4)
  tile.draw((x, y, c) => {
    const i = (y * T + x) * 4
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255
  })
  return encodePng(T, T, data)
}

function renderAtlas(): Buffer {
  const w = COLS * T
  const h = ROWS * T
  const data = new Uint8ClampedArray(w * h * 4)
  STARTER_TILES.forEach((tile, slot) => {
    const ox = (slot % COLS) * T
    const oy = Math.floor(slot / COLS) * T
    tile.draw((x, y, c) => {
      const i = ((oy + y) * w + (ox + x)) * 4
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255
    })
  })
  return encodePng(w, h, data)
}

// ── Demo map: StartTown (24×20) ──────────────────────────────────────────────

export const START_MAP = 'StartTown'
const MAP_W = 24
const MAP_H = 20

/** 1-based tile ids, matching STARTER_TILES slots. */
const ID = {
  grass: 1, flowers: 2, path: 3, water: 4, tree: 5, rock: 6, sand: 7, bush: 8,
  wall: 9, roof: 10, door: 11, window: 12, fence: 13, sign: 14, wood: 15, flower: 16,
} as const

/** Tiles the player can't walk through (collision layer = 1). */
const SOLID: Set<number> = new Set([ID.water, ID.tree, ID.rock, ID.bush, ID.wall, ID.roof, ID.door, ID.window, ID.fence, ID.sign])

function startTownLayers(): { ground: number[]; collision: number[] } {
  const ground = new Array<number>(MAP_W * MAP_H).fill(ID.grass)
  const put = (x: number, y: number, id: number) => { ground[y * MAP_W + x] = id }
  const fillRect = (x0: number, y0: number, x1: number, y1: number, id: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, id)
  }

  // Tree border, with a north and a south exit on the main street (x = 11, 12).
  for (let x = 0; x < MAP_W; x++) {
    const exit = x === 11 || x === 12
    put(x, 0, exit ? ID.path : ID.tree)
    put(x, MAP_H - 1, exit ? ID.path : ID.tree)
  }
  for (let y = 1; y < MAP_H - 1; y++) { put(0, y, ID.tree); put(MAP_W - 1, y, ID.tree) }

  // Pond with a sandy shore, top-right.
  fillRect(16, 2, 22, 7, ID.sand)
  fillRect(17, 3, 21, 6, ID.water)

  // A small house, west of the main street.
  fillRect(4, 3, 7, 4, ID.roof)
  fillRect(4, 5, 7, 5, ID.wall)
  put(4, 5, ID.window); put(7, 5, ID.window); put(5, 5, ID.door)

  // Streets: vertical main street, horizontal cross street, path to the door.
  fillRect(11, 1, 12, MAP_H - 2, ID.path)
  fillRect(1, 10, MAP_W - 2, 10, ID.path)
  fillRect(5, 6, 5, 9, ID.path)

  // Wooden plaza with a signpost at the crossroads.
  fillRect(14, 12, 15, 13, ID.wood)
  put(13, 9, ID.sign)

  // A fenced flower garden, a rock cluster, a few bushes.
  fillRect(2, 13, 6, 13, ID.flower)
  fillRect(2, 14, 6, 14, ID.fence)
  put(18, 14, ID.rock); put(19, 14, ID.rock); put(19, 15, ID.rock)
  put(3, 7, ID.bush); put(20, 9, ID.bush); put(9, 16, ID.bush); put(15, 5, ID.bush)

  // Scatter flower-grass on the remaining plain grass.
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (ground[y * MAP_W + x] === ID.grass && (x * 7 + y * 5) % 13 === 0) put(x, y, ID.flowers)
    }
  }

  return { ground, collision: ground.map(id => (SOLID.has(id) ? 1 : 0)) }
}

/** Same Tiled-JSON shape POST /api/maps-create-tmx writes. */
function startTownTmx(): string {
  const { ground, collision } = startTownLayers()
  const layer = (name: string, data: number[]) => ({
    name, width: MAP_W, height: MAP_H, visible: true, opacity: 1, type: 'tilelayer', data,
  })
  return JSON.stringify({
    width: MAP_W, height: MAP_H, tilewidth: T, tileheight: T,
    backgroundcolor: '#101014',
    layers: [layer('ground', ground), layer('collision', collision)],
  })
}

/** Map meta, mirroring the e2e fixture demo-game/data/maps/HomeTown/map.json. */
function startTownMeta(): string {
  return JSON.stringify({
    name: START_MAP, width: MAP_W, height: MAP_H, tileset: '', music: '',
    warps: [],
    // A demo sign on the signpost tile at (13,9): face it and press A to read.
    signs: [{ x: 13, y: 9, text: 'StartTown — population: you (for now)' }],
    npcs: [],
  }, null, 2)
}

// A short per-map scene in the Game DSL — same proven structure as MAIN_SCENE.
const START_TOWN_SCENE = `// script.scene — StartTown's map script, written in the jrpg Game DSL.
// It shows up in the Scripts pane (per-map scenes live next to their map).

game_scene StartTown {
    @storylines {
        @speaker("Guide") {
            "Welcome to StartTown!"
            "This little demo map is yours to reshape — paint it in the Maps pane."
            "Ask the AI assistant (✨) to grow the story from here."
        }
    }
}
`

// ── Sample data records (jrpg + wuxia templates) ─────────────────────────────

/** Records seeded per template, keyed by their table dir. Must satisfy the
 *  table schemas in scaffold.ts (all `required` fields; selects use `options`). */
const SAMPLE_RECORDS: Record<string, Record<string, Record<string, unknown>[]>> = {
  jrpg: {
    heroes: [{
      id: 'aria', name: 'Aria', job: 'Warrior',
      hp: 120, mp: 30, atk: 24, def: 18, spd: 12, element: 'Light',
      skills: ['slash', 'fire-bolt'], ability: 'intimidate',
    }, {
      id: 'bryn', name: 'Bryn', job: 'Mage',
      hp: 80, mp: 60, atk: 14, def: 12, spd: 10, element: 'Fire',
      skills: ['fire-bolt', 'slash'], heldItem: 'leftovers',
    }],
    monsters: [{
      id: 'slime', name: 'Slime',
      hp: 30, mp: 0, atk: 8, def: 4, spd: 3, element: 'None', exp: 8, gold: 4,
      skills: ['tackle', 'venom-sting'],
    }],
    // One seeded trainer encounter: `@command("startBattle", "bug-catcher")`
    // demonstrates the trainer path (Run blocked, pays money on a win) while
    // `startBattle("slime")` keeps the wild single-enemy path.
    encounters: [{
      id: 'bug-catcher', name: 'Bug Catcher', enemies: ['slime'], trainer: true, money: 32,
    }],
    spells: [
      { id: 'slash', name: 'Slash', type: 'Attack', element: 'None',
        power: 40, mpCost: 0, target: 'SingleEnemy', description: 'A reliable basic strike.' },
      { id: 'fire-bolt', name: 'Fire Bolt', type: 'Attack', element: 'Fire',
        power: 55, mpCost: 8, target: 'SingleEnemy', description: 'Hurls a bolt of flame. Strong against Ice.' },
      { id: 'tackle', name: 'Tackle', type: 'Attack', element: 'None',
        power: 30, mpCost: 0, target: 'SingleEnemy', description: 'A full-body lunge.' },
      { id: 'venom-sting', name: 'Venom Sting', type: 'Attack', element: 'None',
        power: 15, mpCost: 0, target: 'SingleEnemy', description: 'A weak jab that may poison (rules.ron hook).' },
    ],
    items: [{
      id: 'potion', name: 'Potion', type: 'Potion',
      healHp: 50, effect: 'Restores 50 HP', value: 50, price: 20,
    }, {
      // Bryn's held item (`heldItem` on his hero record): its rules.ron
      // `kind: Item` hook heals the holder 1/16 max HP after each of its
      // actions. healHp 0 ⇒ NOT battle-usable from the Item menu; held items
      // are persistent (never consumed).
      id: 'leftovers', name: 'Leftovers', type: 'Equipment',
      healHp: 0, effect: 'Holder restores 1/16 max HP after each of its actions (rules.ron hook).', value: 100, price: 50,
    }],
  },
  wuxia: {
    characters: [{
      id: 'shen-qing', name: 'Shen Qing', sect: 'Wudang',
      hp: 100, neigong: 60, waigong: 55, shenfa: 70, element: 'Wood',
      description: 'A wandering Wudang swordswoman who guides newcomers.',
    }],
    skills: [{
      id: 'taiji-sword', name: 'Taiji Sword', type: 'External', element: 'Wood',
      power: 35, cost: 12, accuracy: 95, target: 'SingleEnemy',
      description: 'A flowing sword form that turns force aside.',
    }],
  },
}

// ── Story seeds (jrpg + wuxia) ───────────────────────────────────────────────
// On-disk layout per src/types/story.ts + server/api/routes/stories.ts:
//   <storiesDir>/characters/<slug>.json  quests/<slug>.json  graph.json

const STORY_CHARACTER = {
  id: 'elder-mira',
  name: { en: 'Elder Mira', zh: '米拉长老' },
  role: 'mentor',
  tags: ['guide', 'starttown'],
  appearance: 'A silver-haired elder in a travel-worn cloak, leaning on a carved staff.',
  personality: 'Warm, patient, and fond of pointing newcomers toward their first step.',
  backstory: 'She founded StartTown decades ago and has greeted every traveller since.',
  motivation: 'Wants every new arrival to find their footing before the road calls them.',
  speechStyle: 'Gentle, unhurried, with the occasional proverb.',
  relationships: [],
  engine: { npcs: [], dataRef: null, spriteAsset: null },
  spriteSpec: null,
  status: 'drafted',
}

const STORY_QUEST = {
  id: 'welcome-to-starttown',
  title: { en: 'Welcome to StartTown', zh: '初临起始镇' },
  type: 'main',
  summary: 'Elder Mira greets the player and shows them around their new home town.',
  giver: 'elder-mira',
  characters: ['elder-mira'],
  maps: [START_MAP],
  objectives: [
    { id: 'meet-elder', text: { en: 'Meet Elder Mira by the crossroads.', zh: '在十字路口与米拉长老见面。' }, doneFlag: 'met_elder_mira' },
    { id: 'explore-town', text: { en: 'Look around StartTown.', zh: '四处看看起始镇。' }, doneFlag: 'explored_starttown' },
  ],
  requires: [],
  sets: ['quest_welcome_started'],
  rewards: [],
  implementedBy: [{ scene: START_MAP, storyline: START_MAP }],
  status: 'drafted',
}

const STORY_GRAPH = { edges: [] }

// Battle rules for the jrpg template (parsed by `jrpg run` via jrpg-rules;
// `jrpg check` validates the full closed vocabulary). Beyond the type chart,
// the `effects` records are LIVE: a `kind: Move` record takes over the skill
// of the same id (its hooks run through the engine's effect stack), a
// `kind: Status` record defines a status for `InflictStatus` ops, a
// `kind: Ability` record fires for the combatant whose record names it in
// `ability` (switch-in + per-action events), a `kind: Item` record for the
// holder named in `heldItem` (residual heal), and a `kind: Weather` record
// runs while a scene-armed weather is active. Naming conventions: `stats` =
// the manifest battle.stats keys, `resources` = the manifest battle.resource
// field name, `types` = the records' element strings.
const RULES_RON = `// rules.ron — battle rules in the jrpg-rules vocabulary.
// stats = the manifest battle.stats keys; resources = the battle.resource
// field name; types = the records' element strings. The effects below are
// LIVE: venom-sting's hooks run through the effect stack (30% poison on
// hit), and poison's Residual hook chips 1/8 max HP after each of the
// afflicted combatant's actions. Aria's ability (intimidate) fires on
// switch-in, Bryn's held item (leftovers) heals him after each of his
// actions, and a scene can arm the sandstorm weather with
// game.setWeather("sandstorm") before game.startBattle(...).
Ruleset(
    stats: ["hp", "attack", "defense", "speed"],
    types: ["Fire", "Ice", "Lightning", "Light", "Dark", "None"],
    resources: ["mp"],
    type_chart: [
        ( atk: "Fire",      def: "Ice",   mult: [2, 1] ),
        ( atk: "Ice",       def: "Fire",  mult: [2, 1] ),
        ( atk: "Light",     def: "Dark",  mult: [2, 1] ),
        ( atk: "Dark",      def: "Light", mult: [2, 1] ),
        ( atk: "Lightning", def: "Light", mult: [1, 2] ),
    ],
    effects: [
        // venom-sting takes over the spells table record of the same id:
        // 15 power, and a 30% chance to poison the target on hit.
        Effect(id: "venom-sting", kind: Move, power: 15, accuracy: 100, type: "None", hooks: [
            Hook(on: "DamagingHit", chance: [30, 100], do: [
                InflictStatus(status: "poison", target: Target),
            ]),
        ]),
        // poison: chips 1/8 of the holder's max HP after each of its actions.
        Effect(id: "poison", kind: Status, hooks: [
            Hook(on: "Residual", do: [
                DamageFraction(num: 1, den: 8, of: MaxHp, target: Target),
            ]),
        ]),
        // intimidate (Aria's ability): −1 attack stage to the foe at battle
        // start and on every switch-in of the ACTIVE combatant.
        Effect(id: "intimidate", kind: Ability, hooks: [
            Hook(on: "SwitchIn", do: [
                Boost(stat: "attack", stages: -1, target: Foe),
            ]),
        ]),
        // leftovers (Bryn's held item): heal 1/16 max HP after each of the
        // holder's actions. Held items are persistent — never consumed.
        Effect(id: "leftovers", kind: Item, hooks: [
            Hook(on: "Residual", do: [
                HealFraction(num: 1, den: 16, of: MaxHp, target: Target),
            ]),
        ]),
        // sandstorm weather: chips 1/16 max HP off every combatant each round
        // while active. Battle-local: a scene arms it with
        // game.setWeather("sandstorm") before game.startBattle(...) (and
        // game.clearWeather() cancels it); it ends with the battle.
        Effect(id: "sandstorm", kind: Weather, hooks: [
            Hook(on: "FieldResidual", do: [
                DamageFraction(num: 1, den: 16, of: MaxHp, target: Target),
            ]),
        ]),
    ],
)
`

// ── Assembly ─────────────────────────────────────────────────────────────────

/**
 * Every starter file for a scaffolded project (except .jrpg-editor.json and
 * README.md, which scaffold.ts writes itself). `dataRoot` is the manifest's
 * dataRoot ('./data' style is normalized away by path.join).
 */
export function starterFiles(templateId: string, dataRoot: string): StarterFile[] {
  const files: StarterFile[] = []
  const at = (...parts: string[]) => path.join(dataRoot, ...parts)

  // Demo map + its tileset and script (all templates, including `empty`).
  files.push(
    { rel: at('maps', START_MAP, 'map.tmx.json'), content: startTownTmx() },
    { rel: at('maps', START_MAP, 'map.json'), content: startTownMeta() },
    { rel: at('maps', START_MAP, 'script.scene'), content: START_TOWN_SCENE },
    { rel: at('maps', START_MAP, 'tileset.png'), content: renderAtlas() },
    {
      rel: at('maps', START_MAP, 'tileset.tiles.json'),
      content: JSON.stringify({ tileIds: STARTER_TILE_IDS, cols: COLS }, null, 2),
    },
  )

  // Shared tile library (same tiles, individually addressable).
  const library = {
    tiles: STARTER_TILES.map((t, i) => ({ id: STARTER_TILE_IDS[i], name: t.name, source: 'starter' })),
  }
  files.push({ rel: at('tiles', 'library.json'), content: JSON.stringify(library, null, 2) })
  STARTER_TILES.forEach((tile, i) => {
    files.push({ rel: at('tiles', `${STARTER_TILE_IDS[i]}.png`), content: renderTile(tile) })
  })

  // Sample data records + narrative bible seeds — game templates only.
  const records = SAMPLE_RECORDS[templateId]
  if (records) {
    for (const [dir, recs] of Object.entries(records)) {
      for (const rec of recs) {
        files.push({ rel: at(dir, `${rec.id as string}.json`), content: JSON.stringify(rec, null, 2) })
      }
    }
    files.push(
      { rel: at('stories', 'characters', 'elder-mira.json'), content: JSON.stringify(STORY_CHARACTER, null, 2) },
      { rel: at('stories', 'quests', 'welcome-to-starttown.json'), content: JSON.stringify(STORY_QUEST, null, 2) },
      { rel: at('stories', 'graph.json'), content: JSON.stringify(STORY_GRAPH, null, 2) },
    )
    // The jrpg template's manifest battle section points at data/rules.ron.
    if (templateId === 'jrpg') {
      files.push({ rel: at('rules.ron'), content: RULES_RON })
    }
  }

  return files
}
