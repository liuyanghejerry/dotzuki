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
    <div class="w-[26rem] bg-surface-deep border border-border rounded-card shadow-popover p-4">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-sm font-bold text-success-ink">🗺 {{ t('map.traceTitle') }}</span>
        <span class="text-tiny text-ink-faint truncate">{{ mapName }}</span>
      </div>
      <p class="text-tiny text-ink-muted mb-3">{{ t('map.traceDesc') }}</p>

      <div class="text-xs text-ink-body mb-3 flex items-center gap-2">
        <span class="px-1.5 py-0.5 rounded-control bg-raised tabular-nums">{{ gridW }} × {{ gridH }}</span>
        <span class="text-ink-faint">{{ t('map.traceCells', { n: cellCount }) }}</span>
      </div>
      <p v-if="heavy" class="text-tiny text-warning-ink mb-3">⚠ {{ t('map.traceHeavy') }}</p>

      <label class="flex items-center gap-2 text-xs text-ink-body mb-2 select-none">
        <input type="checkbox" v-model="quantize" :disabled="busy" />
        {{ t('map.traceQuantize') }}
      </label>
      <div v-if="quantize" class="flex items-center gap-2 mb-2 pl-6">
        <span class="text-tiny text-ink-faint w-14">{{ t('map.traceColors') }}</span>
        <input type="range" min="4" max="64" step="1" v-model.number="colors" :disabled="busy" class="flex-1" />
        <span class="text-tiny text-ink-muted w-6 text-right tabular-nums">{{ colors }}</span>
      </div>
      <label class="flex items-center gap-2 text-xs text-ink-body mb-1 select-none">
        <input type="checkbox" v-model="pixelize" :disabled="busy" />
        {{ t('map.tracePixelize') }}
      </label>

      <p v-if="error" class="text-tiny text-danger-ink mt-2">{{ error }}</p>

      <div class="flex justify-end gap-2 mt-4">
        <button @click="emit('close')" :disabled="busy"
          class="px-3 py-1 text-xs rounded-control text-ink-muted hover:text-ink-secondary disabled:opacity-40">{{ t('common.cancel') }}</button>
        <button @click="convert" :disabled="busy"
          class="px-3 py-1 text-xs rounded-control bg-success text-white hover:bg-success-strong disabled:opacity-40">
          {{ busy ? t('map.tracing') : t('map.traceConvert') }}</button>
      </div>
    </div>
  </div>
</template>
