// ───────────────────────────────────────────────────────────────────────────
// Content-route tests (/api/scripts, /api/gui) — drive registerContent's
// handlers through the shared mock-connect scaffold (testUtils), with the
// project root pinned to a fresh temp dir per test (setProjectRootDir).
// The /wasm static route is not covered (serves a build artifact from the
// repo, independent of the project).
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { registerContent } from './content'
import { makeServer, mockReq, call, useTempProject, writeProjectConfig } from '../testUtils'

const root = useTempProject('jrpg-content-')

/** Scripts live under dataRoot; gui layouts under the project root (guiRoot). */
function writeContentConfig(scriptConfig: Record<string, unknown> = { scriptsDir: 'scripts', extension: '.scene' }) {
  writeProjectConfig(root(), {
    activities: [
      { id: 'scripts', type: 'script', config: scriptConfig },
      { id: 'ui', type: 'ui', config: { guiRoot: 'ui_layouts' } },
    ],
  })
}

function scriptsDir() {
  return path.join(root(), 'data', 'scripts')
}

function writeScript(rel: string, text: string) {
  const abs = path.join(scriptsDir(), rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}

function guiRoot() {
  return path.join(root(), 'ui_layouts')
}

function writeGui(rel: string, text: string) {
  const abs = path.join(guiRoot(), rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}

/** A request with a raw text body (script/gui PUTs send file text, not JSON). */
function rawReq(method: string, text: string, url: string) {
  const req = new Readable({ read() {} }) as any
  req.method = method
  req.url = url
  req.headers = { host: 'localhost' }
  req.push(text)
  req.push(null)
  return req
}

/**
 * Drive a route whose PUT handler reads the body fire-and-forget
 * (`readBody(req).then(...)` without awaiting) — give the promise a tick to
 * settle before asserting on the response.
 */
async function callSettled(routes: Map<string, import('../testUtils').Handler>, route: string, req: any) {
  const res = await call(routes, route, req)
  await new Promise(r => setImmediate(r))
  return res
}

describe('GET /api/scripts', () => {
  it('answers 500 when no project is open', async () => {
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('.jrpg-editor.json')
  })

  it('answers 500 when the project has no script activity', async () => {
    writeProjectConfig(root()) // activities: []
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No script activity configured')
  })

  it('lists script files recursively, filtered by the configured extension', async () => {
    writeContentConfig()
    writeScript('main.scene', 'scene Main\n')
    writeScript('sub/inner.scene', 'scene Inner\n')
    writeScript('notes.txt', 'not a script')

    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET', undefined, '/api/scripts'))
    expect(res.status).toBe(200)
    const entries = res.json()
    // Sorted per directory level: top-level files before recursing into sub/.
    expect(entries.map((e: any) => e.path)).toEqual(['main.scene', 'sub/inner.scene'])
    expect(entries[0]).toMatchObject({ name: 'main.scene', isDir: false })
    expect(entries[0].size).toBe(fs.statSync(path.join(scriptsDir(), 'main.scene')).size)
  })

  it('falls back to the .js extension when none is configured', async () => {
    writeContentConfig({ scriptsDir: 'scripts' })
    writeScript('main.js', 'console.log(1)\n')
    writeScript('main.scene', 'scene Main\n')

    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET', undefined, '/api/scripts'))
    expect(res.json().map((e: any) => e.path)).toEqual(['main.js'])
  })

  it('reads a script file as plain text', async () => {
    writeContentConfig()
    writeScript('main.scene', 'scene Main\n  setFlag("X")\n')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET', undefined, '/api/scripts/main.scene'))
    expect(res.status).toBe(200)
    expect(res.body).toBe('scene Main\n  setFlag("X")\n')
  })

  it('answers 404 for a missing script file', async () => {
    writeContentConfig()
    writeScript('main.scene', 'scene Main\n')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET', undefined, '/api/scripts/nope.scene'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('File not found')
  })

  it('answers 404 when the scriptsDir does not exist yet', async () => {
    writeContentConfig()
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('GET', undefined, '/api/scripts'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('File not found')
  })
})

describe('PUT /api/scripts', () => {
  it('writes the raw body verbatim, creating parent dirs, and round-trips via GET', async () => {
    writeContentConfig()
    const server = makeServer()
    registerContent(server)
    const text = 'scene Deep\n  warpTo("Town")\n'
    const put = await callSettled(server.routes, '/api/scripts', rawReq('PUT', text, '/api/scripts/new/thing.scene'))
    expect(put.status).toBe(200)
    expect(put.json()).toEqual({ ok: true })
    expect(fs.readFileSync(path.join(scriptsDir(), 'new', 'thing.scene'), 'utf-8')).toBe(text)

    const get = await call(server.routes, '/api/scripts', mockReq('GET', undefined, '/api/scripts/new/thing.scene'))
    expect(get.body).toBe(text)
  })
})

describe('GET /api/gui', () => {
  it('answers 500 when the project has no ui activity', async () => {
    writeProjectConfig(root())
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('No ui activity configured')
  })

  it('lists .gui files at the guiRoot only (non-recursive)', async () => {
    writeContentConfig()
    writeGui('hud.gui', 'gui hud\n')
    writeGui('menu.gui', 'gui menu\n')
    writeGui('ignore.txt', 'x')
    writeGui('sub/nested.gui', 'gui nested\n')

    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET', undefined, '/api/gui'))
    expect(res.status).toBe(200)
    expect(res.json().sort()).toEqual(['hud.gui', 'menu.gui'])
  })

  it('returns [] when the guiRoot does not exist yet', async () => {
    writeContentConfig()
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET', undefined, '/api/gui'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('reads a .gui file as plain text', async () => {
    writeContentConfig()
    writeGui('hud.gui', 'gui hud\n  label "HP"\n')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET', undefined, '/api/gui/hud.gui'))
    expect(res.status).toBe(200)
    expect(res.body).toBe('gui hud\n  label "HP"\n')
  })

  it('answers 404 for a missing .gui file', async () => {
    writeContentConfig()
    writeGui('hud.gui', 'gui hud\n')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET', undefined, '/api/gui/nope.gui'))
    expect(res.status).toBe(404)
    expect(res.json().error).toBe('File not found')
  })

  it('refuses paths that escape the guiRoot with 403', async () => {
    writeContentConfig()
    // %2f survives URL parsing; decodeURIComponent then resolves ../ outside base.
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET', undefined, '/api/gui/..%2fsecret.txt'))
    expect(res.status).toBe(403)
    expect(res.json().error).toBe('Access denied')
  })
})

describe('PUT /api/gui', () => {
  it('writes the raw body into the guiRoot, creating parent dirs', async () => {
    writeContentConfig()
    const server = makeServer()
    registerContent(server)
    const text = 'gui inventory\n  grid 4x4\n'
    const res = await callSettled(server.routes, '/api/gui', rawReq('PUT', text, '/api/gui/panels/inv.gui'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    // guiRoot is relative to the PROJECT ROOT, not dataRoot.
    expect(fs.readFileSync(path.join(guiRoot(), 'panels', 'inv.gui'), 'utf-8')).toBe(text)
    expect(fs.existsSync(path.join(root(), 'data', 'ui_layouts'))).toBe(false)
  })
})


describe('route hardening', () => {
  it('GET /api/gui rejects a sibling dir sharing the guiRoot string prefix', async () => {
    writeContentConfig()
    // "ui_layouts_evil" sits next to "ui_layouts"; a bare startsWith(base)
    // check would let "..%2fui_layouts_evil/..." through as in-sandbox.
    fs.mkdirSync(path.join(root(), 'ui_layouts_evil'), { recursive: true })
    fs.writeFileSync(path.join(root(), 'ui_layouts_evil', 'secret.gui'), 'widget {}')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('GET', undefined, '/api/gui/..%2fui_layouts_evil/secret.gui'))
    expect(res.status).toBe(403)
  })

  it('PUT /api/gui to a sibling-prefix path is rejected too', async () => {
    writeContentConfig()
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', rawReq('PUT', 'widget {}', '/api/gui/..%2fui_layouts_evil/x.gui'))
    expect(res.status).toBe(403)
    expect(fs.existsSync(path.join(root(), 'ui_layouts_evil'))).toBe(false)
  })

  it('DELETE /api/scripts/* answers 405 (used to return without ending the response)', async () => {
    writeContentConfig()
    writeScript('intro.scene', 'game_scene Intro {}')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/scripts', mockReq('DELETE', undefined, '/api/scripts/intro.scene'))
    expect(res.status).toBe(405)
  })

  it('DELETE /api/gui/* answers 405', async () => {
    writeContentConfig()
    writeGui('hud.gui', 'widget {}')
    const server = makeServer()
    registerContent(server)
    const res = await call(server.routes, '/api/gui', mockReq('DELETE', undefined, '/api/gui/hud.gui'))
    expect(res.status).toBe(405)
  })
})
