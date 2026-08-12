// usePlayAudio tests — node env has no WebAudio, so the queue and resampler
// are tested as pure logic, and the graph wiring is tested against a stubbed
// window.AudioContext (autoplay resume, mute semantics, dispose).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AudioSampleQueue,
  createPlayAudio,
  resampleLinear,
  MAX_QUEUE_FRAMES,
} from './usePlayAudio'

/** Interleaved stereo chunk from per-frame [L, R] pairs. */
function stereo(...pairs: [number, number][]): Float32Array {
  const out = new Float32Array(pairs.length * 2)
  pairs.forEach(([l, r], i) => {
    out[i * 2] = l
    out[i * 2 + 1] = r
  })
  return out
}

describe('AudioSampleQueue', () => {
  it('drains FIFO across chunk boundaries', () => {
    const q = new AudioSampleQueue()
    q.push(stereo([1, 10], [2, 20]))
    q.push(stereo([3, 30]))
    const { data, consumed } = q.drain(5)
    expect(consumed).toBe(3)
    expect(Array.from(data.slice(0, 6))).toEqual([1, 10, 2, 20, 3, 30])
    // Requested 5 frames, only 3 available — the tail is silence.
    expect(Array.from(data.slice(6))).toEqual([0, 0, 0, 0])
    expect(q.frames).toBe(0)
  })

  it('partially consumes a chunk and resumes from the offset', () => {
    const q = new AudioSampleQueue()
    q.push(stereo([1, 1], [2, 2], [3, 3]))
    expect(q.drain(2).consumed).toBe(2)
    const { data, consumed } = q.drain(2)
    expect(consumed).toBe(1)
    expect(Array.from(data.slice(0, 2))).toEqual([3, 3])
  })

  it('drops the oldest frames (whole chunks) when over the cap', () => {
    const q = new AudioSampleQueue(4) // 4 frames
    q.push(stereo([1, 1], [2, 2], [3, 3]))
    const dropped = q.push(stereo([4, 4], [5, 5], [6, 6]))
    expect(dropped).toBe(2)
    expect(q.frames).toBe(4)
    const { data } = q.drain(4)
    expect(Array.from(data)).toEqual([3, 3, 4, 4, 5, 5, 6, 6])
  })

  it('drops the oldest frames mid-chunk when over the cap', () => {
    const q = new AudioSampleQueue(3)
    q.push(stereo([1, 1], [2, 2]))
    const dropped = q.push(stereo([3, 3], [4, 4], [5, 5]))
    expect(dropped).toBe(2)
    expect(q.frames).toBe(3)
    const { data } = q.drain(3)
    expect(Array.from(data)).toEqual([3, 3, 4, 4, 5, 5])
  })

  it('returns 0 for empty pushes and does not disturb the queue', () => {
    const q = new AudioSampleQueue()
    expect(q.push(new Float32Array(0))).toBe(0)
    expect(q.frames).toBe(0)
  })

  it('clear() empties the queue', () => {
    const q = new AudioSampleQueue()
    q.push(stereo([1, 1]))
    q.clear()
    expect(q.frames).toBe(0)
    expect(q.drain(1).consumed).toBe(0)
  })
})

describe('resampleLinear', () => {
  it('preserves the rate ratio (44100 → 48000)', () => {
    const input = new Float32Array(441 * 2)
    const out = resampleLinear(input, 44100, 48000)
    expect(out.length / 2).toBe(480)
  })

  it('maps the first and last input samples onto the output endpoints', () => {
    const input = stereo([0, 1], [0.5, 0.5], [1, 0])
    const out = resampleLinear(input, 44100, 48000)
    expect(out[0]).toBeCloseTo(0)
    expect(out[1]).toBeCloseTo(1)
    expect(out[out.length - 2]).toBeCloseTo(1)
    expect(out[out.length - 1]).toBeCloseTo(0)
  })

  it('interpolates linearly between frames', () => {
    // 2 → 3 frames: endpoints exact, midpoint halfway between the two inputs.
    const out = resampleLinear(stereo([0, 0], [1, 1]), 2, 3)
    expect(Array.from(out)).toEqual([0, 0, 0.5, 0.5, 1, 1])
  })

  it('handles empty and single-frame input', () => {
    expect(resampleLinear(new Float32Array(0), 44100, 48000).length).toBe(0)
    const out = resampleLinear(stereo([0.25, -0.25]), 44100, 48000)
    expect(out[0]).toBeCloseTo(0.25)
    expect(out[1]).toBeCloseTo(-0.25)
  })
})

// ── Graph wiring (stubbed WebAudio) ────────────────────────────────────────

