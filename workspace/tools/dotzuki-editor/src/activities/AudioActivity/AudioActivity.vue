<template>
  <div class="h-full flex flex-col bg-canvas text-ink">
    <!-- Error banner (both edit and file-preview states) -->
    <div v-if="error || playback.error.value" class="px-4 py-1.5 bg-danger-surface/40 text-danger-ink-strong text-xs shrink-0">
      {{ error || playback.error.value }}
    </div>

    <!-- Empty state -->
    <div v-if="!current" class="flex-1 flex items-center justify-center text-center px-6">
      <div class="w-full max-w-md space-y-6">
        <div>
          <div class="text-4xl mb-3">🎵</div>
          <p class="text-sm text-ink-muted">{{ $t('audio.selectPrompt') }}</p>
        </div>

        <!-- File audio preview (real WAV/OGG/FLAC/MP3, rendered by the engine) -->
        <div class="border border-border rounded-control bg-surface-deep p-4 text-left">
          <h3 class="text-micro uppercase tracking-wider text-ink-faint mb-1">{{ $t('audio.fileAudio') }}</h3>
          <p class="text-tiny text-ink-faint mb-3">{{ $t('audio.fileAudioHint') }}</p>
          <div class="flex items-center gap-2 flex-wrap">
            <label class="px-3 py-1 text-xs rounded-control bg-raised text-ink hover:bg-overlay cursor-pointer">
              {{ fileAudioName ?? $t('audio.fileAudioPick') }}
              <input type="file" accept=".wav,.ogg,.flac,.mp3,audio/*" class="hidden" @change="onFilePicked" />
            </label>
            <button
              v-if="fileAudioBytes"
              class="px-3 py-1 text-xs rounded-control bg-success-hover text-white hover:bg-success disabled:opacity-40"
              :disabled="playback.rendering.value"
              @click="playback.playing.value ? playback.stop() : playback.playFile(fileAudioBytes, fileAudioExt, 10)"
            >{{ playback.playing.value ? '⏹ ' + $t('audio.stop') : (playback.rendering.value ? $t('audio.rendering') : '▶ ' + $t('audio.play')) }}</button>
          </div>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Header / toolbar -->
      <div class="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-deep shrink-0 flex-wrap">
        <span
          class="text-micro uppercase tracking-wider px-1.5 py-0.5 rounded-control"
          :class="current.kind === 'music' ? 'bg-accent-selected text-accent-ink-strong' : 'bg-ai-surface text-ai-ink-strong'"
        >{{ current.kind }}</span>
        <span class="text-sm font-medium text-ink-secondary">{{ current.id }}</span>
        <span v-if="dirty" class="text-xs text-warning-ink" :title="$t('audio.unsaved')">●</span>

        <label class="flex items-center gap-1 text-xs text-ink-muted">
          {{ $t('audio.name') }}
          <input
            :value="current.name ?? ''"
            @input="setName(($event.target as HTMLInputElement).value)"
            class="px-2 py-0.5 w-32 text-xs rounded-control bg-canvas border border-border text-ink"
          />
        </label>

        <label v-if="current.kind === 'music'" class="flex items-center gap-1 text-xs text-ink-muted">
          {{ $t('audio.tempo') }}
          <input
            type="number" min="1" max="65535"
            :value="current.tempo ?? 256"
            @input="setTempo(Number(($event.target as HTMLInputElement).value))"
            class="px-2 py-0.5 w-20 text-xs rounded-control bg-canvas border border-border text-ink"
          />
        </label>

        <div class="flex-1"></div>

        <button
          class="px-3 py-1 text-xs rounded-control bg-success-hover text-white hover:bg-success disabled:opacity-40"
          :disabled="playback.rendering.value"
          @click="playback.playing.value ? playback.stop() : playCurrent()"
        >{{ playback.playing.value ? '⏹ ' + $t('audio.stop') : (playback.rendering.value ? $t('audio.rendering') : '▶ ' + $t('audio.play')) }}</button>

        <button
          class="px-3 py-1 text-xs rounded-control bg-accent text-white hover:bg-accent-strong disabled:opacity-40"
          :disabled="!dirty || saving"
          @click="save()"
        >{{ saving ? $t('audio.saving') : $t('audio.save') }}</button>
      </div>

      <!-- Channels -->
      <div class="flex-1 overflow-auto p-4 space-y-4">
        <div
          v-for="(ch, ci) in current.channels"
          :key="ci"
          class="border border-border rounded-control bg-surface-deep"
        >
          <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-surface">
            <span class="text-xs text-ink-faint">{{ $t('audio.channel') }}</span>
            <select
              :value="ch.hw"
              @change="setHw(ci, ($event.target as HTMLSelectElement).value)"
              class="px-2 py-0.5 text-xs rounded-control bg-canvas border border-border text-ink"
            >
              <option v-for="hw in HW_CHANNELS" :key="hw" :value="hw">{{ hw }}</option>
            </select>
            <span class="text-tiny text-ink-disabled">{{ ch.commands.length }} {{ $t('audio.commands') }}</span>
            <div class="flex-1"></div>
            <button class="text-xs text-ink-faint hover:text-danger-ink" @click="removeChannel(ci)">✕ {{ $t('audio.removeChannel') }}</button>
          </div>

          <!-- Command rows -->
          <div class="divide-y divide-border">
            <div
              v-for="(cmd, ii) in ch.commands"
              :key="ii"
              class="flex items-center gap-2 px-3 py-1 hover:bg-surface/50"
            >
              <span class="text-micro text-ink-disabled w-6 text-right tabular-nums">{{ ii }}</span>
              <select
                :value="cmd.type"
                @change="changeType(ci, ii, ($event.target as HTMLSelectElement).value)"
                class="px-1.5 py-0.5 text-xs rounded-control bg-canvas border border-border text-ink-secondary w-36"
              >
                <option v-for="ct in COMMAND_TYPES" :key="ct" :value="ct">{{ ct }}</option>
              </select>

              <!-- Dynamic fields -->
              <template v-for="f in fieldsFor(cmd.type)" :key="f.key">
                <label class="flex items-center gap-1 text-tiny text-ink-faint">
                  {{ f.key }}
                  <input
                    type="number" :min="f.min" :max="f.max"
                    :value="cmd[f.key] as number"
                    @input="setField(cmd, f.key, Number(($event.target as HTMLInputElement).value))"
                    class="px-1 py-0.5 w-16 text-xs rounded-control bg-canvas border border-border text-ink tabular-nums"
                  />
                </label>
              </template>

              <!-- Read-only helper (note name / musical octave) -->
              <span v-if="hint(cmd)" class="text-tiny text-ink-faint italic">{{ hint(cmd) }}</span>

              <div class="flex-1"></div>
              <button class="text-tiny text-ink-disabled hover:text-ink-body disabled:opacity-30" :disabled="ii === 0" @click="move(ci, ii, -1)">↑</button>
              <button class="text-tiny text-ink-disabled hover:text-ink-body disabled:opacity-30" :disabled="ii === ch.commands.length - 1" @click="move(ci, ii, 1)">↓</button>
              <button class="text-tiny text-ink-disabled hover:text-danger-ink" @click="removeCommand(ci, ii)">✕</button>
            </div>

            <div v-if="!ch.commands.length" class="px-3 py-2 text-tiny text-ink-disabled">{{ $t('audio.noCommands') }}</div>
          </div>

          <!-- Add command -->
          <div class="flex items-center gap-2 px-3 py-1.5 border-t border-border-subtle">
            <select v-model="addType[ci]" class="px-1.5 py-0.5 text-xs rounded-control bg-canvas border border-border text-ink-secondary w-36">
              <option v-for="ct in COMMAND_TYPES" :key="ct" :value="ct">{{ ct }}</option>
            </select>
            <button class="px-2 py-0.5 text-xs rounded-control bg-raised text-ink hover:bg-overlay" @click="addCommand(ci)">＋ {{ $t('audio.addCommand') }}</button>
          </div>
        </div>

        <button
          class="px-3 py-1.5 text-xs rounded-control border border-dashed border-border text-ink-muted hover:text-ink-secondary hover:border-border-strongest"
          @click="addChannel()"
        >＋ {{ $t('audio.addChannel') }}</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAudioActivity, type AudioCommand } from '@/composables/useAudioActivity'
