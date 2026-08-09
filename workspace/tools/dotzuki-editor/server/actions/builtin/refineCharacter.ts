// ───────────────────────────────────────────────────────────────────────────
// Action: refine-character (人设) — structured-output character enrichment.
// Wraps server/ai.ts refineCharacter, sourcing the record + project context from
// ProjectContext (so it now gets real grounding even when `ai` is unset).
// ───────────────────────────────────────────────────────────────────────────
import type { AiAction, ActionContext } from '../types'
import { refineCharacter } from '../../ai'

export const refineCharacterAction: AiAction = {
  id: 'refine-character',
  kind: 'object',
  title: 'Refine character profile',
  async run(ctx: ActionContext) {
    const characterId = ctx.input.characterId
    if (!characterId) throw new Error('characterId is required')
    const character = ctx.project.readStoryRecord('characters', characterId)
    if (!character) throw new Error('Character not found')

    const sc = ctx.project.storyConfig() ?? {}
    const locales = (sc.locales as string[]) || ['en', 'zh']
    const context = ctx.project.assembleContext()

    return await refineCharacter({
      profile: ctx.profile,
      apiKey: ctx.apiKey,
      character,
      locales,
      context,
      onEvent: (event, data) => {
        if (event === 'partial') ctx.emit('partial', { object: data })
        else if (event === 'usage') ctx.emit('usage', data)
      },
    })
  },
}
