import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ───────────────────────────────────────────────────────────────────────────
// Tile-library activity store — the global shared 16px tile store (decision:
// tiles live in one library, tilesets/maps are curated subsets of it).
//
// Tiles are individual `<id>.png` files plus a `library.json` index, served by
// the dev server under `/api/tiles…`. Stage 1 (harvest) crops cells from an AI
// map image (a backdrop) into this library; later stages pixel-edit and
// assemble them into tilesets.
// ───────────────────────────────────────────────────────────────────────────

/** One tile in the library (`<id>.png` + this metadata row in library.json). */
export interface TileEntry {
  id: string
  name?: string
  /** Provenance: the map id this tile was harvested from (if any). */
  source?: string
  tags?: string[]
}

/** A harvest backdrop — a map's full image, served via the maps endpoint. */
export interface BackdropEntry {
  map: string
  file: string
  url: string
}

/**
 * A building group (建筑): a W×H-tile composite assembled from library tiles,
 * stored as one composed `groups/<id>.png` that is pixel-edited as a single
 * canvas and stamped whole onto maps. `cells` (source tile ids, row-major,
 * length w*h) is kept only so the grid assembler can re-open a layout; the PNG
 * is the source of truth for rendering and stamping.
 */
export interface GroupEntry {
  id: string
  name: string
  /** Width / height in tiles. */
  w: number
  h: number
  cells?: (string | null)[]
}

/**
 * One layer in a pixel-editor sidecar. Raster layers store full RGBA; contour
 * layers store only the fill silhouette (the dark outline is derived at render
 * time, never baked here). `png` is that layer's own w×h image as a data-URL.
 */
export interface SidecarLayer {
  id: string
  name: string
  kind: 'raster' | 'contour'
  visible: boolean
  /** 0..1 layer opacity. */
  opacity: number
  outline?: string
  fill?: string
  width?: number
  /** Contour shading style + params (absent → 'flat', the classic split). */
  mode?: 'flat' | 'ring' | 'ramp' | 'directional'
  levels?: number
  angle?: number
  png: string
}

/**
 * The editing-time layer structure stored alongside a tile/group's flat PNG, so
 * reopening the pixel editor can resume layered editing. The flat PNG stays the
 * canonical artifact the engine consumes; the sidecar is purely additive.
 */
export interface SidecarDoc {
  v: number
  w: number
  h: number
  tileSize?: number
  layers: SidecarLayer[]
}

