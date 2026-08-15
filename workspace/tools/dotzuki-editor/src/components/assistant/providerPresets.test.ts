// Quick-setup vendor presets: shape integrity and protocol-kind sanity.
import { describe, it, expect } from 'vitest'
import { PROVIDER_PRESETS, DEFAULT_PRESET_ID, presetById } from './providerPresets'

describe('PROVIDER_PRESETS', () => {
  it('every preset has a non-empty id/label and a legal protocol kind', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.id.trim()).not.toBe('')
      expect(p.label.trim()).not.toBe('')
      expect(['openai', 'anthropic']).toContain(p.kind)
    }
  })

  it('has unique ids and covers the expected vendors, moonshot first', () => {
    const ids = PROVIDER_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['moonshot', 'openai', 'anthropic', 'dsh', 'custom'])
    expect(DEFAULT_PRESET_ID).toBe('moonshot')
  })

  it('non-custom presets point at https console pages for API keys', () => {
    for (const p of PROVIDER_PRESETS.filter(p => p.id !== 'custom')) {
      expect(p.keyUrl).toMatch(/^https:\/\//)
      expect(p.modelExample.trim()).not.toBe('')
    }
  })

  it('openai-kind presets carry an https baseURL; anthropic and the dsh backend leave it empty', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.kind === 'anthropic' || p.backend === 'dsh') expect(p.baseURL).toBe('')
      else if (p.id !== 'custom') expect(p.baseURL).toMatch(/^https:\/\//)
    }
  })

  it('only the DeepSeek Harness preset selects the dsh execution backend', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.backend).toBe(p.id === 'dsh' ? 'dsh' : undefined)
    }
  })

  it('presetById resolves known ids and falls back to the first preset', () => {
    expect(presetById('anthropic').kind).toBe('anthropic')
    expect(presetById('dsh').backend).toBe('dsh')
    expect(presetById('dsh').kind).toBe('openai')
    expect(presetById('nope')).toBe(PROVIDER_PRESETS[0])
  })
})
