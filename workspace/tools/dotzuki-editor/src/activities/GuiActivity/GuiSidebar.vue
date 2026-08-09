<template>
  <div class="p-2">
    <div class="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
      {{ $t('gui.layouts') }}
    </div>
    <div v-if="store.loading" class="px-2 py-2 text-xs text-gray-500">{{ $t('app.loading') }}</div>
    <div v-else-if="!store.files.length" class="px-2 py-2 text-xs text-gray-500">{{ $t('common.none') }}</div>
    <ul v-else class="mt-1 space-y-0.5">
      <li v-for="name in store.files" :key="name">
        <button
          @click="open(name)"
          :class="[
            'w-full text-left px-2 py-1 text-sm rounded truncate',
            store.activeFile === name ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700',
          ]"
        >🎨 {{ name }}</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useGuiActivity } from '@/composables/useGuiActivity'

const store = useGuiActivity()

async function open(name: string) {
  if (store.dirty && !confirm('Discard unsaved changes?')) return
  await store.loadFile(name)
}

onMounted(() => {
  if (!store.files.length) store.fetchFiles()
})
</script>
