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
  <div class="flex flex-col h-full bg-surface">
    <div class="px-4 py-4 border-b border-border shrink-0">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold text-ink-secondary">{{ $t('script.title') }}</h2>
        <button
          class="text-xs text-ink-faint hover:text-ink-body transition-colors px-1.5 py-0.5 rounded-control hover:bg-raised"
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
          class="w-full bg-inset border border-border rounded-control text-xs px-2.5 py-1.5 text-ink-secondary placeholder-gray-500
                 focus:outline-none focus:border-accent-strong/50 transition-colors"
        />
        <span
          v-if="search"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-ink-disabled cursor-pointer text-xs hover:text-ink-muted"
          @click="search = ''"
        >×</span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="flex items-center justify-center py-8 text-xs text-ink-faint">
        {{ $t('script.loading') }}
      </div>
      <div v-else-if="error" class="px-3 py-4 text-xs text-danger-ink">
        {{ error }}
      </div>
      <div v-else-if="filteredFiles.length === 0" class="px-3 py-4 text-xs text-ink-faint">
        <template v-if="search">{{ $t('script.noMatch', { query: search }) }}</template>
        <template v-else>{{ $t('script.noScripts') }}</template>
      </div>
      <div v-else class="py-1">
        <button
          v-for="file in filteredFiles"
          :key="file.path"
          class="w-full text-left px-4 py-2 text-xs font-mono transition-colors truncate block
                 hover:bg-raised/50"
          :class="isActive(file) ? 'bg-accent/20 text-accent-ink border-l-2 border-accent-ink pl-2.5' : 'text-ink-muted border-l-2 border-transparent pl-2.5'"
          @click="handleSelect(file.path)"
        >
          {{ displayName(file) }}
        </button>
      </div>
    </div>

    <div class="px-4 py-2.5 border-t border-border text-micro text-ink-disabled shrink-0">
      {{ files.length }} {{ $t('script.files') }}
    </div>
  </div>
</template>
