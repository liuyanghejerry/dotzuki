import { setActivePinia, createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataActivity } from './useDataActivity'
import { useProjectStore } from '../stores/project'
import { useEditorStore } from '../stores/editor'

// The composable keeps module-level singleton refs; each test re-seeds them
// through the shared API object returned by useDataActivity().

type Call = { url: string; method: string; body?: string }

function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body })
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    const r = hit?.[1] ?? { status: 404, body: { error: `unmocked ${url}` } }
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  }))
  return calls
}

function setup() {
  const project = useProjectStore()
  project.config = {
    name: 'Test',
    dataRoot: 'data',
    activities: [{
      id: 'data', type: 'data', label: 'Data', icon: 'database', enabled: true,
      config: {
        tables: [{
          id: 'characters', label: 'Characters', dir: 'characters',
          fields: [
            { key: 'id', type: 'string', label: 'ID', required: true },
            { key: 'name', type: 'string', label: 'Name', required: true },
          ],
        }],
      },
    }],
  } as any
  useEditorStore().setActivity('data')
  const api = useDataActivity()
  api.selectedTableId.value = 'characters'
  api.selectedRecord.value = null
  api.records.value = []
  api.error.value = null
  return api
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe('useDataActivity save/delete file naming', () => {
  it('saves an existing record back to its _file name', async () => {
    const calls = mockFetch({ '/api/data/save/': { body: { ok: true } }, '/api/data/list/': { body: [] } })
    const api = setup()
    // A record loaded from /api/data/list carries `_file` (e.g. "hero.json");
    // the edit form re-emits schema fields only, so the file name must come
    // from the selected record, and it already ends in ".json".
    api.selectedRecord.value = { _file: 'hero.json', id: 'hero', name: 'Chen Mo' }

    await api.saveRecord({ id: 'hero', name: 'Chen Mo Edited' })

    const save = calls.find(c => c.url.startsWith('/api/data/save/'))
    expect(save?.method).toBe('PUT')
    expect(save?.url).toBe('/api/data/save/characters/hero.json')
    expect(JSON.parse(save!.body!).name).toBe('Chen Mo Edited')
    expect(api.selectedRecord.value).toBeNull() // panel closes on success
  })

  it('saves a new record to "<id>.json"', async () => {
    const calls = mockFetch({ '/api/data/save/': { body: { ok: true } }, '/api/data/list/': { body: [] } })
    const api = setup()
    api.newRecord() // default record from the table schema — no `_file`

    await api.saveRecord({ id: 'npc_trader', name: 'Trader' })

    const save = calls.find(c => c.url.startsWith('/api/data/save/'))
    expect(save?.url).toBe('/api/data/save/characters/npc_trader.json')
  })

  it('deletes via a bare id, normalized to "<id>.json"', async () => {
    const calls = mockFetch({ '/api/data/delete/': { body: { ok: true } }, '/api/data/list/': { body: [] } })
    const api = setup()

    await api.deleteRecord('hero')

    const del = calls.find(c => c.url.startsWith('/api/data/delete/'))
    expect(del?.method).toBe('DELETE')
    expect(del?.url).toBe('/api/data/delete/characters/hero.json')
  })

  it('deletes via a full file name unchanged (no double extension)', async () => {
    const calls = mockFetch({ '/api/data/delete/': { body: { ok: true } }, '/api/data/list/': { body: [] } })
    const api = setup()

    await api.deleteRecord('hero.json')

    expect(calls.find(c => c.url.startsWith('/api/data/delete/'))?.url)
      .toBe('/api/data/delete/characters/hero.json')
  })

  it('keeps the record open and surfaces the error on a failed save', async () => {
    mockFetch({ '/api/data/save/': { status: 400, body: { error: 'id "hero" is already used by "hero.json"' } } })
    const api = setup()
    api.selectedRecord.value = { _file: 'hero.json', id: 'hero', name: 'Chen Mo' }

    await api.saveRecord({ id: 'hero', name: 'Chen Mo' })

    expect(api.error.value).toBe('id "hero" is already used by "hero.json"')
    expect(api.selectedRecord.value).not.toBeNull()
  })
})
