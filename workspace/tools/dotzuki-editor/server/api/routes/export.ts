// @ts-nocheck -- route handlers use the loose dev-server types (see assets.ts)
// ──────────────────────────────────────────────────────────────────────────
// Game export — POST /api/export { target?: 'web' | 'native' } shells out to
// the dotzuki CLI (`dotzuki export --web|--native`) so the editor's export is
// byte-identical to the command-line one: same bundle rules, same diagnostic
// gate, same player artifacts. Nothing about bundling is reimplemented here.
//
// CLI resolution order:
//   1. DOTZUKI_CLI env (packaged Electron app: main.cjs points it at
//      Resources/cli/dotzuki; developers can override too)
//   2. the workspace's target/{release,debug}/dotzuki (dev checkout)
// Web exports always get --runner-pkg pointing at the SAME runner wasm pkg
// the Play activity uses, so a packaged app (no source tree inside) never
// needs wasm-pack. Native exports in a packaged app get --player-bin from
// DOTZUKI_PLAYER (Resources/cli/dotzuki-player); in a dev checkout the CLI
// cargo-builds the player itself.
// ──────────────────────────────────────────────────────────────────────────
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { sendJson, sendError, readBody } from '../http'
import { getProjectRoot, configFile } from '../projectConfig'

const TARGETS = new Set(['web', 'native'])

/** Longest a single export may take (a cold native player build is minutes). */
const EXPORT_TIMEOUT_MS = 10 * 60 * 1000

// The editor root (tools/dotzuki-editor/) — same reconstruction as
// content.ts (DOTZUKI_EDITOR_ROOT pins it under the bundled Electron server).
// Computed per call (not a module const) so tests can repoint the env.
function editorRoot() {
  return process.env.DOTZUKI_EDITOR_ROOT
    ? path.resolve(process.env.DOTZUKI_EDITOR_ROOT)
    : path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')
}

function exeName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base
}

/** Locate the `dotzuki` CLI binary, or null with a reason for the 400. */
export function findDotzukiCli() {
  if (process.env.DOTZUKI_CLI && fs.existsSync(process.env.DOTZUKI_CLI)) {
    return process.env.DOTZUKI_CLI
  }
  const workspace = path.resolve(editorRoot(), '..', '..')
  for (const profile of ['release', 'debug']) {
    const candidate = path.join(workspace, 'target', profile, exeName('dotzuki'))
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** The runner wasm pkg dir — the same one the /wasm route serves Play from. */
export function findRunnerPkg() {
  return process.env.DOTZUKI_RUNNER_WASM_ROOT
    ? path.resolve(process.env.DOTZUKI_RUNNER_WASM_ROOT)
    : path.resolve(editorRoot(), '..', '..', 'crates', 'dotzuki-runner-web', 'pkg')
}

export function registerExport(server: any) {
  server.middlewares.use('/api/export', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return }
    try {
      const root = getProjectRoot()
      if (!root || !fs.existsSync(configFile())) {
        return sendError(res, 'No project open — open a folder with .dotzuki-editor.json first', 400)
      }

      let target = 'web'
      try {
        const body = JSON.parse((await readBody(req)) || '{}')
        if (body.target !== undefined) target = body.target
      } catch {
        return sendError(res, 'Request body must be JSON ({ "target": "web" | "native" })', 400)
      }
      if (!TARGETS.has(target)) {
        return sendError(res, `Unknown export target '${target}' (expected web|native)`, 400)
      }

      const cli = findDotzukiCli()
      if (!cli) {
        return sendError(
          res,
          'dotzuki CLI not found — build it (`cd workspace && cargo build --release --bin dotzuki`) ' +
            'or point DOTZUKI_CLI at a binary',
          400,
        )
      }

      const args = ['export', `--${target}`, root]
      if (target === 'web') {
        args.push('--runner-pkg', findRunnerPkg())
      } else if (process.env.DOTZUKI_PLAYER) {
        args.push('--player-bin', process.env.DOTZUKI_PLAYER)
      }
      const out = path.join(root, 'dist', target)

      const result = await runCli(cli, args, root)
      if (result.code !== 0) {
        return sendError(res, `dotzuki export failed (exit ${result.code}):\n${result.log}`, 500)
      }
      sendJson(res, { ok: true, target, out, log: result.log })
    } catch (e) {
      sendError(res, (e as Error).message ?? 'export failed', 500)
    }
  })
}

/** Spawn the CLI, capturing combined output; resolves { code, log }. */
function runCli(cli, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd })
    let log = ''
    const onData = (chunk) => {
      log += chunk.toString()
      if (log.length > 64 * 1024) log = log.slice(-64 * 1024) // keep the tail
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`dotzuki export timed out after ${EXPORT_TIMEOUT_MS / 60000} min`))
    }, EXPORT_TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, log: log.trim() })
    })
  })
}
