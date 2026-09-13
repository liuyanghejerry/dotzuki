<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { artAssetUrl, artDrawOrder, artImagePaths, moveArtComponent, validateArt, type ArtComponent, type ArtGeometry, type ArtLibraryEntry, type NativeMapArt } from '../../lib/nativeMapArt'

const props = defineProps<{ name: string; active: boolean }>()
const emit = defineEmits<{ dirty: [value: boolean]; editAsset: [id: string] }>()
const { t } = useI18n({ useScope: 'local', messages: {
  en: { title: 'Native scenery', add: 'Place library object', library: 'Library image', save: 'Save scenery', reload: 'Reload from disk', undo: 'Undo', redo: 'Redo', duplicate: 'Duplicate', remove: 'Remove', collision: 'Collision', points: 'NPCs and exits', grid: 'Grid', water: 'Water mask', edit: 'Edit pixels', ground: 'Ground', depth: 'Depth sorted', foreground: 'Foreground', anchor: 'Sorting foot Y', layer: 'Layer', select: 'Select an object on the map or in this list.', objects: 'Objects', filter: 'Filter images', help: 'Drag to move; arrows nudge; Shift + arrows moves one tile. Scenery coordinates are logical pixels. Collision shows the saved map and is edited in the tilemap tab.', discard: 'Discard unsaved scenery changes and reload?', saved: 'Scenery saved', empty: 'No selection', snap: 'Snap to tiles', loading: 'Loading scenery…', loadingError: 'Could not load scenery', savingError: 'Could not save scenery' },
  zh: { title: '原生布景', add: '放置素材库物件', library: '素材库图片', save: '保存布景', reload: '从磁盘重载', undo: '撤销', redo: '重做', duplicate: '复制', remove: '移除', collision: '碰撞', points: '人物与出入口', grid: '网格', water: '水纹范围', edit: '编辑像素', ground: '地面', depth: '按脚底排序', foreground: '前景', anchor: '排序脚底 Y', layer: '层级', select: '在地图或列表中选择物件。', objects: '物件', filter: '筛选图片', help: '拖动物件；方向键微调；Shift + 方向键移动一格。布景坐标使用逻辑像素。碰撞显示已保存地图，在地块标签页中修改。', discard: '丢弃未保存的布景修改并重新加载？', saved: '布景已保存', empty: '未选择', snap: '吸附网格', loading: '正在加载布景…', loadingError: '布景加载失败', savingError: '布景保存失败' },
} })
const art = ref<NativeMapArt | null>(null), geometry = ref<ArtGeometry | null>(null)
const objects = ref<Record<string, { x: number; y: number; name?: string }[]>>({}), showObjects = ref(false)
const images = shallowRef(new Map<string, HTMLImageElement>())
const alpha = new Map<string, Uint8ClampedArray>()
const canvas = ref<HTMLCanvasElement | null>(null), scroll = ref<HTMLDivElement | null>(null)
const library = ref<ArtLibraryEntry[]>([]), libraryChoice = ref('')
const libraryEntries = computed(() => library.value.filter(g => (g.id + g.name).toLowerCase().includes(filter.value.toLowerCase())))
const selected = ref<number | null>(null), zoom = ref(1), snap = ref(true)
const collision = ref(false), grid = ref(false), water = ref(false), filter = ref('')
const busy = ref(false), error = ref(''), status = ref(''), revision = ref(''), saved = ref('')
const past = ref<string[]>([]), future = ref<string[]>([])
const serialized = computed(() => art.value ? JSON.stringify(art.value) : '')
const dirty = computed(() => serialized.value !== saved.value)
const component = computed(() => selected.value === null ? null : art.value?.components[selected.value] ?? null)
const entries = computed(() => (art.value?.components ?? []).map((c, index) => ({ c, index }))
  .filter(({ c }) => c.image.toLowerCase().includes(filter.value.toLowerCase())))
