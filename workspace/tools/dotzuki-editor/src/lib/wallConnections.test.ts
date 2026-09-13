import { describe, it, expect } from 'vitest'
import {
  applyConnectionStroke,
  BLOB_MASKS,
  connectionMask,
  normalizeBlobMask,
  validateConnectionSets,
  type ConnectionSet,
} from './wallConnections'
import { type ComponentLayer } from './mapComponents'
import { setActivePinia, createPinia } from 'pinia'
import { useMapActivity } from '../composables/useMapActivity'

const set: ConnectionSet={id:'plaster',name:'Plaster walls',variants:Object.fromEntries(Array.from({length:16},(_,i)=>[i,`wall-${i}`]))}
const sources=Array.from({length:16},(_,i)=>({groupId:`wall-${i}`,revision:'v1',w:1,h:1,cells:[i+2]}))
const blobSet: ConnectionSet={
  id:'grass',name:'Grass',mode:'blob',
  variants:Object.fromEntries(BLOB_MASKS.map(mask=>[mask,`grass-${mask}`])),
}
const blobSources=BLOB_MASKS.map((mask,i)=>({groupId:`grass-${mask}`,revision:'v1',w:1,h:1,cells:[i+100]}))
describe('wall connections',()=>{
  it('selects every cardinal combination, including ends, corners, T joins and crosses',()=>{
    for(let mask=0;mask<16;mask++){
      const occupied=new Set([4]);if(mask&1)occupied.add(1);if(mask&2)occupied.add(5);if(mask&4)occupied.add(7);if(mask&8)occupied.add(3)
      expect(connectionMask(occupied,3,3,1,1)).toBe(mask)
    }
    expect(connectionMask(new Set([2,3]),3,2,0,1)).toBe(0) // no wrapping across a row
  })
  it('exposes the canonical 47 blob masks and gates unsupported diagonals',()=>{
    expect(BLOB_MASKS).toHaveLength(47)
    expect(new Set(BLOB_MASKS).size).toBe(47)
    expect(normalizeBlobMask(0xff)).toBe(0xff)
    expect(normalizeBlobMask(0x10)).toBe(0)

    const center=12
    const north=7,east=13,northEast=8
    expect(connectionMask(new Set([center,north,east]),5,5,2,2,'blob')).toBe(3)
    expect(connectionMask(new Set([center,north,east,northEast]),5,5,2,2,'blob')).toBe(19)
  })
  it('uses inner-corner variants while painting a filled terrain',()=>{
    const layer: ComponentLayer={data:Array(25).fill(1)}
    const changes=[]
    for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)changes.push({x,y,solid:true})
    changes.push({x:3,y:1,solid:false})
    applyConnectionStroke(layer,5,5,blobSet,blobSources,changes)
    const centerMask=0x0f|0x20|0x40|0x80 // north-east is the missing concave corner
    expect(layer.data[12]).toBe(blobSources[BLOB_MASKS.indexOf(centerMask)].cells[0])
    expect(layer.components).toHaveLength(8)
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
    expect(()=>validateConnectionSets([{...set,mode:'diagonal'}])).toThrow('invalid mode')
    expect(()=>validateConnectionSets([{...blobSet,variants:{...set.variants}}])).toThrow('missing variant 19')
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
