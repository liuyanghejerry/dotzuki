<script setup lang="ts">
// PromptInspector — collapsible view of the captured AI request/response
// detail (usePromptInspector). Rendered at the bottom of the chat scroll
// area; mounts nothing and captures nothing unless the header 🐞 toggle is on.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePromptInspector, type DebugStep } from '@/composables/usePromptInspector'

const { t } = useI18n()
const { enabled, turns, clearTurns } = usePromptInspector()
const open = ref(true)

/** "1.2k↑ / 300↓" token summary for a step usage object (shape varies by provider). */
function fmtUsage(u: any): string {
  if (!u) return ''
  const i = u.inputTokens ?? u.promptTokens
  const o = u.outputTokens ?? u.completionTokens
  if (i == null && o == null) return ''
  return `${i ?? 0}↑ / ${o ?? 0}↓`
}

/** Pretty-print a tool input/output payload; long values stay readable in the
 *  scrollable <pre> rather than being truncated. */
function fmtJson(v: unknown): string {
  try { return JSON.stringify(v, null, 2) ?? String(v) } catch { return String(v) }
}

function stepHasDetail(s: DebugStep): boolean {
  return !!(s.text || s.toolCalls?.length || s.toolResults?.length)
}
</script>

<template>
  <div v-if="enabled" class="pt-1">
    <button @click="open = !open" class="flex w-full items-center gap-1.5 text-left">
      <span class="inline-block w-2.5 shrink-0 text-[10px] text-gray-500">{{ open ? '▾' : '▸' }}</span>
      <span class="text-[11px] font-semibold text-amber-400/90">🐞 {{ t('assistant.inspector.title') }}</span>
      <span class="text-[10px] text-gray-500 tabular-nums">({{ turns.length }})</span>
      <button v-if="turns.length" @click.stop="clearTurns" :title="t('assistant.inspector.clear')"
        class="ml-auto text-[10px] text-gray-600 hover:text-red-400">✕</button>
    </button>

    <div v-if="open" class="mt-1 space-y-1.5">
      <p v-if="!turns.length" class="px-1 text-[10px] text-gray-500">{{ t('assistant.inspector.empty') }}</p>

      <details v-for="turn in turns" :key="turn.id"
        class="rounded border border-gray-700/70 bg-gray-900/60 px-2 py-1.5">
        <summary class="cursor-pointer select-none text-[10px] text-gray-400 flex items-center gap-1.5">
          <span class="font-semibold text-gray-300">#{{ turn.id }}</span>
          <span class="tabular-nums">{{ new Date(turn.at).toLocaleTimeString() }}</span>
          <span class="ml-auto shrink-0">{{ t('assistant.inspector.steps', { n: turn.steps.length }) }}</span>
        </summary>

        <div class="mt-1.5 space-y-1.5">
          <!-- the exact system prompt sent to the model -->
          <details>
            <summary class="cursor-pointer select-none text-[10px] font-semibold text-gray-400">
              {{ t('assistant.inspector.system') }}
              <span v-if="turn.cached" class="ml-1 text-[9px] text-emerald-500">({{ t('assistant.inspector.cached') }})</span>
            </summary>
            <pre class="mt-0.5 max-h-64 overflow-auto rounded bg-gray-950/80 p-1.5 text-[10px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">{{ turn.system }}</pre>
          </details>

          <!-- the full converted message history -->
          <details>
            <summary class="cursor-pointer select-none text-[10px] font-semibold text-gray-400">
              {{ t('assistant.inspector.messages', { n: turn.messages.length }) }}
            </summary>
            <pre class="mt-0.5 max-h-64 overflow-auto rounded bg-gray-950/80 p-1.5 text-[10px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">{{ fmtJson(turn.messages) }}</pre>
          </details>

          <div class="text-[10px] text-gray-500">
            <span class="font-semibold text-gray-400">{{ t('assistant.inspector.tools', { n: turn.tools.length }) }}:</span>
            {{ turn.tools.join(' · ') }}
          </div>

          <!-- one block per model step: text, tool calls and their results -->
          <div v-for="(s, si) in turn.steps" :key="si"
            class="rounded border border-gray-800 px-1.5 py-1 space-y-1">
            <div class="flex items-center gap-1.5 text-[10px] text-gray-500">
              <span class="font-semibold text-gray-400">{{ t('assistant.inspector.step', { n: si + 1 }) }}</span>
              <span v-if="s.finishReason" class="text-gray-600">{{ s.finishReason }}</span>
              <span v-if="fmtUsage(s.usage)" class="ml-auto tabular-nums">{{ fmtUsage(s.usage) }}</span>
            </div>
            <pre v-if="s.text" class="max-h-40 overflow-auto rounded bg-gray-950/80 p-1.5 text-[10px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words">{{ s.text }}</pre>
            <template v-if="stepHasDetail(s)">
              <div v-for="(c, ci) in s.toolCalls ?? []" :key="'c' + ci" class="text-[10px]">
                <div class="text-blue-300">→ {{ c.toolName }} <span class="text-gray-600">{{ t('assistant.inspector.input') }}</span></div>
                <pre class="max-h-40 overflow-auto rounded bg-gray-950/80 p-1.5 text-gray-300 whitespace-pre-wrap break-words">{{ fmtJson(c.input) }}</pre>
              </div>
              <div v-for="(r, ri) in s.toolResults ?? []" :key="'r' + ri" class="text-[10px]">
                <div class="text-emerald-400">← {{ r.toolName }} <span class="text-gray-600">{{ t('assistant.inspector.output') }}</span></div>
                <pre class="max-h-40 overflow-auto rounded bg-gray-950/80 p-1.5 text-gray-300 whitespace-pre-wrap break-words">{{ fmtJson(r.output) }}</pre>
              </div>
            </template>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
