<template>
  <form @submit.prevent="handleSave" class="flex flex-col h-full">
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800 shrink-0">
      <h3 class="text-sm font-semibold text-gray-200">
        {{ isNew ? $t('data.newRecord') : $t('data.editRecord') }}
      </h3>
      <button
        type="button"
        @click="$emit('cancel')"
        class="text-gray-500 hover:text-gray-300 text-lg leading-none"
        :aria-label="$t('common.close')"
      >&times;</button>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <div
        v-for="field in fields"
        :key="field.key"
        class="space-y-1"
        :class="field.width ? `col-span-${field.width}` : ''"
      >
        <label :for="`field-${field.key}`" class="block text-xs font-medium text-gray-400">
          {{ localize(field.label) }}
          <span v-if="field.required" class="text-red-400 ml-0.5">*</span>
        </label>

        <!-- string -->
        <input
          v-if="field.type === 'string'"
          :id="`field-${field.key}`"
          v-model="local[field.key]"
          type="text"
          :required="field.required"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm
                 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
        />

        <!-- number -->
        <input
          v-else-if="field.type === 'number'"
          :id="`field-${field.key}`"
          v-model.number="local[field.key]"
          type="number"
          :required="field.required"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm
                 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
        />

        <!-- boolean -->
        <label
          v-else-if="field.type === 'boolean'"
          class="flex items-center gap-2 cursor-pointer"
        >
          <input
            :id="`field-${field.key}`"
            v-model="local[field.key]"
            type="checkbox"
            class="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500
                   focus:ring-blue-500/30 focus:ring-offset-0"
          />
          <span class="text-sm text-gray-400">{{ local[field.key] ? $t('common.yes') : $t('common.no') }}</span>
        </label>

        <!-- select -->
        <select
          v-else-if="field.type === 'select'"
          :id="`field-${field.key}`"
          v-model="local[field.key]"
          :required="field.required"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm
                 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
        >
          <option value="" disabled>{{ $t('data.selectPlaceholder') }}</option>
          <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>

        <!-- multiselect -->
        <div v-else-if="field.type === 'multiselect'" class="space-y-1 pl-1">
          <label
            v-for="opt in field.options"
            :key="opt"
            class="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="checkbox"
              :checked="(local[field.key] as unknown[])?.includes(opt)"
              @change="toggleMulti(field.key, opt)"
              class="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500
                     focus:ring-blue-500/30 focus:ring-offset-0"
            />
            <span class="text-sm text-gray-300">{{ opt }}</span>
          </label>
        </div>

        <!-- array / object / json → textarea -->
        <textarea
          v-else-if="jsonTypes.includes(field.type)"
          :id="`field-${field.key}`"
          v-model="local[field.key]"
          rows="5"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm font-mono
                 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 resize-y"
        />
      </div>

      <!-- Field description -->
      <p
        v-if="focusedField?.description"
        class="text-xs text-gray-500 mt-3 border-t border-gray-800 pt-3"
      >{{ localize(focusedField.description) }}</p>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800 shrink-0">
      <button
        v-if="!isNew"
        type="button"
        @click="$emit('delete')"
        class="px-3 py-1.5 text-sm rounded text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
      >
        {{ $t('data.delete') }}
      </button>
      <span v-else />

      <div class="flex items-center gap-2">
        <button
          type="button"
          @click="$emit('cancel')"
          class="px-3 py-1.5 text-sm rounded text-gray-400 hover:text-gray-200 transition-colors"
        >
          {{ $t('data.cancel') }}
        </button>
        <button
          type="submit"
          :disabled="saving"
          class="px-4 py-1.5 text-sm rounded bg-blue-600 text-white font-medium
                 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors inline-flex items-center gap-2"
        >
          <span
            v-if="saving"
            class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"
          />
          {{ saving ? $t('data.saving') : $t('data.save') }}
        </button>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalize } from '@/composables/useLocalize'
import type { FieldDef, FieldType } from '@/types'

const { t } = useI18n()
const { localize } = useLocalize()

const jsonTypes: FieldType[] = ['array', 'object', 'json']

const props = withDefaults(defineProps<{
  record: Record<string, unknown>
  fields: FieldDef[]
  saving?: boolean
  isNew?: boolean
}>(), {
  saving: false,
  isNew: false,
})

const emit = defineEmits<{
  save: [record: Record<string, unknown>]
  delete: []
  cancel: []
}>()

const local = ref<Record<string, any>>({})
const focusedField = ref<FieldDef | null>(null)

function syncLocal() {
  const copy: Record<string, any> = {}
  for (const f of props.fields) {
    const raw = props.record[f.key]
    if (jsonTypes.includes(f.type) && typeof raw === 'object' && raw !== null) {
      copy[f.key] = JSON.stringify(raw, null, 2)
    } else {
      copy[f.key] = raw
    }
  }
  local.value = copy
}

onMounted(syncLocal)
watch(() => [props.record, props.fields], syncLocal, { deep: true })

function toggleMulti(key: string, opt: string) {
  const arr: unknown[] = local.value[key] ?? []
  const idx = arr.indexOf(opt)
  local.value[key] = idx >= 0 ? arr.filter((_, i) => i !== idx) : [...arr, opt]
}

function handleSave() {
  const out: Record<string, unknown> = {}
  for (const f of props.fields) {
    let val: unknown = local.value[f.key]
    if (jsonTypes.includes(f.type) && typeof val === 'string' && val.trim()) {
      try { val = JSON.parse(val) } catch { /* keep as string */ }
    }
    out[f.key] = val
  }
  emit('save', out)
}
</script>