import { useAudioPlayback } from '@/composables/useAudioPlayback'

const { t } = useI18n()
const { current, dirty, saving, error, loadList, save, markDirty } = useAudioActivity()
const playback = useAudioPlayback()

// ── File audio preview (real WAV/OGG/FLAC/MP3 files) ─────────────────────
const fileAudioBytes = ref<Uint8Array | null>(null)
const fileAudioName = ref<string | null>(null)
const fileAudioExt = ref('')

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileAudioName.value = file.name
  fileAudioExt.value = (file.name.split('.').pop() ?? '').toLowerCase()
  file.arrayBuffer().then(buf => {
    fileAudioBytes.value = new Uint8Array(buf)
  })
}

const HW_CHANNELS = ['pulse1', 'pulse2', 'wave', 'noise'] as const
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

interface FieldSpec { key: string; min: number; max: number }

// Field schema per command type — mirrors dotzuki-audio's AudioCommand variants.
const COMMAND_FIELDS: Record<string, FieldSpec[]> = {
  note: [{ key: 'pitch', min: 0, max: 11 }, { key: 'length', min: 1, max: 16 }],
  drum_note: [{ key: 'length', min: 1, max: 16 }, { key: 'instrument', min: 0, max: 255 }],
  rest: [{ key: 'length', min: 1, max: 16 }],
  note_type: [{ key: 'speed', min: 0, max: 15 }, { key: 'param', min: 0, max: 255 }],
  octave: [{ key: 'value', min: 0, max: 7 }],
  duty_cycle: [{ key: 'value', min: 0, max: 3 }],
  tempo: [{ key: 'value', min: 0, max: 65535 }],
  volume: [{ key: 'value', min: 0, max: 255 }],
  stereo_panning: [{ key: 'value', min: 0, max: 255 }],
  vibrato: [{ key: 'delay', min: 0, max: 255 }, { key: 'depth_rate', min: 0, max: 255 }],
  pitch_slide: [{ key: 'length_modifier', min: 0, max: 255 }, { key: 'octave_pitch', min: 0, max: 255 }],
  duty_cycle_pattern: [{ key: 'value', min: 0, max: 255 }],
  toggle_perfect_pitch: [],
  execute_music: [],
  sound_call: [{ key: 'offset', min: 0, max: 65535 }],
  sound_loop: [{ key: 'count', min: 0, max: 255 }, { key: 'offset', min: 0, max: 65535 }],
  sound_ret: [],
  pitch_sweep: [{ key: 'param', min: 0, max: 255 }],
  sfx_square_note: [{ key: 'length', min: 0, max: 15 }, { key: 'volume_envelope', min: 0, max: 255 }, { key: 'frequency', min: 0, max: 2047 }],
  sfx_noise_note: [{ key: 'length', min: 0, max: 15 }, { key: 'volume_envelope', min: 0, max: 255 }, { key: 'noise_params', min: 0, max: 255 }],
  unknown_ef: [{ key: 'value', min: 0, max: 255 }],
  end_of_data: [],
}
const COMMAND_TYPES = Object.keys(COMMAND_FIELDS)

