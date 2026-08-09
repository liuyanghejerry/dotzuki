<template>
  <div class="flex flex-col h-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-500">
      <span class="inline-block w-4 h-4 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin mr-2" />
      {{ $t('data.loading') }}
    </div>

    <div v-else-if="!records.length" class="flex-1 flex items-center justify-center text-gray-500">
      <div class="text-center">
        <p class="text-sm text-gray-600">{{ $t('data.noRecords') }}</p>
      </div>
    </div>

    <template v-else>
      <div class="overflow-auto flex-1">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-gray-800 z-10">
            <tr>
              <th
                v-for="f in visibleFields"
                :key="f.key"
                :style="f.width ? { width: `${(f.width / 12) * 100}%` } : {}"
                class="text-left px-3 py-2 text-gray-400 font-medium border-b border-gray-700 whitespace-nowrap"
              >
                {{ localize(f.label) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(record, i) in records"
              :key="resolveId(record, i)"
              @click="$emit('select', record)"
              class="cursor-pointer border-b border-gray-800 hover:bg-gray-750 transition-colors"
            >
              <td
                v-for="f in visibleFields"
                :key="f.key"
                class="px-3 py-2 text-gray-300 truncate max-w-xs"
              >
                {{ formatCell(record[f.key], f.type) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="px-3 py-1.5 text-xs text-gray-500 border-t border-gray-700 bg-gray-850 shrink-0">
        {{ records.length }} {{ records.length === 1 ? $t('data.record') : $t('data.records') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalize } from '@/composables/useLocalize'
import type { FieldDef, FieldType } from '@/types'

const { t } = useI18n()
const { localize } = useLocalize()

const props = withDefaults(defineProps<{
  records: any[]
  fields: FieldDef[]
  loading?: boolean
  /** Limit table to first N fields (show all if 0) */
  maxColumns?: number
}>(), {
  loading: false,
  maxColumns: 0,
})

defineEmits<{
  select: [record: any]
}>()

const visibleFields = computed(() => {
  if (!props.maxColumns || props.maxColumns >= props.fields.length) return props.fields
  return props.fields.slice(0, props.maxColumns)
})

function resolveId(record: any, index: number): string {
  return record.id ?? record._id ?? record.key ?? `row-${index}`
}

function formatCell(value: unknown, type: FieldType): string {
  if (value === null || value === undefined) return '—'
  switch (type) {
    case 'boolean': return value ? '✓' : '✗'
    case 'array':  return Array.isArray(value) ? `[${value.length} items]` : String(value)
    case 'object':
    case 'json':   return typeof value === 'object' ? '{ … }' : String(value)
    default:       return String(value)
  }
}
</script>
