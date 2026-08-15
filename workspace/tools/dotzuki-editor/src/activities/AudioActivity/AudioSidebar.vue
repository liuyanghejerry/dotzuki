<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-3 border-b border-border flex items-center justify-between">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-faint">{{ $t('audio.title') }}</h2>
      <button
        class="text-xs px-2 py-0.5 rounded-control bg-accent text-white hover:bg-accent-strong"
        @click="showNew = !showNew"
      >＋</button>
    </div>

    <!-- New-track form -->
    <div v-if="showNew" class="px-3 py-2 border-b border-border space-y-2 bg-surface-deep">
      <input
        v-model="newId"
        :placeholder="$t('audio.newIdPlaceholder')"
        class="w-full px-2 py-1 text-sm rounded-control bg-canvas border border-border text-ink"
        @keyup.enter="doCreate"
      />
      <div class="flex items-center gap-2">
        <select v-model="newKind" class="flex-1 px-2 py-1 text-sm rounded-control bg-canvas border border-border text-ink">
          <option value="music">{{ $t('audio.music') }}</option>
          <option value="sfx">{{ $t('audio.sfx') }}</option>
        </select>
        <button
          class="px-2 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40"
          :disabled="!newId.trim()"
          @click="doCreate"
        >{{ $t('audio.create') }}</button>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto">
      <template v-for="group in groups" :key="group.kind">
        <div class="px-3 pt-3 pb-1 text-tiny font-semibold uppercase tracking-wider text-ink-disabled">
          {{ group.label }} <span class="text-gray-700">({{ group.items.value.length }})</span>
        </div>
        <button
          v-for="t in group.items.value"
          :key="t.file"
          @click="select(t.file)"
          :class="[
            'group w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
            currentFile === t.file
              ? 'bg-accent-selected text-accent-ink-strong border-l-2 border-accent-ink'
              : 'text-ink-muted hover:text-ink-secondary hover:bg-surface-hover border-l-2 border-transparent'
          ]"
        >
          <span class="text-sm shrink-0">{{ group.icon }}</span>
          <span class="truncate flex-1">{{ t.id }}</span>
          <span
            v-if="t.error"
            class="text-micro text-danger-ink shrink-0"
            :title="t.error"
          >⚠</span>
          <span
            class="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger-ink text-xs shrink-0"
            :title="$t('audio.delete')"
            @click.stop="confirmDelete(t)"
          >🗑</span>
        </button>
      </template>

      <div v-if="!loading && !tracks.length" class="p-4">
        <p class="text-xs text-ink-disabled text-center">{{ $t('audio.empty') }}</p>
      </div>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAudioActivity, type TrackKind, type TrackSummary } from '@/composables/useAudioActivity'

const { t } = useI18n()
const { tracks, musicTracks, sfxTracks, currentFile, loading, open, create, remove } = useAudioActivity()

const showNew = ref(false)
const newId = ref('')
const newKind = ref<TrackKind>('music')

const groups = [
  { kind: 'music' as const, label: t('audio.music'), icon: '🎵', items: musicTracks },
  { kind: 'sfx' as const, label: t('audio.sfx'), icon: '🔔', items: sfxTracks },
]

function select(file: string) {
  open(file)
}

async function doCreate() {
  const id = newId.value.trim()
  if (!id) return
  const file = await create(id, newKind.value)
  if (file) {
    newId.value = ''
    showNew.value = false
  }
}

function confirmDelete(track: TrackSummary) {
  if (window.confirm(t('audio.confirmDelete', { id: track.id }))) {
    remove(track.file)
  }
}
</script>
