<template>
  <div class="h-full flex flex-col bg-gray-900 text-gray-100">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <span class="text-sm font-semibold text-gray-200">🎮 {{ $t('play.title') }}</span>
      <button
        @click="restart"
        :disabled="status === 'loading'"
        class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
      >{{ $t('play.restart') }}</button>
      <button
        @click="clearSave"
        :disabled="status === 'loading'"
        class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
      >{{ $t('play.clearSave') }}</button>
      <button
        @click="toggleMute"
        class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600"
        :title="muted ? 'Unmute' : 'Mute'"
      >{{ muted ? '🔇' : '🔊' }}</button>
      <span
        class="text-xs"
        :class="status === 'error' ? 'text-red-400' : status === 'running' ? 'text-green-400' : 'text-gray-400'"
      >{{ statusText }}</span>
    </div>

    <!-- Stage -->
    <div class="flex-1 flex flex-col items-center justify-center gap-3 bg-gray-950 overflow-auto p-4">
      <canvas
        v-show="status === 'running'"
        ref="canvasEl"
        :width="WIDTH"
        :height="HEIGHT"
        tabindex="0"
        @blur="clearKeys"
        class="w-[960px] h-[720px] max-w-full bg-black [image-rendering:pixelated] outline-none focus:ring-2 focus:ring-blue-500"
      ></canvas>

      <div v-if="status === 'error'" class="max-w-xl text-center">
        <p class="text-sm text-red-400 whitespace-pre-wrap">{{ errorMessage }}</p>
        <button
          @click="restart"
          class="mt-3 px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500"
        >{{ $t('play.retry') }}</button>
      </div>

      <div v-if="status === 'loading'" class="text-sm text-gray-500">{{ $t('play.loading') }}</div>

      <p class="text-xs text-gray-500 text-center">{{ $t('play.keyHelp') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  loadBundle,
  createRunner,
  keyToBit,
  type WasmRunner,
} from '@/composables/useWasmRunner'
import { createPlayAudio, type PlayAudio } from '@/composables/usePlayAudio'

// TODO(language): the project manifest can declare multiple locales, but the
// WasmRunner contract has no language parameter — once it does, offer an
// en/zh switch here and pass it through when constructing the runner.

const { t } = useI18n()

/** The runner's fixed framebuffer (WasmRunner.width()/height()). */
const WIDTH = 320
const HEIGHT = 240
/** Game Boy frame rate — the runner advances one frame per tick. */
const STEP_MS = 1000 / 59.7275
/** Save persistence cadence (plus on tab-hide and unmount). */
const SAVE_INTERVAL_MS = 2000

type Status = 'loading' | 'running' | 'error'
const status = ref<Status>('loading')
const errorMessage = ref('')
const canvasEl = ref<HTMLCanvasElement | null>(null)

const statusText = computed(() => {
  if (status.value === 'loading') return t('play.loading')
  if (status.value === 'running') return t('play.running')
  return t('play.error')
})

let runner: WasmRunner | null = null
let ctx: CanvasRenderingContext2D | null = null
let bundleFiles: Record<string, string> | null = null
/** localStorage key for the save — per project root (`dotzuki-play-save:<root>`). */
let saveKey = ''

let rafId = 0
let lastTime = 0
let acc = 0
const pressed = new Set<number>()
let saveTimer: number | undefined

// Audio: the graph lives across runner restarts (Restart/Clear save only
// swap the WASM instance); it is created on mount and disposed on unmount.
let audio: PlayAudio | null = null
const muted = ref(false)
/** Whether the current runner pkg has take_audio() (feature-detected per boot). */
let audioSupported = false
let warnedNoAudio = false

function inputMask(): number {
  let mask = 0
  for (const bit of pressed) mask |= bit
  return mask
}

function clearKeys() {
  pressed.clear()
}

/** Don't steal keys while the user types in an input (e.g. the assistant panel). */
function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function onKeyDown(e: KeyboardEvent) {
  const bit = keyToBit(e.key, e.code)
  if (!bit || isTypingTarget()) return
  // Mapped keys never reach the page: no Space scroll, no Backspace history
  // navigation, no Enter re-triggering a focused button.
  e.preventDefault()
  pressed.add(bit)
}

function onKeyUp(e: KeyboardEvent) {
  const bit = keyToBit(e.key, e.code)
  if (!bit) return
  // Always release the bit (avoids stuck keys); only swallow the event when it
  // isn't aimed at a text field.
  if (!isTypingTarget()) e.preventDefault()
  pressed.delete(bit)
}

function frame(now: number) {
  rafId = requestAnimationFrame(frame)
  if (!runner || !ctx) return
  if (!lastTime) lastTime = now
  acc += Math.min(now - lastTime, 250) // cap long tab-switch gaps
  lastTime = now
  const mask = inputMask()
  let bytes: Uint8Array | null = null
  while (acc >= STEP_MS) {
    bytes = runner.tick(mask)
    if (audioSupported && audio) {
      const samples = runner.take_audio!()
      if (samples.length > 0) audio.push(samples)
    }
    acc -= STEP_MS
  }
  if (bytes) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes), WIDTH, HEIGHT), 0, 0)
  }
}

