<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStoryActivity } from '@/composables/useStoryActivity'
import { useLocalize } from '@/composables/useLocalize'
import type { Quest } from '@/types'

const { t } = useI18n()
const { localize } = useLocalize()
const story = useStoryActivity()
const { quests, arcs, derivedEdges } = story

const NODE_W = 168, NODE_H = 58, COL_GAP = 52, ROW_GAP = 22, PAD = 24, HEADER = 24

function questTitle(q: Quest): string {
  return localize(q.title, q.id)
}
function arcTitle(id: string): string {
  const a = arcs.value.find(x => x.id === id)
  return a ? localize(a.title, a.id) : id
}

const lanes = computed(() => {
  const byId = new Map(quests.value.map(q => [q.id, q]))
  const placed = new Set<string>()
  const out: { title: string; quests: Quest[] }[] = []
  const sorted = [...arcs.value].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const arc of sorted) {
    const qs = (arc.beats ?? []).map(id => byId.get(id)).filter(Boolean) as Quest[]
    qs.forEach(q => placed.add(q.id))
    if (qs.length) out.push({ title: arcTitle(arc.id), quests: qs })
  }
  const leftover = quests.value.filter(q => !placed.has(q.id))
  if (leftover.length) out.push({ title: t('story.unsorted'), quests: leftover })
  return out
})

const positions = computed(() => {
  const map = new Map<string, { x: number; y: number }>()
  lanes.value.forEach((lane, col) => {
    lane.quests.forEach((q, row) => {
      map.set(q.id, {
        x: PAD + col * (NODE_W + COL_GAP),
        y: PAD + HEADER + row * (NODE_H + ROW_GAP),
      })
    })
  })
  return map
})

const nodes = computed(() =>
  lanes.value.flatMap(lane =>
    lane.quests.map(q => ({ q, pos: positions.value.get(q.id)! })),
  ),
)

const edges = computed(() =>
  derivedEdges.value
    .map(e => {
      const a = positions.value.get(e.from), b = positions.value.get(e.to)
      if (!a || !b) return null
      return {
        x1: a.x + NODE_W, y1: a.y + NODE_H / 2,
        x2: b.x, y2: b.y + NODE_H / 2,
        derived: !!(e as any).derived,
      }
    })
    .filter(Boolean) as { x1: number; y1: number; x2: number; y2: number; derived: boolean }[],
)

const canvasSize = computed(() => {
  const cols = lanes.value.length
  const maxRows = Math.max(1, ...lanes.value.map(l => l.quests.length))
  return {
    w: Math.max(640, PAD * 2 + cols * (NODE_W + COL_GAP) - COL_GAP),
    h: Math.max(360, PAD * 2 + HEADER + maxRows * (NODE_H + ROW_GAP) - ROW_GAP),
  }
})

const laneHeaderX = (col: number) => PAD + col * (NODE_W + COL_GAP)

function statusClass(s: string): string {
  return {
    idea: 'border-gray-600',
    drafted: 'border-amber-500/70',
    scripted: 'border-blue-500/70',
    done: 'border-green-500/70',
  }[s] ?? 'border-gray-600'
}
function statusDot(s: string): string {
  return {
    idea: 'bg-gray-500',
    drafted: 'bg-amber-500',
    scripted: 'bg-blue-500',
    done: 'bg-green-500',
  }[s] ?? 'bg-gray-500'
}

function open(id: string) {
  story.select('quests', id)
  story.setView('quests')
}
</script>

<template>
  <div class="h-full overflow-auto p-4">
    <div class="flex items-center gap-4 mb-3 text-[11px] text-gray-500">
      <span class="font-semibold uppercase tracking-wide">{{ t('story.views.graph') }}</span>
      <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-gray-500 inline-block" /> {{ t('story.status.idea') }}</span>
      <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {{ t('story.status.drafted') }}</span>
      <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-blue-500 inline-block" /> {{ t('story.status.scripted') }}</span>
      <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-green-500 inline-block" /> {{ t('story.status.done') }}</span>
      <span class="flex items-center gap-1"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#60a5fa" stroke-dasharray="3 2" /></svg> {{ t('story.derivedEdge') }}</span>
    </div>

    <div v-if="!quests.length" class="h-64 flex items-center justify-center text-gray-600 text-sm">
      {{ t('story.emptyGraph') }}
    </div>

    <div v-else class="relative" :style="{ width: canvasSize.w + 'px', height: canvasSize.h + 'px' }">
      <!-- edges -->
      <svg class="absolute inset-0 pointer-events-none" :width="canvasSize.w" :height="canvasSize.h">
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#475569" />
          </marker>
        </defs>
        <line
          v-for="(e, i) in edges"
          :key="i"
          :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
          :stroke="e.derived ? '#3b82f6' : '#64748b'"
          :stroke-dasharray="e.derived ? '4 3' : ''"
          :stroke-opacity="e.derived ? 0.5 : 0.8"
          stroke-width="1.5"
          marker-end="url(#arrow)"
        />
      </svg>

      <!-- lane headers -->
      <div
        v-for="(lane, col) in lanes"
        :key="'h' + col"
        class="absolute text-[11px] font-semibold text-gray-400 uppercase tracking-wide truncate"
        :style="{ left: laneHeaderX(col) + 'px', top: '0px', width: NODE_W + 'px' }"
      >{{ lane.title }}</div>

      <!-- nodes -->
      <button
        v-for="n in nodes"
        :key="n.q.id"
        @click="open(n.q.id)"
        class="absolute text-left bg-gray-800 border rounded-md px-2.5 py-1.5 hover:bg-gray-750 transition-colors shadow-sm"
        :class="statusClass(n.q.status)"
        :style="{ left: n.pos.x + 'px', top: n.pos.y + 'px', width: NODE_W + 'px', height: NODE_H + 'px' }"
      >
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full shrink-0" :class="statusDot(n.q.status)" />
          <span class="text-xs text-gray-100 font-medium truncate">{{ questTitle(n.q) }}</span>
        </div>
        <div class="text-[10px] text-gray-500 truncate mt-0.5">
          {{ n.q.type }} · {{ n.q.id }}
        </div>
      </button>
    </div>
  </div>
</template>
