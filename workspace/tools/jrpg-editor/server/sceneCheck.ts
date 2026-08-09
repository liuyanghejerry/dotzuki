// ───────────────────────────────────────────────────────────────────────────
// sceneCheck — verify a DRAFT `.scene` buffer WITHOUT committing it, so the chat
// agent can close the loop: draft → check → fix → re-check → propose only once
// it passes (instead of proposing DSL blind and letting the human discover the
// compile error on apply).
//
// Validation layers, in priority order:
//   1. `scene.checkCmd` (or legacy `scene.validateCmd`) — the draft is written
//      to a temp file and the project's own command runs against it, giving the
//      agent a REAL project compiler's output.
//   2. Built-in WASM compile (default) — the nodejs-target jrpg-web pkg
//      (`crates/jrpg-web/pkg-node`, built by `pnpm build:wasm`) runs the real
//      Game DSL compiler in-process. A compile pass is then layered with the
//      deterministic lint (dangling flags / hallucinated game.* APIs), since
//      the single-file compile does not check flag usage across the project or
//      game.* command names.
//   3. Lint only — when the WASM pkg is unavailable (not built / packaged
//      without it), we warn once and permanently degrade to the lint fallback,
//      clearly labeled so the agent (and the reader) know it is NOT a compile.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { ProjectContext } from './context/projectContext'
import { lintScene, type LintFinding } from './sceneLint'

export interface SceneCheckResult {
  ok: boolean
  /** 'compile' when a real compiler ran (checkCmd or WASM); 'lint' for the fallback. */
  source: 'compile' | 'lint'
  /** Compiler output or lint report, model/human-readable. */
  output: string
}

const CAP = 9000

// The editor root (tools/jrpg-editor/) — reconstructed from this module's URL
// (Vite dev), or pinned via JRPG_EDITOR_ROOT by the bundled Electron production
// server where import.meta.url no longer lives at server/. Same convention as
// the /wasm route in api/routes/content.ts.
const EDITOR_ROOT = process.env.JRPG_EDITOR_ROOT
  ? path.resolve(process.env.JRPG_EDITOR_ROOT)
  : path.resolve(fileURLToPath(import.meta.url), '..', '..')

interface WasmSceneCompiler {
  compile_scene(source: string): string
}

interface WasmCompileFail {
  ok: false
  error: string
  raw: string
  line: number
  col: number
}

// Lazy singleton: undefined = not attempted, null = unavailable (warned once,
// permanently degraded to lint for the rest of the process).
let wasmCompiler: WasmSceneCompiler | null | undefined

function wasmNodeRoot(): string {
  return process.env.JRPG_WASM_NODE_ROOT
    ? path.resolve(process.env.JRPG_WASM_NODE_ROOT)
    : path.resolve(EDITOR_ROOT, '../../crates/jrpg-web/pkg-node')
}

async function loadWasmCompiler(): Promise<WasmSceneCompiler | null> {
  if (wasmCompiler !== undefined) return wasmCompiler
  try {
    const entry = path.join(wasmNodeRoot(), 'jrpg_web.js')
    const mod = await import(pathToFileURL(entry).href)
    wasmCompiler = (mod.default ?? mod) as WasmSceneCompiler
  } catch (e) {
    console.warn(
      `[sceneCheck] jrpg-web nodejs WASM pkg not loadable (${(e as Error).message}); ` +
        'falling back to lint-only scene checks. Build it with `pnpm build:wasm`.',
    )
    wasmCompiler = null
  }
  return wasmCompiler
}

/** Test hook: drop the cached WASM compiler so a test can re-point JRPG_WASM_NODE_ROOT. */
export function _resetWasmCompilerForTests(): void {
  wasmCompiler = undefined
}

