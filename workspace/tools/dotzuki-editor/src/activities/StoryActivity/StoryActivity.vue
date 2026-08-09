<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import StoryGraph from './StoryGraph.vue'
import CharacterEditor from './CharacterEditor.vue'
import QuestEditor from './QuestEditor.vue'
import ArcEditor from './ArcEditor.vue'
import IssuesPanel from './IssuesPanel.vue'

const { t } = useI18n()
const story = useStoryActivity()
const { view, loading, error } = story

onMounted(() => story.loadAll())
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div v-if="error" class="px-4 py-2 text-sm text-red-400 bg-red-900/20 border-b border-red-900/30 shrink-0">
      {{ error }}
    </div>
    <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-500 text-sm">
      {{ t('story.loading') }}
    </div>
    <template v-else>
      <StoryGraph v-if="view === 'graph'" class="flex-1 min-h-0" />
      <IssuesPanel v-else-if="view === 'issues'" class="flex-1 min-h-0" />
      <CharacterEditor v-else-if="view === 'characters'" class="flex-1 min-h-0" />
      <QuestEditor v-else-if="view === 'quests'" class="flex-1 min-h-0" />
      <ArcEditor v-else-if="view === 'arcs'" class="flex-1 min-h-0" />
    </template>
  </div>
</template>
