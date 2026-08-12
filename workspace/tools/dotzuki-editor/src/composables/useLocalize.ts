import { useI18n } from 'vue-i18n'

/**
 * A display value that may be a plain string or a per-locale map, e.g.
 * `{ en: "Items", zh: "道具" }`. Config labels (.dotzuki-editor.json) and the
 * Story bible's `LocalizedText` fields both use this shape.
 */
export type Localized = string | Record<string, string> | null | undefined

/**
 * Pure resolver — pick the best string for `loc` from a plain string or a
 * `{ locale: text }` map. Preference order: the requested locale, then `en`,
 * then `zh`, then the first non-empty value, then `fallback`. Uses `||` (not
 * `??`) so empty-string entries fall through to the next candidate.
 */
export function pickLocalized(value: Localized, loc: string, fallback = ''): string {
  if (value == null) return fallback
  if (typeof value === 'string') return value
  return value[loc] || value.en || value.zh || Object.values(value).find(Boolean) || fallback
}

/**
 * Component composable — resolves localized labels against the active UI
 * locale. Reading `locale.value` inside `localize()` keeps callers reactive, so
 * labels re-render when the language switcher changes.
 */
export function useLocalize() {
  const { locale } = useI18n()
  const localize = (value: Localized, fallback = ''): string =>
    pickLocalized(value, locale.value, fallback)
  return { localize, locale }
}