export const useTilesActivity = defineStore('tilesActivity', () => {
  const tiles = ref<TileEntry[]>([])
  const backdrops = ref<BackdropEntry[]>([])
  const groups = ref<GroupEntry[]>([])
  /**
   * Library tiles minus machine-minted slice tiles: building-group copies
   * (`source` 'group:*', minted while stamping a group onto a map) and
   * reference-trace cells (`source` 'trace:*', minted when a map's backdrop is
   * converted straight into a tilemap). Both are the map's own private tiles —
   * they shouldn't clutter the harvest grid or be hand-added to tilesets.
   */
  const libraryTiles = computed(() =>
    tiles.value.filter((t) => !t.source?.startsWith('group:') && !t.source?.startsWith('trace:')),
  )
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Bumped after each save so thumbnail `<img>` URLs bust the browser cache. */
  const version = ref(0)

  async function loadLibrary() {
    loading.value = true
    error.value = null
    try {
      const r = await fetch('/api/tiles')
      const j = await r.json()
      tiles.value = (j.tiles ?? []) as TileEntry[]
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function loadBackdrops() {
    try {
      const r = await fetch('/api/tiles-backdrops')
      backdrops.value = (await r.json()) as BackdropEntry[]
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /**
   * POST a PNG data-URL (or raw base64) into the library; returns the tile id.
   * Pass `opts.id` to overwrite an existing tile (Stage-2 pixel edits); omit it
   * to mint the next free `t####` id (Stage-1 harvest).
   */
  async function saveTile(
    pngBase64: string,
    opts: { id?: string; source?: string; name?: string; layers?: SidecarDoc | null } = {},
  ): Promise<string | null> {
    error.value = null
    try {
      const r = await fetch('/api/tiles-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pngBase64, ...opts }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'save failed')
      version.value++
      await loadLibrary()
      return j.id as string
    } catch (e) {
      error.value = (e as Error).message
      return null
    }
  }

  /** Harvest many cells at once (drag-select). Returns the new tile ids. */
  async function saveTiles(items: { pngBase64: string; source?: string }[]): Promise<string[]> {
    error.value = null
    try {
      const r = await fetch('/api/tiles-save-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiles: items }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'batch save failed')
      version.value++
      await loadLibrary()
      return (j.ids ?? []) as string[]
    } catch (e) {
      error.value = (e as Error).message
      return []
    }
  }

  /** Remove a tile from the library (deletes its `<id>.png` + index row). */
  async function deleteTile(id: string): Promise<boolean> {
    error.value = null
    try {
      const r = await fetch('/api/tiles-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'delete failed')
      version.value++
      await loadLibrary()
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    }
  }

  /** Remove many tiles at once (batch) — one server round-trip + one index rewrite. */
  async function deleteTiles(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true
    error.value = null
    try {
      const r = await fetch('/api/tiles-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'delete failed')
      version.value++
      await loadLibrary()
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    }
  }

  function tileUrl(id: string): string {
    return `/api/tiles/file/${id}.png?v=${version.value}`
  }
  function tileLayersUrl(id: string): string {
    return `/api/tiles-layers?id=${encodeURIComponent(id)}&v=${version.value}`
  }

  // ── Building groups (建筑) ──
  async function loadGroups() {
    try {
      const r = await fetch('/api/groups')
      const j = await r.json()
      groups.value = (j.groups ?? []) as GroupEntry[]
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  function groupUrl(id: string): string {
    return `/api/groups/file/${id}.png?v=${version.value}`
  }
  function groupLayersUrl(id: string): string {
    return `/api/groups-layers?id=${encodeURIComponent(id)}&v=${version.value}`
  }

  /**
   * Create or overwrite a building group. Pass `id` to update an existing one
   * (omitted fields are left unchanged server-side); omit it to mint a `g####`
   * id. Returns the group id.
   */
  async function saveGroup(g: {
    id?: string
    name?: string
    w?: number
    h?: number
    pngBase64: string
    cells?: (string | null)[]
    layers?: SidecarDoc | null
  }): Promise<string | null> {
    error.value = null
    try {
      const r = await fetch('/api/groups-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(g),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'group save failed')
      version.value++
      await loadGroups()
      return j.id as string
    } catch (e) {
      error.value = (e as Error).message
      return null
    }
  }

  /** Rename a building (index-only; the PNG/sidecar are untouched). */
  async function renameGroup(id: string, name: string): Promise<boolean> {
    error.value = null
    try {
      const r = await fetch('/api/groups-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'group rename failed')
      version.value++
      await loadGroups()
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    }
  }

  async function deleteGroup(id: string): Promise<boolean> {
    error.value = null
    try {
      const r = await fetch('/api/groups-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'group delete failed')
      version.value++
      await loadGroups()
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    }
  }

  // ── Map tileset I/O (consumed by the Map editor's own build flow) ──

  /** The saved tile sequence + column count for a map (empty if none yet). */
  async function loadTilesetSeq(map: string): Promise<{ tileIds: string[]; cols: number }> {
    try {
      const r = await fetch(`/api/tileset?map=${encodeURIComponent(map)}`)
      const j = await r.json()
      return { tileIds: j.tileIds ?? [], cols: j.cols ?? 8 }
    } catch {
      return { tileIds: [], cols: 8 }
    }
  }

  /** Write an assembled tileset PNG (+ tile sequence) into a map dir. */
  async function buildTileset(
    map: string,
    pngBase64: string,
    tileIds: string[],
    cols: number,
  ): Promise<boolean> {
    error.value = null
    try {
      const r = await fetch('/api/tileset-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map, pngBase64, tileIds, cols }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'build failed')
      version.value++ // tileset.png changed → bust image caches keyed on version
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    }
  }

  return {
    tiles, libraryTiles, backdrops, groups, loading, error, version,
    loadLibrary, loadBackdrops, loadTilesetSeq,
    saveTile, saveTiles, deleteTile, deleteTiles, buildTileset, tileUrl,
    tileLayersUrl,
    loadGroups, groupUrl, saveGroup, deleteGroup, renameGroup,
    groupLayersUrl,
  }
})
