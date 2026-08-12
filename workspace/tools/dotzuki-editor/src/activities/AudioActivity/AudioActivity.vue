<template>
  <div class="h-full flex flex-col bg-gray-900 text-gray-100">
    <!-- Empty state -->
    <div v-if="!current" class="flex-1 flex items-center justify-center text-center px-6">
      <div>
        <div class="text-4xl mb-3">🎵</div>
        <p class="text-sm text-gray-400">{{ $t('audio.selectPrompt') }}</p>
      </div>
    </div>

    <template v-else>
      <!-- Header / toolbar -->
      <div class="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-850 shrink-0 flex-wrap">
        <span
          class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
          :class="current.kind === 'music' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'"
        >{{ current.kind }}</span>
        <span class="text-sm font-medium text-gray-200">{{ current.id }}</span>
        <span v-if="dirty" class="text-xs text-amber-400" :title="$t('audio.unsaved')">●</span>

        <label class="flex items-center gap-1 text-xs text-gray-400">
          {{ $t('audio.name') }}
          <input
            :value="current.name ?? ''"
            @input="setName(($event.target as HTMLInputElement).value)"
            class="px-2 py-0.5 w-32 text-xs rounded bg-gray-900 border border-gray-700 text-gray-100"
          />
        </label>

        <label v-if="current.kind === 'music'" class="flex items-center gap-1 text-xs text-gray-400">
          {{ $t('audio.tempo') }}
          <input
            type="number" min="1" max="65535"
            :value="current.tempo ?? 256"
            @input="setTempo(Number(($event.target as HTMLInputElement).value))"
            class="px-2 py-0.5 w-20 text-xs rounded bg-gray-900 border border-gray-700 text-gray-100"
          />
        </label>

        <div class="flex-1"></div>

        <button
          class="px-3 py-1 text-xs rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-40"
          :disabled="playback.rendering.value"
          @click="playback.playing.value ? playback.stop() : playCurrent()"
        >{{ playback.playing.value ? '⏹ ' + $t('audio.stop') : (playback.rendering.value ? $t('audio.rendering') : '▶ ' + $t('audio.play')) }}</button>

        <button
          class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
          :disabled="!dirty || saving"
          @click="save()"
        >{{ saving ? $t('audio.saving') : $t('audio.save') }}</button>
      </div>

      <!-- Error banner -->
      <div v-if="error || playback.error.value" class="px-4 py-1.5 bg-red-900/40 text-red-300 text-xs shrink-0">
        {{ error || playback.error.value }}
      </div>

      <!-- Channels -->
      <div class="flex-1 overflow-auto p-4 space-y-4">
        <div
          v-for="(ch, ci) in current.channels"
          :key="ci"
          class="border border-gray-700 rounded bg-gray-850"
        >
          <div class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 bg-gray-800">
            <span class="text-xs text-gray-500">{{ $t('audio.channel') }}</span>
            <select
              :value="ch.hw"
              @change="setHw(ci, ($event.target as HTMLSelectElement).value)"
              class="px-2 py-0.5 text-xs rounded bg-gray-900 border border-gray-700 text-gray-100"
            >
              <option v-for="hw in HW_CHANNELS" :key="hw" :value="hw">{{ hw }}</option>
            </select>
            <span class="text-[11px] text-gray-600">{{ ch.commands.length }} {{ $t('audio.commands') }}</span>
            <div class="flex-1"></div>
            <button class="text-xs text-gray-500 hover:text-red-400" @click="removeChannel(ci)">✕ {{ $t('audio.removeChannel') }}</button>
          </div>

          <!-- Command rows -->
          <div class="divide-y divide-gray-800">
            <div
              v-for="(cmd, ii) in ch.commands"
              :key="ii"
              class="flex items-center gap-2 px-3 py-1 hover:bg-gray-800/50"
            >
              <span class="text-[10px] text-gray-600 w-6 text-right tabular-nums">{{ ii }}</span>
              <select
                :value="cmd.type"
                @change="changeType(ci, ii, ($event.target as HTMLSelectElement).value)"
                class="px-1.5 py-0.5 text-xs rounded bg-gray-900 border border-gray-700 text-gray-200 w-36"
              >
                <option v-for="ct in COMMAND_TYPES" :key="ct" :value="ct">{{ ct }}</option>
              </select>

              <!-- Dynamic fields -->
              <template v-for="f in fieldsFor(cmd.type)" :key="f.key">
                <label class="flex items-center gap-1 text-[11px] text-gray-500">
                  {{ f.key }}
                  <input
                    type="number" :min="f.min" :max="f.max"
                    :value="cmd[f.key] as number"
                    @input="setField(cmd, f.key, Number(($event.target as HTMLInputElement).value))"
                    class="px-1 py-0.5 w-16 text-xs rounded bg-gray-900 border border-gray-700 text-gray-100 tabular-nums"
                  />
                </label>
              </template>

              <!-- Read-only helper (note name / musical octave) -->
              <span v-if="hint(cmd)" class="text-[11px] text-gray-500 italic">{{ hint(cmd) }}</span>

              <div class="flex-1"></div>
              <button class="text-[11px] text-gray-600 hover:text-gray-300 disabled:opacity-30" :disabled="ii === 0" @click="move(ci, ii, -1)">↑</button>
              <button class="text-[11px] text-gray-600 hover:text-gray-300 disabled:opacity-30" :disabled="ii === ch.commands.length - 1" @click="move(ci, ii, 1)">↓</button>
              <button class="text-[11px] text-gray-600 hover:text-red-400" @click="removeCommand(ci, ii)">✕</button>
            </div>

            <div v-if="!ch.commands.length" class="px-3 py-2 text-[11px] text-gray-600">{{ $t('audio.noCommands') }}</div>
          </div>

          <!-- Add command -->
          <div class="flex items-center gap-2 px-3 py-1.5 border-t border-gray-800">
            <select v-model="addType[ci]" class="px-1.5 py-0.5 text-xs rounded bg-gray-900 border border-gray-700 text-gray-200 w-36">
              <option v-for="ct in COMMAND_TYPES" :key="ct" :value="ct">{{ ct }}</option>
            </select>
            <button class="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-100 hover:bg-gray-600" @click="addCommand(ci)">＋ {{ $t('audio.addCommand') }}</button>
          </div>
        </div>

        <button
          class="px-3 py-1.5 text-xs rounded border border-dashed border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500"
          @click="addChannel()"
        >＋ {{ $t('audio.addChannel') }}</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAudioActivity, type AudioCommand } from '@/composables/useAudioActivity'
import { useAudioPlayback } from '@/composables/useAudioPlayback'

const { t } = useI18n()
const { current, dirty, saving, error, loadList, save, markDirty } = useAudioActivity()
const playback = useAudioPlayback()

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
.bg-gray-850 { background-color: #1a1f2b; }
</style>
