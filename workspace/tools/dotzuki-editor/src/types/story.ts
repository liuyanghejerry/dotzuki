// ───────────────────────────────────────────────────────────────────────────
// Story Designer data model — the narrative bible
//
// Game-agnostic. Records live as JSON under `dataRoot/{storiesDir}/`:
//   characters/<id>.json   quests/<id>.json   arcs/<id>.json   graph.json
//
// The bridge to the engine is the flag namespace: a quest declares the flags it
// `requires` and `sets`, which are the same strings the game's scripts/scenes
// read via getFlag/setFlag. That lets the designer cross-reference and validate
// without hardcoding any game specifics.
// ───────────────────────────────────────────────────────────────────────────

/** Localized text keyed by locale code, e.g. { en: "...", zh: "..." }. */
export type LocalizedText = Record<string, string>

export type DesignStatus = 'idea' | 'drafted' | 'scripted' | 'done'

/** A relationship edge from one character to another. */
export interface CharacterRelationship {
  /** Target character id */
  to: string
  /** Free-form relationship label (e.g. "mentor-of", "rival", "sibling") */
  kind: string
}

/** Binding of a narrative character to a concrete engine NPC instance. */
export interface NpcBinding {
  /** Map id the NPC lives on */
  map: string
  /** NPC object id within that map */
  npcId: number
}

/** How a character maps onto engine entities. */
export interface CharacterEngineLink {
  /** Concrete NPC instances this character appears as */
  npcs: NpcBinding[]
  /** Optional id of a record in a project data table (e.g. a battle/species row) */
  dataRef?: string | null
  /** Optional sprite asset path (relative to gfxRoot) */
  spriteAsset?: string | null
}

/** A sprite generation brief produced by the AI (Phase 3 feeds this to an image model). */
export interface SpriteSpec {
  palette?: string[]
  poses?: string[]
  size?: string
  style?: string
  notes?: string
}

/** A character profile (人设). */
export interface Character {
  id: string
  name: LocalizedText
  role: string
  tags?: string[]
  appearance: string
  personality: string
  backstory: string
  motivation: string
  speechStyle: string
  relationships: CharacterRelationship[]
  engine: CharacterEngineLink
  spriteSpec?: SpriteSpec | null
  status: DesignStatus
}

export type QuestType = 'main' | 'side' | 'fetch' | 'battle' | 'event'

/** A single step toward completing a quest. */
export interface QuestObjective {
  id: string
  text: LocalizedText
  /** Flag that marks this objective complete */
  doneFlag?: string
}

/** A reward granted on quest completion. */
export interface QuestReward {
  /** "item" | "monster" | "badge" | "money" | ... (free-form, game-defined) */
  kind: string
  id: string
  amount?: number
}

/** Where a quest is implemented in the engine. */
export interface QuestImplementation {
  /** Scene / map id whose script implements this quest */
  scene: string
  /** Storyline / function name within that scene */
  storyline: string
}

/** A quest — the flag-linked unit of progression. */
export interface Quest {
  id: string
  title: LocalizedText
  type: QuestType
  /** Owning arc id */
  arc?: string
  summary: string
  /** Character id of the quest giver */
  giver?: string
  /** Character ids involved */
  characters: string[]
  /** Map ids the quest touches */
  maps: string[]
  objectives: QuestObjective[]
  /** Event flags that must be set before this quest is available */
  requires: string[]
  /** Event flags this quest sets */
  sets: string[]
  rewards: QuestReward[]
  /** Scene/storyline bindings that implement this quest */
  implementedBy: QuestImplementation[]
  status: DesignStatus
}

/** A story arc — an ordered spine of quests (主线). */
export interface Arc {
  id: string
  title: LocalizedText
  /** Sort order among arcs */
  order: number
  summary: string
  /** Quest ids, in narrative order */
  beats: string[]
}

export type EdgeKind = 'unlocks' | 'blocks' | 'branches'

/** An explicit progression edge between two quests. */
export interface StoryEdge {
  from: string
  to: string
  kind: EdgeKind
  label?: string
}

/** The explicit-edges document (auto-derived flag edges are computed separately). */
export interface StoryGraph {
  edges: StoryEdge[]
}

/** The kinds of story record collections (each a subdirectory + sidebar list). */
export type StoryKind = 'characters' | 'quests' | 'arcs'

// ── AI provider profiles ───────────────────────────────────────────────────

/** Which wire protocol a vendor speaks. `dsh` = the optional DeepSeek Harness
 *  runtime (a local agent subprocess driven over stdio JSON-RPC). */
export type ProviderKind = 'anthropic' | 'openai' | 'dsh'

/**
 * A named LLM provider profile for TEXT generation (character refine, scene
 * gen). NOTE: never carries an API key — keys live in the browser (localStorage)
 * and are sent per-request. This is config only.
 */
export interface ProviderProfile {
  id: string
  kind: ProviderKind
  baseURL: string
  model: string
  /** Optional HTTP(S) proxy for reaching the provider, e.g. http://127.0.0.1:9085. */
  proxyUrl?: string
  /** Optional embedding model id (openai-compatible) — enables retrieval/RAG. */
  embeddingModel?: string
  /** @deprecated image generation now uses a separate ImageProviderProfile. */
  imageModel?: string
}

/** Which wire protocol an IMAGE vendor speaks. */
export type ImageProviderKind = 'openai' | 'gemini'

/**
 * A named provider profile for IMAGE generation (sprite sheets), kept separate
 * from the text providers above. `openai` = OpenAI-compatible images API;
 * `gemini` = Google Gemini `generateContent` (Nano Banana — supports reference
 * images). Config only; the API key lives in the browser.
 */
export interface ImageProviderProfile {
  id: string
  kind: ImageProviderKind
  baseURL: string
  /** The image model id, e.g. `gpt-image-1` or `gemini-2.5-flash-image`. */
  model: string
  /** Optional HTTP(S) proxy for reaching the provider, e.g. http://127.0.0.1:9085. */
  proxyUrl?: string
}

/** A lint finding surfaced in the Issues panel. */
export interface StoryIssue {
  severity: 'error' | 'warn'
  /** i18n-able machine code, e.g. "danglingRequire" */
  code: string
  /** Human-readable message (English fallback; UI prefers t('story.lint.'+code, params)). */
  message: string
  /** Interpolation values for the localized message keyed by code. */
  params?: Record<string, string>
  /** Related record, for click-through */
  kind?: StoryKind
  recordId?: string
}
