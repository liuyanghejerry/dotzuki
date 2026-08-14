<template>
  <aside class="absolute inset-y-0 right-0 z-50 w-[560px] max-w-full bg-gray-800 border-l border-gray-700 flex flex-col shadow-xl">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
      <span class="text-sm font-bold text-blue-400">❓ {{ $t('help.title') }}</span>
      <span class="flex-1" />
      <button
        class="px-2 py-1 text-sm rounded hover:bg-gray-700"
        :title="$t('help.close')"
        @click="editor.toggleHelp()"
      >✕</button>
    </div>
    <div class="flex-1 flex min-h-0">
      <nav class="w-44 border-r border-gray-700 overflow-y-auto shrink-0 py-1">
        <button
          v-for="page in HELP_PAGES"
          :key="page.id"
          @click="active = page.id"
          :class="[
            'w-full text-left px-3 py-1.5 text-sm truncate',
            active === page.id ? 'bg-blue-600/30 text-blue-300' : 'text-gray-300 hover:bg-gray-700'
          ]"
        >{{ page.title }}</button>
      </nav>
      <div class="flex-1 overflow-y-auto px-4 py-3 help-markdown" v-html="html" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { renderMarkdown } from '@/composables/useMarkdown'
import { HELP_PAGES } from '@/help/pages'

const editor = useEditorStore()
const active = ref(HELP_PAGES[0]?.id ?? '')
const html = computed(() =>
  renderMarkdown(HELP_PAGES.find(p => p.id === active.value)?.source ?? ''),
)
</script>

<style scoped>
/* Readable typography for the bundled reference pages (Tailwind preflight
   strips default heading/list/table styles inside the app). */
.help-markdown h1 { font-size: 1.25rem; font-weight: 700; color: #60a5fa; margin: 0.75rem 0 0.5rem; }
.help-markdown h2 { font-size: 1.05rem; font-weight: 600; margin: 1rem 0 0.4rem; }
.help-markdown h3, .help-markdown h4 { font-size: 0.95rem; font-weight: 600; margin: 0.75rem 0 0.3rem; }
.help-markdown p { margin: 0.4rem 0; line-height: 1.5; }
.help-markdown ul, .help-markdown ol { margin: 0.4rem 0 0.4rem 1.25rem; }
.help-markdown ul { list-style: disc; }
.help-markdown ol { list-style: decimal; }
.help-markdown li { margin: 0.15rem 0; }
.help-markdown code { background: #1f2937; padding: 0 0.25rem; border-radius: 0.25rem; font-size: 0.85em; }
.help-markdown pre { background: #111827; border: 1px solid #374151; border-radius: 0.375rem; padding: 0.5rem 0.75rem; overflow-x: auto; margin: 0.5rem 0; }
.help-markdown pre code { background: none; padding: 0; }
.help-markdown blockquote { border-left: 3px solid #4b5563; padding-left: 0.75rem; color: #9ca3af; margin: 0.5rem 0; }
.help-markdown hr { border-color: #374151; margin: 0.75rem 0; }
.help-markdown table { border-collapse: collapse; margin: 0.5rem 0; font-size: 0.85rem; }
.help-markdown th, .help-markdown td { border: 1px solid #4b5563; padding: 0.25rem 0.5rem; text-align: left; }
.help-markdown th { background: #1f2937; }
.help-markdown a { color: #60a5fa; text-decoration: underline; }
</style>
