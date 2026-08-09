// ───────────────────────────────────────────────────────────────────────────
// WebAudio playback for the Play activity.
//
// Source contract (crates/dotzuki-runner-web): WasmRunner.take_audio() returns
// interleaved stereo f32 (LRLR…) at a fixed 44100 Hz and drains the runner's
// internal buffer on every call — roughly 738 frames per tick, empty while
// the game is silent. This module owns everything between those samples and
// the speakers: the sample queue, the playback graph, autoplay-policy
// handling and mute.
// ───────────────────────────────────────────────────────────────────────────
import { ref, type Ref } from 'vue'

/** Sample rate of the take_audio() stream (fixed by the WASM contract). */
export const SOURCE_SAMPLE_RATE = 44100
/** Queue cap — about 0.5s of stereo audio at the source rate. */
export const MAX_QUEUE_FRAMES = 22050

/**
 * FIFO queue of interleaved-stereo f32 chunks with a frame cap.
 *
 * The rAF clock (which pushes) and the audio clock (which drains) drift
 * against each other, so the queue absorbs the jitter; when the backlog
 * exceeds `maxFrames` the *oldest* frames are dropped — for a live playtest,
 * staying in sync matters more than not skipping.
 */
export class AudioSampleQueue {
  private chunks: Float32Array[] = []
  /** Read offset into chunks[0], in samples (2 per frame). */
  private headSamples = 0
  private frameCount = 0

  constructor(readonly maxFrames: number = MAX_QUEUE_FRAMES) {}

  get frames(): number {
    return this.frameCount
  }

  /** Append a chunk; returns how many old frames were dropped to fit the cap. */
  push(samples: Float32Array): number {
    if (samples.length === 0) return 0
    this.chunks.push(samples)
    this.frameCount += samples.length / 2
    let dropped = 0
    while (this.frameCount > this.maxFrames) {
      const excessSamples = (this.frameCount - this.maxFrames) * 2
      const firstAvailable = this.chunks[0].length - this.headSamples
      if (excessSamples >= firstAvailable) {
        this.chunks.shift()
        this.headSamples = 0
        this.frameCount -= firstAvailable / 2
        dropped += firstAvailable / 2
      } else {
        this.headSamples += excessSamples
        this.frameCount -= excessSamples / 2
        dropped += excessSamples / 2
      }
    }
    return dropped
  }

  /**
   * Consume up to `frames` frames from the front. Always returns a buffer of
   * `frames * 2` samples — zero-padded when the queue runs dry — plus how
   * many frames were real (consumed) rather than silence.
   */
  drain(frames: number): { data: Float32Array; consumed: number } {
    const out = new Float32Array(frames * 2)
    const target = frames * 2
    let written = 0
    while (written < target && this.chunks.length > 0) {
      const first = this.chunks[0]
      const n = Math.min(first.length - this.headSamples, target - written)
      out.set(first.subarray(this.headSamples, this.headSamples + n), written)
      written += n
      this.headSamples += n
      if (this.headSamples >= first.length) {
        this.chunks.shift()
        this.headSamples = 0
      }
    }
    this.frameCount -= written / 2
    return { data: out, consumed: written / 2 }
  }

  clear(): void {
    this.chunks = []
    this.headSamples = 0
    this.frameCount = 0
  }
}

/** Core of resampleLinear, parameterized in raw frame counts. */
function resampleFrames(input: Float32Array, inFrames: number, outFrames: number): Float32Array {
  const out = new Float32Array(outFrames * 2)
  if (inFrames === 0 || outFrames === 0) return out
  if (inFrames === 1 || outFrames === 1) {
    for (let j = 0; j < outFrames; j++) {
      out[j * 2] = input[0]
      out[j * 2 + 1] = input[1]
    }
    return out
  }
  // Endpoint-preserving mapping: output j reads input position j * step, so
  // the first and last input samples land exactly on the output endpoints.
  const step = (inFrames - 1) / (outFrames - 1)
  for (let j = 0; j < outFrames; j++) {
    const p = j * step
    const i = Math.min(Math.floor(p), inFrames - 2)
    const f = p - i
    out[j * 2] = input[i * 2] + (input[(i + 1) * 2] - input[i * 2]) * f
    out[j * 2 + 1] = input[i * 2 + 1] + (input[(i + 1) * 2 + 1] - input[i * 2 + 1]) * f
  }
  return out
}

