import { describe, expect, it } from 'vitest'
import { computeIssues } from './useStoryLint'
import type { Character, Quest } from '../types'
import en from '../locales/en'
import zh from '../locales/zh'

function quest(over: Partial<Quest> = {}): Quest {
  return {
    id: 'q1',
    title: { en: 'Quest One' },
    type: 'main',
    summary: '',
    characters: [],
    maps: [],
    objectives: [],
    requires: [],
    sets: [],
    rewards: [],
    implementedBy: [],
    status: 'idea',
    ...over,
  }
}

function character(over: Partial<Character> = {}): Character {
  return {
    id: 'hero',
    name: { en: 'Hero' },
    role: '',
    appearance: '',
    personality: '',
    backstory: '',
    motivation: '',
    speechStyle: '',
    relationships: [],
    engine: { npcs: [] },
    status: 'idea',
    ...over,
  }
}

describe('computeIssues', () => {
  it('a consistent bible produces no issues', () => {
    const chars = [
      character({ id: 'hero', relationships: [{ to: 'rival', kind: 'rival' }] }),
      character({ id: 'rival' }),
    ]
    const quests = [
      quest({
        id: 'q1',
        giver: 'hero',
        characters: ['hero', 'rival'],
        sets: ['flag_met_rival'],
        status: 'done',
        implementedBy: [{ scene: 'start', storyline: 'intro' }],
      }),
      quest({
        id: 'q2',
        requires: ['flag_met_rival'],
        sets: ['flag_champion'],
        status: 'drafted',
        implementedBy: [{ scene: 'league', storyline: 'final' }],
      }),
    ]
    // flag_champion is set by q2 and read by a script (scanned), so no orphan.
    expect(computeIssues(chars, quests, ['flag_champion'])).toEqual([])
    expect(computeIssues([], [], [])).toEqual([])
  })

  it('errors when a required flag is set by no quest', () => {
    const issues = computeIssues([], [quest({ requires: ['flag_gate'] })], [])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'danglingRequire',
      params: { quest: 'q1', flag: 'flag_gate' },
      kind: 'quests',
      recordId: 'q1',
    })
  })

  it('a require is satisfied by any quest setting the flag, including itself', () => {
    const chained = computeIssues([], [
      quest({ id: 'q1', sets: ['flag_a'] }),
      quest({ id: 'q2', requires: ['flag_a'] }),
    ], [])
    expect(chained).toEqual([])
    const selfSet = computeIssues([], [quest({ requires: ['flag_a'], sets: ['flag_a'] })], [])
    expect(selfSet).toEqual([])
  })

  it('a require is satisfied when a scanned script touches the flag', () => {
    // The flag scan covers setFlag(...) calls by default, so a flag set by a
    // game script (not modeled as any quest's `sets`) must not be reported as
    // "the quest can never become available".
    const issues = computeIssues([], [quest({ requires: ['flag_from_cutscene'] })], ['flag_from_cutscene'])
    expect(issues).toEqual([])
  })

  it('a require still errors when the flag is neither quest-set nor scanned', () => {
    const issues = computeIssues([], [quest({ requires: ['flag_gate'] })], ['some_other_flag'])
    expect(issues.map(i => i.code)).toEqual(['danglingRequire'])
  })

  it('warns when a set flag is neither required by any quest nor scanned', () => {
    const issues = computeIssues([], [quest({ sets: ['flag_lonely'] })], [])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warn',
      code: 'orphanSet',
      params: { quest: 'q1', flag: 'flag_lonely' },
      kind: 'quests',
      recordId: 'q1',
    })
  })

  it('a set flag stays quiet when another quest requires it or a script reads it', () => {
    const required = computeIssues([], [
      quest({ id: 'q1', sets: ['flag_a'] }),
      quest({ id: 'q2', requires: ['flag_a'] }),
    ], [])
    expect(required).toEqual([])
    const scanned = computeIssues([], [quest({ sets: ['flag_a'] })], ['flag_a'])
    expect(scanned).toEqual([])
  })

  it('warns for every non-idea status with no implementing scene bound', () => {
    for (const status of ['drafted', 'scripted', 'done'] as const) {
      const issues = computeIssues([], [quest({ status })], [])
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({
        severity: 'warn',
        code: 'unimplemented',
        params: { quest: 'q1', status },
        kind: 'quests',
        recordId: 'q1',
      })
    }
  })

  it('an idea quest, or a non-idea quest with a bound scene, stays quiet', () => {
    expect(computeIssues([], [quest({ status: 'idea' })], [])).toEqual([])
    const bound = quest({
      status: 'done',
      implementedBy: [{ scene: 'start', storyline: 'intro' }],
    })
    expect(computeIssues([], [bound], [])).toEqual([])
  })

  it('warns about a giver that is not a known character', () => {
    const issues = computeIssues([character()], [quest({ giver: 'ghost' })], [])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warn',
      code: 'unknownGiver',
      params: { quest: 'q1', giver: 'ghost' },
      kind: 'quests',
      recordId: 'q1',
    })
    expect(computeIssues([character()], [quest({ giver: 'hero' })], [])).toEqual([])
  })

  it('flags each unknown character reference, skipping known ones', () => {
    const issues = computeIssues([character()], [
      quest({ characters: ['hero', 'ghost1', 'ghost2'] }),
    ], [])
    expect(issues.map(i => i.params?.char)).toEqual(['ghost1', 'ghost2'])
    for (const i of issues) {
      expect(i).toMatchObject({ severity: 'warn', code: 'unknownCharRef', kind: 'quests', recordId: 'q1' })
    }
  })

  it('warns about relationships pointing at unknown characters', () => {
    const issues = computeIssues([
      character({ relationships: [{ to: 'ghost', kind: 'mentor-of' }] }),
    ], [], [])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warn',
      code: 'unknownRelation',
      params: { char: 'hero', to: 'ghost' },
      kind: 'characters',
      recordId: 'hero',
    })
    const known = computeIssues([
      character({ id: 'hero', relationships: [{ to: 'rival', kind: 'rival' }] }),
      character({ id: 'rival' }),
    ], [], [])
    expect(known).toEqual([])
  })

  it('ignores relationship entries with an empty target', () => {
    const issues = computeIssues([
      character({ relationships: [{ to: '', kind: 'unset' }] }),
    ], [], [])
    expect(issues).toEqual([])
  })

  it('labels an id-less quest as "(unnamed quest)"', () => {
    const issues = computeIssues([], [quest({ id: '', requires: ['flag_a'] })], [])
    expect(issues[0].params?.quest).toBe('(unnamed quest)')
    expect(issues[0].message).toContain('(unnamed quest)')
    expect(issues[0].recordId).toBe('')
  })

  it('a single messy quest raises each applicable issue in rule order', () => {
    const issues = computeIssues([], [
      quest({
        requires: ['flag_missing'],
        sets: ['flag_lonely'],
        status: 'drafted',
        giver: 'ghost',
        characters: ['phantom'],
      }),
    ], [])
    expect(issues.map(i => i.code)).toEqual([
      'danglingRequire',
      'orphanSet',
      'unimplemented',
      'unknownGiver',
      'unknownCharRef',
    ])
  })

  it('every emitted code has a story.lint message in en and zh', () => {
    const issues = [
      ...computeIssues([], [quest({ requires: ['f'] })], []),
      ...computeIssues([], [quest({ sets: ['f'] })], []),
      ...computeIssues([], [quest({ status: 'done' })], []),
      ...computeIssues([], [quest({ giver: 'ghost' })], []),
      ...computeIssues([], [quest({ characters: ['ghost'] })], []),
      ...computeIssues([character({ relationships: [{ to: 'ghost', kind: 'k' }] })], [], []),
    ]
    const codes = [...new Set(issues.map(i => i.code))].sort()
    expect(codes).toEqual([
      'danglingRequire',
      'orphanSet',
      'unimplemented',
      'unknownCharRef',
      'unknownGiver',
      'unknownRelation',
    ])
    const enLint = en.story.lint as Record<string, string>
    const zhLint = zh.story.lint as Record<string, string>
    for (const code of codes) {
      expect(enLint[code], `en missing story.lint.${code}`).toBeTypeOf('string')
      expect(zhLint[code], `zh missing story.lint.${code}`).toBeTypeOf('string')
    }
  })
})
