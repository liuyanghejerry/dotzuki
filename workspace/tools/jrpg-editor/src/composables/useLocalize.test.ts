// ───────────────────────────────────────────────────────────────────────────
// useLocalize tests — pickLocalized is pure and covered exhaustively.
// useLocalize itself is a thin vue-i18n binding; the node test env has no
// component/i18n-instance context, so vue-i18n is replaced with a minimal
// mock exposing a mutable locale ref (mirrors how useScheduler.test.ts
// exercises pure seams instead of store wiring).
// ───────────────────────────────────────────────────────────────────────────
import { beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = vi.hoisted(() => ({ locale: { value: 'en' } }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: i18nState.locale }) }))

import { pickLocalized, useLocalize } from './useLocalize'

describe('pickLocalized', () => {
  it('passes plain strings through unchanged, whatever the locale', () => {
    expect(pickLocalized('Items', 'en')).toBe('Items')
    expect(pickLocalized('Items', 'zh')).toBe('Items')
    expect(pickLocalized('Items', 'fr', 'fallback')).toBe('Items')
  })

  it('returns the fallback for null and undefined', () => {
    expect(pickLocalized(null, 'en')).toBe('')
    expect(pickLocalized(undefined, 'en')).toBe('')
    expect(pickLocalized(null, 'en', 'N/A')).toBe('N/A')
    expect(pickLocalized(undefined, 'zh', 'N/A')).toBe('N/A')
  })

  it('picks the requested locale when present', () => {
    const label = { en: 'Items', zh: '道具' }
    expect(pickLocalized(label, 'en')).toBe('Items')
    expect(pickLocalized(label, 'zh')).toBe('道具')
  })

  it('falls back to en, then zh, when the requested locale is missing', () => {
    expect(pickLocalized({ en: 'Items', zh: '道具' }, 'fr')).toBe('Items')
    expect(pickLocalized({ zh: '道具' }, 'fr')).toBe('道具')
    expect(pickLocalized({ zh: '道具' }, 'en')).toBe('道具')
  })

  it('falls back to the first non-empty entry when neither en nor zh exist', () => {
    expect(pickLocalized({ ja: 'アイテム', fr: 'Objets' }, 'de')).toBe('アイテム')
  })

  it('treats empty-string entries as missing and falls through', () => {
    expect(pickLocalized({ zh: '', en: 'Items' }, 'zh')).toBe('Items')
    expect(pickLocalized({ en: '', zh: '道具' }, 'fr')).toBe('道具')
  })

  it('returns the fallback when every entry is empty or the map is empty', () => {
    expect(pickLocalized({ en: '', zh: '' }, 'en', 'N/A')).toBe('N/A')
    expect(pickLocalized({}, 'en', 'N/A')).toBe('N/A')
    expect(pickLocalized({}, 'en')).toBe('')
  })

  it('degrades non-string scalar inputs to the fallback instead of crashing', () => {
    expect(pickLocalized(42 as any, 'en', 'N/A')).toBe('N/A')
    expect(pickLocalized(true as any, 'en', 'N/A')).toBe('N/A')
  })
})

describe('useLocalize', () => {
  beforeEach(() => {
    i18nState.locale.value = 'en'
  })

  it('exposes the active locale from useI18n', () => {
    i18nState.locale.value = 'zh'
    const { locale } = useLocalize()
    expect(locale.value).toBe('zh')
  })

  it('resolves labels against the active locale and forwards the fallback', () => {
    i18nState.locale.value = 'zh'
    const { localize } = useLocalize()
    expect(localize({ en: 'Items', zh: '道具' })).toBe('道具')
    expect(localize(null, 'N/A')).toBe('N/A')
    expect(localize({ zh: '' })).toBe('')
  })

  it('reads the locale at call time, so switching languages re-resolves', () => {
    const { localize } = useLocalize()
    const label = { en: 'Items', zh: '道具' }
    expect(localize(label)).toBe('Items')
    i18nState.locale.value = 'zh'
    expect(localize(label)).toBe('道具')
  })
})