/**
 * Linear-interpolation resampler for interleaved stereo. Good enough for
 * game audio and dependency-free; the output length preserves the rate
 * ratio (`round(frames * toRate / fromRate)` frames).
 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const inFrames = input.length / 2
  if (inFrames === 0) return new Float32Array(0)
  const outFrames = Math.max(1, Math.round((inFrames * toRate) / fromRate))
  return resampleFrames(input, inFrames, outFrames)
}

export interface PlayAudioStats {
  /** Frames (stereo sample pairs) accepted via push(), incl. later-dropped ones. */
  samplesPushed: number
  /** Frames actually consumed from the queue by the audio clock (excl. silence padding). */
  samplesPlayed: number
}

export interface PlayAudio {
  push(samples: Float32Array): void
  setMuted(m: boolean): void
  muted: Ref<boolean>
  dispose(): void
  stats: PlayAudioStats
}

/**
 * Build the WebAudio graph for playtest audio.
 *
 * Autoplay policy: the AudioContext is constructed eagerly but stays
 * suspended until a user gesture; construction is cheap and some browsers
 * only honor resume() when it runs synchronously inside the gesture handler,
 * so deferring construction to the first gesture would be the fragile
 * option. pointerdown/keydown are captured (once: false) so a failed resume
 * is retried on the next gesture.
 *
 * ScriptProcessorNode rather than AudioWorklet: the dev server sends no
 * COOP/COEP headers, so crossOriginIsolated is false, SharedArrayBuffer is
 * unavailable and a worklet couldn't share a ring buffer with this thread.
 * ScriptProcessor is deprecated but works in every browser; the upgrade path
 * is an AudioWorklet + SAB ring buffer once the server is cross-origin
 * isolated.
 */
export function createPlayAudio(): PlayAudio {
  const ctx = new window.AudioContext({ sampleRate: SOURCE_SAMPLE_RATE })
  const queue = new AudioSampleQueue()
  const muted = ref(false)
  const stats: PlayAudioStats = { samplesPushed: 0, samplesPlayed: 0 }

  // Browsers may ignore the requested sampleRate (e.g. locked to the output
  // device at 48 kHz) — resample on drain when that happens.
  const outRate = ctx.sampleRate
  const needsResample = outRate !== SOURCE_SAMPLE_RATE
  /** Fractional input frames owed to the output clock (drift accumulator). */
  let inDebt = 0

  const node = ctx.createScriptProcessor(4096, 0, 2)
  node.onaudioprocess = (e) => {
    const outL = e.outputBuffer.getChannelData(0)
    const outR = e.outputBuffer.getChannelData(1)
    const outFrames = outL.length
    let data: Float32Array
    if (!needsResample) {
      const drained = queue.drain(outFrames)
      stats.samplesPlayed += drained.consumed
      data = drained.data
    } else {
      inDebt += (outFrames * SOURCE_SAMPLE_RATE) / outRate
      const inFrames = Math.floor(inDebt)
      inDebt -= inFrames
      const drained = queue.drain(inFrames)
      stats.samplesPlayed += drained.consumed
      data = resampleFrames(drained.data, inFrames, outFrames)
    }
    // Muted: write silence but keep the drain above — a long mute must not
    // build up a backlog that bursts out on unmute.
    if (muted.value) {
      outL.fill(0)
      outR.fill(0)
      return
    }
    for (let i = 0; i < outFrames; i++) {
      outL[i] = data[i * 2]
      outR[i] = data[i * 2 + 1]
    }
  }
  node.connect(ctx.destination)

  const onGesture = () => {
    if (ctx.state === 'suspended') void ctx.resume()
  }
  window.addEventListener('pointerdown', onGesture, { capture: true })
  window.addEventListener('keydown', onGesture, { capture: true })

  return {
    push(samples: Float32Array) {
      if (samples.length === 0) return
      stats.samplesPushed += samples.length / 2
      queue.push(samples)
    },
    setMuted(m: boolean) {
      muted.value = m
    },
    muted,
    dispose() {
      window.removeEventListener('pointerdown', onGesture, { capture: true })
      window.removeEventListener('keydown', onGesture, { capture: true })
      node.onaudioprocess = null
      node.disconnect()
      void ctx.close()
    },
    stats,
  }
}
