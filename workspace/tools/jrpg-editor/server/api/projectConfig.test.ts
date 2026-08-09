import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { defaultProjectRoot } from './projectConfig'

// defaultProjectRoot is pure apart from its fs reads, so tests drive it with
// real temp dirs (manifest / editor-repo package.json) and a fake homedir.
describe('defaultProjectRoot', () => {
  let cwd: string
  let homedir: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-root-cwd-'))
    homedir = fs.mkdtempSync(path.join(os.tmpdir(), 'jrpg-root-home-'))
  })
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
    fs.rmSync(homedir, { recursive: true, force: true })
  })

  it('JRPG_PROJECT_ROOT always wins', () => {
    fs.writeFileSync(path.join(cwd, '.jrpg-editor.json'), '{}')
    expect(defaultProjectRoot({ JRPG_PROJECT_ROOT: '/elsewhere' }, cwd, homedir)).toBe('/elsewhere')
  })

  it('cwd with a .jrpg-editor.json manifest wins over the editor-repo fallback', () => {
    fs.writeFileSync(path.join(cwd, '.jrpg-editor.json'), '{}')
    // Even if the cwd also looks like the editor repo, the manifest wins.
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'jrpg-editor' }))
    expect(defaultProjectRoot({}, cwd, homedir)).toBe(cwd)
  })

  it('falls back to ~/jrpg-projects when cwd is the editor repo itself', () => {
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'jrpg-editor' }))
    expect(defaultProjectRoot({}, cwd, homedir)).toBe(path.join(homedir, 'jrpg-projects'))
  })

  it('keeps cwd for any other directory without a manifest', () => {
    // No package.json at all…
    expect(defaultProjectRoot({}, cwd, homedir)).toBe(cwd)
    // …and a package.json with a different name is not the editor repo.
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'my-game' }))
    expect(defaultProjectRoot({}, cwd, homedir)).toBe(cwd)
  })
})
