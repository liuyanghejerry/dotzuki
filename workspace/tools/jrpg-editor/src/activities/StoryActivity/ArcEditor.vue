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
      <input v-model="selectedRecord.id" placeholder="arc-id" class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-blue-300 font-mono w-48" />
      <label class="text-[11px] text-gray-500 flex items-center gap-1">{{ t('story.fields.order') }}
        <input v-model.number="selectedRecord.order" type="number" class="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100" />
      </label>
      <div class="flex-1" />
      <button @click="onDelete" class="px-2 py-1 text-xs rounded text-gray-400 hover:text-red-400">{{ t('story.delete') }}</button>
      <button @click="onSave" :disabled="saving" class="px-4 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40">
        {{ saving ? t('story.saving') : t('story.save') }}
      </button>
    </div>

    <div class="mb-4">
      <LocalizedField :label="t('story.fields.title')" :locales="locales" v-model="selectedRecord.title" />
    </div>

    <label class="block text-[11px] uppercase tracking-wide text-gray-500 mb-4">{{ t('story.fields.summary') }}
      <textarea v-model="selectedRecord.summary" rows="3" class="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none" />
    </label>

    <StringList :label="t('story.fields.beats')" v-model="selectedRecord.beats" :options="story.quests.value.map((q:any)=>q.id)" :placeholder="t('story.addBeat')" />
    <p class="text-[11px] text-gray-600 mt-1">{{ t('story.beatsHint') }}</p>
  </div>

  <div v-else class="h-full flex items-center justify-center text-gray-600 text-sm">
    {{ t('story.selectOrCreate') }}
  </div>
</template>
