<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { requiredConnectionMasks, type ConnectionSet } from '@/lib/wallConnections'
import { useTilesActivity, type GroupEntry } from '@/composables/useTilesActivity'

const props = defineProps<{
  sets: ConnectionSet[]
  groups: GroupEntry[]
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{
  close: []
  save: [sets: ConnectionSet[]]
}>()

const { t } = useI18n()
const tilesStore = useTilesActivity()
const draft = ref<ConnectionSet[]>(props.sets.map(set => ({
  ...set,
  mode: set.mode ?? 'cardinal',
  variants: { ...set.variants },
})))
const activeIndex = ref(draft.value.length ? 0 : -1)
const active = computed(() => draft.value[activeIndex.value] ?? null)
const masks = computed(() => requiredConnectionMasks(active.value?.mode))
const oneTileGroups = computed(() => props.groups.filter(group => group.w === 1 && group.h === 1))

const completeCount = computed(() => {
  const set = active.value
  if (!set) return 0
  return masks.value.filter(mask => oneTileGroups.value.some(group => group.id === set.variants[mask])).length
})

const valid = computed(() => draft.value.every(set => {
  if (!/^[\w-]+$/.test(set.id) || !set.name.trim()) return false
  const required = requiredConnectionMasks(set.mode)
  return required.every(mask => oneTileGroups.value.some(group => group.id === set.variants[mask]))
}) && new Set(draft.value.map(set => set.id.trim())).size === draft.value.length)

const maskBits = [128, 1, 16, 8, 0, 2, 64, 4, 32]
function maskCell(mask: number, index: number): boolean {
  return index === 4 || !!(mask & maskBits[index])
}

function addSet(): void {
  let n = draft.value.length + 1
  const taken = new Set(draft.value.map(set => set.id))
  while (taken.has(`terrain-${n}`)) n++
  draft.value.push({ id: `terrain-${n}`, name: t('map.autotile.newName'), mode: 'blob', variants: {} })
  activeIndex.value = draft.value.length - 1
}

function removeSet(): void {
  if (!active.value || !window.confirm(t('map.autotile.deleteConfirm', { name: active.value.name }))) return
  draft.value.splice(activeIndex.value, 1)
  activeIndex.value = Math.min(activeIndex.value, draft.value.length - 1)
}

function autoAssign(): void {
  const set = active.value
  if (!set || oneTileGroups.value.length < masks.value.length) return
  masks.value.forEach((mask, index) => { set.variants[mask] = oneTileGroups.value[index].id })
}

function normalizedSets(): ConnectionSet[] {
  return draft.value.map(set => ({
    id: set.id.trim(),
    name: set.name.trim(),
    mode: set.mode ?? 'cardinal',
    variants: Object.fromEntries(requiredConnectionMasks(set.mode).map(mask => [mask, set.variants[mask]])),
  }))
}

const initialSignature = JSON.stringify(props.sets.map(set => ({
  id: set.id,
  name: set.name,
  mode: set.mode ?? 'cardinal',
  variants: Object.fromEntries(requiredConnectionMasks(set.mode).map(mask => [mask, set.variants[mask]])),
})))
const changed = computed(() => JSON.stringify(normalizedSets()) !== initialSignature)
</script>

<template>
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" @click.self="emit('close')">
    <div class="bg-surface border border-border-strong rounded-card shadow-popover w-[min(1060px,94vw)] h-[min(760px,90vh)] flex flex-col">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          <h3 class="text-sm font-semibold text-ink-secondary">{{ $t('map.autotile.title') }}</h3>
          <p class="text-tiny text-ink-faint mt-0.5">{{ $t('map.autotile.subtitle') }}</p>
        </div>
        <button class="text-ink-muted hover:text-ink-secondary" @click="emit('close')">✕</button>
      </header>

      <div class="flex flex-1 min-h-0">
        <aside class="w-52 border-r border-border p-2 flex flex-col shrink-0">
          <button
            v-for="(set, index) in draft"
            :key="set.id + index"
            @click="activeIndex = index"
            :class="[
              'text-left px-2 py-2 rounded-control mb-1',
              activeIndex === index ? 'bg-accent-hover text-accent-ink' : 'text-ink-body hover:bg-raised',
            ]"
          >
            <span class="block text-xs truncate">{{ set.name || set.id }}</span>
            <span class="block text-micro text-ink-faint mt-0.5">
              {{ $t(`map.autotileMode.${set.mode ?? 'cardinal'}`) }}
            </span>
          </button>
          <button class="mt-1 px-2 py-1.5 text-xs rounded-control border border-dashed border-border-strong text-accent-ink hover:bg-raised" @click="addSet">
            ＋ {{ $t('map.autotile.add') }}
          </button>
          <div class="mt-auto text-micro text-ink-faint leading-relaxed p-1">
            {{ $t('map.autotile.groupHint') }}
          </div>
        </aside>

        <main v-if="active" class="flex-1 min-w-0 flex flex-col">
          <div class="p-3 border-b border-border grid grid-cols-[1fr_1fr_auto] gap-3 items-end shrink-0">
            <label class="text-xs text-ink-muted">
              <span class="block mb-1">{{ $t('map.autotile.id') }}</span>
              <input v-model.trim="active.id" class="w-full px-2 py-1 bg-raised border border-border-strong rounded-control text-ink-secondary" />
            </label>
            <label class="text-xs text-ink-muted">
              <span class="block mb-1">{{ $t('map.autotile.name') }}</span>
              <input v-model="active.name" class="w-full px-2 py-1 bg-raised border border-border-strong rounded-control text-ink-secondary" />
            </label>
            <label class="text-xs text-ink-muted">
              <span class="block mb-1">{{ $t('map.autotile.mode') }}</span>
              <select v-model="active.mode" class="px-2 py-1 bg-raised border border-border-strong rounded-control text-ink-secondary">
                <option value="cardinal">{{ $t('map.autotileMode.cardinal') }}</option>
                <option value="blob">{{ $t('map.autotileMode.blob') }}</option>
              </select>
            </label>
          </div>

          <div class="px-3 py-2 border-b border-border flex items-center gap-3 shrink-0">
            <span :class="['text-xs', completeCount === masks.length ? 'text-success-ink' : 'text-warning-ink']">
              {{ $t('map.autotile.progress', { done: completeCount, total: masks.length }) }}
            </span>
            <button
              class="px-2 py-1 text-xs rounded-control bg-raised hover:bg-overlay text-ink-body disabled:opacity-40"
              :disabled="oneTileGroups.length < masks.length"
              :title="$t('map.autotile.autoAssignHint')"
              @click="autoAssign"
            >{{ $t('map.autotile.autoAssign') }}</button>
            <span v-if="oneTileGroups.length < masks.length" class="text-micro text-warning-ink">
              {{ $t('map.autotile.needGroups', { count: masks.length - oneTileGroups.length }) }}
            </span>
            <button class="ml-auto text-xs text-danger-ink hover:underline" @click="removeSet">
              {{ $t('common.delete') }}
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-3 grid grid-cols-2 lg:grid-cols-3 gap-2 content-start">
            <div v-for="mask in masks" :key="mask" class="flex items-center gap-2 p-2 bg-raised border border-border rounded-control min-w-0">
              <div class="grid grid-cols-3 gap-px w-9 h-9 shrink-0 bg-border" :title="$t('map.autotile.mask', { mask })">
                <span
                  v-for="cellIndex in 9"
                  :key="cellIndex"
                  :class="maskCell(mask, cellIndex - 1) ? 'bg-accent' : 'bg-canvas'"
                />
              </div>
              <img
                v-if="active.variants[mask]"
                :src="tilesStore.groupUrl(active.variants[mask])"
                class="w-9 h-9 bg-canvas border border-border shrink-0"
                style="image-rendering: pixelated"
              />
              <div v-else class="w-9 h-9 bg-canvas border border-dashed border-border-strong shrink-0" />
              <label class="min-w-0 flex-1">
                <span class="block text-micro text-ink-faint mb-0.5">{{ $t('map.autotile.mask', { mask }) }}</span>
                <select v-model="active.variants[mask]" class="w-full min-w-0 px-1 py-1 text-xs bg-surface border border-border-strong rounded-control text-ink-secondary">
                  <option value="">{{ $t('common.none') }}</option>
                  <option v-for="group in oneTileGroups" :key="group.id" :value="group.id">
                    {{ group.name || group.id }} · {{ group.id }}
                  </option>
                </select>
              </label>
            </div>
          </div>
        </main>

        <main v-else class="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div class="text-3xl mb-3">▦</div>
          <h4 class="text-sm text-ink-secondary mb-1">{{ $t('map.autotile.empty') }}</h4>
          <p class="text-xs text-ink-faint max-w-sm mb-4">{{ $t('map.autotile.emptyHint') }}</p>
          <button class="px-3 py-1.5 text-sm rounded-control bg-accent hover:bg-accent-strong text-white" @click="addSet">
            ＋ {{ $t('map.autotile.add') }}
          </button>
        </main>
      </div>

      <footer class="px-4 py-3 border-t border-border flex items-center gap-3 shrink-0">
        <span v-if="error" class="text-xs text-danger-ink">{{ error }}</span>
        <span v-else-if="!valid && draft.length" class="text-xs text-warning-ink">{{ $t('map.autotile.incomplete') }}</span>
        <div class="ml-auto flex gap-2">
          <button class="px-3 py-1 text-sm rounded-control bg-raised hover:bg-overlay text-ink-body" @click="emit('close')">
            {{ $t('common.cancel') }}
          </button>
          <button
            class="px-3 py-1 text-sm rounded-control bg-accent hover:bg-accent-strong text-white disabled:opacity-40"
            :disabled="busy || !valid || !changed"
            @click="emit('save', normalizedSets())"
          >{{ busy ? '…' : $t('common.save') }}</button>
        </div>
      </footer>
    </div>
  </div>
</template>
