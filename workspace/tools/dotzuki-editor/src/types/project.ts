// ───────────────────────────────────────────────────────────────────────────
// Project Configuration — the .dotzuki-editor.json schema
//
// A game developer drops this file in their project root. The editor reads it
// to know where data lives, what activities to show, and what schemas to use
// for data validation. No Pokémon hardcoding anywhere.
// ───────────────────────────────────────────────────────────────────────────

/** Field type for schema-driven forms */
export type FieldType = 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'array' | 'object' | 'json'

/**
 * A display label that is either a plain string or a per-locale map, e.g.
 * `"Items"` or `{ en: "Items", zh: "道具" }`. The editor resolves it against
 * the active UI locale (see `useLocalize`), so a project can localize every
 * label it shows. Plain strings keep working unchanged.
 */
export type LocalizedLabel = string | Record<string, string>

/** A single field definition in a data table schema */
export interface FieldDef {
  /** JSON key in the data file */
  key: string
  /** Display label (plain or per-locale) */
  label: LocalizedLabel
  /** Field type */
  type: FieldType
  /** Optional description / help text (plain or per-locale) */
  description?: LocalizedLabel
  /** For select/multiselect: available options */
  options?: string[]
  /** Default value when creating new records */
  default?: unknown
  /** Whether this field is required */
  required?: boolean
  /** Hint for display width (1-12 grid columns) */
  width?: number
}

/** A data table definition — maps to a directory of JSON files */
export interface TableDef {
  /** Unique identifier for this table */
  id: string
  /** Display label in the sidebar (plain or per-locale) */
  label: LocalizedLabel
  /** Directory containing JSON files, relative to project dataRoot */
  dir: string
  /** Icon name (simple string identifier) */
  icon?: string
  /** Field schema for editing */
  fields: FieldDef[]
  /** Key field used as the record identifier (defaults to "id") */
  idField?: string
  /** Whether records can be created/deleted (default: true) */
  allowCreate?: boolean
  /** Whether records can be deleted (default: true) */
  allowDelete?: boolean
}

/** Map activity configuration */
export interface MapActivityConfig {
  /** Directory containing map JSON files, relative to dataRoot */
  mapsDir: string
  /** Directory containing tileset PNG files, relative to gfxRoot */
  tilesetsDir?: string
  /** Tileset BST file directory, relative to dataRoot */
  tilesetDataDir?: string
  /** Tile size in pixels (default: 8) */
  tileSize?: number
  /** Block size in tiles (default: 4 for 4×4 blocks) */
  blockSize?: number
  /**
   * The game's logical screen/framebuffer size in px, used to draw the camera
   * helper box on the map canvas. Defaults to a 160×144 Game Boy frame.
   */
  screen?: { width: number; height: number }
  /** World map image path for minimap navigation, relative to gfxRoot */
  worldMapImage?: string
  /** Map of tileset name → BST file name */
  tilesetBstFiles?: Record<string, string>
  /** Default passable tile indices per tileset */
  defaultPassableTiles?: Record<string, number[]>
  /**
   * Enables the NPC/warp entity overlay on the map canvas, backed by a per-map
   * JSON sidecar (`{ npcs:[{id,x,y,…}], warps:[{x,y,dest_map,…}] }`). Omit to
   * disable the overlay (other games unaffected).
   */
  objects?: { file?: string }
}

/** Script activity configuration */
export interface ScriptActivityConfig {
  /** Directory containing script files, relative to dataRoot */
  scriptsDir: string
  /** Script file extension (default: ".js") */
  extension?: string
  /** Whether to scan subdirectories (default: true) */
  recursive?: boolean
}

/** UI-layout (`.gui`) activity configuration */
export interface GuiActivityConfig {
  /**
   * Directory holding `.gui` files, relative to the PROJECT ROOT (not dataRoot)
   * — game UI layouts often live outside the data dir (e.g. a crate's
   * `ui_layouts/`). The dev server sandboxes reads/writes within PROJECT_ROOT.
   */
  guiRoot: string
  /** Layout file extension (default: ".gui") */
  extension?: string
  /** Preview canvas width in pixels (the game's framebuffer width) */
  width: number
  /** Preview canvas height in pixels */
  height: number
  /**
   * Theme injected into every layout before rendering (the `.gui` DSL emits no
   * theme block). Mirrors the game's runtime theme: `{ bg_color, text_mode,
   * ink, cursor_color, ... }`. Omit for the default GB white/tile look.
   */
  theme?: Record<string, unknown>
}

