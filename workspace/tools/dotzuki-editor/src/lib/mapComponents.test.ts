import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMapActivity } from '../composables/useMapActivity'
import { placeComponent, refreshComponents, type ComponentLayer } from './mapComponents'

const wall = { groupId:'wall', revision:'v1',w:2,h:1,cells:[2,2] }
const changed = {...wall,revision:'v2',cells:[3,0]}
describe('linked map components', () => {
  it('updates every linked copy and restores the floor when a source cell becomes transparent', () => {
    const layer: ComponentLayer={data:Array(12).fill(1)}
    placeComponent(layer,6,2,0,0,wall)
    placeComponent(layer,6,2,3,0,wall)
    expect(refreshComponents(layer,6,2,[changed]).updated).toBe(2)
    expect(layer.data).toEqual([3,1,1,3,1,1,1,1,1,1,1,1])
    const reopened=JSON.parse(JSON.stringify(layer))
    expect(refreshComponents(reopened,6,2,[changed]).updated).toBe(0)
  })
  it('preserves external local edits and resized source instances', () => {
    const layer: ComponentLayer={data:Array(12).fill(1)}
    placeComponent(layer,6,2,0,0,wall)
    layer.data[1]=99
    expect(refreshComponents(layer,6,2,[changed]).conflicts).toBe(1)
    expect(layer.data.slice(0,2)).toEqual([2,99])
    expect(refreshComponents(layer,6,2,[{...changed,w:3,cells:[3,3,3]}]).resized).toBe(1)
  })
  it('supports unlinked copies and rejects clipped placements', () => {
    const layer: ComponentLayer={data:Array(12).fill(1)}
    placeComponent(layer,6,2,0,0,wall,false)
    expect(refreshComponents(layer,6,2,[changed]).updated).toBe(0)
    expect(()=>placeComponent(layer,6,2,5,0,wall)).toThrow('inside')
    expect(layer.data.slice(0,2)).toEqual([2,2])
  })
  it('undoes paint detachment, updates and map resizing with their instance metadata', () => {
    setActivePinia(createPinia())
    const store=useMapActivity()
    store.tmx={width:6,height:2,tilewidth:16,tileheight:16,layers:[{name:'walls',width:6,height:2,data:Array(12).fill(1)}]}
    store.placeComponent(0,1,0,wall)
    store.beginStroke(0);store.setCell(0,1,0,99);store.endStroke()
    expect(store.tmx.layers[0].components).toHaveLength(0)
    store.undo()
    expect(store.tmx.layers[0].components).toHaveLength(1)
    store.updateComponents([changed])
    expect(store.tmx.layers[0].data.slice(1,3)).toEqual([3,1])
    store.undo()
    expect(store.tmx.layers[0].components![0].revision).toBe('v1')
    store.redo()
    expect(store.tmx.layers[0].components![0].revision).toBe('v2')
    store.resizeMap(8,3,'right','bottom')
    expect(store.tmx.layers[0].components![0]).toMatchObject({x:3,y:1})
    store.undo()
    expect(store.tmx.layers[0].components![0]).toMatchObject({x:1,y:0})
  })
})
