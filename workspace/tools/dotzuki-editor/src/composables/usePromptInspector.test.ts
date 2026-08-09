// Prompt inspector: per-turn capture of data-debug-* parts, defensive input
// handling, the memory cap, and the default-off flag. Node has no
// localStorage, so `enabled` falls back to false here (its browser-side
// persistence is a thin guarded wrapper, same as the other composables).
import { describe, it, expect, beforeEach } from 'vitest'
import { usePromptInspector } from './usePromptInspector'

const inspector = usePromptInspector()

beforeEach(() => inspector.clearTurns())

describe('usePromptInspector', () => {
  it('is off by default', () => {
    expect(inspector.enabled.value).toBe(false)
  })

  it('records a request as a new turn with the full payload', () => {
    inspector.recordRequest({
      system: 'SYS', messages: [{ role: 'user', content: 'hi' }],
      tools: ['read_file', 'propose_edit'], cached: true,
    })
    expect(inspector.turns.value).toHaveLength(1)
    const turn = inspector.turns.value[0]
    expect(turn.system).toBe('SYS')
    expect(turn.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(turn.tools).toEqual(['read_file', 'propose_edit'])
    expect(turn.cached).toBe(true)
    expect(turn.steps).toEqual([])
  })

  it('appends steps to the latest turn only', () => {
    inspector.recordStep({ text: 'orphan' }) // no turn yet → dropped
    expect(inspector.turns.value).toHaveLength(0)

    inspector.recordRequest({ system: 'A' })
    inspector.recordStep({ text: 'hello', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } })
    inspector.recordRequest({ system: 'B' })
    inspector.recordStep({ toolCalls: [{ toolName: 'read_file', input: { path: 'x' } }] })

    expect(inspector.turns.value[0].steps).toHaveLength(1)
    expect(inspector.turns.value[0].steps[0].text).toBe('hello')
    expect(inspector.turns.value[1].steps).toHaveLength(1)
    expect(inspector.turns.value[1].steps[0].toolCalls?.[0].toolName).toBe('read_file')
  })

  it('tolerates malformed payloads', () => {
    inspector.recordRequest(null)
    inspector.recordRequest({})
    inspector.recordStep(undefined)
    expect(inspector.turns.value).toHaveLength(2)
    expect(inspector.turns.value[0].system).toBe('')
    expect(inspector.turns.value[0].messages).toEqual([])
    expect(inspector.turns.value[0].tools).toEqual([])
    expect(inspector.turns.value[1].steps).toHaveLength(1)
  })

  it('caps the retained turns', () => {
    for (let i = 0; i < 25; i++) inspector.recordRequest({ system: `S${i}` })
    expect(inspector.turns.value).toHaveLength(20)
    expect(inspector.turns.value[0].system).toBe('S5') // oldest dropped
  })

  it('clearTurns empties the capture', () => {
    inspector.recordRequest({ system: 'SYS' })
    inspector.clearTurns()
    expect(inspector.turns.value).toHaveLength(0)
  })
})
