// ───────────────────────────────────────────────────────────────────────────
// useScheduler pure-helper tests — due calculation, the UI message stream
// seams (SSE parse + chunk fold) used by the headless agent-prompt runner,
// and summary clipping. The scheduler's timers/store wiring is not exercised
// here (component-level concern); these cover the protocol-critical logic.
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import { isDue, parseSseChunks, summarizeStreamChunks, clipSummary, type ScheduledJob } from './useScheduler'

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'j1', name: 'n', kind: 'scene-check', intervalMinutes: 30,
    enabled: true, lastRunAt: 0, lastStatus: '', lastSummary: '', ...over,
  }
}

describe('isDue', () => {
  const now = 1_000_000_000_000

  it('is due immediately when it never ran (lastRunAt 0)', () => {
    expect(isDue(job(), now)).toBe(true)
  })

  it('is due once the interval has elapsed since the last run', () => {
    const last = now - 30 * 60_000
    expect(isDue(job({ lastRunAt: last }), now)).toBe(true)
    expect(isDue(job({ lastRunAt: last + 1 }), now)).toBe(false)
  })

  it('never runs while disabled', () => {
    expect(isDue(job({ enabled: false }), now)).toBe(false)
  })

  it('honors per-job intervals', () => {
    const last = now - 10 * 60_000
    expect(isDue(job({ intervalMinutes: 5, lastRunAt: last }), now)).toBe(true)
    expect(isDue(job({ intervalMinutes: 60, lastRunAt: last }), now)).toBe(false)
  })
})

describe('parseSseChunks', () => {
  it('parses data: lines and drops blanks, [DONE] and junk', () => {
    const raw = [
      'data: {"type":"start","messageId":"m1"}',
      '',
      'data: {"type":"text-delta","id":"t1","delta":"Hello "}',
      'data: {not json',
      'data: [DONE]',
      'data: {"type":"finish"}',
      '',
    ].join('\n')
    const chunks = parseSseChunks(raw)
    expect(chunks.map(c => c.type)).toEqual(['start', 'text-delta', 'finish'])
  })

  it('handles an empty payload', () => {
    expect(parseSseChunks('')).toEqual([])
  })
})

describe('summarizeStreamChunks', () => {
  it('folds text deltas and collects data-proposal payloads', () => {
    const proposal = { target: { kind: 'scene', scene: 'Intro' }, title: 'Add scene', diff: [], after: 'x' }
    const { text, proposals, error } = summarizeStreamChunks([
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Checked 12 scenes. ' },
      { type: 'tool-list_scenes', state: 'output-available' },
      { type: 'text-delta', id: 't1', delta: 'One needs fixes.' },
      { type: 'data-proposal', data: proposal, transient: true },
      { type: 'data-plan', data: { steps: [] }, transient: true },
      { type: 'finish' },
    ])
    expect(error).toBe('')
    expect(text).toBe('Checked 12 scenes. One needs fixes.')
    expect(proposals).toEqual([proposal])
  })

  it('surfaces an error chunk as the run failure', () => {
    const { error } = summarizeStreamChunks([{ type: 'error', errorText: 'provider exploded' }])
    expect(error).toBe('provider exploded')
  })
})

describe('clipSummary', () => {
  it('collapses whitespace and keeps short text intact', () => {
    expect(clipSummary('  line one\n  line two  ')).toBe('line one line two')
  })

  it('clips to 120 chars with an ellipsis', () => {
    const clipped = clipSummary('x'.repeat(200))
    expect(clipped).toHaveLength(121)
    expect(clipped.endsWith('…')).toBe(true)
  })

  it('returns an empty string for empty input', () => {
    expect(clipSummary('')).toBe('')
  })
})
