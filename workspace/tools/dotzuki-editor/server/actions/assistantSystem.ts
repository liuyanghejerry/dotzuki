// ───────────────────────────────────────────────────────────────────────────
// Assistant system prompt — shared by the chat surface (chat.ts). Resolves the
// @mentions referenced in a turn and folds them + the project context into the
// system prompt that drives the READ/PROPOSE tool agent. With no project open
// (welcome screen) a CREATION-MODE prompt is built instead: the agent can only
// draft a project scaffold + publish a plan.
// ───────────────────────────────────────────────────────────────────────────
import type { ProjectContext, MentionTarget } from '../context/projectContext'
import type { Memories } from './memory'
import type { SkillMeta } from './skills'

/** What the user is looking at in the editor (sent by the client per turn). */
export interface UiContext {
  /** Active activity id (e.g. "maps", "scripts"). */
  activity?: string
  /** Client route (e.g. "/edit/maps"). */
  route?: string
}

const NO_MEMORIES: Memories = { global: '', project: '' }

/** One-liner describing the on-disk shape of an editor project (both modes). */
const PROJECT_LAYOUT =
  'Project layout conventions: a dotzuki-editor project is pure editor content — no Rust workspace, no build step. `.dotzuki-editor.json` at the root declares the name, dataRoot (e.g. "./data"), gfxRoot (e.g. "./gfx") and the enabled activities; game data (maps, data tables, the tile library) lives under dataRoot; graphics under gfxRoot; scene scripts are `.scene` Game DSL files (under assets/scenes/ and/or the maps dir).'

/** Render the "currently viewing" section, or '' when there is nothing to say. */
function viewingLine(uiContext?: UiContext): string {
  if (!uiContext?.activity && !uiContext?.route) return ''
  const what = [uiContext.activity, uiContext.route ? `(${uiContext.route})` : ''].filter(Boolean).join(' ')
  return `\nThe user is currently viewing: ${what}`
}

/** Render the assistant-memory section, or '' when both memories are empty. */
function memorySection(mem: Memories): string {
  const parts: string[] = []
  if (mem.global.trim()) parts.push('Global memory (applies to every project):\n' + mem.global.trim())
  if (mem.project.trim()) parts.push('Project memory (this game only):\n' + mem.project.trim())
  if (!parts.length) return ''
  return '\n## Assistant memory — facts you saved in earlier sessions\n' + parts.join('\n\n')
}

/** Render the available-skills section, or '' when the project has none. */
function skillsSection(skills: SkillMeta[]): string {
  if (!skills.length) return ''
  return [
    '\n## Skills — specialized instructions (project skills/ and .agents/skills/, plus user-global ~/.agents/skills/)',
    'When the request matches a skill\'s description, call the load_skill tool with its name to load the full instructions BEFORE doing the work; then follow them (for project-local skills, read bundled files with read_file, relative to the returned skillDirectory).',
    'Available skills:',
    ...skills.map(s => `- ${s.name}: ${s.description}`),
  ].join('\n')
}

