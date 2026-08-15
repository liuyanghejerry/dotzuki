// Dev launcher: start the Vite dev server (which already serves the app + the
// full /api surface via vite.config.ts) and, once it's listening, launch
// Electron pointed at it. Killing either tears down both. No extra deps —
// just child_process + a tiny TCP wait.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT || 5174)

function waitForPort(port, host, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect(port, host)
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error(`Vite did not start on ${host}:${port}`))
        else setTimeout(tryOnce, 250)
      })
    }
    tryOnce()
  })
}

// Vite lives at the pnpm-workspace root (workspace/tools), not in this
// package's node_modules, so with pnpm's isolated linker the runnable
// .bin/vite shim sits in the parent directory and `require.resolve('vite')`
// fails here. Prefer the workspace shim; fall back to a package-local one for
// setups where vite is a direct devDependency.
const isWin = process.platform === 'win32'
const binName = isWin ? 'vite.CMD' : 'vite'
const workspaceBin = path.join(root, '..', 'node_modules', '.bin', binName)
const localBin = path.join(root, 'node_modules', '.bin', binName)
const viteBin = fs.existsSync(workspaceBin) ? workspaceBin : localBin
const vite = spawn(viteBin, ['--host', HOST, '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
})

// `require('electron')` in a plain Node process yields the path to the binary.
const electronPath = nodeRequire('electron')

let electron = null
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (electron && !electron.killed) electron.kill()
  if (vite && !vite.killed) vite.kill()
  process.exit(code)
}

vite.on('exit', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  await waitForPort(PORT, HOST)
  electron = spawn(electronPath, [path.join(root, 'electron', 'main.cjs')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_DEV: '1', ELECTRON_RENDERER_URL: `http://${HOST}:${PORT}` },
  })
  electron.on('exit', (code) => shutdown(code ?? 0))
} catch (e) {
  console.error(e)
  shutdown(1)
}