const assetId = (image: string) => /(?:^|\/)groups\/([^/]+)\.png$/.exec(image)?.[1]
const imageName = (image: string) => image.split('/').pop() ?? image
let drag: { pointer: number; index: number; start: [number, number]; component: ArtComponent; before: string } | null = null
watch(dirty, value => emit('dirty', value))

async function refreshImages(a: NativeMapArt): Promise<void> {
  const loaded = new Map<string, HTMLImageElement>()
  const pixels = new Map<string, Uint8ClampedArray>()
  await Promise.all(artImagePaths(a).map(async source => {
    const image = new Image(); image.src = artAssetUrl(props.name, source, String(Date.now()))
    await image.decode(); loaded.set(source, image)
    // Alpha-aware picking lets authors click through transparent roof corners.
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height
    const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0)
    pixels.set(source, ctx.getImageData(0, 0, c.width, c.height).data)
  }))
  images.value = loaded; alpha.clear(); for (const [key, pixels_] of pixels) alpha.set(key, pixels_)
  draw()
}
async function refreshOnReturn(): Promise<void> {
  if (!art.value || busy.value) return
  busy.value = true
  try { await refreshImages(art.value) }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function load(force = false): Promise<void> {
  if (busy.value || (force && dirty.value && !confirm(t('discard')))) return
  busy.value = true; error.value = ''; status.value = ''
  try {
    const response = await fetch(`api/map-art?${new URLSearchParams({ name: props.name })}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw Error(data.error || t('loadingError'))
    validateArt(data.art)
    await refreshImages(data.art)
    geometry.value = data.geometry; objects.value = data.objects ?? {}; library.value = data.library ?? []; art.value = data.art; revision.value = data.revision
    saved.value = JSON.stringify(data.art); past.value = []; future.value = []; selected.value = null
    await nextTick(); draw()
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
function record(before: string): void {
  if (before === serialized.value) return
  past.value.push(before); if (past.value.length > 50) past.value.shift()
  future.value = []; status.value = ''
}
function change(fn: (a: NativeMapArt) => void): void {
  if (!art.value || busy.value) return
  const before = serialized.value; fn(art.value); record(before); draw()
}
function undo(): void {
  if (busy.value || !past.value.length) return
  future.value.push(serialized.value); art.value = JSON.parse(past.value.pop()!)
  selected.value = null; status.value = ''; draw()
}
function redo(): void {
  if (busy.value || !future.value.length) return
  past.value.push(serialized.value); art.value = JSON.parse(future.value.pop()!)
  selected.value = null; status.value = ''; draw()
}
function setNumber(field: 'x' | 'y' | 'foot_y', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isSafeInteger(value) || selected.value === null) return
  change(a => {
    const c = a.components[selected.value!]!
    if (field === 'y') c.foot_y += value - c.y
    c[field] = value
  })
}
function setLayer(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ArtComponent['layer']
  if (selected.value !== null) change(a => { a.components[selected.value!]!.layer = value })
}
function duplicate(): void {
  if (!component.value || !geometry.value) return
  const copy = moveArtComponent(component.value, geometry.value.tilewidth, geometry.value.tileheight)
  change(a => { a.components.push(copy); selected.value = a.components.length - 1 })
}
function remove(): void {
  if (selected.value !== null) change(a => { a.components.splice(selected.value!, 1); selected.value = null })
}
async function add(): Promise<void> {
  const entry = library.value.find(g => g.image === libraryChoice.value)
  if (!entry || !art.value || !geometry.value || busy.value) return
  error.value = ''
  try {
    if (!images.value.has(entry.image)) {
      busy.value = true
      const image = new Image(); image.src = artAssetUrl(props.name, entry.image, String(Date.now())); await image.decode()
      if (image.width % art.value.pixels_per_unit || image.height % art.value.pixels_per_unit) throw Error('Image dimensions must align to density')
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height
      const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0)
      images.value.set(entry.image, image); alpha.set(entry.image, ctx.getImageData(0, 0, c.width, c.height).data)
      busy.value = false
    }
    const d = art.value.pixels_per_unit, im = images.value.get(entry.image)!, g = geometry.value
    const x = Math.round(((scroll.value?.scrollLeft ?? 0) + (scroll.value?.clientWidth ?? 320) / 2) / (d * zoom.value) / g.tilewidth) * g.tilewidth
    const y = Math.round(((scroll.value?.scrollTop ?? 0) + (scroll.value?.clientHeight ?? 240) / 2) / (d * zoom.value) / g.tileheight) * g.tileheight
    change(a => { a.components.push({ image: entry.image, x, y, foot_y: y + im.height / d - g.tileheight, layer: 'depth' }); selected.value = a.components.length - 1 })
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function save(): Promise<void> {
  if (busy.value || !art.value || !dirty.value) return
  busy.value = true; error.value = ''; status.value = ''
  const snapshot = serialized.value
  try {
    const response = await fetch(`api/map-art?${new URLSearchParams({ name: props.name })}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ art: JSON.parse(snapshot), revision: revision.value }),
    })
    const result = await response.json()
    if (!response.ok) throw Error(result.error || t('savingError'))
    saved.value = snapshot; revision.value = result.revision; status.value = t('saved')
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}

