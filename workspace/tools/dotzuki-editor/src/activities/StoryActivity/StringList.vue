<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  label: string
  modelValue: string[]
  options?: string[]
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const draft = ref('')
const listId = 'sl-' + Math.random().toString(36).slice(2, 8)

function add() {
  const v = draft.value.trim()
  if (!v) return
  if (!(props.modelValue || []).includes(v)) emit('update:modelValue', [...(props.modelValue || []), v])
  draft.value = ''
}
function removeAt(i: number) {
  const next = (props.modelValue || []).slice()
  next.splice(i, 1)
  emit('update:modelValue', next)
}
</script>

<template>
  <div>
    <label class="block text-tiny uppercase tracking-wide text-ink-faint mb-1">{{ label }}</label>
    <div v-if="(modelValue || []).length" class="flex flex-wrap gap-1 mb-1">
      <span
        v-for="(item, i) in modelValue"
        :key="i"
        class="inline-flex items-center gap-1 bg-raised rounded-control px-2 py-0.5 text-xs text-ink-secondary"
      >
        {{ item }}
        <button @click="removeAt(i)" class="text-ink-muted hover:text-danger-ink leading-none">×</button>
      </span>
    </div>
    <div class="flex gap-1">
      <input
        v-model="draft"
        :list="options ? listId : undefined"
        :placeholder="placeholder"
        @keydown.enter.prevent="add"
        class="flex-1 bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink focus:border-accent-strong focus:outline-none"
      />
      <datalist v-if="options" :id="listId">
        <option v-for="o in options" :key="o" :value="o" />
      </datalist>
      <button @click="add" class="px-3 rounded-control bg-raised hover:bg-overlay text-sm">＋</button>
    </div>
  </div>
</template>
