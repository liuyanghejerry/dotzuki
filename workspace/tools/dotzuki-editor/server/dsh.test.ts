// DeepSeek Harness backend — pure-logic unit tests (status probing, persona
// assembly, wire-shape helpers). The runtime process itself is exercised by
// the optional handshake script, not here (it needs the dsh-runtime install).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dshStatus, buildDshPersona, blockText, toolOutputText, safeJsonInput, dshBinCandidates, dshLaunchSpec } from './dsh'
import { createProjectContext } from './context/projectContext'

function tmpProject(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-project-'))
  fs.writeFileSync(path.join(root, '.dotzuki-editor.json'), JSON.stringify({
    name: 'Test Game',
    dataRoot: './data',
    activities: [
      { id: 'data', type: 'data', label: 'Data', enabled: true, config: {} },
      { id: 'maps', type: 'map', label: 'Maps', enabled: true, config: {} },
    ],
  }))
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

afterEach(() => {
  delete process.env.DOTZUKI_DSH_BIN
  delete process.env.DOTZUKI_DSH_CONFIG
})

describe('dshStatus', () => {
  it('reports not-installed with a setup hint when the runtime is absent', () => {
    // Point the probe at paths that cannot exist.
    process.env.DOTZUKI_DSH_BIN = '/nonexistent/dsh-jsonrpc-agent'
    process.env.DOTZUKI_DSH_CONFIG = '/nonexistent/cordis.yml'
    const s = dshStatus()
    expect(s.kind).toBe('dsh')
    expect(s.installed).toBe(false)
    expect(s.hint).toContain('dsh-runtime')
  })

  it('reports installed when bin + config both exist (env overrides)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-status-'))
    try {
      const bin = path.join(dir, 'dsh-jsonrpc-agent')
      const config = path.join(dir, 'cordis.yml')
      fs.writeFileSync(bin, '#!/bin/sh\n')
      fs.writeFileSync(config, '')
      process.env.DOTZUKI_DSH_BIN = bin
      process.env.DOTZUKI_DSH_CONFIG = config
      const s = dshStatus()
      expect(s.installed).toBe(true)
      expect(s.bin).toBe(bin)
      expect(s.config).toBe(config)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('env override pointing at a missing bin reports the packaged-build hint', () => {
    process.env.DOTZUKI_DSH_BIN = '/nonexistent/dsh-jsonrpc-agent'
    process.env.DOTZUKI_DSH_CONFIG = '/nonexistent/cordis.yml'
    const s = dshStatus()
    expect(s.installed).toBe(false)
    expect(s.hint).toContain('packaged')
  })

  it('prefers the .cmd shim on Windows and the plain shim elsewhere', () => {
    expect(dshBinCandidates('/dsh', true)[0]).toMatch(/\.cmd$/)
    expect(dshBinCandidates('/dsh', false)[0]).not.toMatch(/\.cmd$/)
  })

  it('wraps .cmd shims through cmd.exe on Windows', () => {
    const win = dshLaunchSpec('C:\\x\\dsh-jsonrpc-agent.cmd', 'C:\\x\\cordis.yml', true)
    expect(win.command).toBe('cmd.exe')
    expect(win.args).toEqual(['/d', '/s', '/c', 'C:\\x\\dsh-jsonrpc-agent.cmd', 'C:\\x\\cordis.yml'])
    const unix = dshLaunchSpec('/x/dsh-jsonrpc-agent', '/x/cordis.yml', false)
    expect(unix.command).toBe('/x/dsh-jsonrpc-agent')
    expect(unix.args).toEqual(['/x/cordis.yml'])
  })
})

describe('buildDshPersona', () => {
  it('summarizes the project manifest for the agent', () => {
    const { root, cleanup } = tmpProject()
    try {
      const persona = buildDshPersona(createProjectContext(root))
      expect(persona).toContain('dotzuki-editor')
      expect(persona).toContain('Test Game')
      expect(persona).toContain('./data')
      expect(persona).toContain('data')
      expect(persona).toContain('map')
      expect(persona).toContain('bilingual')
    } finally {
      cleanup()
    }
  })
})

describe('dsh wire-shape helpers', () => {
  it('safeJsonInput parses valid JSON and preserves non-JSON text', () => {
    expect(safeJsonInput('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonInput('not json')).toEqual({ raw: 'not json' })
    expect(safeJsonInput(42)).toBe(42)
  })

  it('blockText flattens text blocks and nested content arrays', () => {
    expect(blockText({ text: 'hello' })).toBe('hello')
    expect(blockText({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('ab')
    expect(blockText(null)).toBe('')
  })

  it('toolOutputText prefers block text and falls back to JSON', () => {
    expect(toolOutputText({ content: [{ text: 'result line' }] })).toBe('result line')
    expect(toolOutputText({ content: [{ type: 'image', data: 'x' }] })).toContain('image')
    expect(toolOutputText(null)).toBe('null')
  })
})
