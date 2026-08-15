<template>
  <form @submit.prevent="handleSave" class="flex flex-col h-full">
    <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-surface shrink-0">
      <h3 class="text-sm font-semibold text-ink-secondary">
        {{ isNew ? $t('data.newRecord') : $t('data.editRecord') }}
      </h3>
      <button
        type="button"
        @click="$emit('cancel')"
        class="text-ink-faint hover:text-ink-body text-lg leading-none"
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
        <label :for="`field-${field.key}`" class="block text-xs font-medium text-ink-muted">
          {{ localize(field.label) }}
          <span v-if="field.required" class="text-danger-ink ml-0.5">*</span>
        </label>

        <!-- string -->
        <input
          v-if="field.type === 'string'"
          :id="`field-${field.key}`"
          v-model="local[field.key]"
          type="text"
          :required="field.required"
          class="w-full px-3 py-2 bg-surface border border-border rounded-control text-ink text-sm
                 placeholder-gray-600 focus:outline-none focus:border-accent-strong focus:ring-1 focus:ring-accent-strong/30"
        />

        <!-- number -->
        <input
          v-else-if="field.type === 'number'"
          :id="`field-${field.key}`"
          v-model.number="local[field.key]"
          type="number"
          :required="field.required"
          class="w-full px-3 py-2 bg-surface border border-border rounded-control text-ink text-sm
                 placeholder-gray-600 focus:outline-none focus:border-accent-strong focus:ring-1 focus:ring-accent-strong/30"
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
            class="w-4 h-4 rounded-control border-border-strong bg-surface text-accent-strong
                   focus:ring-accent-strong/30 focus:ring-offset-0"
          />
          <span class="text-sm text-ink-muted">{{ local[field.key] ? $t('common.yes') : $t('common.no') }}</span>
        </label>

        <!-- select -->
        <select
          v-else-if="field.type === 'select'"
          :id="`field-${field.key}`"
          v-model="local[field.key]"
          :required="field.required"
          class="w-full px-3 py-2 bg-surface border border-border rounded-control text-ink text-sm
                 focus:outline-none focus:border-accent-strong focus:ring-1 focus:ring-accent-strong/30"
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
              class="w-4 h-4 rounded-control border-border-strong bg-surface text-accent-strong
                     focus:ring-accent-strong/30 focus:ring-offset-0"
            />
            <span class="text-sm text-ink-body">{{ opt }}</span>
          </label>
        </div>

        <!-- array / object / json → textarea -->
        <textarea
          v-else-if="jsonTypes.includes(field.type)"
          :id="`field-${field.key}`"
          v-model="local[field.key]"
          rows="5"
          class="w-full px-3 py-2 bg-surface border border-border rounded-control text-ink text-sm font-mono
                 focus:outline-none focus:border-accent-strong focus:ring-1 focus:ring-accent-strong/30 resize-y"
        />
      </div>

      <!-- Field description -->
      <p
        v-if="focusedField?.description"
        class="text-xs text-ink-faint mt-3 border-t border-border-subtle pt-3"
      >{{ localize(focusedField.description) }}</p>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between px-4 py-3 border-t border-border bg-surface shrink-0">
      <button
        v-if="!isNew"
        type="button"
        @click="$emit('delete')"
        class="px-3 py-1.5 text-sm rounded-control text-danger-ink hover:text-danger-ink-strong hover:bg-danger-surface transition-colors"
      >
        {{ $t('data.delete') }}
      </button>
      <span v-else />

      <div class="flex items-center gap-2">
        <button
          type="button"
          @click="$emit('cancel')"
          class="px-3 py-1.5 text-sm rounded-control text-ink-muted hover:text-ink-secondary transition-colors"
        >
          {{ $t('data.cancel') }}
        </button>
        <button
          type="submit"
          :disabled="saving"
          class="px-4 py-1.5 text-sm rounded-control bg-accent text-white font-medium
                 hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors inline-flex items-center gap-2"
        >
          <span
            v-if="saving"
            class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-pill animate-spin"
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
