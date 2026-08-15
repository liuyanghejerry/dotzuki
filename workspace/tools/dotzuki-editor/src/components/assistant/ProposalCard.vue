<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { diffHunks, type DiffOp, type AssistantProposal } from '@/composables/useProposals'

const { t } = useI18n()
const props = defineProps<{ proposal: AssistantProposal }>()
const emit = defineEmits<{ apply: []; applySubset: [accepted: number[]]; forceApply: []; discard: [] ; revert: [] }>()

const expanded = ref(false)
const stats = computed(() => ({
  add: props.proposal.diff.filter(o => o.type === 'add').length,
  del: props.proposal.diff.filter(o => o.type === 'del').length,
}))

// project-scaffold proposals carry a structured payload, not a file diff —
// render a readable summary (name / dir / template / activities) instead.
const scaffold = computed(() => {
  if (props.proposal.target?.kind !== 'project-scaffold') return null
  try { return JSON.parse(props.proposal.after) } catch { return null }
})
const scaffoldActivities = computed(() =>
  (Array.isArray(scaffold.value?.activities) ? scaffold.value.activities : [])
    .map((a: any) => a?.label ?? a?.id)
    .filter(Boolean)
    .join(', '),
)

// ── hunk-grouped render rows + per-hunk selection ─────────────────────────────
interface Row { kind: 'ctx' | 'hunk'; ops: DiffOp[]; hunk: number }
const hunkCount = computed(() => diffHunks(props.proposal.diff).length)
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  let hunk = -1
  let cur: Row | null = null
  for (const op of props.proposal.diff) {
    if (op.type === 'ctx') { cur = null; out.push({ kind: 'ctx', ops: [op], hunk: -1 }) }
    else {
      if (!cur) { hunk++; cur = { kind: 'hunk', ops: [], hunk }; out.push(cur) }
      cur.ops.push(op)
    }
  }
  return out
})
const previewRows = computed(() => (expanded.value ? rows.value : rows.value.slice(0, 12)))
const truncated = computed(() => !expanded.value && rows.value.length > 12)

// Selecting hunks is only meaningful for a pending multi-hunk EDIT — a delete
// proposal (op:'delete') is all-or-nothing, so it is never hunk-selectable.
const selectable = computed(() => props.proposal.status === 'pending' && props.proposal.op !== 'delete' && hunkCount.value > 1)
const accepted = ref<Set<number>>(new Set())
// default: all hunks selected
function resetAccepted() { accepted.value = new Set(Array.from({ length: hunkCount.value }, (_, i) => i)) }
resetAccepted()
function toggle(h: number) {
  const s = new Set(accepted.value)
  s.has(h) ? s.delete(h) : s.add(h)
  accepted.value = s
}
const partial = computed(() => selectable.value && accepted.value.size < hunkCount.value)

function onApply() {
  if (partial.value) emit('applySubset', [...accepted.value])
  else emit('apply')
}
</script>

