// ───────────────────────────────────────────────────────────────────────────
// Export-route tests — registerExport driven through the shared mock-connect
// scaffold, project root pinned to a fresh temp dir per test. The dotzuki CLI
// is a shell-script stub (DOTZUKI_CLI) that records its argv and exits 0/3;
// no real Rust build happens here.
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { registerExport } from './export'
import { makeServer, mockReq, call, useTempProject, writeProjectConfig } from '../testUtils'

const root = useTempProject('jrpg-export-')

// The CLI stub is a POSIX shell script — skip the whole suite on Windows.
describe.skipIf(process.platform === 'win32')('POST /api/export', () => {
  let stubDir = ''
  let stubCli = ''
  let savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-export-cli-'))
    stubCli = path.join(stubDir, 'dotzuki')
    makeStubCli(stubCli, stubDir, 0)
    savedEnv = {
      DOTZUKI_CLI: process.env.DOTZUKI_CLI,
      DOTZUKI_RUNNER_WASM_ROOT: process.env.DOTZUKI_RUNNER_WASM_ROOT,
      DOTZUKI_PLAYER: process.env.DOTZUKI_PLAYER,
      DOTZUKI_EDITOR_ROOT: process.env.DOTZUKI_EDITOR_ROOT,
    }
    process.env.DOTZUKI_CLI = stubCli
    delete process.env.DOTZUKI_PLAYER
    delete process.env.DOTZUKI_RUNNER_WASM_ROOT
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(stubDir, { recursive: true, force: true })
  })

  function makeExportServer() {
    const server = makeServer()
    registerExport(server)
    return server
  }

  function stubArgs(): string {
    return fs.readFileSync(path.join(stubDir, 'args.txt'), 'utf-8')
  }

  it('answers 405 for non-POST methods', async () => {
    writeProjectConfig(root())
    const res = await call(makeExportServer().routes, '/api/export', mockReq('GET'))
    expect(res.status).toBe(405)
  })

  it('answers 400 when no project is open', async () => {
    const res = await call(makeExportServer().routes, '/api/export', mockReq('POST', {}))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('No project open')
  })

  it('answers 400 for an unknown target', async () => {
    writeProjectConfig(root())
    const res = await call(makeExportServer().routes, '/api/export', mockReq('POST', { target: 'steam-deck' }))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('steam-deck')
  })

  it('answers 400 with build instructions when no CLI is found', async () => {
    writeProjectConfig(root())
    // Neither DOTZUKI_CLI nor a workspace target/ dir resolves: point the
    // editor root at the temp project so the dev fallback finds nothing.
    process.env.DOTZUKI_EDITOR_ROOT = root()
    delete process.env.DOTZUKI_CLI
    const res = await call(makeExportServer().routes, '/api/export', mockReq('POST', {}))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('dotzuki CLI not found')
  })

  it('web export runs the CLI with --web and the runner pkg override', async () => {
    writeProjectConfig(root())
    const fakePkg = path.join(stubDir, 'runner-pkg')
    process.env.DOTZUKI_RUNNER_WASM_ROOT = fakePkg

    const res = await call(makeExportServer().routes, '/api/export', mockReq('POST', { target: 'web' }))
    expect(res.status).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.out).toBe(path.join(root(), 'dist', 'web'))

    const args = stubArgs()
    expect(args).toContain(`export --web ${root()}`)
    expect(args).toContain(`--runner-pkg ${fakePkg}`)
    expect(args).not.toContain('--player-bin')
  })

  it('defaults to the web target when the body has none', async () => {
    writeProjectConfig(root())
    const res = await call(makeExportServer().routes, '/api/export', mockReq('POST'))
    expect(res.status).toBe(200)
    expect(stubArgs()).toContain('--web')
  })

  it('native export passes --player-bin only when DOTZUKI_PLAYER is set', async () => {
    writeProjectConfig(root())
    let res = await call(makeExportServer().routes, '/api/export', mockReq('POST', { target: 'native' }))
    expect(res.status).toBe(200)
    expect(stubArgs()).toContain('--native')
    expect(stubArgs()).not.toContain('--player-bin')

    const player = path.join(stubDir, 'dotzuki-player')
    fs.writeFileSync(player, '')
    process.env.DOTZUKI_PLAYER = player
    res = await call(makeExportServer().routes, '/api/export', mockReq('POST', { target: 'native' }))
    expect(res.status).toBe(200)
    expect(stubArgs()).toContain(`--player-bin ${player}`)
  })

  it('surfaces the CLI log on failure', async () => {
    writeProjectConfig(root())
    makeStubCli(stubCli, stubDir, 3)
    const res = await call(makeExportServer().routes, '/api/export', mockReq('POST', { target: 'web' }))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('exit 3')
    expect(res.json().error).toContain('stub failure')
  })
})

/** Write a stub `dotzuki` that records argv and exits with `exitCode`. */
function makeStubCli(bin: string, dir: string, exitCode: number) {
  const stderr = exitCode === 0 ? '' : 'echo "stub failure" >&2\n'
  fs.writeFileSync(
    bin,
    `#!/bin/sh\necho "$@" > "${dir}/args.txt"\n${stderr}echo "stub ok"\nexit ${exitCode}\n`,
  )
  fs.chmodSync(bin, 0o755)
}
