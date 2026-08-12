<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import type { StoryIssue } from '@/types'

const { t } = useI18n()
const story = useStoryActivity()
const { issues } = story

function open(issue: StoryIssue) {
  if (issue.kind && issue.recordId) {
    story.select(issue.kind, issue.recordId)
    story.setView(issue.kind)
  }
}

/** Localized message for an issue; falls back to the English message when the code is unknown. */
function issueMessage(issue: StoryIssue): string {
  const key = 'story.lint.' + issue.code
  const params: Record<string, string> = { ...(issue.params ?? {}) }
  if (params.status) params.status = t('story.status.' + params.status)
  const translated = t(key, params)
  return translated === key ? issue.message : translated
}
</script>

<template>
  <div class="h-full overflow-y-auto p-5 max-w-3xl">
    <h2 class="text-base font-bold text-blue-400 mb-1">{{ t('story.views.issues') }}</h2>
    <p class="text-[11px] text-gray-400 mb-4">{{ t('story.issuesDesc') }}</p>

    <div v-if="!issues.length" class="text-sm text-green-400/80 flex items-center gap-2">
      <span>✓</span> {{ t('story.noIssues') }}
    </div>

    <ul v-else class="space-y-1.5">
      <li
        v-for="(issue, i) in issues"
        :key="i"
        @click="open(issue)"
        class="flex items-start gap-2 bg-gray-800 border border-gray-700 rounded px-3 py-2 cursor-pointer hover:border-gray-600"
      >
        <span class="text-sm shrink-0" :class="issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'">
          {{ issue.severity === 'error' ? '⛔' : '⚠' }}
        </span>
        <div class="min-w-0">
          <div class="text-xs text-gray-200">{{ issueMessage(issue) }}</div>
          <div class="text-[10px] text-gray-500 font-mono">{{ issue.code }}<span v-if="issue.recordId"> · {{ issue.recordId }}</span></div>
        </div>
      </li>
    </ul>
  </div>
</template>
