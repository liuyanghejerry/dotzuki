<template>
  <div class="flex h-full">
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Toolbar -->
      <div v-if="currentTable" class="flex items-center gap-3 px-5 py-3 border-b border-border bg-surface-deep shrink-0">
        <span class="text-sm font-medium text-ink-body">{{ localize(currentTable.label) }}</span>
        <span class="text-xs text-ink-disabled">{{ records.length }} {{ records.length === 1 ? t('data.record') : t('data.records') }}</span>
        <div class="flex-1" />
        <button
          @click="showAi = true"
          class="px-4 py-1.5 text-xs rounded-control bg-raised text-ink-secondary hover:bg-overlay transition-colors"
        >✨ {{ $t('data.ai') }}</button>
        <button
          v-if="currentTable.allowCreate !== false"
          @click="newRecord()"
          class="px-4 py-1.5 text-xs rounded-control bg-accent text-white hover:bg-accent-strong transition-colors"
        >
          {{ $t('data.newRecord') }}
        </button>
      </div>

      <!-- Error banner -->
      <div
        v-if="error"
        class="px-4 py-2 text-sm text-danger-ink bg-danger-surface border-b border-danger-deep/30 shrink-0"
      >{{ error }}</div>

      <!-- Table content -->
      <DataTable
        v-if="currentTable"
        :records="records"
        :fields="currentTable.fields"
        :loading="loading"
        @select="selectedRecord = $event"
        class="flex-1"
      />

      <!-- No table selected -->
      <div v-else class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <p class="text-4xl mb-3">📊</p>
          <p class="text-lg text-ink-muted font-medium">{{ t('data.editorTitle') }}</p>
          <p class="text-sm text-ink-disabled mt-1">{{ t('data.selectTableHint') }}</p>
        </div>
      </div>
    </div>

    <DataGenerator
      v-if="showAi && currentTable"
      :table-id="currentTable.id"
      @close="showAi = false"
      @applied="loadRecords(currentTable.id)"
    />

    <!-- Slide-in detail panel -->
    <Transition name="slide">
      <div
        v-if="selectedRecord && currentTable"
        class="w-96 border-l border-border bg-canvas shrink-0 overflow-hidden"
      >
        <DataForm
          :record="selectedRecord"
          :fields="currentTable.fields"
          :saving="saving"
          :is-new="!hasId"
          @save="saveRecord($event)"
          @delete="onDelete"
          @cancel="selectedRecord = null"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDataActivity } from '@/composables/useDataActivity'
import { useLocalize } from '@/composables/useLocalize'

const { t } = useI18n()
const { localize } = useLocalize()
import DataTable from '@/components/data/DataTable.vue'
import DataForm from '@/components/data/DataForm.vue'
import DataGenerator from './DataGenerator.vue'

const showAi = ref(false)

const {
  selectedRecord,
  records,
  loading,
  saving,
  error,
  currentTable,
  newRecord,
  saveRecord,
  deleteRecord,
  loadRecords,
} = useDataActivity()

const hasId = computed(() => {
  if (!selectedRecord.value) return false
  const idField = currentTable.value?.idField ?? 'id'
  const val = (selectedRecord.value as Record<string, unknown>)[idField]
  return val !== undefined && val !== null && val !== ''
})

function onDelete() {
  if (!currentTable.value || !selectedRecord.value) return
  const idField = currentTable.value.idField ?? 'id'
  const fileName = (selectedRecord.value as Record<string, unknown>)[idField] ?? 'unknown'
  deleteRecord(String(fileName))
}
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: width 0.2s ease, opacity 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  width: 0 !important;
  opacity: 0;
}
</style>
