// ───────────────────────────────────────────────────────────────────────────
// Assistant behavior settings — the "how much power does the AI get" knobs,
// edited in Settings → AI assistant behavior and persisted in the project-level
// `.jrpg-editor.settings.json` under the `assistant` key (same file as the
// screen resolution, written by PUT /api/editor-settings).
//
//   includeUserSkills  (default true)  — also discover skills from the
//                                        user-global ~/.agents/skills/ dir.
//   allowCodeExecution (default false) — register the run_command tool, letting
//                                        the agent execute arbitrary shell
//                                        commands with cwd = the project root.
//
// Read per chat turn (chat.ts) so toggling a switch applies on the next turn.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import path from 'path'
import type { ProjectContext } from '../context/projectContext'

export interface AssistantSettings {
  includeUserSkills: boolean
  allowCodeExecution: boolean
}

/** Safe defaults: user skills on (harmless read), code execution OFF. */
export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  includeUserSkills: true,
  allowCodeExecution: false,
}

/** The settings file shared with the other editor settings (screen size, …). */
export function editorSettingsFileFor(project: ProjectContext): string {
  return path.join(project.root, '.jrpg-editor.settings.json')
}

/**
 * Whitelist-sanitize an arbitrary `assistant` value from a PUT body or a
 * hand-edited file: booleans only, anything else falls back to the default.
 * Exported so the editor-settings route and the reader share one definition.
 */
export function sanitizeAssistantSettings(v: unknown): AssistantSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    includeUserSkills: typeof o.includeUserSkills === 'boolean' ? o.includeUserSkills : DEFAULT_ASSISTANT_SETTINGS.includeUserSkills,
    allowCodeExecution: typeof o.allowCodeExecution === 'boolean' ? o.allowCodeExecution : DEFAULT_ASSISTANT_SETTINGS.allowCodeExecution,
  }
}

/** Read the project's assistant settings (missing/unreadable file → defaults). */
export function readAssistantSettings(project: ProjectContext): AssistantSettings {
  try {
    const raw = fs.readFileSync(editorSettingsFileFor(project), 'utf-8')
    return sanitizeAssistantSettings(JSON.parse(raw)?.assistant)
  } catch {
    return { ...DEFAULT_ASSISTANT_SETTINGS }
  }
}
