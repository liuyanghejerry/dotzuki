// Agent skills: multi-dir discovery (project skills/ + .agents/skills/, user
// ~/.agents/skills/), precedence/dedupe, full-body loading with frontmatter
// stripping, and the load_skill tool impl. Everything runs in temp dirs — the
// homeDir parameter points the user-global dir at a fake home.
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProjectContext } from '../context/projectContext'
import { discoverSkills, loadSkill, stripFrontmatter } from './skills'
import { skillToolImpls } from './tools'
import { buildAssistantSystem } from './assistantSystem'
import type { ActionContext } from './types'

const EXTRA_DIRS: string[] = []

afterAll(() => {
  for (const d of EXTRA_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
})

/** Fresh fake home per case (holds the user-global ~/.agents/skills dir). */
function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-skills-home-'))
  EXTRA_DIRS.push(home)
  return home
}

/** Fresh project root per case so skills never mix across tests. */
function freshProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-skills-proj-'))
  EXTRA_DIRS.push(root)
  return createProjectContext(root)
}

/** Write a SKILL.md under `<base>/<dir>/` (base = project root or fake home). */
function writeSkill(base: string, dir: string, skillMd: string, sub = 'skills') {
  const abs = path.join(base, sub, dir)
  fs.mkdirSync(abs, { recursive: true })
  fs.writeFileSync(path.join(abs, 'SKILL.md'), skillMd, 'utf-8')
}

const VALID = `---
name: balancing
description: Rebalance stats/skills tables against the level curve.
---
# Balancing
## When to use this skill
Use when the user asks to rebalance numbers.
`

describe('discoverSkills', () => {
  it('returns [] when no skills dirs exist', () => {
    const home = freshHome()
    expect(discoverSkills(freshProject(), { homeDir: home })).toEqual([])
  })

  it('discovers a valid SKILL.md with name/description/path', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'balancing', VALID)
    expect(discoverSkills(proj, { homeDir: home })).toEqual([
      { name: 'balancing', description: 'Rebalance stats/skills tables against the level curve.', path: 'skills/balancing' },
    ])
  })

  it('scans the project .agents/skills dir too (root-relative path)', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'scene-doctor', '---\nname: scene-doctor\ndescription: Fix broken .scene files.\n---\nbody\n', path.join('.agents', 'skills'))
    expect(discoverSkills(proj, { homeDir: home })).toEqual([
      { name: 'scene-doctor', description: 'Fix broken .scene files.', path: path.join('.agents', 'skills', 'scene-doctor') },
    ])
  })

  it('scans the user-global ~/.agents/skills dir (absolute path)', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(home, 'shared', '---\nname: shared\ndescription: User-global skill.\n---\nbody\n', path.join('.agents', 'skills'))
    const found = discoverSkills(proj, { homeDir: home })
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('shared')
    expect(path.isAbsolute(found[0].path)).toBe(true)
    expect(found[0].path).toBe(path.join(home, '.agents', 'skills', 'shared'))
  })

  it('includeUserSkills: false excludes the user-global dir (the Settings toggle)', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(home, 'shared', '---\nname: shared\ndescription: User-global skill.\n---\nbody\n', path.join('.agents', 'skills'))
    writeSkill(proj.root, 'local', '---\nname: local\ndescription: Project skill.\n---\nbody\n')
    const found = discoverSkills(proj, { homeDir: home, includeUserSkills: false })
    expect(found.map(s => s.name)).toEqual(['local'])
    expect(loadSkill(proj, 'shared', { homeDir: home, includeUserSkills: false })).toBeNull()
  })

  it('precedence: project skills/ beats project .agents/skills/ beats user-global', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(home, 'dup', '---\nname: dup\ndescription: user-global loses\n---\nbody\n', path.join('.agents', 'skills'))
    writeSkill(proj.root, 'dup', '---\nname: dup\ndescription: .agents loses too\n---\nbody\n', path.join('.agents', 'skills'))
    writeSkill(proj.root, 'dup', '---\nname: dup\ndescription: project skills/ wins\n---\nbody\n')
    expect(discoverSkills(proj, { homeDir: home })).toEqual([
      { name: 'dup', description: 'project skills/ wins', path: 'skills/dup' },
    ])
  })

  it('skips entries without a SKILL.md, without frontmatter, or without a name', () => {
    const home = freshHome()
    const proj = freshProject()
    fs.mkdirSync(path.join(proj.root, 'skills', 'empty-dir'), { recursive: true })
    writeSkill(proj.root, 'no-frontmatter', '# just markdown, no frontmatter\n')
    writeSkill(proj.root, 'no-name', '---\ndescription: has a description but no name\n---\nbody\n')
    writeSkill(proj.root, 'good', VALID)
    expect(discoverSkills(proj, { homeDir: home }).map(s => s.name)).toEqual(['balancing'])
  })

  it('dedupes by name within a dir (first wins) and sorts by name', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'b-dir', '---\nname: zeta\ndescription: "quoted desc"\n---\nbody\n')
    writeSkill(proj.root, 'a-dir', '---\nname: alpha\ndescription: first\n---\nbody\n')
    writeSkill(proj.root, 'c-dir', '---\nname: alpha\ndescription: duplicate loses\n---\nbody\n')
    expect(discoverSkills(proj, { homeDir: home })).toEqual([
      { name: 'alpha', description: 'first', path: 'skills/a-dir' },
      { name: 'zeta', description: 'quoted desc', path: 'skills/b-dir' },
    ])
  })
})

