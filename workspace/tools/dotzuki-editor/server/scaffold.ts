// ───────────────────────────────────────────────────────────────────────────
// Project scaffolding — turns a template into a fresh dotzuki-editor project.
//
// The create route (server/api/routes/project.ts) is a thin shell over this
// module: it validates the request, resolves the target directory, then calls
// scaffoldProject(). Kept separate so it is unit-testable without HTTP and so
// the template catalog is shared with /api/project/templates (which localizes
// name/description via ?lang=).
//
// A scaffolded project is pure editor content — no Rust workspace, no build
// system: just .dotzuki-editor.json + data/gfx folders and starter content (demo
// map + tileset, sample records, story seeds — see server/starterContent.ts).
// ───────────────────────────────────────────────────────────────────────────
import path from 'path'
import fs from 'fs'
import { starterFiles } from './starterContent'

export interface TemplateField {
  key: string
  type: string
  label: string
  required?: boolean
  options?: string[]
  default?: unknown
}

export interface TemplateTable {
  id: string
  label: string
  dir: string
  icon: string
  idField: string
  fields: TemplateField[]
}

export interface ProjectTemplate {
  id: string
  /** Per-locale display name; the templates endpoint picks one via ?lang=. */
  name: Record<string, string>
  /** Per-locale blurb; falls back to `en` for unknown languages. */
  description: Record<string, string>
  icon: string
  /** Data-table schemas — both the data activity config and /api/project/templates. */
  tables: TemplateTable[]
  /** Map activity config. */
  map: Record<string, unknown>
  /** Assets activity config. */
  assets: Record<string, unknown>
  /** Optional manifest `battle` section (see docs/game-project-spec.md). */
  battle?: Record<string, unknown>
  /** Optional manifest `shop` section (currency + starting money). */
  shop?: Record<string, unknown>
}

const WUXIA_TABLES: TemplateTable[] = [
  { id: 'characters', label: 'Characters', dir: 'characters', icon: 'user', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'sect', type: 'select', label: 'Sect', options: ['Shaolin', 'Wudang', 'Emei', 'Gaibang', 'Mojiao', 'Sanxian'], required: true },
      { key: 'hp', type: 'number', label: 'HP', default: 100 },
      { key: 'neigong', type: 'number', label: 'Internal Energy', default: 50 },
      { key: 'waigong', type: 'number', label: 'External Power', default: 50 },
      { key: 'shenfa', type: 'number', label: 'Agility', default: 50 },
      { key: 'element', type: 'select', label: 'Element', options: ['Metal', 'Wood', 'Water', 'Fire', 'Earth'], required: true },
      { key: 'description', type: 'string', label: 'Description' },
    ] },
  { id: 'skills', label: 'Skills', dir: 'skills', icon: 'sword', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'type', type: 'select', label: 'Type', options: ['Internal', 'External', 'Lightness', 'Hardness', 'Special'] },
      { key: 'element', type: 'select', label: 'Element', options: ['Metal', 'Wood', 'Water', 'Fire', 'Earth', 'None'] },
      { key: 'power', type: 'number', label: 'Power', default: 0 },
      { key: 'cost', type: 'number', label: 'Qi Cost', default: 0 },
      { key: 'accuracy', type: 'number', label: 'Accuracy', default: 100 },
      { key: 'target', type: 'select', label: 'Target', options: ['Self', 'SingleEnemy', 'AllEnemies', 'SingleAlly', 'AllAllies'] },
      { key: 'description', type: 'string', label: 'Description' },
    ] },
  { id: 'items', label: 'Items', dir: 'items', icon: 'package', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'category', type: 'select', label: 'Category', options: ['Medicine', 'Weapon', 'Manual', 'Material', 'Key', 'Other'] },
      { key: 'effect', type: 'string', label: 'Effect' },
      { key: 'value', type: 'number', label: 'Value', default: 0 },
      { key: 'price', type: 'number', label: 'Price', default: 0 },
      { key: 'description', type: 'string', label: 'Description' },
    ] },
  { id: 'status', label: 'Status Effects', dir: 'status', icon: 'alert', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'type', type: 'select', label: 'Type', options: ['Buff', 'Debuff', 'Damage', 'Control'] },
      { key: 'duration', type: 'number', label: 'Duration (turns)', default: 3 },
      { key: 'statAffected', type: 'string', label: 'Stat Affected' },
      { key: 'modifier', type: 'number', label: 'Modifier %', default: 0 },
      { key: 'description', type: 'string', label: 'Description' },
    ] },
]

