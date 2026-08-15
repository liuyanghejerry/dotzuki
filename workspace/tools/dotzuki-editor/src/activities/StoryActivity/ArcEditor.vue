<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import LocalizedField from './LocalizedField.vue'
import StringList from './StringList.vue'

const { t } = useI18n()
const story = useStoryActivity()
const { selectedRecord, locales, saving } = story

function onSave() { story.save('arcs', selectedRecord.value) }
function onDelete() {
  if (confirm(t('story.confirmDelete'))) story.remove('arcs', selectedRecord.value.id)
}
</script>

<template>
  <div v-if="selectedRecord" class="h-full overflow-y-auto p-5 max-w-2xl">
    <div class="flex items-center gap-3 mb-4">
      <input v-model="selectedRecord.id" placeholder="arc-id" class="bg-surface border border-border rounded-control px-2 py-1 text-sm text-accent-ink-strong font-mono w-48" />
      <label class="text-tiny text-ink-faint flex items-center gap-1">{{ t('story.fields.order') }}
        <input v-model.number="selectedRecord.order" type="number" class="w-16 bg-surface border border-border rounded-control px-2 py-1 text-xs text-ink" />
      </label>
      <div class="flex-1" />
      <button @click="onDelete" class="px-2 py-1 text-xs rounded-control text-ink-muted hover:text-danger-ink">{{ t('story.delete') }}</button>
      <button @click="onSave" :disabled="saving" class="px-4 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40">
        {{ saving ? t('story.saving') : t('story.save') }}
      </button>
    </div>

    <div class="mb-4">
      <LocalizedField :label="t('story.fields.title')" :locales="locales" v-model="selectedRecord.title" />
    </div>

    <label class="block text-tiny uppercase tracking-wide text-ink-faint mb-4">{{ t('story.fields.summary') }}
      <textarea v-model="selectedRecord.summary" rows="3" class="mt-1 w-full bg-surface border border-border rounded-control px-2 py-1 text-sm text-ink focus:border-accent-strong focus:outline-none" />
    </label>

    <StringList :label="t('story.fields.beats')" v-model="selectedRecord.beats" :options="story.quests.value.map((q:any)=>q.id)" :placeholder="t('story.addBeat')" />
    <p class="text-tiny text-ink-disabled mt-1">{{ t('story.beatsHint') }}</p>
  </div>

  <div v-else class="h-full flex items-center justify-center text-ink-disabled text-sm">
    {{ t('story.selectOrCreate') }}
  </div>
</template>
