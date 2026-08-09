// E2E dev-server launcher (used by playwright.config.ts webServer).
//
// Copies the checked-in fixture project to a throwaway scratch dir (so tests
// may freely create/edit/delete records without dirtying the repo), then
// starts the Vite dev server against that scratch copy on a dedicated port.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// DOTZUKI_E2E_FIXTURE selects the fixture project (a dir under e2e/fixtures);
// the play-activity spec uses the runner-ready "playable-game" fixture.
const fixtureName = process.env.DOTZUKI_E2E_FIXTURE ?? 'demo-game'
const fixture = path.join(root, 'e2e', 'fixtures', fixtureName)
const scratch = path.join(root, 'e2e', '.scratch', fixtureName)
const port = Number(process.env.E2E_PORT ?? 5199)

fs.rmSync(scratch, { recursive: true, force: true })
fs.cpSync(fixture, scratch, { recursive: true })
console.log(`[e2e] fixture copied to ${scratch}`)

const viteBin = path.join(root, 'node_modules', '.bin', 'vite')
const child = spawn(viteBin, ['--port', String(port), '--strictPort'], {
  cwd: root,
  env: { ...process.env, DOTZUKI_PROJECT_ROOT: scratch },
  stdio: 'inherit',
})

process.on('SIGTERM', () => child.kill('SIGTERM'))
process.on('SIGINT', () => child.kill('SIGINT'))
child.on('exit', (code) => process.exit(code ?? 0))