interface StubNode {
  onaudioprocess: ((e: { outputBuffer: { length: number; getChannelData(c: number): Float32Array } }) => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

class StubAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  resumeCalls = 0
  node: StubNode | null = null
  constructor(public opts?: { sampleRate?: number }) {}
  get sampleRate(): number {
    return this.opts?.sampleRate ?? 44100
  }
  resume(): Promise<void> {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }
  createScriptProcessor(_size: number, _in: number, _out: number): StubNode {
    this.node = { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() }
    return this.node
  }
  get destination(): object {
    return {}
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
}

interface StubWindow {
  AudioContext: typeof StubAudioContext
  /** Every constructed context, in order. */
  contexts: StubAudioContext[]
  /** Device sample rate the stub context reports (44100 = honors the request). */
  deviceRate: number
  listeners: Map<string, Set<EventListenerOrEventListenerObject>>
  addEventListener(type: string, fn: EventListenerOrEventListenerObject): void
  removeEventListener(type: string, fn: EventListenerOrEventListenerObject): void
  dispatch(type: string): void
}

function stubWindow(deviceRate = 44100): StubWindow {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const contexts: StubAudioContext[] = []
  const win: StubWindow = {
    AudioContext: class extends StubAudioContext {
      constructor(opts?: { sampleRate?: number }) {
        super(opts)
        // Simulate a browser that ignores the requested sampleRate.
        this.opts = { sampleRate: deviceRate }
        contexts.push(this)
      }
    },
    contexts,
    deviceRate,
    listeners,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatch: (type) => listeners.get(type)?.forEach((fn) => (fn as EventListener)(new Event(type))),
  }
  vi.stubGlobal('window', win)
  return win
}

/** Drive one audio callback with a zero-filled output buffer. */
function renderBlock(node: StubNode, frames: number): [Float32Array, Float32Array] {
  const l = new Float32Array(frames)
  const r = new Float32Array(frames)
  node.onaudioprocess!({
    outputBuffer: { length: frames, getChannelData: (c) => (c === 0 ? l : r) },
  })
  return [l, r]
}

describe('createPlayAudio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('constructs the context suspended and registers capture-phase gestures', () => {
    const win = stubWindow()
    const audio = createPlayAudio()
    expect(win.contexts[0].state).toBe('suspended')
    expect(win.listeners.get('pointerdown')?.size).toBe(1)
    expect(win.listeners.get('keydown')?.size).toBe(1)
    audio.dispose()
  })

  it('resumes the suspended context on the first gesture only', () => {
    const win = stubWindow()
    const audio = createPlayAudio()
    const ctx = win.contexts[0]
    win.dispatch('pointerdown')
    expect(ctx.state).toBe('running')
    expect(ctx.resumeCalls).toBe(1)
    // Once running, further gestures are no-ops (no redundant resume calls).
    win.dispatch('keydown')
    expect(ctx.resumeCalls).toBe(1)
    audio.dispose()
  })

  it('plays queued samples and counts stats', () => {
    const win = stubWindow()
    const audio = createPlayAudio()
    audio.push(stereo([0.5, -0.5], [1, -1]))
    expect(audio.stats.samplesPushed).toBe(2)
    const [l, r] = renderBlock(win.contexts[0].node!, 4)
    expect(Array.from(l)).toEqual([0.5, 1, 0, 0])
    expect(Array.from(r)).toEqual([-0.5, -1, 0, 0])
    expect(audio.stats.samplesPlayed).toBe(2) // silence padding not counted
    audio.dispose()
  })

  it('muted output is silent but the queue keeps draining', () => {
    const win = stubWindow()
    const audio = createPlayAudio()
    audio.setMuted(true)
    expect(audio.muted.value).toBe(true)
    audio.push(stereo([0.5, -0.5], [1, -1]))
    const [l] = renderBlock(win.contexts[0].node!, 2)
    expect(Array.from(l)).toEqual([0, 0])
    expect(audio.stats.samplesPlayed).toBe(2) // consumed despite the mute
    audio.setMuted(false)
    audio.push(stereo([0.25, 0.25]))
    const [l2] = renderBlock(win.contexts[0].node!, 1)
    expect(Array.from(l2)).toEqual([0.25])
    audio.dispose()
  })

  it('resamples when the context ignores the requested 44100 Hz', () => {
    const win = stubWindow(48000)
    const audio = createPlayAudio()
    expect(win.contexts[0].sampleRate).toBe(48000)
    // 441 source frames ≈ 480 output frames of constant signal.
    audio.push(new Float32Array(441 * 2).fill(0.5))
    const [l] = renderBlock(win.contexts[0].node!, 480)
    expect(l[0]).toBeCloseTo(0.5)
    expect(l[479]).toBeCloseTo(0.5)
    expect(audio.stats.samplesPlayed).toBeGreaterThan(400)
    audio.dispose()
  })

  it('dispose removes gesture listeners, disconnects and closes', () => {
    const win = stubWindow()
    const audio = createPlayAudio()
    audio.dispose()
    expect(win.listeners.get('pointerdown')?.size ?? 0).toBe(0)
    expect(win.listeners.get('keydown')?.size ?? 0).toBe(0)
    expect(win.contexts[0].node!.disconnect).toHaveBeenCalledOnce()
    expect(win.contexts[0].state).toBe('closed')
  })

  it('exposes a sane default queue cap (~0.5s at the source rate)', () => {
    expect(MAX_QUEUE_FRAMES).toBe(22050)
  })
})
