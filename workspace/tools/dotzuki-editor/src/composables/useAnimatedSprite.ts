// ───────────────────────────────────────────────────────────────────────────
// Animated sprite generation (PerfectPixel-style) — talks to the dev-server
// /api/sprites/{presets,directions,animated} + the SSE /api/ai/generate-animated.
// The heavy pipeline runs server-side; this is just catalog loading + the SSE
// driver + URL helpers for previewing the result sheet/manifest from /gfx.
// ───────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { streamSse } from './useAiStream'

export interface PresetInfo {
  name: string
  label: string
  category: string
  action: string
  frames: number
  fps: number
  loop: boolean
}

export interface DirectionInfo {
  key: string
  label: string
  short: string
  mirrorOf: string
  row: number
  col: number
}

export interface FrameRect { x: number; y: number; w: number; h: number }
export interface AnimationEntry {
  row: number
  frames: number
  fps: number
  loop: boolean
  durationMs: number
  pivot: { x: number; y: number }
  rects: FrameRect[]
  trims: FrameRect[]
}
export interface AnimManifest {
  character: string
  sheet: { image: string; width: number; height: number; cellWidth: number; cellHeight: number }
  animations: Record<string, AnimationEntry>
}

export interface AnimScore { identity: number; motion: number; contact: number; overall: number }
export interface AnimStateResult { name: string; found: number; expected: number; warnings: string[]; scores: AnimScore }

export interface AnimGenResult {
  ok: boolean
  dir: string
  manifest: AnimManifest
  frames: string[]
  states: AnimStateResult[]
}

const presets = ref<PresetInfo[]>([])
const directions = ref<DirectionInfo[]>([])
let loaded = false

export function useAnimatedSprite() {
  async function loadCatalogs(force = false): Promise<void> {
    if (loaded && !force) return
    const [p, d] = await Promise.all([
      fetch('/api/sprites/presets').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/sprites/directions').then((r) => (r.ok ? r.json() : [])),
    ])
    presets.value = p
    directions.value = d
    loaded = true
  }

  async function loadExisting(id: string): Promise<{ exists: boolean; dir: string; manifest?: AnimManifest; frames?: string[] }> {
    const r = await fetch(`/api/sprites/animated?id=${encodeURIComponent(id)}`)
    return r.ok ? r.json() : { exists: false, dir: '' }
  }

  /** URL for a file under the animated set's gfx dir (cache-busted by `v`). */
  function gfxUrl(dir: string, name: string, v = 0): string {
    return `/gfx/${dir}/${name}?v=${v}`
  }

  /** Drive the SSE generation; onEvent receives ("progress"|"done"|"error", data). */
  function generate(body: unknown, onEvent: (event: string, data: any) => void): Promise<void> {
    return streamSse('/api/ai/generate-animated', body, onEvent)
  }

  return { presets, directions, loadCatalogs, loadExisting, gfxUrl, generate }
}
