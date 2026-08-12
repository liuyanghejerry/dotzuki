// ───────────────────────────────────────────────────────────────────────────
// Scheduled-jobs route tests — same mock-middleware approach as
// project.test.ts: drive registerJobs' handlers through a minimal connect
// `server.middlewares.use` mock, with the project root pinned to a fresh temp
// dir per test (setProjectRootDir).
// ───────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { registerJobs, sanitizeJobs, runSceneCheck, jobsFile, type ScheduledJob } from './jobs'
import { setProjectRootDir } from '../projectConfig'
import type { ProjectContext } from '../../context/projectContext'
import type { LintFinding } from '../../sceneLint'

type Handler = (req: any, res: any) => unknown

function makeServer() {
  const routes = new Map<string, Handler>()
  return {
    routes,
    middlewares: { use(route: string, fn: Handler) { routes.set(route, fn) } },
  }
}

function mockReq(method: string, body?: unknown) {
  const req = new Readable({ read() {} }) as any
  req.method = method
  req.url = '/'
  req.headers = { host: 'localhost' }
  if (body !== undefined) req.push(JSON.stringify(body))
  req.push(null)
  return req
}

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(status: number) { res.status = status },
    end(chunk?: string) { res.body = chunk ?? '' },
    json() { return JSON.parse(res.body) },
  }
  return res
}

async function call(routes: Map<string, Handler>, route: string, req: any) {
  const handler = routes.get(route)!
  const res = mockRes()
  await handler(req, res)
  return res
}

let ROOT = ''

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-jobs-'))
  setProjectRootDir(ROOT)
})

afterEach(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* ignore */ }
})

/** Minimal project: a story activity whose scenesDir lives under dataRoot. */
function writeProjectConfig() {
  fs.writeFileSync(path.join(ROOT, '.dotzuki-editor.json'), JSON.stringify({
    name: 'Test',
    dataRoot: 'data',
    activities: [{ id: 'story', type: 'story', config: { storiesDir: 'story', scenesDir: 'maps' } }],
  }))
}

function writeScene(stem: string, text: string) {
  const dir = path.join(ROOT, 'data', 'maps', stem)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'script.scene'), text)
}

const baseJob: ScheduledJob = {
  id: 'j1', name: 'Nightly check', kind: 'scene-check', intervalMinutes: 30,
  enabled: true, lastRunAt: 0, lastStatus: '', lastSummary: '',
}

describe('sanitizeJobs', () => {
  it('drops junk entries and entries without an id', () => {
    expect(sanitizeJobs([null, 42, 'x', {}, { id: '  ' }, baseJob])).toHaveLength(1)
    expect(sanitizeJobs('not-an-array')).toEqual([])
  })

  it('applies defaults and coerces field types', () => {
    const [j] = sanitizeJobs([{ id: 'a', intervalMinutes: -5, lastStatus: 'weird', lastRunAt: -10 }])
    expect(j).toMatchObject({
      id: 'a',
      name: 'a', // falls back to the id
      kind: 'scene-check',
      intervalMinutes: 60, // invalid interval → default
      enabled: true,
      lastRunAt: 0,
      lastStatus: '', // unknown status → cleared
      lastSummary: '',
    })
    expect(j.prompt).toBeUndefined()
    expect(j.unread).toBeUndefined()
  })

  it('keeps a valid agent-prompt job intact', () => {
    const [j] = sanitizeJobs([{
      id: 'b', name: 'Daily', kind: 'agent-prompt', prompt: 'Say hi', intervalMinutes: 15,
      enabled: false, lastRunAt: 123, lastStatus: 'skipped-busy', lastSummary: 's', unread: true,
    }])
    expect(j).toEqual({
      id: 'b', name: 'Daily', kind: 'agent-prompt', prompt: 'Say hi', intervalMinutes: 15,
      enabled: false, lastRunAt: 123, lastStatus: 'skipped-busy', lastSummary: 's', unread: true,
    })
  })
})