const DOTZUKI_TABLES: TemplateTable[] = [
  { id: 'heroes', label: 'Heroes', dir: 'heroes', icon: 'user', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'job', type: 'select', label: 'Job', options: ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger'] },
      { key: 'hp', type: 'number', label: 'HP', default: 100 },
      { key: 'mp', type: 'number', label: 'MP', default: 50 },
      { key: 'atk', type: 'number', label: 'ATK', default: 20 },
      { key: 'def', type: 'number', label: 'DEF', default: 15 },
      { key: 'spd', type: 'number', label: 'SPD', default: 10 },
      { key: 'element', type: 'select', label: 'Element', options: ['Fire', 'Ice', 'Lightning', 'Light', 'Dark', 'None'] },
      { key: 'skills', type: 'array', label: 'Skills' },
      // RON hooks (rules.ron): `ability` names a `kind: Ability` record
      // (fires on switch-in + per-action events), `heldItem` a `kind: Item`
      // record (its Residual hooks run after the holder's actions).
      { key: 'ability', type: 'string', label: 'Ability' },
      { key: 'heldItem', type: 'string', label: 'Held Item' },
    ] },
  { id: 'monsters', label: 'Monsters', dir: 'monsters', icon: 'ghost', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'hp', type: 'number', label: 'HP', default: 50 },
      { key: 'mp', type: 'number', label: 'MP', default: 10 },
      { key: 'atk', type: 'number', label: 'ATK', default: 15 },
      { key: 'def', type: 'number', label: 'DEF', default: 10 },
      { key: 'spd', type: 'number', label: 'SPD', default: 8 },
      { key: 'element', type: 'select', label: 'Element', options: ['Fire', 'Ice', 'Lightning', 'Light', 'Dark', 'None'] },
      { key: 'exp', type: 'number', label: 'EXP Reward', default: 10 },
      { key: 'gold', type: 'number', label: 'Gold Drop', default: 5 },
      { key: 'skills', type: 'array', label: 'Skills' },
    ] },
  { id: 'encounters', label: 'Encounters', dir: 'encounters', icon: 'swords', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'enemies', type: 'array', label: 'Enemies' },
      { key: 'trainer', type: 'boolean', label: 'Trainer', default: false },
      { key: 'money', type: 'number', label: 'Money', default: 0 },
    ] },
  { id: 'spells', label: 'Spells', dir: 'spells', icon: 'magic', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'type', type: 'select', label: 'Type', options: ['Attack', 'Heal', 'Buff', 'Debuff', 'Status'] },
      { key: 'element', type: 'select', label: 'Element', options: ['Fire', 'Ice', 'Lightning', 'Light', 'Dark', 'None'] },
      { key: 'power', type: 'number', label: 'Power', default: 30 },
      { key: 'mpCost', type: 'number', label: 'MP Cost', default: 5 },
      { key: 'target', type: 'select', label: 'Target', options: ['Self', 'SingleEnemy', 'AllEnemies', 'SingleAlly', 'AllAllies'] },
      { key: 'description', type: 'string', label: 'Description' },
    ] },
  { id: 'items', label: 'Items', dir: 'items', icon: 'package', idField: 'id',
    fields: [
      { key: 'id', type: 'string', label: 'ID', required: true },
      { key: 'name', type: 'string', label: 'Name', required: true },
      { key: 'type', type: 'select', label: 'Type', options: ['Potion', 'Equipment', 'Key', 'Treasure', 'Other'] },
      { key: 'healHp', type: 'number', label: 'Heal HP', default: 0 },
      { key: 'effect', type: 'string', label: 'Effect' },
      { key: 'value', type: 'number', label: 'Value', default: 0 },
      { key: 'price', type: 'number', label: 'Price', default: 10 },
    ] },
]