function startLoop() {
  cancelAnimationFrame(rafId)
  lastTime = 0
  acc = 0
  rafId = requestAnimationFrame(frame)
}

function stopLoop() {
  cancelAnimationFrame(rafId)
  rafId = 0
}

function persistSave() {
  if (!runner || !saveKey) return
  try {
    const save = runner.export_save()
    if (save) localStorage.setItem(saveKey, save)
  } catch {
    /* save export is best-effort */
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') persistSave()
}

function destroyRunner() {
  stopLoop()
  if (runner) {
    runner.free()
    runner = null
  }
}

/**
 * (Re)boot the playtest. `refreshBundle` re-fetches /api/play/bundle;
 * `keepSave` restores the localStorage save into the fresh runner.
 */
async function boot(refreshBundle: boolean, keepSave: boolean) {
  destroyRunner()
  clearKeys()
  status.value = 'loading'
  errorMessage.value = ''
  try {
    if (refreshBundle || !bundleFiles) {
      const bundle = await loadBundle()
      bundleFiles = bundle.files
      saveKey = `dotzuki-play-save:${bundle.projectRoot}`
    }
    const save = keepSave && saveKey ? localStorage.getItem(saveKey) : null
    runner = await createRunner(bundleFiles!, save)
    // Older runner pkgs predate take_audio() — skip audio silently (warn once).
    audioSupported = typeof runner.take_audio === 'function'
    if (!audioSupported && !warnedNoAudio) {
      warnedNoAudio = true
      console.warn(
        '[play] WasmRunner.take_audio() is missing — the runner pkg predates ' +
          'audio support; sound is disabled. Rebuild with `pnpm build:wasm-runner`.',
      )
    }
    status.value = 'running'
    await nextTick()
    ctx = canvasEl.value?.getContext('2d') ?? null
    canvasEl.value?.focus()
    startLoop()
  } catch (e) {
    destroyRunner()
    status.value = 'error'
    errorMessage.value = (e as Error).message
  }
}

/** Toolbar: restart — fresh bundle + fresh runner, save restored. */
function restart() {
  void boot(true, true)
}

/** Toolbar: clear save — drop the localStorage save and boot a clean runner. */
function clearSave() {
  if (saveKey) localStorage.removeItem(saveKey)
  void boot(false, false)
}

/** Toolbar: mute toggle — silences output while the queue keeps draining. */
function toggleMute() {
  muted.value = !muted.value
  audio?.setMuted(muted.value)
}

onMounted(() => {
  void boot(true, true)
  audio = createPlayAudio()
  // Dev-only observability for manual/e2e debugging: live audio stats.
  ;(window as unknown as Record<string, unknown>).__playAudio = audio.stats
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', clearKeys)
  document.addEventListener('visibilitychange', onVisibilityChange)
  saveTimer = window.setInterval(persistSave, SAVE_INTERVAL_MS)
})

onBeforeUnmount(() => {
  persistSave()
})

onUnmounted(() => {
  destroyRunner()
  audio?.dispose()
  audio = null
  delete (window as unknown as Record<string, unknown>).__playAudio
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', clearKeys)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (saveTimer !== undefined) window.clearInterval(saveTimer)
})
</script>
