// Assistant behavior settings: safe defaults, sanitize whitelist, file
// round-trip, the run_command tool impl (the allowCodeExecution surface), and
// the system-prompt line that announces it. Everything runs in temp dirs.
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProjectContext } from '../context/projectContext'
import {
  DEFAULT_ASSISTANT_SETTINGS, editorSettingsFileFor, readAssistantSettings, sanitizeAssistantSettings,
} from './assistantSettings'
import { execToolImpls } from './tools'
import { buildAssistantSystem } from './assistantSystem'
import type { ActionContext } from './types'

const EXTRA_DIRS: string[] = []
afterAll(() => {
  for (const d of EXTRA_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
})

function freshProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-aset-proj-'))
  EXTRA_DIRS.push(root)
  return createProjectContext(root)
}

describe('sanitizeAssistantSettings', () => {
  it('falls back to the defaults for missing/non-boolean values', () => {
    expect(sanitizeAssistantSettings(undefined)).toEqual(DEFAULT_ASSISTANT_SETTINGS)
    expect(sanitizeAssistantSettings(null)).toEqual(DEFAULT_ASSISTANT_SETTINGS)
    expect(sanitizeAssistantSettings('yes')).toEqual(DEFAULT_ASSISTANT_SETTINGS)
    expect(sanitizeAssistantSettings({ includeUserSkills: 'no', allowCodeExecution: 1 })).toEqual(DEFAULT_ASSISTANT_SETTINGS)
  })

  it('keeps explicit booleans and drops unknown keys', () => {
    expect(sanitizeAssistantSettings({ includeUserSkills: false, allowCodeExecution: true, evil: 'x' }))
      .toEqual({ includeUserSkills: false, allowCodeExecution: true })
  })
})

describe('readAssistantSettings', () => {
  it('returns the defaults when the settings file is missing or invalid', () => {
    const proj = freshProject()
    expect(readAssistantSettings(proj)).toEqual(DEFAULT_ASSISTANT_SETTINGS)
    fs.writeFileSync(editorSettingsFileFor(proj), 'not json', 'utf-8')
    expect(readAssistantSettings(proj)).toEqual(DEFAULT_ASSISTANT_SETTINGS)
  })

  it('reads the assistant key from .dotzuki-editor.settings.json, preserving other keys\' absence', () => {
    const proj = freshProject()
    fs.writeFileSync(editorSettingsFileFor(proj),
      JSON.stringify({ screen: { width: 320, height: 240 }, assistant: { includeUserSkills: false } }), 'utf-8')
    expect(readAssistantSettings(proj)).toEqual({ includeUserSkills: false, allowCodeExecution: false })
  })
})

describe('run_command tool impl (allowCodeExecution surface)', () => {
  const ctxFor = (proj: ReturnType<typeof createProjectContext> | null) => ({
    actionId: 'assistant', input: {}, profile: {} as any, apiKey: 'k',
    project: proj, emit: () => {},
  }) as ActionContext

  it('executes a command with cwd = the project root', async () => {
    const proj = freshProject()
    fs.writeFileSync(path.join(proj.root, 'marker.txt'), 'hi', 'utf-8')
    const r = await execToolImpls(ctxFor(proj)).run_command({ command: 'pwd; cat marker.txt' }) as any
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain(fs.realpathSync(proj.root))
    expect(r.stdout).toContain('hi')
  })

  it('reports a non-zero exit code with stderr', async () => {
    const r = await execToolImpls(ctxFor(freshProject())).run_command({ command: 'echo oops >&2; exit 3' }) as any
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toContain('oops')
  })

  it('times out a hung command and says so', async () => {
    const r = await execToolImpls(ctxFor(freshProject())).run_command({ command: 'sleep 5', timeoutMs: 1000 }) as any
    expect(r.exitCode).toBe(-1)
    expect(String(r.note)).toContain('did not exit normally')
  }, 10_000)

  it('rejects an empty command and a missing project', async () => {
    expect(String(await execToolImpls(ctxFor(freshProject())).run_command({ command: '  ' }))).toMatch(/^ERROR/)
    expect(String(await execToolImpls(ctxFor(null)).run_command({ command: 'ls' }))).toMatch(/^ERROR: no project is open/)
  })
})

describe('system prompt code-execution line', () => {
  const projWithConfig = () => {
    const proj = freshProject()
    fs.writeFileSync(path.join(proj.root, '.dotzuki-editor.json'),
      JSON.stringify({ name: 't', dataRoot: './data', activities: [] }), 'utf-8')
    return proj
  }

  it('mentions run_command only when code execution is enabled', () => {
    const proj = projWithConfig()
    expect(buildAssistantSystem(proj, 'hi', [], undefined, undefined, [], false)).not.toContain('run_command')
    const on = buildAssistantSystem(proj, 'hi', [], undefined, undefined, [], true)
    expect(on).toContain('run_command is ENABLED')
    expect(on).toContain('propose_* tools')
  })
})
