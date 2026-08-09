// ───────────────────────────────────────────────────────────────────────────
// Quick prompts — context-aware canned instructions rendered as chips above
// the assistant input. The matching logic is pure (unit-tested); AssistantPanel
// resolves the i18n text and sends it exactly like a typed user message.
// ───────────────────────────────────────────────────────────────────────────

/** One clickable chip: icon + i18n keys for the label and the prompt to send. */
export interface QuickPrompt {
  id: string
  icon: string
  labelKey: string
  promptKey: string
  /** vue-i18n interpolation values for the prompt (e.g. the selected record id). */
  vars?: Record<string, string>
}

/** What the panel is looking at when the chips render. */
export interface QuickPromptContext {
  /** Welcome screen (no project open). */
  welcome: boolean
  /** Active activity id ('maps' | 'story' | 'data' | 'scripts' | …), null if none. */
  activity: string | null
  /** Current selection: story record kind + id, or { kind: 'table', id }. */
  selection: { kind: string; id: string } | null
}

/** Cap on simultaneously visible chips; first matches win, in definition order. */
export const MAX_QUICK_PROMPTS = 4

/**
 * The chips matching the current context. Each prompt's text is a natural-
 * language instruction aligned with the agent's tools (draft_project_scaffold
 * with no project; read + propose_* tools with one open).
 */
export function quickPromptsFor(ctx: QuickPromptContext): QuickPrompt[] {
  const out: QuickPrompt[] = []
  // A blank id means an unsaved new record — treat it as no selection.
  const sel = ctx.selection?.id ? ctx.selection : null

  // No project yet: scaffolding a new game is the only meaningful action.
  if (ctx.welcome) {
    out.push({ id: 'create-game', icon: '🎮', labelKey: 'assistant.quick.createGame.label', promptKey: 'assistant.quick.createGame.prompt' })
    return out
  }

  if (ctx.activity === 'maps') {
    out.push({ id: 'new-map', icon: '🗺', labelKey: 'assistant.quick.newMap.label', promptKey: 'assistant.quick.newMap.prompt' })
  }

  if (ctx.activity === 'story') {
    const charId = sel?.kind === 'characters' ? sel.id : null
    out.push({
      id: 'refine-character', icon: '🧑',
      labelKey: 'assistant.quick.refineCharacter.label',
      promptKey: charId ? 'assistant.quick.refineCharacter.promptWithId' : 'assistant.quick.refineCharacter.prompt',
      ...(charId ? { vars: { id: charId } } : {}),
    })
    if (sel?.kind === 'quests') {
      out.push({ id: 'quest-to-scene', icon: '📜', labelKey: 'assistant.quick.questToScene.label', promptKey: 'assistant.quick.questToScene.prompt', vars: { id: sel.id } })
    }
  }

  if (ctx.activity === 'data') {
    const tableId = sel?.kind === 'table' ? sel.id : null
    out.push({
      id: 'design-table', icon: '📊',
      labelKey: 'assistant.quick.designTable.label',
      promptKey: tableId ? 'assistant.quick.designTable.promptWithId' : 'assistant.quick.designTable.prompt',
      ...(tableId ? { vars: { id: tableId } } : {}),
    })
  }

  if (ctx.activity === 'scripts') {
    out.push({ id: 'write-scene', icon: '📝', labelKey: 'assistant.quick.writeScene.label', promptKey: 'assistant.quick.writeScene.prompt' })
  }

  // Fallback: a project is open but nothing context-specific matched.
  if (!out.length) {
    out.push({ id: 'whats-next', icon: '🧭', labelKey: 'assistant.quick.whatsNext.label', promptKey: 'assistant.quick.whatsNext.prompt' })
  }

  return out.slice(0, MAX_QUICK_PROMPTS)
}
