import { describe, it, expect } from 'vitest'
import { applyConnectionStroke, connectionMask, validateConnectionSets, type ConnectionSet } from './wallConnections'
import { type ComponentLayer } from './mapComponents'
import { setActivePinia, createPinia } from 'pinia'
import { useMapActivity } from '../composables/useMapActivity'

const set: ConnectionSet={id:'plaster',name:'Plaster walls',variants:Object.fromEntries(Array.from({length:16},(_,i)=>[i,`wall-${i}`]))}
const sources=Array.from({length:16},(_,i)=>({groupId:`wall-${i}`,revision:'v1',w:1,h:1,cells:[i+2]}))
describe('wall connections',()=>{
  it('selects every cardinal combination, including ends, corners, T joins and crosses',()=>{
    for(let mask=0;mask<16;mask++){
      const occupied=new Set([4]);if(mask&1)occupied.add(1);if(mask&2)occupied.add(5);if(mask&4)occupied.add(7);if(mask&8)occupied.add(3)
      expect(connectionMask(occupied,3,3,1,1)).toBe(mask)
    }
    expect(connectionMask(new Set([2,3]),3,2,0,1)).toBe(0) // no wrapping across a row
  })
  it('joins a corner and replaces neighboring end caps when a segment is erased',()=>{
    const layer: ComponentLayer={data:Array(25).fill(1)}
    applyConnectionStroke(layer,5,5,set,sources,[{x:1,y:1,solid:true},{x:2,y:1,solid:true},{x:2,y:2,solid:true}])
    expect(layer.data[6]).toBe(2+2) // east end
    expect(layer.data[7]).toBe(12+2) // west + south corner
    expect(layer.data[12]).toBe(1+2) // north end
    applyConnectionStroke(layer,5,5,set,sources,[{x:2,y:2,solid:false}])
    expect(layer.data[12]).toBe(1) // restored ground
    expect(layer.data[7]).toBe(8+2) // now a west end
    expect(layer.components).toHaveLength(2)
  })
  it('rejects incomplete rules without modifying the map',()=>{
    const layer: ComponentLayer={data:Array(9).fill(1)}
    expect(()=>validateConnectionSets([{...set,variants:{0:'wall-0'}}])).toThrow('missing variant')
    expect(()=>applyConnectionStroke(layer,3,3,set,[],[{x:1,y:1,solid:true}])).toThrow('variant')
    expect(layer).toEqual({data:Array(9).fill(1)})
  })
  it('keeps an externally edited cell and recalculates the remaining neighbors',()=>{
    const layer: ComponentLayer={data:Array(9).fill(1)}
    applyConnectionStroke(layer,3,3,set,sources,[{x:0,y:0,solid:true},{x:1,y:0,solid:true}])
    layer.data[1]=99
    applyConnectionStroke(layer,3,3,set,sources,[])
    expect(layer.data[1]).toBe(99)
    expect(layer.data[0]).toBe(2) // isolated
  })
  it('undoes and redoes a wall stroke with the connectivity needed by the next stroke',()=>{
    setActivePinia(createPinia());const store=useMapActivity()
    store.tmx={width:3,height:3,tilewidth:16,tileheight:16,layers:[{name:'walls',width:3,height:3,data:Array(9).fill(1)}]}
    store.paintConnections(0,set,sources,[{x:0,y:0,solid:true},{x:1,y:0,solid:true}]);store.undo()
    expect(store.tmx.layers[0].data).toEqual(Array(9).fill(1))
    expect(store.tmx.layers[0].components).toHaveLength(0)
    store.redo();store.paintConnections(0,set,sources,[{x:1,y:1,solid:true}])
    expect(store.tmx.layers[0].data[1]).toBe(12+2)
    expect(store.tmx.layers[0].components).toHaveLength(3)
  })
})
