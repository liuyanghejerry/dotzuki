import path from 'path'
import fs from 'fs'
import os from 'os'
import { setProjectRoot } from '../context/projectContext'

/**
 * The editor repo ships a package.json named "dotzuki-editor" — that is how we
 * detect "the dev server was started from the editor's own repo" (the usual
 * `pnpm dev` from tools/dotzuki-editor case).
 */
function looksLikeEditorRepo(cwd: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'))
    return pkg?.name === 'dotzuki-editor'
  } catch {
    return false
  }
}

/**
 * Compute the project root at startup:
 * - JRPG_PROJECT_ROOT always wins (the Electron shell sets it explicitly).
 * - A cwd holding a `.dotzuki-editor.json` is a game project — keep it.
 * - A cwd that is the editor's own repo falls back to ~/jrpg-projects so new
 *   projects are not scaffolded inside the editor repo. The directory is
 *   created lazily (the scaffolder mkdirs recursively); nothing here touches
 *   the filesystem beyond the reads above.
 * - Any other cwd keeps the historical behavior (cwd is the root).
 */
export function defaultProjectRoot(env: NodeJS.ProcessEnv, cwd: string, homedir: string): string {
  if (env.JRPG_PROJECT_ROOT) return env.JRPG_PROJECT_ROOT
  if (fs.existsSync(path.join(cwd, '.dotzuki-editor.json'))) return cwd
  if (looksLikeEditorRepo(cwd)) return path.join(homedir, 'jrpg-projects')
  return cwd
}

let projectRoot = defaultProjectRoot(process.env, process.cwd(), os.homedir())

export interface ProjectConfig {
  name: string
  dataRoot: string
  gfxRoot?: string
  activities: ActivityDef[]
}

export interface ActivityDef {
  id: string
  type: 'map' | 'script' | 'data' | 'assets' | 'story' | 'ui' | 'audio' | 'play'
  config: Record<string, unknown>
  enabled?: boolean
}

export interface TableDef {
  id: string
  dir: string
  /** Record id field (defaults to "id") — read by the data routes + flag scan. */
  idField?: string
}

let cachedConfig: ProjectConfig | null = null

export function getProjectRoot(): string {
  return projectRoot
}

export function setProjectRootDir(dir: string): void {
  projectRoot = dir
  cachedConfig = null
  setProjectRoot(dir)
}

export function resetConfigCache(): void {
  cachedConfig = null
}

export function configFile() { return path.join(projectRoot, '.dotzuki-editor.json') }

export function loadConfig(): ProjectConfig {
  if (cachedConfig) return cachedConfig
    if (!fs.existsSync(configFile())) {
    throw new Error(`No .dotzuki-editor.json found in ${projectRoot}. Run 'dotzuki-editor init' first.`)
  }
  cachedConfig = JSON.parse(fs.readFileSync(configFile(), 'utf-8'))
  return cachedConfig!
}

export function resolveDataPath(relative: string): string {
  const cfg = loadConfig()
  return path.resolve(projectRoot, cfg.dataRoot, relative)
}

export function resolveGfxPath(relative: string): string {
  const cfg = loadConfig()
  return path.resolve(projectRoot, cfg.gfxRoot ?? 'gfx', relative)
}
