<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

// Options dialog for "trace a map's reference backdrop straight into a tilemap".
// The heavy lifting (slice → dedupe → build tileset → fill) lives in the parent
// (MapActivity) because it needs the map/tiles stores; this dialog only gathers
// options and reflects the parent-driven busy / error state.
const props = defineProps<{
  mapName: string
  /** Natural pixel size of the source backdrop. */
  imgW: number
  imgH: number
  /** Map tile size (px). */
  tileSize: number
  /** Parent-driven progress state. */
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  close: []
  convert: [opts: { quantize: boolean; colors: number; pixelize: boolean }]
}>()

const { t } = useI18n()

const quantize = ref(true)
const colors = ref(24)
const pixelize = ref(false)

const gridW = computed(() => Math.max(1, Math.round(props.imgW / props.tileSize)))
const gridH = computed(() => Math.max(1, Math.round(props.imgH / props.tileSize)))
const cellCount = computed(() => gridW.value * gridH.value)
/** Rough upper bound on tileset size — flat/quantized art dedupes well below this. */
const heavy = computed(() => cellCount.value > 4000)

function convert() {
  if (props.busy) return
  emit('convert', { quantize: quantize.value, colors: colors.value, pixelize: pixelize.value })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="!busy && emit('close')">
    <div class="w-[26rem] bg-gray-850 border border-gray-700 rounded-lg shadow-xl p-4">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-sm font-bold text-emerald-400">🗺 {{ t('map.traceTitle') }}</span>
        <span class="text-[11px] text-gray-500 truncate">{{ mapName }}</span>
      </div>
      <p class="text-[11px] text-gray-400 mb-3">{{ t('map.traceDesc') }}</p>

      <div class="text-xs text-gray-300 mb-3 flex items-center gap-2">
        <span class="px-1.5 py-0.5 rounded bg-gray-700 tabular-nums">{{ gridW }} × {{ gridH }}</span>
        <span class="text-gray-500">{{ t('map.traceCells', { n: cellCount }) }}</span>
      </div>
      <p v-if="heavy" class="text-[11px] text-amber-400 mb-3">⚠ {{ t('map.traceHeavy') }}</p>

      <label class="flex items-center gap-2 text-xs text-gray-300 mb-2 select-none">
        <input type="checkbox" v-model="quantize" :disabled="busy" />
        {{ t('map.traceQuantize') }}
      </label>
      <div v-if="quantize" class="flex items-center gap-2 mb-2 pl-6">
        <span class="text-[11px] text-gray-500 w-14">{{ t('map.traceColors') }}</span>
        <input type="range" min="4" max="64" step="1" v-model.number="colors" :disabled="busy" class="flex-1" />
        <span class="text-[11px] text-gray-400 w-6 text-right tabular-nums">{{ colors }}</span>
      </div>
      <label class="flex items-center gap-2 text-xs text-gray-300 mb-1 select-none">
        <input type="checkbox" v-model="pixelize" :disabled="busy" />
        {{ t('map.tracePixelize') }}
      </label>

      <p v-if="error" class="text-[11px] text-red-400 mt-2">{{ error }}</p>

      <div class="flex justify-end gap-2 mt-4">
        <button @click="emit('close')" :disabled="busy"
          class="px-3 py-1 text-xs rounded text-gray-400 hover:text-gray-200 disabled:opacity-40">{{ t('common.cancel') }}</button>
        <button @click="convert" :disabled="busy"
          class="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40">
          {{ busy ? t('map.tracing') : t('map.traceConvert') }}</button>
      </div>
    </div>
  </div>
</template>
