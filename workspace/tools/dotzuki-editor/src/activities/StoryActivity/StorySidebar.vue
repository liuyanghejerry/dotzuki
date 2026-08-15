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
    <div class="px-3 py-3 border-b border-border">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-faint">{{ t('story.title') }}</h2>
    </div>

    <!-- view navigation -->
    <nav class="border-b border-border py-1">
      <button
        v-for="n in navs"
        :key="n.v"
        @click="story.setView(n.v as any)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
          view === n.v
            ? 'bg-accent-selected text-accent-ink-strong border-l-2 border-accent-ink'
            : 'text-ink-muted hover:text-ink-secondary hover:bg-surface-hover border-l-2 border-transparent',
        ]"
      >
        <span class="text-base shrink-0">{{ n.icon }}</span>
        <span class="truncate flex-1">{{ n.label }}</span>
        <span v-if="n.v === 'issues' && errorCount" class="text-micro bg-danger-deep/50 text-danger-ink-strong rounded-control px-1.5">{{ errorCount }}</span>
      </button>
    </nav>

    <!-- record list for the active kind -->
    <div v-if="activeKind" class="flex-1 overflow-y-auto">
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-micro uppercase tracking-wide text-ink-disabled">{{ records.length }}</span>
        <button @click="story.create(activeKind)" class="text-tiny text-accent-ink hover:text-accent-ink-strong">＋ {{ t('story.new') }}</button>
      </div>
      <button
        v-for="rec in records"
        :key="rec.id"
        @click="story.select(activeKind, rec.id)"
        :class="[
          'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left',
          selectedRecord && selectedRecord.id === rec.id
            ? 'bg-surface-hover text-ink'
            : 'text-ink-muted hover:text-ink-secondary hover:bg-surface',
        ]"
      >
        <span class="w-1.5 h-1.5 rounded-pill shrink-0" :class="{
          'bg-gray-500': rec.status === 'idea' || !rec.status,
          'bg-warning': rec.status === 'drafted',
          'bg-accent-strong': rec.status === 'scripted',
          'bg-success-strong': rec.status === 'done',
        }" />
        <span class="truncate">{{ recordLabel(rec) }}</span>
      </button>
      <p v-if="!records.length" class="px-3 py-2 text-tiny text-ink-disabled">{{ t('story.noRecords') }}</p>
    </div>
  </div>
</template>