function draw(): void {
  const c = canvas.value, a = art.value, g = geometry.value
  if (!c || !a || !g) return
  const d = a.pixels_per_unit, width = g.width * g.tilewidth, height = g.height * g.tileheight
  c.width = width * d; c.height = height * d
  c.style.width = `${c.width * zoom.value}px`; c.style.height = `${c.height * zoom.value}px`
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.scale(d, d)
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height)
  const image = (source: string, x: number, y: number) => {
    const im = images.value.get(source); if (im) ctx.drawImage(im, x, y, im.width / d, im.height / d)
  }
  image(a.ground, 0, 0)
  for (const i of artDrawOrder(a)) { const c = a.components[i]!; image(c.image, c.x, c.y) }
  if (water.value && a.water_mask) { ctx.globalAlpha = .4; image(a.water_mask, 0, 0); ctx.globalAlpha = 1 }
  if (collision.value) {
    ctx.fillStyle = 'rgba(245,65,80,.4)'
    g.collision.forEach((v, i) => { if (v) ctx.fillRect(i % g.width * g.tilewidth, Math.floor(i / g.width) * g.tileheight, g.tilewidth, g.tileheight) })
  }
  if (grid.value) {
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1 / d; ctx.beginPath()
    for (let x = 0; x <= width; x += g.tilewidth) { ctx.moveTo(x, 0); ctx.lineTo(x, height) }
    for (let y = 0; y <= height; y += g.tileheight) { ctx.moveTo(0, y); ctx.lineTo(width, y) }
    ctx.stroke()
  }
  const pick = component.value, im = pick && images.value.get(pick.image)
  if (showObjects.value) {
    ctx.font = '8px sans-serif'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 1 / d
    for (const [kind, color] of [['npcs', '#ffa0db'], ['signs', '#ffdc70'], ['warps', '#6bf5ed']]) {
      ctx.strokeStyle = color!; ctx.fillStyle = color!
      for (const obj of objects.value[kind!] ?? []) {
        const x = obj.x * g.tilewidth, y = obj.y * g.tileheight
        ctx.strokeRect(x, y, g.tilewidth, g.tileheight)
        if (obj.name) ctx.fillText(obj.name, x, y)
      }
    }
  }
  if (pick && im) {
    ctx.strokeStyle = '#ffdb71'; ctx.lineWidth = 1 / d; ctx.strokeRect(pick.x, pick.y, im.width / d, im.height / d)
    ctx.strokeStyle = '#6bf5ed'; ctx.beginPath(); ctx.moveTo(pick.x, pick.foot_y); ctx.lineTo(pick.x + im.width / d, pick.foot_y); ctx.stroke()
  }
}
function point(e: PointerEvent): [number, number] {
  const rect = canvas.value!.getBoundingClientRect(), a = art.value!
  return [(e.clientX - rect.left) / (zoom.value * a.pixels_per_unit), (e.clientY - rect.top) / (zoom.value * a.pixels_per_unit)]
}
function down(e: PointerEvent): void {
  if (!art.value || busy.value || e.button !== 0) return
  const a = art.value, [x, y] = point(e), d = a.pixels_per_unit
  selected.value = null
  for (const i of artDrawOrder(a).reverse()) {
    const c = a.components[i]!, im = images.value.get(c.image)!, px = Math.floor((x - c.x) * d), py = Math.floor((y - c.y) * d)
    if (px >= 0 && py >= 0 && px < im.width && py < im.height && alpha.get(c.image)![(py * im.width + px) * 4 + 3]! > 32) { selected.value = i; break }
  }
  if (selected.value !== null) {
    drag = { pointer: e.pointerId, index: selected.value, start: [x, y], component: { ...component.value! }, before: serialized.value }
    canvas.value!.setPointerCapture(e.pointerId)
  }
  canvas.value!.focus(); draw()
}
function move(e: PointerEvent): void {
  if (!drag || drag.pointer !== e.pointerId || !art.value || !geometry.value) return
  const [x, y] = point(e), sx = snap.value ? geometry.value.tilewidth : 1, sy = snap.value ? geometry.value.tileheight : 1
  art.value.components[drag.index] = moveArtComponent(drag.component, Math.round((x - drag.start[0]) / sx) * sx, Math.round((y - drag.start[1]) / sy) * sy)
  draw()
}
function up(e: PointerEvent): void {
  if (!drag || drag.pointer !== e.pointerId) return
  const before = drag.before; drag = null
  if (canvas.value?.hasPointerCapture(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
  record(before); draw()
}
function cancel(): void {
  if (!drag) return
  art.value = JSON.parse(drag.before); drag = null; draw()
}
function key(e: KeyboardEvent): void {
  if (!props.active) return
  const command = e.metaKey || e.ctrlKey
  if (command && e.key.toLowerCase() === 's') {
    e.preventDefault(); (e.target as HTMLElement).blur(); void save(); return
  }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return
  if (command && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
  if (e.key === 'Escape') { cancel(); return }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
  if (direction && component.value && geometry.value) {
    e.preventDefault()
    const dx = direction[0]! * (e.shiftKey ? geometry.value.tilewidth : 1), dy = direction[1]! * (e.shiftKey ? geometry.value.tileheight : 1)
    change(a => { a.components[selected.value!] = moveArtComponent(component.value!, dx, dy) })
  }
}
function beforeUnload(e: BeforeUnloadEvent): void { if (dirty.value) e.preventDefault() }
watch([zoom, collision, grid, water, showObjects, selected], draw)
watch(() => props.active, active => { if (!active) cancel(); else void nextTick(refreshOnReturn) })
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))
defineExpose({ save })
</script>

<template>
  <section class="art-editor" tabindex="0" @keydown.stop="key" data-testid="native-art-editor" :data-map="name" :data-dirty="dirty">
    <div class="art-toolbar">
      <strong>{{ name }} · {{ t('title') }}{{ dirty ? ' *' : '' }}</strong>
      <button :disabled="busy || !dirty" @click="save" data-testid="art-save">{{ t('save') }}</button>
      <button :disabled="busy" @click="load(true)">{{ t('reload') }}</button>
      <button :disabled="busy || !past.length" @click="undo" data-testid="art-undo">{{ t('undo') }}</button>
      <button :disabled="busy || !future.length" @click="redo">{{ t('redo') }}</button>
      <select v-model.number="zoom" aria-label="Zoom"><option :value=".5">50%</option><option :value="1">100%</option><option :value="2">200%</option></select>
      <label><input type="checkbox" v-model="snap">{{ t('snap') }}</label>
      <label><input type="checkbox" v-model="collision">{{ t('collision') }}</label>
      <label><input type="checkbox" v-model="grid">{{ t('grid') }}</label>
      <label><input type="checkbox" v-model="showObjects">{{ t('points') }}</label>
      <label v-if="art?.water_mask"><input type="checkbox" v-model="water">{{ t('water') }}</label>
    </div>
    <p class="art-help">{{ t('help') }}</p>
    <p v-if="error" role="alert" class="art-error">{{ error }}</p>
    <p v-if="status" role="status" class="art-help">{{ status }}</p>
    <p v-if="busy" class="art-help">{{ t('loading') }}</p>
    <div class="art-body">
      <div ref="scroll" class="art-scroll"><canvas ref="canvas" tabindex="0" data-testid="art-canvas" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @lostpointercapture="cancel" /></div>
      <aside class="art-inspector">
        <template v-if="component">
          <strong>{{ imageName(component.image) }}</strong>
          <label>X <input type="number" :value="component.x" :disabled="busy" @change="setNumber('x', $event)" data-testid="art-x"></label>
          <label>Y <input type="number" :value="component.y" :disabled="busy" @change="setNumber('y', $event)" data-testid="art-y"></label>
          <label>{{ t('anchor') }} <input type="number" :value="component.foot_y" :disabled="busy" @change="setNumber('foot_y', $event)" data-testid="art-foot"></label>
          <label>{{ t('layer') }} <select :value="component.layer" :disabled="busy" @change="setLayer"><option value="ground">{{ t('ground') }}</option><option value="depth">{{ t('depth') }}</option><option value="foreground">{{ t('foreground') }}</option></select></label>
          <div class="art-toolbar"><button @click="duplicate" :disabled="busy">{{ t('duplicate') }}</button><button @click="remove" :disabled="busy">{{ t('remove') }}</button></div>
          <button v-if="assetId(component.image)" @click="emit('editAsset', assetId(component.image)!)">{{ t('edit') }}</button>
        </template>
        <p v-else>{{ t('select') }}</p>
        <button v-if="art && assetId(art.ground)" @click="emit('editAsset', assetId(art.ground)!)">{{ t('ground') }} · {{ t('edit') }}</button>
        <strong>{{ t('objects') }} · {{ art?.components.length ?? 0 }}</strong>
        <input v-model="filter" :placeholder="t('filter')" data-testid="art-filter">
        <label>{{ t('library') }}<select v-model="libraryChoice" data-testid="art-library"><option value="">—</option><option v-for="g in libraryEntries" :key="g.id" :value="g.image">{{ g.name }}</option></select></label>
        <button :disabled="busy || !libraryChoice" @click="add" data-testid="art-add">{{ t('add') }}</button>
        <div class="art-list"><button v-for="entry in entries" :key="entry.index" :class="{ chosen: selected === entry.index }" @click="selected = entry.index" :data-art-index="entry.index">{{ entry.index + 1 }} · {{ imageName(entry.c.image) }}</button></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.art-editor{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;height:100%;color:var(--color-ink-body);background:var(--color-surface);font-size:12px}.art-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px}.art-toolbar label{display:flex;gap:4px;align-items:center}.art-help{color:var(--color-ink-muted);padding:4px 10px}.art-error{color:var(--color-danger-ink);padding:6px 10px}.art-body{display:flex;flex:1;min-height:0;min-width:0}.art-scroll{overflow:auto;flex:1;min-width:0;background:var(--color-raised)}canvas{display:block;image-rendering:pixelated;touch-action:none;outline:none}.art-inspector{display:flex;flex-direction:column;gap:8px;width:220px;flex-shrink:0;padding:10px;min-height:0;border-left:1px solid var(--color-border)}.art-inspector strong{overflow-wrap:anywhere}.art-inspector label{display:flex;gap:8px;justify-content:space-between;align-items:center}.art-inspector input[type=number]{width:90px}.art-inspector select{max-width:140px}.art-list{display:flex;flex-direction:column;overflow:auto;flex:1;min-height:80px}.art-list button{text-align:left;overflow-wrap:anywhere}button,input,select{border:1px solid var(--color-border);border-radius:4px;padding:4px 6px;background:var(--color-raised);color:inherit}button{cursor:pointer}button:hover,.chosen{background:var(--color-overlay)}button:disabled{opacity:.5;cursor:default}input[type=checkbox]{width:13px;height:13px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--color-accent-ink)}
</style>