describe('GET/PUT /api/jobs', () => {
  it('answers 500 when no project is open (consistent with other routes)', async () => {
    const server = makeServer()
    registerJobs(server)
    const res = await call(server.routes, '/api/jobs', mockReq('GET'))
    expect(res.status).toBe(500)
    expect(res.json().error).toContain('.dotzuki-editor.json')
  })

  it('returns [] when the jobs file does not exist yet', async () => {
    writeProjectConfig()
    const server = makeServer()
    registerJobs(server)
    const res = await call(server.routes, '/api/jobs', mockReq('GET'))
    expect(res.status).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('round-trips a sanitized whole-list write', async () => {
    writeProjectConfig()
    const server = makeServer()
    registerJobs(server)

    const put = await call(server.routes, '/api/jobs', mockReq('PUT', [
      baseJob,
      { id: 'j2', kind: 'agent-prompt', prompt: 'Hi', intervalMinutes: 0 }, // → defaults
      { noId: true }, // → dropped
    ]))
    expect(put.status).toBe(200)

    const onDisk = JSON.parse(fs.readFileSync(jobsFile(), 'utf-8'))
    expect(onDisk).toHaveLength(2)
    expect(onDisk[1]).toMatchObject({ id: 'j2', name: 'j2', intervalMinutes: 60, prompt: 'Hi' })

    const get = await call(server.routes, '/api/jobs', mockReq('GET'))
    expect(get.json()).toEqual(onDisk)
  })

  it('rejects other methods with 405', async () => {
    writeProjectConfig()
    const server = makeServer()
    registerJobs(server)
    const res = await call(server.routes, '/api/jobs', mockReq('DELETE'))
    expect(res.status).toBe(405)
  })
})

describe('runSceneCheck (aggregation)', () => {
  const fakeProject = (scenes: { stem: string; content: string }[]) => ({
    listScenes: () => scenes.map(s => ({ stem: s.stem, names: [], path: `${s.stem}/script.scene` })),
    readScene: (rel: string) => scenes.find(s => rel === `${s.stem}/script.scene`)!.content,
  }) as unknown as ProjectContext

  it('counts only warn-level findings as failures', async () => {
    const lint = (_p: ProjectContext, content: string): LintFinding[] =>
      content.includes('warn') ? [{ line: 1, severity: 'warn', message: 'bad' }]
        : content.includes('info') ? [{ line: 1, severity: 'info', message: 'fyi' }] : []
    const report = await runSceneCheck(fakeProject([
      { stem: 'Clean', content: '' },
      { stem: 'Info', content: 'info' },
      { stem: 'Warn', content: 'warn' },
    ]), lint)
    expect(report.total).toBe(3)
    expect(report.failed).toBe(1)
    expect(report.scenes.map(s => [s.scene, s.ok])).toEqual([['Clean', true], ['Info', true], ['Warn', false]])
  })

  it('a scene whose check throws lands in diagnostics instead of aborting', async () => {
    const lint = (): LintFinding[] => { throw new Error('boom') }
    const report = await runSceneCheck(fakeProject([{ stem: 'Bad', content: 'x' }]), lint)
    expect(report.failed).toBe(1)
    expect(report.scenes[0].ok).toBe(false)
    expect(report.scenes[0].diagnostics[0].message).toContain('boom')
  })
})

describe('POST /api/jobs/run-scene-check', () => {
  it('checks every .scene in the project and aggregates the result', async () => {
    writeProjectConfig()
    // Good: valid DSL, no flags → compiles and lints clean.
    writeScene('Good', 'game_scene Good {\n    @storyline("s") {\n        @trigger(map = "Good", npc = 1)\n        @speaker("Narrator") {\n            "Hello."\n        }\n    }\n}\n')
    // Bad: valid DSL, but a flag is read and never set anywhere → lint warn.
    writeScene('Bad', 'game_scene Bad {\n    @storyline("s") {\n        @trigger(map = "Bad", npc = 1)\n        @if (getFlag("TYPO_FLAG")) {\n            @speaker("Narrator") {\n                "Hm."\n            }\n        }\n    }\n}\n')

    const server = makeServer()
    registerJobs(server)
    const res = await call(server.routes, '/api/jobs/run-scene-check', mockReq('POST'))
    expect(res.status).toBe(200)
    const report = res.json()
    expect(report.total).toBe(2)
    expect(report.failed).toBe(1)
    const byStem = Object.fromEntries(report.scenes.map((s: any) => [s.scene, s]))
    expect(byStem.Good.ok).toBe(true)
    expect(byStem.Good.diagnostics).toEqual([])
    expect(byStem.Bad.ok).toBe(false)
    expect(byStem.Bad.diagnostics[0].message).toContain('TYPO_FLAG')
  })

  it('answers 500 when no project is open', async () => {
    const server = makeServer()
    registerJobs(server)
    const res = await call(server.routes, '/api/jobs/run-scene-check', mockReq('POST'))
    expect(res.status).toBe(500)
  })
})