<template>
  <div class="border border-border rounded-control bg-surface-deep/60">
    <div class="flex items-start gap-2 px-2.5 py-2">
      <span
        class="mt-0.5 text-[9px] uppercase tracking-wide px-1 rounded-control shrink-0"
        :class="proposal.target.kind === 'story' ? 'bg-indigo-900 text-indigo-300'
          : proposal.target.kind === 'data' ? 'bg-success-deep text-success-ink-strong'
          : proposal.target.kind === 'scene' ? 'bg-warning-deep text-warning-ink-strong'
          : proposal.target.kind === 'project-config' ? 'bg-ai-deep text-ai-ink-strong'
          : proposal.target.kind === 'project-scaffold' ? 'bg-accent-deep text-accent-ink-strong'
          : proposal.target.kind === 'map-create' ? 'bg-teal-900 text-teal-300'
          : proposal.target.kind === 'map-tilemap' ? 'bg-rose-900 text-rose-300'
          : 'bg-sky-900 text-sky-300'"
      >{{ proposal.target.kind }}</span>
      <div class="min-w-0 flex-1">
        <div class="text-xs text-ink font-medium truncate">{{ proposal.title }}</div>
        <div class="text-micro text-ink-faint truncate">{{ proposal.target.path }}</div>
      </div>
      <span class="text-micro shrink-0"
        :class="proposal.status === 'applied' ? 'text-success-ink'
          : proposal.status === 'reverted' ? 'text-ink-faint'
          : proposal.status === 'failed' ? 'text-danger-ink'
          : proposal.status === 'conflict' ? 'text-warning-ink' : 'text-ink-faint'">
        {{ proposal.status === 'applied' ? t('assistant.applied')
          : proposal.status === 'reverted' ? t('assistant.reverted')
          : proposal.status === 'failed' ? t('assistant.applyFailed')
          : proposal.status === 'conflict' ? t('assistant.conflict') : '' }}
        <template v-if="proposal.status === 'pending'">
          <span class="text-success-strong">+{{ stats.add }}</span>
          <span v-if="stats.del" class="text-danger ml-1">-{{ stats.del }}</span>
        </template>
      </span>
    </div>

    <p v-if="proposal.rationale" class="px-2.5 pb-1.5 text-micro text-ink-muted leading-snug">{{ proposal.rationale }}</p>

    <div v-if="selectable" class="px-2.5 pb-1 text-micro text-ink-faint">{{ t('assistant.selectHunksHint') }}</div>

    <!-- structured summary for a project-scaffold draft (no file diff) -->
    <div v-if="scaffold" class="mx-2.5 mb-2 rounded-control bg-canvas px-2.5 py-2 space-y-1 text-tiny">
      <div class="flex gap-2"><span class="text-ink-faint w-16 shrink-0">{{ t('wizard.summaryName') }}</span><span class="text-ink">{{ scaffold.name }}</span></div>
      <div class="flex gap-2"><span class="text-ink-faint w-16 shrink-0">{{ t('wizard.summaryDir') }}</span><span class="text-ink-body font-mono text-micro break-all">{{ scaffold.dir }}</span></div>
      <div class="flex gap-2"><span class="text-ink-faint w-16 shrink-0">{{ t('wizard.summaryTemplate') }}</span><span class="text-ink-body">{{ t(`templates.${scaffold.templateId}.name`) }}</span></div>
      <div v-if="scaffoldActivities" class="flex gap-2"><span class="text-ink-faint w-16 shrink-0">{{ t('assistant.scaffoldActivities') }}</span><span class="text-ink-muted">{{ scaffoldActivities }}</span></div>
    </div>

    <div v-else class="mx-2.5 mb-2 max-h-56 overflow-auto rounded-control bg-canvas text-micro leading-[1.35] font-mono">
      <template v-for="(row, ri) in previewRows" :key="ri">
        <div v-if="row.kind === 'ctx'" class="px-2 whitespace-pre-wrap break-all text-ink-faint">{{ '  ' + row.ops[0].text }}</div>
        <div v-else class="flex items-start" :class="selectable && !accepted.has(row.hunk) ? 'opacity-40' : ''">
          <input v-if="selectable" type="checkbox" :checked="accepted.has(row.hunk)" @change="toggle(row.hunk)"
            class="mt-1 ml-1 mr-0.5 shrink-0 accent-emerald-500" :title="t('assistant.includeHunk')" />
          <div class="min-w-0 flex-1">
            <div v-for="(op, oi) in row.ops" :key="oi" class="px-2 whitespace-pre-wrap break-all"
              :class="op.type === 'add' ? 'bg-success-deep/60 text-success-ink-strong' : 'bg-danger-deep/60 text-danger-ink-strong'"
            >{{ (op.type === 'add' ? '+ ' : '- ') + op.text }}</div>
          </div>
        </div>
      </template>
    </div>

    <button v-if="truncated && !scaffold" @click="expanded = true" class="mx-2.5 mb-2 text-micro text-accent-ink hover:text-accent-ink-strong">
      ⌄ {{ rows.length - 12 }} more
    </button>

    <!-- stale-proposal guard: the file drifted since this diff was built -->
    <p v-if="proposal.status === 'conflict'" class="px-2.5 pb-1.5 text-micro text-warning-ink/90 leading-snug">
      {{ t('assistant.conflictHint') }}
    </p>

    <div class="flex items-center justify-end gap-1.5 px-2.5 pb-2">
      <span v-if="proposal.error" class="mr-auto text-micro text-danger-ink truncate">{{ proposal.error }}</span>
      <template v-if="proposal.status === 'pending' || proposal.status === 'failed'">
        <button @click="emit('discard')" class="px-2 py-0.5 text-tiny rounded-control text-ink-muted hover:text-ink-secondary">{{ t('assistant.discard') }}</button>
        <button @click="onApply" :disabled="selectable && accepted.size === 0"
          class="px-2.5 py-0.5 text-tiny rounded-control bg-success-hover text-white hover:bg-success disabled:opacity-40">
          {{ partial ? t('assistant.apply') + ' (' + accepted.size + '/' + hunkCount + ')' : t('assistant.apply') }}
        </button>
      </template>
      <template v-else-if="proposal.status === 'conflict'">
        <button @click="emit('discard')" class="px-2 py-0.5 text-tiny rounded-control text-ink-muted hover:text-ink-secondary">{{ t('assistant.discard') }}</button>
        <button @click="emit('forceApply')" class="px-2.5 py-0.5 text-tiny rounded-control bg-warning-strong text-white hover:bg-warning-hover">{{ t('assistant.applyAnyway') }}</button>
      </template>
      <button v-else-if="proposal.status === 'applied'" @click="emit('revert')" class="px-2 py-0.5 text-tiny rounded-control text-warning-ink hover:text-warning-ink-strong">{{ t('assistant.revert') }}</button>
    </div>
  </div>
</template>
