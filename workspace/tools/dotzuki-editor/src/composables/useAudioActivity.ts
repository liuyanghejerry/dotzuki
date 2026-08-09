import { ref, computed } from 'vue'

// ── Track data model (mirrors dotzuki-audio's file-based `format` module) ──────

export type HwChannel = 'pulse1' | 'pulse2' | 'wave' | 'noise'
export type TrackKind = 'music' | 'sfx'

/** One audio command; `type` is the discriminator, the rest are its fields. */
export interface AudioCommand {
  type: string
  [field: string]: number | string
}

export interface ChannelDef {
  hw: HwChannel
  commands: AudioCommand[]
}

export interface TrackDef {
  id: string
  kind: TrackKind
  name?: string | null
  tempo?: number
  channels: ChannelDef[]
}

/** Lightweight list entry returned by GET /api/audio/list. */
export interface TrackSummary {
  file: string
  id: string
  kind: TrackKind
  name: string | null
  tempo: number | null
  channels: number
  error?: string
}

// ── Module-level singleton state (shared across mounts) ─────────────────────
const tracks = ref<TrackSummary[]>([])
const currentFile = ref<string | null>(null)
const current = ref<TrackDef | null>(null)
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const error = ref<string | null>(null)

async function jsonOrThrow(resp: Response) {
  if (!resp.ok) {
    const msg = await resp.json().then(j => j.error).catch(() => `HTTP ${resp.status}`)
    throw new Error(msg)
  }
  return resp.json()
}

export function useAudioActivity() {
  const musicTracks = computed(() => tracks.value.filter(t => t.kind === 'music'))
  const sfxTracks = computed(() => tracks.value.filter(t => t.kind === 'sfx'))

  async function loadList() {
    loading.value = true
    error.value = null
    try {
      tracks.value = await jsonOrThrow(await fetch('/api/audio/list'))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to list tracks'
      tracks.value = []
    } finally {
      loading.value = false
    }
  }

  async function open(file: string) {
    loading.value = true
    error.value = null
    try {
      const track = await jsonOrThrow(await fetch(`/api/audio/record?file=${encodeURIComponent(file)}`))
      currentFile.value = file
      current.value = track
      dirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to open track'
    } finally {
      loading.value = false
    }
  }

  async function save() {
    if (!currentFile.value || !current.value) return
    saving.value = true
    error.value = null
    try {
      await jsonOrThrow(
        await fetch(`/api/audio/save?file=${encodeURIComponent(currentFile.value)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(current.value),
        }),
      )
      dirty.value = false
      await loadList()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save track'
    } finally {
      saving.value = false
    }
  }

  async function create(id: string, kind: TrackKind) {
    error.value = null
    try {
      const res = await jsonOrThrow(
        await fetch('/api/audio/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, kind }),
        }),
      )
      await loadList()
      if (res.file) await open(res.file)
      return res.file as string
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create track'
      return null
    }
  }

  async function remove(file: string) {
    error.value = null
    try {
      await jsonOrThrow(await fetch(`/api/audio/delete?file=${encodeURIComponent(file)}`, { method: 'DELETE' }))
      if (currentFile.value === file) {
        currentFile.value = null
        current.value = null
      }
      await loadList()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete track'
    }
  }

  function markDirty() {
    dirty.value = true
  }

  return {
    tracks,
    musicTracks,
    sfxTracks,
    current,
    currentFile,
    loading,
    saving,
    dirty,
    error,
    loadList,
    open,
    save,
    create,
    remove,
    markDirty,
  }
}
