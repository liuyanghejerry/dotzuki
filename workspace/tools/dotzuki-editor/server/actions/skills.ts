// ───────────────────────────────────────────────────────────────────────────
// Agent skills — progressive disclosure over SKILL.md directories.
//
// Each skill is a folder with a SKILL.md (YAML frontmatter `name` /
// `description` + Markdown instructions). At turn start we discover only the
// name/description pairs and fold them into the system prompt; when a request
// matches a skill, the agent calls the load_skill tool to pull the full
// SKILL.md body into context. Bundled sibling files (scripts/, references/,
// templates/…) need no special mechanism — the agent reads them with the
// ordinary read_file tool, relative to the skillDirectory in the tool result.
//
// Scan order (first skill with a given name wins — project overrides user):
//
//   1. <projectRoot>/skills/          project-local skills
//   2. <projectRoot>/.agents/skills/  project-local, agent-convention dir
//   3. ~/.agents/skills/              user-global skills (every project)
//
// Follows the AI SDK cookbook pattern (ai-sdk.dev/cookbook/guides/agent-skills);
// skills are project content, so they only exist when a project is open.
// `homeDir` parameters exist so tests can point the global dir at a temp dir.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ProjectContext } from '../context/projectContext'

export interface SkillMeta {
  name: string
  description: string
  /** Project-root-relative skill dir (e.g. "skills/balancing"), or an ABSOLUTE
   *  path for user-global skills under ~/.agents/skills/. */
  path: string
}

/** Discovery options: `homeDir` locates the user-global dir (tests inject a
 *  fake home); `includeUserSkills` (default true) is the Settings → AI
 *  assistant behavior toggle — off scans only the two project-local dirs. */
export interface SkillDiscoveryOptions {
  homeDir?: string
  includeUserSkills?: boolean
}

/** Per-skill body cap: keeps one load bounded (~8KB). */
const BODY_CAP = 8000

/** Directories scanned for skills, in precedence order. */
export function skillsDirs(project: ProjectContext, opts: SkillDiscoveryOptions = {}): string[] {
  const dirs = [
    path.join(project.root, 'skills'),
    path.join(project.root, '.agents', 'skills'),
  ]
  if (opts.includeUserSkills !== false) dirs.push(path.join(opts.homeDir ?? os.homedir(), '.agents', 'skills'))
  return dirs
}

/**
 * Scan every skills dir for valid SKILL.md files. Invalid entries (no
 * SKILL.md, no frontmatter, no name) are skipped; the first skill with a
 * given name wins (earlier dirs override later ones). Missing dirs → skipped.
 */
export function discoverSkills(project: ProjectContext, opts: SkillDiscoveryOptions = {}): SkillMeta[] {
  const skills: SkillMeta[] = []
  const seen = new Set<string>()
  for (const dir of skillsDirs(project, opts)) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = path.join(dir, entry.name)
      let content: string
      try {
        content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8')
      } catch {
        continue
      }
      const fm = parseFrontmatter(content)
      if (!fm.name || seen.has(fm.name)) continue
      seen.add(fm.name)
      // Project-local dirs surface as root-relative paths (read_file can reach
      // them); user-global skills stay absolute.
      const rel = path.relative(project.root, skillDir)
      const display = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : skillDir
      skills.push({ name: fm.name, description: fm.description ?? '', path: display })
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Read one skill's full instructions: the SKILL.md body with the frontmatter
 * stripped, plus the skill directory so the agent can resolve bundled files
 * with read_file. Unknown name → null (caller renders the error).
 */
export function loadSkill(
  project: ProjectContext, name: string, opts: SkillDiscoveryOptions = {},
): { skillDirectory: string; content: string } | null {
  const wanted = String(name).trim().toLowerCase()
  const skill = discoverSkills(project, opts).find(s => s.name.toLowerCase() === wanted)
  if (!skill) return null
  const abs = path.isAbsolute(skill.path) ? skill.path : path.join(project.root, skill.path)
  const raw = fs.readFileSync(path.join(abs, 'SKILL.md'), 'utf-8')
  return { skillDirectory: skill.path, content: stripFrontmatter(raw).slice(0, BODY_CAP) }
}

/** Minimal frontmatter parse: single-line `key: value` pairs (we only need name/description). */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m?.[1]) return {}
  const out: { name?: string; description?: string } = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].toLowerCase()
    if (key !== 'name' && key !== 'description') continue
    // Strip one layer of surrounding quotes, if present.
    const value = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2').trim()
    if (value) out[key] = value
  }
  return out
}

/** Drop the leading `--- … ---` frontmatter block, leaving the Markdown body. */
export function stripFrontmatter(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return (m ? content.slice(m[0].length) : content).trim()
}