/** The create-a-project template catalog (ids are stable; the API matches by id). */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'empty',
    name: { en: 'Empty Project', zh: '空白项目' },
    description: {
      en: 'Start from scratch. Add your own tables and activities.',
      zh: '从零开始，自定义添加数据表和功能。',
    },
    icon: 'blank',
    tables: [],
    map: { mapsDir: 'maps' },
    assets: { roots: ['gfx'] },
  },
  {
    id: 'wuxia',
    name: { en: 'Wuxia RPG', zh: '武侠 RPG' },
    description: {
      en: 'Martial arts world with sects, internal/external skills, and five elements.',
      zh: '武林江湖，包含门派、内外功、五行相克。',
    },
    icon: 'sword',
    tables: WUXIA_TABLES,
    map: { mapsDir: 'maps', tileSize: 16, blockSize: 4 },
    assets: { roots: ['gfx'], extensions: ['.png', '.jpg', '.gif'] },
  },
  {
    id: 'dotzuki',
    name: { en: 'Generic JRPG', zh: '经典 JRPG' },
    description: {
      en: 'Classic turn-based RPG with heroes, monsters, spells, and equipment.',
      zh: '传统回合制 RPG，包含英雄、怪物、魔法、装备。',
    },
    icon: 'star',
    tables: DOTZUKI_TABLES,
    map: { mapsDir: 'maps', tileSize: 16, blockSize: 4 },
    assets: { roots: ['gfx'], extensions: ['.png', '.jpg', '.gif'] },
    // Battle-ready out of the box: Aria + Bryn (the whole heroes table is
    // the party, with switching) vs. any monster via
    // `@command("startBattle", "slime")` in a scene, and a stocked Item menu
    // (3 Potions). The `encounters` block arms enemy parties + trainer
    // battles: `@command("startBattle", "bug-catcher")` fights the seeded
    // trainer (Run blocked, pays 32 G on a win). The `levels` block arms
    // EXP/level growth (+5% per level,
    // 8·L³ curve): the seeded Slime pays 8 EXP on a win, heroes start at
    // level 1 (no `level` field on their records). Defaults cover
    // stats/skills fields — see docs/game-project-spec.md#what-jrpg-run-does.
    battle: {
      party: { table: 'heroes' },
      enemies: { table: 'monsters' },
      encounters: { table: 'encounters' },
      skills: { table: 'spells' },
      resource: 'mp',
      rules: 'data/rules.ron',
      items: { table: 'items', healField: 'healHp', starting: { potion: 3 } },
      levels: {
        expField: 'exp',
        levelField: 'level',
        curve: { base: 8, exponent: 3 },
        growth: 0.05,
        maxLevel: 100,
      },
    },
    // Shop-ready too: 100 G starting money (the seeded Potion costs 20 G) —
    // `@command("openShop", ["potion"])` opens a Buy/Sell shop in `dotzuki run`
    // (selling pays half the record price, floored).
    shop: { currency: 'G', startMoney: 100 },
  },
]

/**
 * Activity list written into `.dotzuki-editor.json`. Scripts use the `.scene`
 * Game DSL (the repo standard); the tiles activity backs the map editor's
 * tile library (Backdrop / Trace-to-map need it — see README).
 */
export function activitiesFor(tpl: ProjectTemplate) {
  return [
    { id: 'maps', type: 'map', label: 'Maps', icon: 'map', enabled: true, config: tpl.map },
    { id: 'scripts', type: 'script', label: 'Scripts', icon: 'code', enabled: true,
      config: { scriptsDir: 'maps', extension: '.scene' } },
    { id: 'play', type: 'play', label: 'Play', icon: 'play', enabled: true, config: {} },
    { id: 'data', type: 'data', label: 'Data', icon: 'database', enabled: true,
      config: { tables: tpl.tables } },
    { id: 'story', type: 'story', label: 'Story', icon: 'book', enabled: true,
      config: { storiesDir: 'stories', scenesDir: 'maps', locales: ['en', 'zh'] } },
    { id: 'assets', type: 'assets', label: 'Assets', icon: 'image', enabled: true, config: tpl.assets },
    { id: 'tiles', type: 'tiles', label: 'Tiles', icon: 'tiles', enabled: true,
      config: { tilesDir: 'tiles', tileSize: 16, backdropMapsDir: 'maps' } },
  ]
}

/** Default folder name derived from a game name ("My Game!" → "my-game"). */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
}