/** Title-screen (`.gui` overlay + optional background image) activity config. */
export interface TitleActivityConfig {
  /**
   * Directory holding the title `.gui` layout, relative to the PROJECT ROOT
   * (same convention as `GuiActivityConfig.guiRoot`). Read/written via `/api/gui`.
   */
  guiRoot: string
  /** The single layout file this activity edits (e.g. "title.gui"). */
  layoutFile: string
  /**
   * Optional on-disk background PNG override, relative to the PROJECT ROOT. The
   * `.gui` layout is a transparent overlay drawn on top of this image. May not
   * exist (the in-game background is procedural); the editor handles its absence.
   */
  bgImage?: string
  /** Preview canvas width in pixels (the game's framebuffer width). */
  width: number
  /** Preview canvas height in pixels. */
  height: number
  /**
   * Theme injected into the layout before rendering. Use a transparent
   * `bg_color` (e.g. `#00000000`) so the overlay reveals the background layer.
   */
  theme?: Record<string, unknown>
}

/** Asset activity configuration */
export interface AssetActivityConfig {
  /** Root directories to browse, relative to project root */
  roots: string[]
  /** File extensions to show (e.g. [".png", ".json"]) */
  extensions?: string[]
}

/** Tile-library activity configuration (the global shared 16px tile store). */
export interface TilesActivityConfig {
  /** Directory holding the tile library (`<id>.png` + `library.json`), under dataRoot */
  tilesDir: string
  /** Tile side length in pixels (default: 16) */
  tileSize?: number
  /**
   * Directory of maps whose `source.png` images are offered as harvest
   * backdrops, under dataRoot (default: "data/maps"). The editor loads each
   * map's full image, overlays a grid, and crops cells into the library.
   */
  backdropMapsDir?: string
}

/** How the Story Designer discovers the game's event flags (for autocomplete). */
export interface FlagSourceConfig {
  /** Scan scripts/scenes for flag-name string literals (default behaviour) */
  scan?: {
    /** Directory under dataRoot to scan (default: the script/map dir) */
    dir: string
    /** Function names whose string argument is a flag (default: getFlag, setFlag) */
    fns?: string[]
    /** Recurse into subdirectories (default: true) */
    recursive?: boolean
  }
  /** Optionally union flags from a data table's id field (tableId) */
  table?: string | null
}

/** Optional project-provided context handed to the AI when refining/authoring. */
export interface StoryAiConfig {
  /** Path (relative to project root) to a DSL authoring guide */
  dslGuide?: string | null
  /** Path to game-API type definitions */
  apiTypes?: string | null
  /** Example scene files to use as style references */
  exampleScenes?: string[]
}

/** Where a generated `.scene` file is written and how it is validated. */
export interface SceneGenConfig {
  /** Scene file extension (default: ".scene") */
  ext?: string
  /**
   * Path template (relative to dataRoot) for a scene's file, with `{scene}`
   * and `{ext}` placeholders. Default: `<scenesDir>/{scene}/script{ext}`.
   */
  pathTemplate?: string
  /**
   * Shell command run in the project root to validate a generated scene, with
   * `{scene}` and `{file}` placeholders. Takes priority over the built-in WASM
   * compile; omit to use the default check chain (WASM compile + lint).
   */
  checkCmd?: string
  /**
   * Legacy name for `checkCmd`; kept for backward compatibility with existing
   * project configs.
   */
  validateCmd?: string
}

/**
 * One sprite category the Sprite Studio manages for a character (e.g. overworld
 * walk sheet, battle portrait, bestiary/dex 立绘, dialogue head). On disk each is
 * `gfxRoot/<dir>/<characterId>/sheet.png` (RGBA), a `rows × cols` grid of
 * `cellW × cellH` cells: row = facing, col = frame. Mirrors the wuxia
 * character-sprite-gen pipeline. Omit `categories` to use the built-in defaults.
 */
