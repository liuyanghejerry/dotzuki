// keyToBit mapping tests — the bitmask contract is fixed by the WASM runner
// (crates/dotzuki-runner-web): bit0=A, bit1=B, bit2=Select, bit3=Start,
// bit4=Right, bit5=Left, bit6=Up, bit7=Down.
import { describe, expect, it } from 'vitest'
import {
  keyToBit,
  BIT_A,
  BIT_B,
  BIT_SELECT,
  BIT_START,
  BIT_RIGHT,
  BIT_LEFT,
  BIT_UP,
  BIT_DOWN,
} from './useWasmRunner'

describe('keyToBit', () => {
  it('maps arrow keys by `key` (layout-independent)', () => {
    expect(keyToBit('ArrowUp', 'ArrowUp')).toBe(BIT_UP)
    expect(keyToBit('ArrowDown', 'ArrowDown')).toBe(BIT_DOWN)
    expect(keyToBit('ArrowLeft', 'ArrowLeft')).toBe(BIT_LEFT)
    expect(keyToBit('ArrowRight', 'ArrowRight')).toBe(BIT_RIGHT)
  })

  it('maps WASD by `code` so IME / CapsLock / Shift cannot break it', () => {
    // key would be 'w', 'W', or an IME-composed character — code stays 'KeyW'.
    expect(keyToBit('w', 'KeyW')).toBe(BIT_UP)
    expect(keyToBit('W', 'KeyW')).toBe(BIT_UP)
    expect(keyToBit('我', 'KeyW')).toBe(BIT_UP)
    expect(keyToBit('a', 'KeyA')).toBe(BIT_LEFT)
    expect(keyToBit('s', 'KeyS')).toBe(BIT_DOWN)
    expect(keyToBit('d', 'KeyD')).toBe(BIT_RIGHT)
  })

  it('maps Z/X to A/B by `code`', () => {
    expect(keyToBit('z', 'KeyZ')).toBe(BIT_A)
    expect(keyToBit('Z', 'KeyZ')).toBe(BIT_A)
    expect(keyToBit('x', 'KeyX')).toBe(BIT_B)
  })

  it('maps Enter/Space to Start', () => {
    expect(keyToBit('Enter', 'Enter')).toBe(BIT_START)
    expect(keyToBit(' ', 'Space')).toBe(BIT_START)
    // Some platforms report a non-' ' key for space — the code still catches it.
    expect(keyToBit('Spacebar', 'Space')).toBe(BIT_START)
  })

  it('maps Backspace/Right Shift to Select', () => {
    expect(keyToBit('Backspace', 'Backspace')).toBe(BIT_SELECT)
    expect(keyToBit('Shift', 'ShiftRight')).toBe(BIT_SELECT)
  })

  it('returns 0 for unmapped keys', () => {
    expect(keyToBit('q', 'KeyQ')).toBe(0)
    expect(keyToBit('Escape', 'Escape')).toBe(0)
    expect(keyToBit('Shift', 'ShiftLeft')).toBe(0)
    expect(keyToBit('F5', 'F5')).toBe(0)
  })

  it('keeps the documented bit values stable', () => {
    expect([BIT_A, BIT_B, BIT_SELECT, BIT_START, BIT_RIGHT, BIT_LEFT, BIT_UP, BIT_DOWN])
      .toEqual([1, 2, 4, 8, 16, 32, 64, 128])
  })
})