// A minimal scene so a fresh project has something openable on day one.
const MAIN_SCENE = `// main.scene — your game's first scene, written in the jrpg Game DSL.
// Scenes compile to JavaScript and run on the dotzuki-engine runtime.
//
// Where to look next:
//   - Maps pane → StartTown: a demo town map with its own tileset; its
//     script.scene shows up in the Scripts pane (per-map scenes live
//     next to their map under data/maps/).
//   - Story pane: your narrative bible (characters, quests, graph).
//   - Ask the in-editor AI assistant (✨) to sketch characters, quests
//     and scenes for you.

game_scene Main {
    @storylines {
        @speaker("Guide") {
            "Welcome to your new JRPG project!"
            "Open the StartTown map to see the demo content."
        }
    }
}
`

function readme(name: string): string {
  return `# ${name}

A JRPG project created with the JRPG Editor.

## Layout

- \`.dotzuki-editor.json\` — editor project config (activities, data roots)
- \`data/maps/StartTown/\` — demo town map (\`map.tmx.json\`, \`tileset.png\`, \`script.scene\`)
- \`data/tiles/\` — shared tile library (seeded with the starter tiles)
- \`data/stories/\` — narrative bible (characters, quests, arcs, \`graph.json\`)
- \`data/<tables>/\` — data tables (game templates include sample records)
- \`gfx/\` — graphics assets (sprites)
- \`assets/scenes/\` — Game DSL scene scripts (\`.scene\`)

## Editing

Reopen this folder from the editor's welcome screen (**Open Project**), or
start the editor with \`DOTZUKI_PROJECT_ROOT=<this folder>\`. The in-editor AI
assistant (✨) can help sketch characters, quests and scenes.
`
}

export interface ScaffoldOptions {
  /** Display name stored in .dotzuki-editor.json. */
  name: string
  /** Template id — must match PROJECT_TEMPLATES. */
  templateId: string
  /** Game data root, relative to the project dir (default './data'). */
  dataRoot?: string
  /** Graphics root, relative to the project dir (default './gfx'). */
  gfxRoot?: string
}

export interface ScaffoldResult {
  /** The config written to .dotzuki-editor.json. */
  config: {
    name: string
    dataRoot: string
    gfxRoot: string
    activities: ReturnType<typeof activitiesFor>
  }
  /** Sorted project-relative paths of every file written (not dirs). */
  files: string[]
}

/** Lay out a fresh project in `targetDir`; returns the config + written files. */
export function scaffoldProject(targetDir: string, opts: ScaffoldOptions): ScaffoldResult {
  const tpl = PROJECT_TEMPLATES.find(t => t.id === opts.templateId)
  if (!tpl) throw new Error(`Unknown template: ${opts.templateId}`)
  const dataRoot = opts.dataRoot ?? './data'
  const gfxRoot = opts.gfxRoot ?? './gfx'

  const config = {
    name: opts.name,
    dataRoot,
    gfxRoot,
    activities: activitiesFor(tpl),
    // Optional manifest `battle` section (jrpg template) — validated by
    // `dotzuki check`, consumed by `dotzuki run`. Same for the `shop` section.
    ...(tpl.battle ? { battle: tpl.battle } : {}),
    ...(tpl.shop ? { shop: tpl.shop } : {}),
  }

  const files: string[] = []
  const write = (rel: string, content: string | Buffer) => {
    const abs = path.join(targetDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    files.push(rel)
  }

  fs.mkdirSync(targetDir, { recursive: true })
  write('.dotzuki-editor.json', JSON.stringify(config, null, 2))

  // Data tables (template-specific) + the shared maps/tile-library/story folders.
  for (const t of tpl.tables) {
    fs.mkdirSync(path.join(targetDir, dataRoot, t.dir), { recursive: true })
  }
  fs.mkdirSync(path.join(targetDir, dataRoot, 'maps'), { recursive: true })
  fs.mkdirSync(path.join(targetDir, dataRoot, 'tiles'), { recursive: true })
  for (const sub of ['characters', 'quests', 'arcs']) {
    fs.mkdirSync(path.join(targetDir, dataRoot, 'stories', sub), { recursive: true })
  }
  fs.mkdirSync(path.join(targetDir, gfxRoot), { recursive: true })

  // Starter content: demo map + tileset, sample records, story seeds, an
  // openable scene, and a README describing the layout.
  for (const f of starterFiles(tpl.id, dataRoot)) write(f.rel, f.content)
  fs.mkdirSync(path.join(targetDir, 'assets', 'scenes'), { recursive: true })
  write(path.join('assets', 'scenes', 'main.scene'), MAIN_SCENE)
  write('README.md', readme(opts.name))

  return { config, files: files.sort() }
}