export interface SpriteCategoryDef {
  /** Stable id, e.g. "overworld" | "portrait" | "dex" | "head". */
  id: string
  /** Display label (plain or per-locale). */
  label?: LocalizedLabel
  /** Directory under gfxRoot holding `<id>/` per-character sub-dirs. */
  dir: string
  /** Grid rows (facings) and cols (frames). */
  rows: number
  cols: number
  /** Cell pixel size. */
  cellW: number
  cellH: number
  /** Row labels, e.g. ["down","up","left","right"]. */
  rowNames?: string[]
  /** Column labels, e.g. ["stand","walk1","walk2","run1","run2"]. */
  colNames?: string[]
  /** Show an animated walk/run preview (overworld). */
  animated?: boolean
  /** Preview the cell bottom-centred on a tile (overworld foot anchor). */
  footAnchor?: boolean
  /** Column index used as the standing/idle frame. */
  standCol?: number
  /** Columns forming the walk loop. */
  walkCols?: number[]
  /** Columns forming the run loop (empty/absent → run falls back to walk). */
  runCols?: number[]
}

/** Where generated sprite images are written (under gfxRoot). */
export interface SpriteGenConfig {
  /** Directory under gfxRoot for the legacy single-image generator (default: "sprites") */
  dir?: string
  /** Image size, e.g. "1024x1024" */
  size?: string
  /** Sprite categories the Sprite Studio manages. Omit for built-in defaults. */
  categories?: SpriteCategoryDef[]
  /**
   * Shell command run in the project root to (re)generate a sprite set, e.g. the
   * wuxia Gemini character-sprite-gen skill. Placeholders: `{id}` `{category}`
   * `{rows}` `{cols}` `{cell}` `{dir}` `{prompt}`. Omit to disable AI generation.
   */
  generateCmd?: string
}

/** Story Designer activity configuration. */
export interface StoryActivityConfig {
  /** Directory holding story records (characters/quests/arcs/graph.json), under dataRoot */
  storiesDir: string
  /** Directory holding scene/script files, for cross-referencing implementations */
  scenesDir?: string
  /** Locale codes authored in localized text fields (default: ["en", "zh"]) */
  locales?: string[]
  /** Where to discover event flags */
  flagSource?: FlagSourceConfig
  /** Optional AI context references */
  ai?: StoryAiConfig
  /** Scene generation target + validation */
  scene?: SceneGenConfig
  /** Sprite generation output */
  sprite?: SpriteGenConfig
}

/** Audio activity configuration — where the file-based audio tracks live. */
export interface AudioActivityConfig {
  /** Directory holding the audio tracks, relative to dataRoot (default: "audio"). */
  audioDir: string
  /** Subdirectory for music tracks under audioDir (default: "music"). */
  musicSubdir?: string
  /** Subdirectory for sound effects under audioDir (default: "sfx"). */
  sfxSubdir?: string
}

/** The Settings/Config activity. Editable settings live in their own sidecar
 *  files (`.dotzuki-editor.settings.json` for the screen size, `.dotzuki-editor.providers.json`
 *  for AI providers) via dedicated APIs, so there is no static config here. */
export type SettingsActivityConfig = Record<string, never>

/** The Play activity (in-browser WASM playtest). No static config — the bundle
 *  comes from GET /api/play/bundle and the runner pkg is fixed to the repo. */
export type PlayActivityConfig = Record<string, never>

/** A single activity (tab) definition */
export interface ActivityDef {
  /** Unique identifier */
  id: string
  /** Display label in the tab bar (plain or per-locale) */
  label: LocalizedLabel
  /** Simple icon identifier */
  icon: string
  /** Activity type — determines which component renders */
  type: 'map' | 'script' | 'data' | 'assets' | 'story' | 'ui' | 'tiles' | 'settings' | 'character-sprite' | 'title-screen' | 'audio' | 'play'
  /** Activity-specific configuration */
  config: MapActivityConfig | ScriptActivityConfig | { tables: TableDef[] } | AssetActivityConfig | StoryActivityConfig | GuiActivityConfig | TitleActivityConfig | TilesActivityConfig | SettingsActivityConfig | AudioActivityConfig | PlayActivityConfig
  /** Whether this activity is enabled */
  enabled?: boolean
}

/** Root project configuration */
export interface ProjectConfig {
  /** Project name (displayed in title bar) */
  name: string
  /** Root directory for game data, relative to project root */
  dataRoot: string
  /** Root directory for graphics assets, relative to project root */
  gfxRoot?: string
  /** Activities to enable */
  activities: ActivityDef[]
}
