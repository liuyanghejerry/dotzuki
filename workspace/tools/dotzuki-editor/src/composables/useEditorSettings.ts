// ───────────────────────────────────────────────────────────────────────────
// Editor-level settings — module-level singleton. Editable, project-scoped
// settings that aren't part of the (read-only) `.dotzuki-editor.json` activity
// definitions. Persisted to `.dotzuki-editor.settings.json` via `/api/editor-settings`.
//
// Currently holds the game's logical screen size (drives the map camera box)
// and the AI assistant behavior switches (user-global skills, code execution).
// Screen layering: a saved override here wins; otherwise the map activity's
// declared `screen` default; otherwise a 160×144 Game Boy frame.
// ───────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import { useProjectStore } from '@/stores/project'
import type { MapActivityConfig } from '@/types/project'

/** AI assistant behavior knobs (Settings → AI assistant behavior). The server
 *  applies its own defaults for absent keys — keep these in sync with
 *  server/actions/assistantSettings.ts (DEFAULT_ASSISTANT_SETTINGS). */
export interface AssistantBehaviorSettings {
  /** Also discover skills from the user-global ~/.agents/skills/ dir. */
  includeUserSkills?: boolean
  /** Give the assistant run_command (arbitrary shell, cwd = project root). */
  allowCodeExecution?: boolean
}

export const DEFAULT_ASSISTANT_BEHAVIOR: Required<AssistantBehaviorSettings> = {
  includeUserSkills: true,
  allowCodeExecution: false,
}

export interface EditorSettings {
  screen?: { width: number; height: number }
  assistant?: AssistantBehaviorSettings
}

const settings = ref<EditorSettings>({})
let loadedOnce = false

export function useEditorSettings() {
  const project = useProjectStore()

  /** The screen size declared on the map activity, else a Game Boy frame. */
  const defaultScreen = computed(() => {
    const mapAct = project.config?.activities.find(a => a.type === 'map')
    const s = (mapAct?.config as MapActivityConfig | undefined)?.screen
    return s && s.width > 0 && s.height > 0
      ? { width: s.width, height: s.height }
      : { width: 160, height: 144 }
  })

  /** Effective screen size: saved override → map default → Game Boy. */
  const screen = computed(() => settings.value.screen ?? defaultScreen.value)

  /** Effective assistant behavior: saved overrides over the safe defaults. */
  const assistant = computed(() => ({ ...DEFAULT_ASSISTANT_BEHAVIOR, ...settings.value.assistant }))

  async function load(force = false): Promise<void> {
    if (loadedOnce && !force) return
    try {
      const resp = await fetch('/api/editor-settings')
      settings.value = resp.ok ? await resp.json() : {}
    } catch {
      settings.value = {}
    }
    loadedOnce = true
  }

  async function save(): Promise<void> {
    const resp = await fetch('/api/editor-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.value),
    })
    if (!resp.ok) throw new Error(await resp.json().then(j => j.error).catch(() => resp.statusText))
    loadedOnce = true
  }

  return { settings, screen, defaultScreen, assistant, load, save }
}
