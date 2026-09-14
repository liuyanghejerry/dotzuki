import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { registerMapArt } from './mapArt'
import { call, makeServer, mockReq, useTempProject, writeProjectConfig } from '../testUtils'

const root = useTempProject('dotzuki-native-art-')
function png(file: string, width: number, height: number): void {
  const image = new PNG({ width, height }); image.data.fill(180)
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, PNG.sync.write(image))
}
function fixture() {
  writeProjectConfig(root(), { activities: [
    { id: 'maps', type: 'map', config: { mapsDir: 'maps' } },
    { id: 'tiles', type: 'tiles', config: { tilesDir: 'tiles' } },
  ] })
  const dir = path.join(root(), 'data/maps/Test'), assets = path.join(root(), 'data/tiles/groups')
  fs.mkdirSync(dir, { recursive: true })
  png(path.join(assets, 'ground.png'), 128, 96); png(path.join(assets, 'tree.png'), 32, 64)
  png(path.join(assets, 'pot.png'), 32, 32)
  fs.writeFileSync(path.join(assets, 'groups.json'), JSON.stringify({ groups: [{ id: 'pot', name: 'Pot' }] }))
  const map = { width: 4, height: 3, tilewidth: 16, tileheight: 16, layers: [{ name: 'collision', data: [1, ...Array(11).fill(0)] }] }
  const art = { version: 1, pixels_per_unit: 2, ground: '../../tiles/groups/ground.png',
    author_note: 'keep this', components: [{ image: '../../tiles/groups/tree.png', x: 16, y: 0, foot_y: 16, layer: 'depth', label: 'keep object metadata' }] }
  fs.writeFileSync(path.join(dir, 'map.tmx.json'), JSON.stringify(map))
  fs.writeFileSync(path.join(dir, 'events.json'), '{"barriers":[]}')
  fs.writeFileSync(path.join(dir, 'art.json'), JSON.stringify(art))
  const server = makeServer(); registerMapArt(server)
  const request = (method: string, body?: unknown, suffix = '') => call(server.routes, '/api/map-art', mockReq(method, body, '/api/map-art?name=Test' + suffix))
  return { dir, assets, art, request }
}
describe('native map art persistence', () => {
  it('roundtrips edited native positions and extra fields without rewriting terrain or events', async () => {
    const f = fixture(), beforeMap = fs.readFileSync(path.join(f.dir, 'map.tmx.json')), beforeEvents = fs.readFileSync(path.join(f.dir, 'events.json'))
    const loaded = (await f.request('GET')).json()
    expect(loaded.geometry.collision[0]).toBe(1)
    expect(loaded.library[0].image).toBe('../../tiles/groups/pot.png')
    loaded.art.components[0].y = 8; loaded.art.components[0].foot_y = 24
    const result = await f.request('PUT', { art: loaded.art, revision: loaded.revision })
    expect(result.status).toBe(200)
    const after = (await f.request('GET')).json()
    expect(after.revision).not.toBe(loaded.revision)
    expect(after.art).toEqual(loaded.art)
    expect(fs.readFileSync(path.join(f.dir, 'map.tmx.json'))).toEqual(beforeMap)
    expect(fs.readFileSync(path.join(f.dir, 'events.json'))).toEqual(beforeEvents)
  })
  it('rejects stale revisions instead of overwriting external edits', async () => {
    const f = fixture(), loaded = (await f.request('GET')).json()
    fs.appendFileSync(path.join(f.dir, 'art.json'), '\n')
    expect((await f.request('PUT', loaded)).status).toBe(409)
    expect(fs.readFileSync(path.join(f.dir, 'art.json'), 'utf8').endsWith('\n')).toBe(true)
  })
  it('rejects missing or incorrectly sized images and leaves the original bytes intact', async () => {
    const f = fixture(), loaded = (await f.request('GET')).json(), before = fs.readFileSync(path.join(f.dir, 'art.json'))
    for (const ground of ['missing.png', '../../tiles/groups/tree.png']) {
      expect((await f.request('PUT', { ...loaded, art: { ...loaded.art, ground } })).status).toBe(400)
      expect(fs.readFileSync(path.join(f.dir, 'art.json'))).toEqual(before)
    }
    expect((await f.request('PUT', { ...loaded, art: { ...loaded.art, water_mask: '../../tiles/groups/tree.png' } })).status).toBe(400)
  })
  it('serves a library image before placement and accepts it as a new component', async () => {
    const f = fixture(), loaded = (await f.request('GET')).json(), image = loaded.library[0].image
    const asset = await f.request('GET', undefined, '&image=' + encodeURIComponent(image))
    expect(asset.status).toBe(200)
    expect(PNG.sync.read(asset.body).width).toBe(32)
    loaded.art.components.push({ image, x: 32, y: 16, foot_y: 16, layer: 'depth' })
    expect((await f.request('PUT', loaded)).status).toBe(200)
  })
  it('rejects unlisted images and symlinks outside the configured data root', async () => {
    const f = fixture()
    expect((await f.request('GET', undefined, '&image=' + encodeURIComponent('../../../secret.png'))).status).toBe(404)
    const outside = path.join(root(), 'outside.png'); png(outside, 128, 96)
    fs.unlinkSync(path.join(f.assets, 'ground.png')); fs.symlinkSync(outside, path.join(f.assets, 'ground.png'))
    expect((await f.request('GET')).status).toBe(400)
    expect((await f.request('GET', undefined, '&image=' + encodeURIComponent(f.art.ground))).status).toBe(400)
  })
})
