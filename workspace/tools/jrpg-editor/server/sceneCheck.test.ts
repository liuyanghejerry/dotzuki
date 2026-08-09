// checkScene tests — the draft verification loop. Covers the WASM compile layer
// (default: real pkg-node compile, pass/fail, lint layered on top), the lint-only
// fallback when the WASM pkg is unavailable, and the real-command path
// (a portable shell command that fails when the draft contains a FAILMARK),
// proving both pass/fail branches and that the project's files are never touched.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createProjectContext } from './context/projectContext'
import { checkScene, _resetWasmCompilerForTests } from './sceneCheck'

/** True when the jrpg-web WASM nodejs pkg (jrpg_web.js) is present on disk. */
function isWasmPkgAvailable(): boolean {
  const editorRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
  const wasmRoot = process.env.JRPG_WASM_NODE_ROOT
    ? path.resolve(process.env.JRPG_WASM_NODE_ROOT)
    : path.resolve(editorRoot, '../../crates/jrpg-web/pkg-node')
  return fs.existsSync(path.join(wasmRoot, 'jrpg_web.js'))
}

let ROOT = ''
function writeConfig(sceneBlock: Record<string, unknown>) {
  fs.writeFileSync(path.join(ROOT, '.jrpg-editor.json'), JSON.stringify({
    name: 'F', dataRoot: '.', activities: [
      { id: 'story', type: 'story', config: { storiesDir: 'data/story', scenesDir: 'data/maps', scene: sceneBlock } },
    ],
  }), 'utf-8')
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-scenecheck-t-'))
  fs.mkdirSync(path.join(ROOT, 'data/maps/Town'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'data/maps/Town/script.scene'), 'setFlag("EVENT_TOWN_DONE")\ngetFlag("EVENT_TOWN_DONE")\n', 'utf-8')
})
afterAll(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* ignore */ } })

// The WASM compiler singleton + JRPG_WASM_NODE_ROOT are process-global; reset
// both after every test so a failure-mocking test can't leak into the next.
const SAVED_WASM_ROOT = process.env.JRPG_WASM_NODE_ROOT
afterEach(() => {
  if (SAVED_WASM_ROOT === undefined) delete process.env.JRPG_WASM_NODE_ROOT
  else process.env.JRPG_WASM_NODE_ROOT = SAVED_WASM_ROOT
  _resetWasmCompilerForTests()
})

/** A scene that compiles cleanly; the body is parameterized. */
function validScene(body: string): string {
  return `game_scene Town {\n    @storyline("s") {\n        @trigger(map = "Town", npc = 1)\n${body}\n    }\n}\n`
}

// These 3 tests require the jrpg-web WASM nodejs pkg (built by `pnpm build:wasm`);
// skip them when unavailable so CI doesn't fail on a fresh checkout.
const wasmOk = isWasmPkgAvailable()

describe('checkScene — WASM compile layer (default)', () => {
  it.runIf(wasmOk)('fails with source=compile on a syntax error, reporting the position', async () => {
    writeConfig({ ext: '.scene' })
    const p = createProjectContext(ROOT)
    const r = await checkScene(p, 'Town', 'this is not dsl %%\n')
    expect(r.source).toBe('compile')
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/compile FAIL at \d+:\d+/)
    expect(r.output).toContain('Unexpected character')
  })

  it.runIf(wasmOk)('passes a valid scene whose lint is clean', async () => {
    writeConfig({ ext: '.scene' })
    const p = createProjectContext(ROOT)
    // Reads EVENT_TOWN_DONE, which the project's Town scene sets → lint clean.
    const body = '        @if (getFlag("EVENT_TOWN_DONE")) {\n            @speaker("Narrator") {\n                "Done."\n            }\n        }'
    const r = await checkScene(p, 'Town', validScene(body))
    expect(r.source).toBe('compile')
    expect(r.ok).toBe(true)
    expect(r.output).toContain('compile PASS')
  })

  it.runIf(wasmOk)('compiles OK but fails on a lint warn, keeping the compile PASS note', async () => {
    writeConfig({ ext: '.scene' })
    const p = createProjectContext(ROOT)
    // EVENT_NEVER is read but never set anywhere → lint warn.
    const body = '        @if (getFlag("EVENT_NEVER")) {\n            @speaker("Narrator") {\n                "Hm."\n            }\n        }'
    const r = await checkScene(p, 'Town', validScene(body))
    expect(r.source).toBe('compile')
    expect(r.ok).toBe(false)
    expect(r.output).toContain('compile PASS')
    expect(r.output).toContain('EVENT_NEVER')
  })
})

describe('checkScene — lint fallback (WASM pkg unavailable)', () => {
  it('degrades to lint when the WASM pkg cannot be loaded, and labels it', async () => {
    process.env.JRPG_WASM_NODE_ROOT = path.join(os.tmpdir(), 'jrpg-no-such-wasm-pkg')
    _resetWasmCompilerForTests()
    writeConfig({ ext: '.scene' })
    const p = createProjectContext(ROOT)
    // A flag read but never set → lint FAIL.
    const bad = await checkScene(p, 'Town', 'getFlag("EVENT_NEVER")\n')
    expect(bad.source).toBe('lint')
    expect(bad.ok).toBe(false)
    expect(bad.output).toMatch(/lint only/)
    // A clean buffer (reads a flag the project sets) → lint PASS.
    const good = await checkScene(p, 'Town', 'getFlag("EVENT_TOWN_DONE")\n')
    expect(good.ok).toBe(true)
  })
})

describe('checkScene — scene.checkCmd (project compiler, priority over WASM)', () => {
  it('runs a configured scene.checkCmd against the draft (real compile path)', async () => {
    // Point the WASM loader at a bogus root: if checkCmd did not take priority,
    // the check would degrade to lint and the assertions below would fail.
    process.env.JRPG_WASM_NODE_ROOT = path.join(os.tmpdir(), 'jrpg-no-such-wasm-pkg')
    _resetWasmCompilerForTests()
    // Portable stand-in for a compiler: fail iff the draft contains FAILMARK.
    writeConfig({ ext: '.scene', checkCmd: "sh -c '! grep -q FAILMARK {file}'" })
    const p = createProjectContext(ROOT)

    const pass = await checkScene(p, 'Town', '@storyline("ok")\n')
    expect(pass.source).toBe('compile')
    expect(pass.ok).toBe(true)

    const fail = await checkScene(p, 'Town', '@storyline("bad")\nFAILMARK\n')
    expect(fail.source).toBe('compile')
    expect(fail.ok).toBe(false)
  })

  it('never writes the draft into the project', async () => {
    writeConfig({ ext: '.scene', checkCmd: "sh -c 'true'" })
    const p = createProjectContext(ROOT)
    const before = fs.readFileSync(path.join(ROOT, 'data/maps/Town/script.scene'), 'utf-8')
    await checkScene(p, 'Town', '@storyline("draft only")\n// should never hit disk\n')
    expect(fs.readFileSync(path.join(ROOT, 'data/maps/Town/script.scene'), 'utf-8')).toBe(before)
  })
})
