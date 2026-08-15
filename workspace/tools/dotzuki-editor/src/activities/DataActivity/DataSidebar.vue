<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-3 border-b border-border">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-faint">{{ $t('data.title') }}</h2>
    </div>
    <nav class="flex-1 overflow-y-auto">
      <button
        v-for="table in tables"
        :key="table.id"
        @click="selectTable(table.id)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left',
          selectedTableId === table.id
            ? 'bg-accent-selected text-accent-ink-strong border-l-2 border-accent-ink'
            : 'text-ink-muted hover:text-ink-secondary hover:bg-surface-hover border-l-2 border-transparent'
        ]"
      >
        <span class="text-base shrink-0">{{ tableIcon(table.icon) }}</span>
        <span class="truncate">{{ localize(table.label) }}</span>
      </button>
    </nav>
    <div v-if="!tables.length" class="flex-1 flex items-center justify-center p-4">
      <p class="text-xs text-ink-disabled text-center">
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
