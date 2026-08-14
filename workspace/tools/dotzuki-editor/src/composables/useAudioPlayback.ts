import { ref } from 'vue'

// Plays a file-based audio track by rendering it with the *real* engine
// (`dotzuki-web`'s `render_audio_pcm`, backed by the dotzuki-audio APU/sequencer) to
// PCM, then feeding it through WebAudio. What you hear in the editor is exactly
// what the game plays — no reimplementation.

interface AudioWasm {
  default(): Promise<unknown>
  render_audio_pcm(track_json: string, max_seconds: number): Uint8Array
  // Only present when the wasm build was compiled with `modern-audio`
  // (dotzuki-web's `modern-audio` feature).
  render_file_audio?(bytes: Uint8Array, ext_hint: string, max_seconds: number): Uint8Array
  audio_sample_rate(): number
}

// Shared across all callers: one wasm module + one AudioContext + one active
// source (so starting a new preview stops the previous one).
let wasm: AudioWasm | null = null
let initPromise: Promise<AudioWasm> | null = null
let audioCtx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null

function ensureWasm(): Promise<AudioWasm> {
  if (wasm) return Promise.resolve(wasm)
  if (!initPromise) {
    initPromise = (async () => {
      // Runtime URL so Vite doesn't pre-resolve it — the request must reach the
      // `/wasm` middleware (same package the layout preview loads).
      const url = new URL('/wasm/dotzuki_web.js', window.location.origin).href
      const mod = (await import(/* @vite-ignore */ url)) as unknown as AudioWasm
      await mod.default()
      wasm = mod
      return mod
    })()
  }
  return initPromise
}

function context(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = new Ctor()
  }
  return audioCtx
}

export function useAudioPlayback() {
  const playing = ref(false)
  const rendering = ref(false)
  const error = ref<string | null>(null)

  function stop() {
    if (currentSource) {
      try {
        currentSource.onended = null
        currentSource.stop()
      } catch {
        /* already stopped */
      }
      currentSource.disconnect()
      currentSource = null
    }
    playing.value = false
  }

  /**
   * Render `track` (a plain TrackDef object) and play it. `maxSeconds` caps
   * looping music. Any in-flight preview is stopped first.
   */
  async function play(track: unknown, maxSeconds = 10): Promise<void> {
    error.value = null
    stop()
    rendering.value = true
    try {
      const w = await ensureWasm()
      const bytes = w.render_audio_pcm(JSON.stringify(track), maxSeconds)
      if (!bytes || bytes.length < 8) {
        error.value = 'Nothing to play — the track produced no audio.'
        return
      }
      await playPcm(bytes, w.audio_sample_rate())
    } catch (e) {
      error.value = `Playback failed: ${(e as Error).message}`
    } finally {
      rendering.value = false
    }
  }

  /**
   * Render a real audio file (WAV / OGG / FLAC / MP3 bytes) with the *same*
   * engine path (`render_file_audio`) and play it — what the editor previews
   * is exactly what the game plays. Requires a wasm build with the
   * `modern-audio` feature; otherwise a clear error is surfaced instead.
   */
  async function playFile(bytes: Uint8Array, extHint: string, maxSeconds = 10): Promise<void> {
    error.value = null
    stop()
    rendering.value = true
    try {
      const w = await ensureWasm()
      if (typeof w.render_file_audio !== 'function') {
        error.value = 'File audio is unavailable — the engine wasm build lacks the modern-audio feature.'
        return
      }
      const out = w.render_file_audio(bytes, extHint, maxSeconds)
      if (!out || out.length < 8) {
        error.value = 'Nothing to play — the file produced no audio.'
        return
      }
      await playPcm(out, w.audio_sample_rate())
    } catch (e) {
      error.value = `Playback failed: ${(e as Error).message}`
    } finally {
      rendering.value = false
    }
  }

  /** Feed raw interleaved f32 PCM bytes to the shared WebAudio source. */
  async function playPcm(bytes: Uint8Array, rate: number): Promise<void> {
    // Copy to a fresh, 4-aligned buffer before viewing as f32.
    const f32 = new Float32Array(bytes.slice().buffer)
    const frames = Math.floor(f32.length / 2)

    const ac = context()
    if (ac.state === 'suspended') await ac.resume()

    const buffer = ac.createBuffer(2, frames, rate)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    for (let i = 0; i < frames; i++) {
      left[i] = f32[i * 2]
      right[i] = f32[i * 2 + 1]
    }

    const source = ac.createBufferSource()
    source.buffer = buffer
    source.connect(ac.destination)
    source.onended = () => {
      if (currentSource === source) {
        currentSource = null
        playing.value = false
      }
    }
    source.start()
    currentSource = source
    playing.value = true
  }

  return { playing, rendering, error, play, playFile, stop }
}
