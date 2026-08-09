<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

const { t } = useI18n()
import { useScriptActivity } from '@/composables/useScriptActivity'
import type { ScriptFile } from '@/composables/useScriptActivity'

const store = useScriptActivity()
const { files, activeFile, loading, error } = storeToRefs(store)

const search = ref('')

const filteredFiles = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return files.value
  return files.value.filter(f => f.name.toLowerCase().includes(q))
})

function displayName(file: ScriptFile): string {
  // Use the path so nested per-map scripts are distinguishable, and collapse a
  // trailing "/script" (the `<Map>/script.scene` convention) to the map name.
  const noExt = file.path.replace(/\.[^./]+$/, '')
  return noExt.replace(/\/script$/, '') || file.name
}

function isActive(file: ScriptFile): boolean {
  return file.path === activeFile.value
}

function handleSelect(path: string) {
  if (store.dirty && store.activeFile && store.activeFile !== path) {
    if (confirm(t('script.confirmSwitch'))) {
      store.saveFile(store.activeFile, store.content)
    }
  }
  store.loadFile(path)
}
</script>

<template>
  <div class="flex flex-col h-full bg-gray-800">
    <div class="px-3 py-3 border-b border-gray-700 shrink-0">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold text-gray-200">{{ $t('script.title') }}</h2>
        <button
          class="text-xs text-gray-500 hover:text-gray-300 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-700"
          :title="$t('script.refresh')"
          @click="store.fetchFiles()"
        >
          ↻
        </button>
      </div>
      <div class="relative">
        <input
          v-model="search"
          type="text"
          :placeholder="$t('script.search')"
          class="w-full bg-gray-900 border border-gray-700 rounded text-xs px-2.5 py-1.5 text-gray-200 placeholder-gray-500
                 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
        <span
          v-if="search"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 cursor-pointer text-xs hover:text-gray-400"
          @click="search = ''"
        >×</span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="flex items-center justify-center py-8 text-xs text-gray-500">
        {{ $t('script.loading') }}
      </div>
      <div v-else-if="error" class="px-3 py-4 text-xs text-red-400">
        {{ error }}
      </div>
      <div v-else-if="filteredFiles.length === 0" class="px-3 py-4 text-xs text-gray-500">
        <template v-if="search">{{ $t('script.noMatch', { query: search }) }}</template>
        <template v-else>{{ $t('script.noScripts') }}</template>
      </div>
      <div v-else class="py-1">
        <button
          v-for="file in filteredFiles"
          :key="file.path"
          class="w-full text-left px-3 py-1.5 text-xs font-mono transition-colors truncate block
                 hover:bg-gray-700/50"
          :class="isActive(file) ? 'bg-blue-600/20 text-blue-400 border-l-2 border-blue-400 pl-2.5' : 'text-gray-400 border-l-2 border-transparent pl-2.5'"
          @click="handleSelect(file.path)"
        >
          {{ displayName(file) }}
        </button>
      </div>
    </div>

    <div class="px-3 py-2 border-t border-gray-700 text-[10px] text-gray-600 shrink-0">
      {{ files.length }} {{ $t('script.files') }}
    </div>
  </div>
</template>