/** Run the WASM compiler; null when the pkg is unavailable (lint-only mode). */
async function compileSceneWasm(content: string): Promise<WasmCompileFail | null> {
  const wasm = await loadWasmCompiler()
  if (!wasm) return null
  try {
    const res = JSON.parse(wasm.compile_scene(content))
    if (res?.ok === true) return null
    return res as WasmCompileFail
  } catch (e) {
    // A throw from the wasm boundary is a compiler crash, not a scene error —
    // report it as a failure at 1:1 rather than crashing the check.
    return { ok: false, error: `compiler threw: ${(e as Error).message}`, raw: String(e), line: 1, col: 1 }
  }
}

function lintReport(findings: LintFinding[]): string {
  return findings.length
    ? findings.map(f => `[${f.severity}] line ${f.line}: ${f.message}`).join('\n')
    : 'OK: no flag/API issues found.'
}

/**
 * Compile (when the WASM pkg is available) + lint a scene buffer, returning
 * flat diagnostics for aggregation (jobs run-scene-check). Compile errors map
 * to a single warn finding at the reported position; lint findings pass through.
 */
export async function checkSceneFindings(project: ProjectContext, content: string): Promise<LintFinding[]> {
  const fail = await compileSceneWasm(content)
  if (fail) {
    return [{
      line: fail.line || 1,
      severity: 'warn',
      message: `Compile error at ${fail.line}:${fail.col}: ${fail.error}`,
    }]
  }
  return lintScene(project, content)
}

/**
 * Run the project's scene check against a draft buffer: checkCmd → WASM compile
 * + lint → lint only. Never mutates project files — a checkCmd draft goes to a
 * temp file that is removed afterward.
 */
export async function checkScene(project: ProjectContext, sceneName: string, content: string): Promise<SceneCheckResult> {
  const sc = (project.storyConfig() ?? {}) as any
  const cmdTmpl: string | undefined = sc.scene?.checkCmd ?? sc.scene?.validateCmd
  if (cmdTmpl) {
    const ext: string = sc.scene?.ext ?? '.scene'
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-scenecheck-'))
    const file = path.join(dir, `draft${ext}`)
    try {
      fs.writeFileSync(file, content, 'utf-8')
      const cmd = String(cmdTmpl).replace(/\{file\}/g, file).replace(/\{scene\}/g, sceneName || 'draft')
      const { execSync } = await import('child_process')
      try {
        const out = execSync(cmd, { cwd: project.root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 })
        return { ok: true, source: 'compile', output: (out || '').trim().slice(0, CAP) || 'OK: scene compiles.' }
      } catch (e: any) {
        const out = (String(e.stdout || '') + String(e.stderr || '') + (e.message ? '\n' + e.message : '')).trim()
        return { ok: false, source: 'compile', output: out.slice(0, CAP) || 'Scene failed to compile.' }
      }
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  // Default: real compile via the jrpg-web WASM compiler, then layer the lint
  // on top (the single-file compile does not check cross-scene flag usage or
  // game.* command names — lint catches those).
  const fail = await compileSceneWasm(content)
  if (fail) {
    const report = `compile FAIL at ${fail.line}:${fail.col}: ${fail.error}${fail.raw && fail.raw !== fail.error ? `\n${fail.raw}` : ''}`
    return { ok: false, source: 'compile', output: report.slice(0, CAP) }
  }
  if (await loadWasmCompiler()) {
    const findings = lintScene(project, content)
    const hasErr = findings.some(f => f.severity === 'warn')
    return {
      ok: !hasErr,
      source: 'compile',
      output: `compile PASS (jrpg-web WASM compiler)\n${lintReport(findings)}`.slice(0, CAP),
    }
  }

  // Fallback: deterministic lint (WASM compiler unavailable).
  const findings = lintScene(project, content)
  const hasErr = findings.some(f => f.severity === 'warn')
  return {
    ok: !hasErr,
    source: 'lint',
    output: (lintReport(findings) + '\n(note: lint only — the WASM scene compiler is unavailable, so this is NOT a full compile.)').slice(0, CAP),
  }
}