// Per-channel "add command" type selection.
const addType = reactive<Record<number, string>>({})

onMounted(() => loadList())

function fieldsFor(type: string): FieldSpec[] {
  return COMMAND_FIELDS[type] ?? []
}

function hint(cmd: AudioCommand): string | null {
  if (cmd.type === 'note') return NOTE_NAMES[(cmd.pitch as number) ?? 0] ?? null
  if (cmd.type === 'octave') return `oct ${8 - ((cmd.value as number) ?? 0)}`
  return null
}

function defaultCommand(type: string): AudioCommand {
  const cmd: AudioCommand = { type }
  for (const f of fieldsFor(type)) {
    cmd[f.key] = f.key === 'length' ? 4 : f.min
  }
  return cmd
}

// ── Mutations (all mark the track dirty) ──────────────────────────────────

function setName(v: string) {
  if (!current.value) return
  current.value.name = v || null
  markDirty()
}
function setTempo(v: number) {
  if (!current.value) return
  current.value.tempo = v
  markDirty()
}
function setHw(ci: number, hw: string) {
  if (!current.value) return
  current.value.channels[ci].hw = hw as never
  markDirty()
}
function setField(cmd: AudioCommand, key: string, v: number) {
  cmd[key] = v
  markDirty()
}
function changeType(ci: number, ii: number, type: string) {
  if (!current.value) return
  current.value.channels[ci].commands[ii] = defaultCommand(type)
  markDirty()
}
function addCommand(ci: number) {
  if (!current.value) return
  current.value.channels[ci].commands.push(defaultCommand(addType[ci] ?? 'note'))
  markDirty()
}
function removeCommand(ci: number, ii: number) {
  if (!current.value) return
  current.value.channels[ci].commands.splice(ii, 1)
  markDirty()
}
function move(ci: number, ii: number, delta: number) {
  if (!current.value) return
  const cmds = current.value.channels[ci].commands
  const j = ii + delta
  if (j < 0 || j >= cmds.length) return
  const [c] = cmds.splice(ii, 1)
  cmds.splice(j, 0, c)
  markDirty()
}
function addChannel() {
  if (!current.value) return
  const used = new Set(current.value.channels.map(c => c.hw))
  const next = HW_CHANNELS.find(h => !used.has(h)) ?? 'pulse1'
  current.value.channels.push({ hw: next, commands: [] })
  markDirty()
}
function removeChannel(ci: number) {
  if (!current.value) return
  current.value.channels.splice(ci, 1)
  markDirty()
}

function playCurrent() {
  if (current.value) playback.play(current.value)
}
</script>

<style scoped>
.bg-surface-deep { background-color: #1a1f2b; }
</style>