describe('loadSkill', () => {
  it('returns the body without frontmatter plus the skill directory', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'balancing', VALID)
    const r = loadSkill(proj, 'balancing', { homeDir: home })
    expect(r).not.toBeNull()
    expect(r!.skillDirectory).toBe('skills/balancing')
    expect(r!.content).toBe('# Balancing\n## When to use this skill\nUse when the user asks to rebalance numbers.')
  })

  it('loads a user-global skill (absolute skillDirectory)', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(home, 'shared', '---\nname: shared\ndescription: d\n---\n# Shared\nbody\n', path.join('.agents', 'skills'))
    const r = loadSkill(proj, 'shared', { homeDir: home })
    expect(r).not.toBeNull()
    expect(r!.skillDirectory).toBe(path.join(home, '.agents', 'skills', 'shared'))
    expect(r!.content).toBe('# Shared\nbody')
  })

  it('matches the name case-insensitively', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'balancing', VALID)
    expect(loadSkill(proj, 'BALANCING', { homeDir: home })).not.toBeNull()
  })

  it('returns null for an unknown skill', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'balancing', VALID)
    expect(loadSkill(proj, 'nope', { homeDir: home })).toBeNull()
  })

  it('caps an oversized body', () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'big', `---\nname: big\ndescription: d\n---\n${'x'.repeat(9000)}`)
    expect(loadSkill(proj, 'big', { homeDir: home })!.content).toHaveLength(8000)
  })
})

describe('stripFrontmatter', () => {
  it('strips the block and surrounding blank lines; leaves frontmatter-less text alone', () => {
    expect(stripFrontmatter('---\nname: a\n---\n\nbody\n')).toBe('body')
    expect(stripFrontmatter('plain text')).toBe('plain text')
  })
})

describe('load_skill tool impl', () => {
  const ctxFor = (proj: ReturnType<typeof createProjectContext> | null) => ({
    actionId: 'assistant', input: {}, profile: {} as any, apiKey: 'k',
    project: proj, emit: () => {},
  }) as ActionContext

  it('loads a project-local skill by name', async () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(proj.root, 'balancing', VALID)
    const res = await skillToolImpls(ctxFor(proj), { homeDir: home }).load_skill({ name: 'balancing' })
    expect(res).toMatchObject({ skillDirectory: 'skills/balancing' })
    expect(String((res as any).content)).toContain('# Balancing')
    expect((res as any).note).toBeUndefined()
  })

  it('warns that read_file cannot reach a user-global skill\'s bundled files', async () => {
    const home = freshHome()
    const proj = freshProject()
    writeSkill(home, 'shared', '---\nname: shared\ndescription: d\n---\nbody\n', path.join('.agents', 'skills'))
    const res = await skillToolImpls(ctxFor(proj), { homeDir: home }).load_skill({ name: 'shared' }) as any
    expect(path.isAbsolute(res.skillDirectory)).toBe(true)
    expect(String(res.note)).toContain('read_file CANNOT reach')
  })

  it('reports an ERROR for an unknown skill', async () => {
    const home = freshHome()
    const res = await skillToolImpls(ctxFor(freshProject()), { homeDir: home }).load_skill({ name: 'nope' })
    expect(String(res)).toMatch(/^ERROR: skill "nope" not found/)
  })

  it('reports an ERROR when no project is open', async () => {
    const home = freshHome()
    const res = await skillToolImpls(ctxFor(null), { homeDir: home }).load_skill({ name: 'balancing' })
    expect(String(res)).toMatch(/^ERROR: no project is open/)
  })
})

describe('system prompt skills section', () => {
  it('lists discovered skills and points at load_skill; absent without skills', () => {
    const home = freshHome()
    const proj = freshProject()
    fs.writeFileSync(path.join(proj.root, '.jrpg-editor.json'),
      JSON.stringify({ name: 't', dataRoot: './data', activities: [] }), 'utf-8')
    const without = buildAssistantSystem(proj, 'hi')
    expect(without).not.toContain('## Skills')

    writeSkill(proj.root, 'balancing', VALID)
    const skills = discoverSkills(proj, { homeDir: home })
    const withSkills = buildAssistantSystem(proj, 'hi', [], undefined, undefined, skills)
    expect(withSkills).toContain('## Skills')
    expect(withSkills).toContain('load_skill')
    expect(withSkills).toContain('- balancing: Rebalance stats/skills tables against the level curve.')
  })
})
