<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-3 border-b border-gray-700">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ $t('data.title') }}</h2>
    </div>
    <nav class="flex-1 overflow-y-auto">
      <button
        v-for="table in tables"
        :key="table.id"
        @click="selectTable(table.id)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left',
          selectedTableId === table.id
            ? 'bg-blue-900/30 text-blue-300 border-l-2 border-blue-400'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750 border-l-2 border-transparent'
        ]"
      >
        <span class="text-base shrink-0">{{ tableIcon(table.icon) }}</span>
        <span class="truncate">{{ localize(table.label) }}</span>
      </button>
    </nav>
    <div v-if="!tables.length" class="flex-1 flex items-center justify-center p-4">
      <p class="text-xs text-gray-600 text-center">
        {{ $t('data.noTables') }}<br />{{ $t('data.noTablesHint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useDataActivity } from '@/composables/useDataActivity'
import { useLocalize } from '@/composables/useLocalize'

const { t } = useI18n()
const { localize } = useLocalize()

const { selectedTableId, tables, selectTable } = useDataActivity()

function tableIcon(icon?: string): string {
  const map: Record<string, string> = {
    monster: '⚡', species: '🐾', moves: '⚔️', items: '🎒', types: '🔷',
    trainers: '👤', maps: '🗺️', encounters: '🌿', evolutions: '🔄',
    scripts: '📜', text: '💬', config: '⚙️', stats: '📊',
    list: '📋', database: '🗄️',
  }
  return map[icon ?? ''] ?? '📄'
}
</script>