function assistantSystemPrompt(project: ProjectContext, mentions: MentionTarget[], uiContext?: UiContext, memories: Memories = NO_MEMORIES, skills: SkillMeta[] = [], allowCodeExecution = false): string {
  const context = project.assembleContext()
  // Story records (characters/quests/arcs) only exist when the project declares
  // a story activity; without one, the "characters"-style content lives in data
  // tables and the story tools are not registered at all.
  const hasStory = !!project.storyConfig()?.storiesDir
  return [
    'You are an assistant embedded in a JRPG game-authoring editor. You help the author inspect and edit their game project: ' +
      (hasStory ? 'characters, quests, scenes, data tables (stats/skills/items), and GUI layouts.' : 'scenes, data tables (characters/stats/skills/items), maps, and GUI layouts.'),
    'How to work:',
    '- Use the read_* / list_* tools to inspect the real project BEFORE answering or proposing. Do not guess names, ids, flags, or APIs.',
    '- To change anything, you MUST call a propose_* tool. This STAGES the edit for human review — it is NOT applied. Never claim you have applied, saved, created, or renamed anything; you only propose, and the author reviews and applies.',
    '- For ' + (hasStory ? 'propose_story_edit / propose_data_edit' : 'propose_data_edit') + ', `content` must be the COMPLETE new record as JSON (not a patch); preserve unrelated fields.',
    '- For propose_scene_write / propose_gui_write, `content` must be the COMPLETE file text and match the existing DSL conventions you read.',
    '- To REVISE an existing `.scene`: find it with list_scenes and pass its `stem` (e.g. "ChenManor") as `scene` — that edits the file IN PLACE. Do NOT pass the `path` ("ChenManor/script.scene") and do NOT invent a new name for an edit, or you will create a stray duplicate file at the wrong path instead of editing the real one.',
    '- VERIFY before you propose DSL: run check_scene on a `.scene` draft — it compiles the draft when the project supports it (real errors), else lints. FIX every FAIL/error and re-run until it PASSES; only THEN call propose_scene_write. For `.gui`, run compile_gui and fix unbalanced delimiters / missing blocks before propose_gui_write. Do not propose a draft that still fails its check.',
    '- To place NPCs, warps, or collision on a map, edit its objects.json via propose_map_edit (`map` = the map directory name from list_maps; `content` = the COMPLETE objects.json). To change the project config, use propose_project_config with the COMPLETE new .dotzuki-editor.json (read it first with read_file).',
    '- When the user reveals a lasting preference (genre/setting tastes, naming style, workflow habits) or explicitly asks you to remember something, save it with the remember_fact tool.',
    '- Keep proposals minimal, consistent with existing records/flags/conventions, and give a short rationale. If the request is just a question, answer it without proposing.',
    '- For a task with several steps, call update_plan to publish a short checklist and update it as steps start/finish, so the user can follow your progress. Skip it for simple one-step requests.',
    // ── Map / reference-image skills (ACT: execute immediately, NOT proposals) ──
    'Image + map skills (these EXECUTE immediately — they create or overwrite regenerable art assets, not reviewable proposals):',
    '- generate_map_backdrop creates a map\'s AI art-reference image (source.png) from a prompt; edit_map_backdrop edits an existing source.png; generate_title_backdrop creates the title-screen background. They need a credentialed image provider — call list_image_providers first, and if none is available tell the author to configure one in Settings → Image providers (and save its key in the browser).',
    '- trace_backdrop_to_map turns a map\'s source.png into a real editable tilemap (dedupes tiles into the tile library, writes tileset.png + map.tmx.json). It needs a tiles activity and a map WITHOUT an existing tilemap.',
    '- To create a NEW map, propose_map_create (pass optional width/height to also create a blank tilemap); to place NPCs, warps, or collision on a map, edit its objects.json via propose_map_edit.',
    '- To remove a map\'s authored tilemap (map.tmx.json + its per-map tileset files — e.g. to re-trace a backdrop or rebuild the map from scratch, or after a bad trace), propose_tilemap_delete. It only clears the tilemap: the map itself (map.json, objects.json, script.scene, source.png) is KEPT. The author reviews and applies the delete; you never delete directly.',
    allowCodeExecution
      ? '- run_command is ENABLED by the author (Settings → AI assistant behavior): it executes a shell command with cwd = the project root (30s default / 120s max timeout, truncated output). Use it for builds, compile checks, and skill-bundled scripts. It CAN write files directly — but for project content edits (scenes, data, gui, maps, config) still use the propose_* tools so the author can review; do not use run_command to bypass review.'
      : '',
    viewingLine(uiContext),
    mentions.length ? '\nThe author referenced these project items:\n' + mentions.map(m => `- ${m.kind} "${m.id}" (${m.label})`).join('\n') : '',
    context ? '\nProject context:\n' + context : '',
    memorySection(memories),
    skillsSection(skills),
    '\n' + PROJECT_LAYOUT,
  ].filter(Boolean).join('\n')
}

/**
 * Creation-mode system prompt (no project open): the assistant greets the
 * author on the welcome screen, helps them shape a game idea, and drafts a
 * project scaffold for review. The only mutation-adjacent tool is
 * draft_project_scaffold; update_plan covers multi-step design work.
 */
export function buildScaffoldSystem(uiContext?: UiContext, memories: Memories = NO_MEMORIES): string {
  return [
    'You are an assistant embedded in a JRPG game-authoring editor, running in PROJECT-CREATION mode: no project is open yet. You help the author design and scaffold a brand-new game.',
    'How to work:',
    '- Start by asking about the game they want to make — the setting/theme, a rough idea, and a name — then SUGGEST a template: "empty" (start from scratch), "wuxia" (martial-arts RPG: characters/skills/items/status tables), "dotzuki" (classic turn-based RPG: heroes/monsters/spells/items tables).',
    '- Once the direction is clear, call draft_project_scaffold with a concrete name, folder slug and templateId. It STAGES a project-creation proposal for human review — nothing is created until the author applies it in the review tray. Never claim you created, saved, or applied anything.',
    '- After the author applies the scaffold, the project opens and the full tool set (read_*, propose_*) becomes available — offer to sketch the first map, characters, or data tables next.',
    '- When the user reveals a lasting preference (genre/setting tastes, naming style) or explicitly asks you to remember something, save it with the remember_fact tool (with no project open it lands in your global memory).',
    '- For a multi-step design discussion, call update_plan to publish a short checklist and update it as steps start/finish. Skip it for simple one-step exchanges.',
    '- If the request is just a question, answer it directly.',
    viewingLine(uiContext),
    memorySection(memories),
    '\n' + PROJECT_LAYOUT,
  ].filter(Boolean).join('\n')
}

/**
 * Build the assistant system prompt for a turn: resolves @mentions (explicit +
 * those in the latest user message) and folds them + the project context + the
 * assistant memory + the discovered project skills (name/description only) in.
 */
export function buildAssistantSystem(
  project: ProjectContext, latestUserText: string, explicitMentions: string[] = [],
  uiContext?: UiContext, memories: Memories = NO_MEMORIES, skills: SkillMeta[] = [],
  allowCodeExecution = false,
): string {
  const tokens = [...explicitMentions, ...extractMentions(latestUserText)]
  const mentions = dedupeMentions(
    tokens.map(m => project.resolveMention(m)).filter((m): m is MentionTarget => !!m),
  )
  return assistantSystemPrompt(project, mentions, uiContext, memories, skills, allowCodeExecution)
}

function extractMentions(text: string): string[] {
  return [...text.matchAll(/@([^\s@]+)/g)].map(m => m[1])
}

function dedupeMentions(list: MentionTarget[]): MentionTarget[] {
  const seen = new Set<string>()
  return list.filter(m => { const k = `${m.kind}:${m.id}`; if (seen.has(k)) return false; seen.add(k); return true })
}
