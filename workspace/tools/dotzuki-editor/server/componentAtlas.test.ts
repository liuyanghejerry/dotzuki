import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { prepareComponents } from './componentAtlas'
import { useTempProject, writeProjectConfig, makeServer, call, mockReq } from './api/testUtils'
import { registerGroups } from './api/routes/groups'

const root = useTempProject('dotzuki-components-')
const file = (name: string) => path.join(root(), 'data', name)
function json(name: string, data: unknown) {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true })
  fs.writeFileSync(file(name), JSON.stringify(data))
}
function image(name: string, w: number, h: number, colors: number[][]) {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    png.data.set(colors[Math.floor(x / 16) % colors.length], (y * w + x) * 4)
  }
  fs.writeFileSync(file(name), PNG.sync.write(png))
  return png
}
beforeEach(() => {
  writeProjectConfig(root(), { activities: [
    { id: 'maps', type: 'map', config: { mapsDir: 'maps' } },
    { id: 'tiles', type: 'tiles', config: { tilesDir: 'tiles', tileSize: 16 } },
  ] })
  json('maps/Room/map.tmx.json', { tilewidth: 16, tileheight: 16, width: 4, height: 2,
    layers: [{ name: 'ground', data: [1,2,3,1,1,2,3,1] }, { name: 'collision', data: [1,0,0,0,0,0,0,0] }] })
  json('maps/Room/tileset.tiles.json', { tileIds: ['old-a','old-b','old-c'], custom: 'preserve' })
  image('maps/Room/tileset.png',48,16,[[50,60,70,255],[80,90,100,255],[1,2,3,128]])
  json('tiles/groups/groups.json',{ groups: [{ id:'wall', name:'Wall', w:2,h:1 }] })
  image('tiles/groups/wall.png',32,16,[[100,50,20,255],[100,50,20,255]])
})

describe('component atlas preparation', () => {
  it('preserves imported RGBA and GIDs without any old library sources or cols metadata', () => {
    const before = PNG.sync.read(fs.readFileSync(file('maps/Room/tileset.png')))
    const result = prepareComponents('Room',['wall'])
    const after = PNG.sync.read(fs.readFileSync(file('maps/Room/tileset.png')))
    expect(result.cols).toBe(3)
    expect(result.components[0].cells).toEqual([4,4])
    expect(result.tileIds.slice(0,3)).toEqual(['old-a','old-b','old-c'])
    expect(after.data.subarray(0,before.data.length)).toEqual(before.data)
    expect(JSON.parse(fs.readFileSync(file('maps/Room/tileset.tiles.json'),'utf8')).custom).toBe('preserve')
    expect(JSON.parse(fs.readFileSync(file('maps/Room/map.tmx.json'),'utf8')).layers[0].data).toEqual([1,2,3,1,1,2,3,1])
  })
  it('reuses unchanged components and appends edited pixels without altering old instances', () => {
    const first = prepareComponents('Room',['wall'])
    expect(prepareComponents('Room',['wall']).tileIds).toEqual(first.tileIds)
    const before = PNG.sync.read(fs.readFileSync(file('maps/Room/tileset.png')))
    image('tiles/groups/wall.png',32,16,[[200,0,0,255],[100,50,20,255]])
    const next = prepareComponents('Room',['wall'])
    expect(next.components[0].cells).toEqual([5,4])
    expect(next.components[0].revision).not.toBe(first.components[0].revision)
    const after = PNG.sync.read(fs.readFileSync(file('maps/Room/tileset.png')))
    // The first appended tile is at the beginning of row 2, below the legacy atlas.
    expect(after.data.subarray(48*16*4,48*16*4+16*4)).toEqual(before.data.subarray(48*16*4,48*16*4+16*4))
  })
  it('keeps transparent cells as holes and synthesizes IDs for an atlas with no metadata', () => {
    fs.rmSync(file('maps/Room/tileset.tiles.json'))
    image('tiles/groups/wall.png',32,16,[[100,50,20,255],[0,0,0,0]])
    const result = prepareComponents('Room',['wall'])
    expect(result.tileIds.slice(0,3)).toEqual(['imported-Room-0','imported-Room-1','imported-Room-2'])
    expect(result.components[0].cells).toEqual([4,0])
  })
  it('fails before changing any file if a component or old pixel source is missing', () => {
    const atlas = fs.readFileSync(file('maps/Room/tileset.png'))
    const seq = fs.readFileSync(file('maps/Room/tileset.tiles.json'))
    expect(()=>prepareComponents('Room',['wall','absent'])).toThrow('Component not found')
    expect(fs.readFileSync(file('maps/Room/tileset.png'))).toEqual(atlas)
    expect(fs.readFileSync(file('maps/Room/tileset.tiles.json'))).toEqual(seq)
    expect(fs.existsSync(file('tiles/library.json'))).toBe(false)
    fs.rmSync(file('maps/Room/tileset.png'))
    expect(()=>prepareComponents('Room',['wall'])).toThrow()
    expect(fs.readFileSync(file('maps/Room/tileset.tiles.json'))).toEqual(seq)
    expect(fs.existsSync(file('maps/Room/tileset.png'))).toBe(false)
  })
  it('rejects missing GIDs and mismatched component geometry before writing', () => {
    json('tiles/groups/groups.json',{groups:[{id:'wall',w:3,h:1}]})
    expect(()=>prepareComponents('Room',['wall'])).toThrow('tile grid')
    json('maps/Room/tileset.tiles.json',{tileIds:['only-one']})
    expect(()=>prepareComponents('Room',['wall'])).toThrow('missing or unsupported')
  })
  it('serves the same preparation through the editor API and rejects traversal', async () => {
    const server=makeServer();registerGroups(server)
    const response=await call(server.routes,'/api/groups-prepare',mockReq('POST',{map:'Room',groupIds:['wall']}))
    expect(response.json()).toMatchObject({ok:true,cols:3,components:[{groupId:'wall',cells:[4,4]}]})
    const bad=await call(server.routes,'/api/groups-prepare',mockReq('POST',{map:'../Room',groupIds:['wall']}))
    expect(bad.status).toBe(400)
  })
  it('persists auto-tile sets through the editor API and validates them before writing', async () => {
    const server=makeServer();registerGroups(server)
    const set={id:'stone',name:'Stone walls',mode:'cardinal',
      variants:Object.fromEntries(Array.from({length:16},(_,mask)=>[mask,'wall']))}
    const saved=await call(server.routes,'/api/connection-sets',mockReq('PUT',{sets:[set]}))
    expect(saved.json()).toMatchObject({ok:true,sets:[set]})
    expect(JSON.parse(fs.readFileSync(file('tiles/connections.json'),'utf8'))).toEqual({version:2,sets:[set]})
    const loaded=await call(server.routes,'/api/connection-sets',mockReq('GET'))
    expect(loaded.json()).toEqual({sets:[set]})

    const invalid=await call(server.routes,'/api/connection-sets',mockReq('PUT',{
      sets:[{...set,mode:'blob'}],
    }))
    expect(invalid.status).toBe(400)
    expect(JSON.parse(fs.readFileSync(file('tiles/connections.json'),'utf8'))).toEqual({version:2,sets:[set]})
  })
})
