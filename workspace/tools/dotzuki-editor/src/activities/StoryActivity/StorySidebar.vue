<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import { useLocalize } from '@/composables/useLocalize'
import type { StoryKind } from '@/types'

const { t } = useI18n()
const { localize } = useLocalize()
const story = useStoryActivity()
const { view, selectedRecord, issues } = story

const navs = computed(() => [
  { v: 'graph', icon: '📈', label: t('story.views.graph') },
  { v: 'characters', icon: '👤', label: t('story.views.characters'), kind: 'characters' as StoryKind },
  { v: 'quests', icon: '🗺', label: t('story.views.quests'), kind: 'quests' as StoryKind },
  { v: 'arcs', icon: '📖', label: t('story.views.arcs'), kind: 'arcs' as StoryKind },
  { v: 'issues', icon: '⚠', label: t('story.views.issues') },
])

const activeKind = computed<StoryKind | null>(() =>
  (['characters', 'quests', 'arcs'] as string[]).includes(view.value) ? (view.value as StoryKind) : null,
)

const records = computed(() => (activeKind.value ? (story as any)[activeKind.value].value : []))

const errorCount = computed(() => issues.value.filter(i => i.severity === 'error').length)

function recordLabel(rec: any): string {
  // Prefer the active UI locale (falling back through en/zh) so titles follow
  // the language switcher, not the project's first authoring locale.
  return localize(rec.name ?? rec.title, rec.id)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-3 border-b border-gray-700">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ t('story.title') }}</h2>
    </div>

    <!-- view navigation -->
    <nav class="border-b border-gray-700 py-1">
      <button
        v-for="n in navs"
        :key="n.v"
        @click="story.setView(n.v as any)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
          view === n.v
            ? 'bg-blue-900/30 text-blue-300 border-l-2 border-blue-400'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-750 border-l-2 border-transparent',
        ]"
      >
        <span class="text-base shrink-0">{{ n.icon }}</span>
        <span class="truncate flex-1">{{ n.label }}</span>
        <span v-if="n.v === 'issues' && errorCount" class="text-[10px] bg-red-900/50 text-red-300 rounded px-1.5">{{ errorCount }}</span>
      </button>
    </nav>

    <!-- record list for the active kind -->
    <div v-if="activeKind" class="flex-1 overflow-y-auto">
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-[10px] uppercase tracking-wide text-gray-600">{{ records.length }}</span>
        <button @click="story.create(activeKind)" class="text-[11px] text-blue-400 hover:text-blue-300">＋ {{ t('story.new') }}</button>
      </div>
      <button
        v-for="rec in records"
        :key="rec.id"
        @click="story.select(activeKind, rec.id)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left',
          selectedRecord && selectedRecord.id === rec.id
            ? 'bg-gray-750 text-gray-100'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800',
        ]"
      >
        <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="{
          'bg-gray-500': rec.status === 'idea' || !rec.status,
          'bg-amber-500': rec.status === 'drafted',
          'bg-blue-500': rec.status === 'scripted',
          'bg-green-500': rec.status === 'done',
        }" />
        <span class="truncate">{{ recordLabel(rec) }}</span>
      </button>
      <p v-if="!records.length" class="px-3 py-2 text-[11px] text-gray-600">{{ t('story.noRecords') }}</p>
    </div>
  </div>
</template>
