<script setup lang="ts">
import type { LocalizedText } from '@/types'

const props = defineProps<{
  label: string
  modelValue: LocalizedText
  locales: string[]
  textarea?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [LocalizedText] }>()

function set(loc: string, val: string) {
  emit('update:modelValue', { ...(props.modelValue || {}), [loc]: val })
}
</script>

<template>
  <div>
    <label class="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{{ label }}</label>
    <div class="space-y-1">
      <div v-for="loc in locales" :key="loc" class="flex items-start gap-2">
        <span class="text-[10px] text-gray-500 w-6 shrink-0 uppercase mt-1.5">{{ loc }}</span>
        <textarea
          v-if="textarea"
          :value="modelValue?.[loc] ?? ''"
          @input="set(loc, ($event.target as HTMLTextAreaElement).value)"
          rows="2"
          class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        <input
          v-else
          :value="modelValue?.[loc] ?? ''"
          @input="set(loc, ($event.target as HTMLInputElement).value)"
          class="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  </div>
</template>
