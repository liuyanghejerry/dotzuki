import { describe, expect, it } from 'vitest'
import { quickPromptsFor, MAX_QUICK_PROMPTS, type QuickPromptContext } from './useQuickPrompts'
import en from '../locales/en'
import zh from '../locales/zh'

const ctx = (over: Partial<QuickPromptContext> = {}): QuickPromptContext => ({
  welcome: false,
  activity: null,
  selection: null,
  ...over,
})
const ids = (c: QuickPromptContext) => quickPromptsFor(c).map(p => p.id)

describe('quickPromptsFor', () => {
  it('welcome mode offers only create-game, regardless of activity/selection', () => {
    expect(ids(ctx({ welcome: true }))).toEqual(['create-game'])
    expect(ids(ctx({ welcome: true, activity: 'maps', selection: { kind: 'quests', id: 'q1' } }))).toEqual(['create-game'])
  })

  it('maps activity → new-map', () => {
    expect(ids(ctx({ activity: 'maps' }))).toEqual(['new-map'])
  })

  it('scripts activity → write-scene', () => {
    expect(ids(ctx({ activity: 'scripts' }))).toEqual(['write-scene'])
  })

  it('story without a selection → refine-character with the pick-one prompt', () => {
    const [p] = quickPromptsFor(ctx({ activity: 'story' }))
    expect(p.id).toBe('refine-character')
    expect(p.promptKey).toBe('assistant.quick.refineCharacter.prompt')
    expect(p.vars).toBeUndefined()
  })

  it('story with a character selected → refine-character carries the id', () => {
    const [p] = quickPromptsFor(ctx({ activity: 'story', selection: { kind: 'characters', id: 'hero' } }))
    expect(p.id).toBe('refine-character')
    expect(p.promptKey).toBe('assistant.quick.refineCharacter.promptWithId')
    expect(p.vars).toEqual({ id: 'hero' })
  })

  it('story with a quest selected → refine-character + quest-to-scene, in definition order', () => {
    const prompts = quickPromptsFor(ctx({ activity: 'story', selection: { kind: 'quests', id: 'main-1' } }))
    expect(prompts.map(p => p.id)).toEqual(['refine-character', 'quest-to-scene'])
    // refine-character falls back to its pick-one variant (no character selected)
    expect(prompts[0].promptKey).toBe('assistant.quick.refineCharacter.prompt')
    expect(prompts[1].promptKey).toBe('assistant.quick.questToScene.prompt')
    expect(prompts[1].vars).toEqual({ id: 'main-1' })
  })

  it('story with an arc selected → only refine-character (arcs have no prompt)', () => {
    expect(ids(ctx({ activity: 'story', selection: { kind: 'arcs', id: 'a1' } }))).toEqual(['refine-character'])
  })

  it('data without a table → design-table with the new-table prompt', () => {
    const [p] = quickPromptsFor(ctx({ activity: 'data' }))
    expect(p.id).toBe('design-table')
    expect(p.promptKey).toBe('assistant.quick.designTable.prompt')
    expect(p.vars).toBeUndefined()
  })

  it('data with a table open → design-table carries the table id', () => {
    const [p] = quickPromptsFor(ctx({ activity: 'data', selection: { kind: 'table', id: 'monsters' } }))
    expect(p.id).toBe('design-table')
    expect(p.promptKey).toBe('assistant.quick.designTable.promptWithId')
    expect(p.vars).toEqual({ id: 'monsters' })
  })

  it('an empty selection id counts as no selection (unsaved new record)', () => {
    const [p] = quickPromptsFor(ctx({ activity: 'story', selection: { kind: 'characters', id: '' } }))
    expect(p.promptKey).toBe('assistant.quick.refineCharacter.prompt')
    expect(p.vars).toBeUndefined()
  })

  it('falls back to whats-next for other activities or no activity', () => {
    expect(ids(ctx({ activity: 'assets' }))).toEqual(['whats-next'])
    expect(ids(ctx({ activity: 'ui' }))).toEqual(['whats-next'])
    expect(ids(ctx())).toEqual(['whats-next'])
  })

  it('never exceeds the chip cap and never repeats an id', () => {
    const matrix: QuickPromptContext[] = [
      ctx({ welcome: true }),
      ctx({ activity: 'maps' }),
      ctx({ activity: 'scripts' }),
      ctx({ activity: 'data' }),
      ctx({ activity: 'data', selection: { kind: 'table', id: 't' } }),
      ctx({ activity: 'story' }),
      ctx({ activity: 'story', selection: { kind: 'characters', id: 'c' } }),
      ctx({ activity: 'story', selection: { kind: 'quests', id: 'q' } }),
      ctx({ activity: 'story', selection: { kind: 'arcs', id: 'a' } }),
      ctx({ activity: 'assets' }),
      ctx(),
    ]
    for (const c of matrix) {
      const prompts = quickPromptsFor(c)
      expect(prompts.length).toBeLessThanOrEqual(MAX_QUICK_PROMPTS)
      expect(new Set(prompts.map(p => p.id)).size).toBe(prompts.length)
    }
  })

  it('every label/prompt key (incl. interpolated variants) exists in en and zh', () => {
    const resolve = (msgs: any, key: string) =>
      key.split('.').reduce((o, k) => (o == null ? o : o[k]), msgs)
    const matrix: QuickPromptContext[] = [
      ctx({ welcome: true }),
      ctx({ activity: 'maps' }),
      ctx({ activity: 'scripts' }),
      ctx({ activity: 'data' }),
      ctx({ activity: 'data', selection: { kind: 'table', id: 't' } }),
      ctx({ activity: 'story' }),
      ctx({ activity: 'story', selection: { kind: 'characters', id: 'c' } }),
      ctx({ activity: 'story', selection: { kind: 'quests', id: 'q' } }),
      ctx({ activity: 'assets' }),
    ]
    for (const c of matrix) {
      for (const p of quickPromptsFor(c)) {
        for (const key of [p.labelKey, p.promptKey]) {
          expect(resolve(en, key), `en missing ${key}`).toBeTypeOf('string')
          expect(resolve(zh, key), `zh missing ${key}`).toBeTypeOf('string')
        }
      }
    }
  })
})
