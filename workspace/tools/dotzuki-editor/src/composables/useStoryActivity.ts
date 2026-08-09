// ───────────────────────────────────────────────────────────────────────────
// Story Designer activity state — module-level singleton (shared across the
// sidebar and the views), mirroring useDataActivity's shape.
// ───────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '@/stores/project'
import { useEditorStore } from '@/stores/editor'
import { computeIssues } from '@/composables/useStoryLint'
import { pickLocalized } from '@/composables/useLocalize'
import { useAiProviders } from '@/composables/useAiProviders'
import type {
  Character, Quest, Arc, StoryGraph, StoryKind, LocalizedText,
} from '@/types'

export type StoryView = 'graph' | 'characters' | 'quests' | 'arcs' | 'issues'

// ── Shared state ──────────────────────────────────────────────────────────
const view = ref<StoryView>('graph')
const characters = ref<Character[]>([])
const quests = ref<Quest[]>([])
const arcs = ref<Arc[]>([])
const graph = ref<StoryGraph>({ edges: [] })
const flags = ref<string[]>([])
/** Available `.scene` files (stem + storyline names + file path) for quest linking. */
const scenes = ref<{ stem: string; names: string[]; path: string }[]>([])
const selectedKind = ref<StoryKind | null>(null)
const selectedRecord = ref<any | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
let loadedOnce = false

function listRef(kind: StoryKind) {
  return kind === 'characters' ? characters : kind === 'quests' ? quests : arcs
}

async function getJson(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(await resp.json().then(j => j.error).catch(() => resp.statusText))
  return resp.json()
}

async function putJson(url: string, body: unknown): Promise<void> {
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(await resp.json().then(j => j.error).catch(() => resp.statusText))
}

export function useStoryActivity() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const { locale } = useI18n()
  const ai = useAiProviders()

  const activity = computed(() =>
    editor.activeActivity ? project.getActivity(editor.activeActivity) : undefined,
  )
  const config = computed<any>(() => activity.value?.config ?? {})
  const locales = computed<string[]>(() => config.value.locales ?? ['en', 'zh'])

  const issues = computed(() => computeIssues(characters.value, quests.value, flags.value))

  /** Edges shown in the graph: explicit + auto-derived from sets→requires flags. */
  const derivedEdges = computed(() => {
    const out: { from: string; to: string; kind: string; derived?: boolean }[] = []
    for (const e of graph.value.edges ?? []) out.push({ ...e })
    const seen = new Set(out.map(e => `${e.from}->${e.to}`))
    for (const a of quests.value) {
      for (const b of quests.value) {
        if (a.id === b.id) continue
        const shares = (a.sets ?? []).some(f => (b.requires ?? []).includes(f))
        if (shares && !seen.has(`${a.id}->${b.id}`)) {
          out.push({ from: a.id, to: b.id, kind: 'unlocks', derived: true })
          seen.add(`${a.id}->${b.id}`)
        }
      }
    }
    return out
  })

  function emptyLocalized(): LocalizedText {
    return Object.fromEntries(locales.value.map(l => [l, '']))
  }

  function blankRecord(kind: StoryKind): any {
    if (kind === 'characters') {
      return {
        id: '', name: emptyLocalized(), role: '', tags: [],
        appearance: '', personality: '', backstory: '', motivation: '', speechStyle: '',
        relationships: [], engine: { npcs: [], dataRef: null, spriteAsset: null },
        spriteSpec: null, status: 'idea',
      } as Character
    }
    if (kind === 'quests') {
      return {
        id: '', title: emptyLocalized(), type: 'side', arc: '', summary: '',
        giver: '', characters: [], maps: [], objectives: [],
        requires: [], sets: [], rewards: [], implementedBy: [], status: 'idea',
      } as Quest
    }
    return { id: '', title: emptyLocalized(), order: arcs.value.length, summary: '', beats: [] } as Arc
  }

  // ── Loading ───────────────────────────────────────────────────────────
  async function loadKind(kind: StoryKind) {
    listRef(kind).value = await getJson(`/api/stories/${kind}`)
  }

  async function loadAll(force = false) {
    if (loadedOnce && !force) return
    loading.value = true
    error.value = null
    try {
      const [c, q, a, g, fl, sc] = await Promise.all([
        getJson('/api/stories/characters'),
        getJson('/api/stories/quests'),
        getJson('/api/stories/arcs'),
        getJson('/api/stories/graph'),
        getJson('/api/flags'),
        getJson('/api/scenes').catch(() => []),
      ])
      characters.value = c
      quests.value = q
      arcs.value = a
      graph.value = g && Array.isArray(g.edges) ? g : { edges: [] }
      flags.value = fl
      scenes.value = Array.isArray(sc) ? sc : []
      loadedOnce = true
      void ai.loadProviders()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load story data'
    } finally {
      loading.value = false
    }
  }

  // ── Selection / editing ───────────────────────────────────────────────
  function setView(v: StoryView) {
    view.value = v
    // 只有 characters/quests/arcs 这三种编辑视图会把 selectedRecord 当作表单渲染。
    // 切到「不同种类」的编辑视图时清掉选中，避免记录串味到错误的编辑器；
    // 但切到与当前选中同种类的视图时要保留选中 —— 这样从剧情总览/问题面板
    // 里 select() 后再 setView() 跳转到某条记录时，能真正定位并打开它。
    if (v === 'characters' || v === 'quests' || v === 'arcs') {
      if (selectedKind.value !== v) selectedRecord.value = null
      selectedKind.value = v
    }
  }

  function select(kind: StoryKind, id: string) {
    selectedKind.value = kind
    const rec = listRef(kind).value.find((r: any) => r.id === id)
    selectedRecord.value = rec ? JSON.parse(JSON.stringify(rec)) : null
  }

  function create(kind: StoryKind) {
    selectedKind.value = kind
    selectedRecord.value = blankRecord(kind)
  }

  async function save(kind: StoryKind, record: any) {
    if (!record.id) { error.value = 'An id is required before saving.'; return }
    saving.value = true
    error.value = null
    try {
      await putJson(`/api/stories/${kind}/${encodeURIComponent(record.id)}`, record)
      await loadKind(kind)
      selectedRecord.value = JSON.parse(JSON.stringify(record))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save'
    } finally {
      saving.value = false
    }
  }

  async function remove(kind: StoryKind, id: string) {
    saving.value = true
    error.value = null
    try {
      const resp = await fetch(`/api/stories/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error(resp.statusText)
      await loadKind(kind)
      if (selectedRecord.value?.id === id) selectedRecord.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete'
    } finally {
      saving.value = false
    }
  }

  async function saveGraph(next: StoryGraph) {
    await putJson('/api/stories/graph', next)
    graph.value = next
  }

  function charName(id: string): string {
    const c = characters.value.find(x => x.id === id)
    if (!c) return id
    // Follow the active UI locale (with en/zh fallback) rather than the
    // project's first authoring locale, so names match the language switcher.
    return pickLocalized(c.name, locale.value, id)
  }

  return {
    // state
    view, characters, quests, arcs, graph, flags, providers: ai.providers, scenes,
    selectedKind, selectedRecord, loading, saving, error,
    // derived
    config, locales, issues, derivedEdges,
    // actions
    loadAll, loadKind, setView, select, create, save, remove,
    saveGraph, saveProviders: ai.saveProviders, blankRecord, emptyLocalized, charName,
  }
}
