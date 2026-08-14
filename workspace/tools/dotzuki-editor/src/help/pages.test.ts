import { describe, expect, it } from 'vitest'
import { HELP_PAGES } from './pages'
import { renderMarkdown } from '@/composables/useMarkdown'

describe('help pages', () => {
  it('bundles every page with non-empty markdown', () => {
    expect(HELP_PAGES.length).toBeGreaterThanOrEqual(1)
    for (const page of HELP_PAGES) {
      expect(page.source.length, page.id).toBeGreaterThan(100)
      expect(page.source, page.id).toMatch(/^# .+/m)
    }
  })

  it('renders each reference page to headings', () => {
    for (const page of HELP_PAGES) {
      const html = renderMarkdown(page.source)
      expect(html, page.id).toContain('<h1>')
    }
  })

  it('has unique page ids and titles', () => {
    const ids = HELP_PAGES.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const titles = HELP_PAGES.map(p => p.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
