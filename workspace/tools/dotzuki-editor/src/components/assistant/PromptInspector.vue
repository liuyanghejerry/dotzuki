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
      <span class="inline-block w-2.5 shrink-0 text-micro text-ink-faint">{{ open ? '▾' : '▸' }}</span>
      <span class="text-tiny font-semibold text-warning-ink/90">🐞 {{ t('assistant.inspector.title') }}</span>
      <span class="text-micro text-ink-faint tabular-nums">({{ turns.length }})</span>
      <button v-if="turns.length" @click.stop="clearTurns" :title="t('assistant.inspector.clear')"
        class="ml-auto text-micro text-ink-disabled hover:text-danger-ink">✕</button>
    </button>

    <div v-if="open" class="mt-1 space-y-1.5">
      <p v-if="!turns.length" class="px-1 text-micro text-ink-faint">{{ t('assistant.inspector.empty') }}</p>

      <details v-for="turn in turns" :key="turn.id"
        class="rounded-control border border-border/70 bg-canvas/60 px-2 py-1.5">
        <summary class="cursor-pointer select-none text-micro text-ink-muted flex items-center gap-1.5">
          <span class="font-semibold text-ink-body">#{{ turn.id }}</span>
          <span class="tabular-nums">{{ new Date(turn.at).toLocaleTimeString() }}</span>
          <span class="ml-auto shrink-0">{{ t('assistant.inspector.steps', { n: turn.steps.length }) }}</span>
        </summary>

        <div class="mt-1.5 space-y-1.5">
          <!-- the exact system prompt sent to the model -->
          <details>
            <summary class="cursor-pointer select-none text-micro font-semibold text-ink-muted">
              {{ t('assistant.inspector.system') }}
              <span v-if="turn.cached" class="ml-1 text-[9px] text-success-strong">({{ t('assistant.inspector.cached') }})</span>
            </summary>
            <pre class="mt-0.5 max-h-64 overflow-auto rounded-control bg-canvas-deep/80 p-1.5 text-micro leading-relaxed text-ink-body whitespace-pre-wrap break-words">{{ turn.system }}</pre>
          </details>

          <!-- the full converted message history -->
          <details>
            <summary class="cursor-pointer select-none text-micro font-semibold text-ink-muted">
              {{ t('assistant.inspector.messages', { n: turn.messages.length }) }}
            </summary>
            <pre class="mt-0.5 max-h-64 overflow-auto rounded-control bg-canvas-deep/80 p-1.5 text-micro leading-relaxed text-ink-body whitespace-pre-wrap break-words">{{ fmtJson(turn.messages) }}</pre>
          </details>

          <div class="text-micro text-ink-faint">
            <span class="font-semibold text-ink-muted">{{ t('assistant.inspector.tools', { n: turn.tools.length }) }}:</span>
            {{ turn.tools.join(' · ') }}
          </div>

          <!-- one block per model step: text, tool calls and their results -->
          <div v-for="(s, si) in turn.steps" :key="si"
            class="rounded-control border border-border-subtle px-1.5 py-1 space-y-1">
            <div class="flex items-center gap-1.5 text-micro text-ink-faint">
              <span class="font-semibold text-ink-muted">{{ t('assistant.inspector.step', { n: si + 1 }) }}</span>
              <span v-if="s.finishReason" class="text-ink-disabled">{{ s.finishReason }}</span>
              <span v-if="fmtUsage(s.usage)" class="ml-auto tabular-nums">{{ fmtUsage(s.usage) }}</span>
            </div>
            <pre v-if="s.text" class="max-h-40 overflow-auto rounded-control bg-canvas-deep/80 p-1.5 text-micro leading-relaxed text-ink-body whitespace-pre-wrap break-words">{{ s.text }}</pre>
            <template v-if="stepHasDetail(s)">
              <div v-for="(c, ci) in s.toolCalls ?? []" :key="'c' + ci" class="text-micro">
                <div class="text-accent-ink-strong">→ {{ c.toolName }} <span class="text-ink-disabled">{{ t('assistant.inspector.input') }}</span></div>
                <pre class="max-h-40 overflow-auto rounded-control bg-canvas-deep/80 p-1.5 text-ink-body whitespace-pre-wrap break-words">{{ fmtJson(c.input) }}</pre>
              </div>
              <div v-for="(r, ri) in s.toolResults ?? []" :key="'r' + ri" class="text-micro">
                <div class="text-success-ink">← {{ r.toolName }} <span class="text-ink-disabled">{{ t('assistant.inspector.output') }}</span></div>
                <pre class="max-h-40 overflow-auto rounded-control bg-canvas-deep/80 p-1.5 text-ink-body whitespace-pre-wrap break-words">{{ fmtJson(r.output) }}</pre>
              </div>
            </template>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
