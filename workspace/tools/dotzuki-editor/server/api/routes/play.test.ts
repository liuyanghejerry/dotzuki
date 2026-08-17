// ───────────────────────────────────────────────────────────────────────────
// Playtest-bundle route tests — registerPlay driven through the shared
// mock-connect scaffold (testUtils), project root pinned to a fresh temp dir
// per test. The size caps are exercised through collectProjectFiles' options
// (small limits) plus one route-level 413 with a real >16 MB file.
// ───────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { registerPlay, collectProjectFiles, BundleError, MAX_FILE_BYTES } from './play'
import { makeServer, mockReq, call, useTempProject, writeProjectConfig } from '../testUtils'

const root = useTempProject('jrpg-play-')

function makeBundleServer() {
  const server = makeServer()
  registerPlay(server)
  return server
}

describe('GET /api/play/bundle', () => {
  it('answers 400 when no project is open (no .dotzuki-editor.json)', async () => {
    const server = makeBundleServer()
    const res = await call(server.routes, '/api/play/bundle', mockReq('GET'))
    expect(res.status).toBe(400)
    expect(res.json().error).toContain('No project open')
  })

  it('answers 405 for non-GET methods', async () => {
    writeProjectConfig(root())
    const server = makeBundleServer()
    const res = await call(server.routes, '/api/play/bundle', mockReq('POST'))
    expect(res.status).toBe(405)
  })

  it('returns base64 file map with posix paths + projectRoot', async () => {
    writeProjectConfig(root())
    fs.mkdirSync(path.join(root(), 'data', 'maps'), { recursive: true })
    fs.writeFileSync(path.join(root(), 'data', 'maps', 'hello.json'), '{"a":1}')

    const server = makeBundleServer()
    const res = await call(server.routes, '/api/play/bundle', mockReq('GET'))
    expect(res.status).toBe(200)
    const body = res.json()
    expect(body.projectRoot).toBe(root())
    expect(Object.keys(body.files).sort()).toEqual(['.dotzuki-editor.json', 'data/maps/hello.json'])
    expect(Buffer.from(body.files['data/maps/hello.json'], 'base64').toString('utf-8')).toBe('{"a":1}')
  })

  it('skips node_modules/.git/target/dist, *.bak and dotfiles — but keeps .dotzuki-editor.json', async () => {
    writeProjectConfig(root())
    const files = [
      'node_modules/dep/index.js',
      '.git/HEAD',
      'target/debug/app',
      'dist/bundle.js',
      'data/script.js.bak',
      'data/.hidden',
      '.secret',
      'data/keep.json',
    ]
    for (const rel of files) {
      const abs = path.join(root(), rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, 'x')
    }

    const server = makeBundleServer()
    const res = await call(server.routes, '/api/play/bundle', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(Object.keys(res.json().files).sort()).toEqual(['.dotzuki-editor.json', 'data/keep.json'])
  })

  it('never follows symlinks, even ones escaping the project root', async () => {
    writeProjectConfig(root())
    const outside = path.join(os.tmpdir(), `jrpg-play-outside-${process.pid}.txt`)
    fs.writeFileSync(outside, 'secret')
    try {
      fs.symlinkSync(outside, path.join(root(), 'linked.txt'))
      const insideDir = path.join(root(), 'real')
      fs.mkdirSync(insideDir)
      fs.symlinkSync(insideDir, path.join(root(), 'linked-dir'))

      const server = makeBundleServer()
      const res = await call(server.routes, '/api/play/bundle', mockReq('GET'))
      expect(res.status).toBe(200)
      expect(Object.keys(res.json().files)).toEqual(['.dotzuki-editor.json'])
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('answers 413 when a single file exceeds the 16 MB cap', async () => {
    writeProjectConfig(root())
    fs.writeFileSync(path.join(root(), 'big.bin'), Buffer.alloc(MAX_FILE_BYTES + 1, 1))

    const server = makeBundleServer()
    const res = await call(server.routes, '/api/play/bundle', mockReq('GET'))
    expect(res.status).toBe(413)
    expect(res.json().error).toContain('big.bin')
  })
})

describe('collectProjectFiles (size caps via options)', () => {
  it('throws BundleError(413) past the per-file cap', () => {
    writeProjectConfig(root())
    fs.writeFileSync(path.join(root(), 'a.bin'), Buffer.alloc(100, 1))
    expect(() => collectProjectFiles(root(), { maxFileBytes: 50 })).toThrowError(
      expect.objectContaining({ status: 413 }) as BundleError,
    )
  })

  it('throws BundleError(413) past the total cap', () => {
    writeProjectConfig(root())
    fs.writeFileSync(path.join(root(), 'a.bin'), Buffer.alloc(40, 1))
    fs.writeFileSync(path.join(root(), 'b.bin'), Buffer.alloc(40, 1))
    expect(() => collectProjectFiles(root(), { maxTotalBytes: 50 })).toThrowError(
      expect.objectContaining({ status: 413 }) as BundleError,
    )
  })

  it('uses posix separators in keys on every platform', () => {
    writeProjectConfig(root())
    fs.mkdirSync(path.join(root(), 'deep', 'deeper'), { recursive: true })
    fs.writeFileSync(path.join(root(), 'deep', 'deeper', 'f.txt'), 'hi')
    const files = collectProjectFiles(root())
    expect(Object.keys(files).sort()).toEqual(['.dotzuki-editor.json', 'deep/deeper/f.txt'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// /wasm fallback — the playtest runner pkg (dotzuki-runner-web) is served by the
// /wasm middleware in content.ts when a file isn't in dotzuki-web/pkg. Env roots
// (DOTZUKI_WASM_ROOT / DOTZUKI_RUNNER_WASM_ROOT) pin both dirs to temp fixtures so
// the test doesn't depend on a wasm-pack build.
// ───────────────────────────────────────────────────────────────────────────
import { Writable } from 'stream'
import { registerContent } from './content'

describe('GET /wasm/* runner-pkg fallback', () => {
  /** A writable response capturing status/headers/body (the handler pipes a
   *  read stream into it, unlike the JSON routes). */
  function streamRes() {
    const chunks: Buffer[] = []
    const res = new Writable({ write(c: Buffer, _e, cb) { chunks.push(c); cb() } }) as any
    res.status = 0
    res.headers = {}
    res.writeHead = (s: number, h: Record<string, string>) => { res.status = s; res.headers = h }
    res.body = () => Buffer.concat(chunks).toString('utf-8')
    return res
  }

  function wasmHandler() {
    const server = makeServer()
    registerContent(server)
    return server.routes.get('/wasm')!
  }

  /** Run the /wasm middleware; resolves with { res, nextCalled } once the
   *  streamed body finishes (or next() short-circuits). */
  function callWasm(url: string) {
    return new Promise<{ res: any; nextCalled: boolean }>((resolve) => {
      const res = streamRes()
      let nextCalled = false
      res.on('finish', () => resolve({ res, nextCalled }))
      wasmHandler()(mockReq('GET', undefined, url), res, () => {
        nextCalled = true
        resolve({ res, nextCalled })
      })
    })
  }

  it('serves files missing from dotzuki-web/pkg out of the runner pkg', async () => {
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-wasm-web-'))
    const runnerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-wasm-runner-'))
    const prevWeb = process.env.DOTZUKI_WASM_ROOT
    const prevRunner = process.env.DOTZUKI_RUNNER_WASM_ROOT
    process.env.DOTZUKI_WASM_ROOT = webDir
    process.env.DOTZUKI_RUNNER_WASM_ROOT = runnerDir
    try {
      fs.writeFileSync(path.join(webDir, 'dotzuki_web.js'), '// web')
      fs.writeFileSync(path.join(runnerDir, 'dotzuki_runner_web.js'), '// runner')
      fs.writeFileSync(path.join(runnerDir, 'dotzuki_runner_web_bg.wasm'), 'wasm-bytes')

      // Present only in the runner pkg → fallback serves it.
      const a = await callWasm('/wasm/dotzuki_runner_web.js')
      expect(a.nextCalled).toBe(false)
      expect(a.res.status).toBe(200)
      expect(a.res.headers['Content-Type']).toBe('application/javascript')
      expect(a.res.body()).toBe('// runner')

      // .wasm always gets application/wasm.
      const b = await callWasm('/wasm/dotzuki_runner_web_bg.wasm')
      expect(b.res.headers['Content-Type']).toBe('application/wasm')
      expect(b.res.body()).toBe('wasm-bytes')

      // Present in the primary pkg → primary wins, no fallback.
      const c = await callWasm('/wasm/dotzuki_web.js')
      expect(c.res.body()).toBe('// web')

      // Missing from both → 404 (never falls through to SPA fallback, which
      // would mask "wasm not built" as a 200 HTML response).
      const d = await callWasm('/wasm/nope.js')
      expect(d.nextCalled).toBe(false)
      expect(d.res.status).toBe(404)
      expect(d.res.body()).toContain('run pnpm build:wasm')
    } finally {
      if (prevWeb === undefined) delete process.env.DOTZUKI_WASM_ROOT
      else process.env.DOTZUKI_WASM_ROOT = prevWeb
      if (prevRunner === undefined) delete process.env.DOTZUKI_RUNNER_WASM_ROOT
      else process.env.DOTZUKI_RUNNER_WASM_ROOT = prevRunner
      fs.rmSync(webDir, { recursive: true, force: true })
      fs.rmSync(runnerDir, { recursive: true, force: true })
    }
  })
})
