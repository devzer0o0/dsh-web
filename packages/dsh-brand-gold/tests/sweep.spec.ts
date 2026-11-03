/**
 * Sweep timing: the period is start-to-start, the sweep is a window inside it,
 * and the rest of the period runs no frame at all.
 */
import { describe, expect, it } from 'vitest'
import { SWEEP_PARAMS, nextSweepStartAt, sweepProgressAt } from '../src/client/sweep.ts'
import { sweepEnvelope } from '../src/client/overlay.ts'

describe('sweep timing', () => {
  it('operator sees a beam every 5s, measured from one start to the next', () => {
    // Given: the shipped tunables and a sweep that started at t = 5000.
    const origin = 5000
    // When: the sweep windows are read across three periods.
    const starts = [0, 1, 2, 3].map((period) => origin + period * SWEEP_PARAMS.periodMs)
    // Then: each start is exactly one period after the previous one, and the
    // first one waits the configured delay after the resources are ready.
    expect(starts[1]! - starts[0]!).toBe(5000)
    expect(starts[2]! - starts[1]!).toBe(5000)
    expect(SWEEP_PARAMS.firstDelayMs).toBe(5000)
    // A sweep never becomes "play 1200ms, then wait 5000ms".
    expect(SWEEP_PARAMS.periodMs - SWEEP_PARAMS.sweepMs).toBe(3800)
  })

  it('operator sees the beam move only inside its 1200ms window', () => {
    // Given: the shipped tunables.
    const { periodMs, sweepMs } = SWEEP_PARAMS
    const origin = 0
    // When: progress is sampled inside, at the edge of, and after a window.
    // Then: only the window reports progress, and it maps linearly to 0..1.
    expect(sweepProgressAt(0, origin)).toBe(0)
    expect(sweepProgressAt(sweepMs / 2, origin)).toBeCloseTo(0.5, 5)
    expect(sweepProgressAt(sweepMs - 1, origin)).toBeCloseTo(1, 2)
    expect(sweepProgressAt(sweepMs, origin)).toBeNull()
    expect(sweepProgressAt(periodMs - 1, origin)).toBeNull()
    expect(sweepProgressAt(periodMs, origin)).toBe(0)
  })

  it('operator never sees a sweep replayed after the tab was throttled', () => {
    // Given: a clock far past the first window.
    const origin = 1000
    // When: the next start is computed from a late reading.
    const late = origin + SWEEP_PARAMS.periodMs * 3 + SWEEP_PARAMS.sweepMs + 500
    // Then: the next start is the following period, never the missed one.
    expect(nextSweepStartAt(late, origin)).toBe(origin + SWEEP_PARAMS.periodMs * 4)
    expect(nextSweepStartAt(origin, origin)).toBe(origin + SWEEP_PARAMS.periodMs)
    expect(nextSweepStartAt(origin - 200, origin)).toBe(origin)
  })

  it('operator sees the beam fade in and out instead of popping at the edges', () => {
    // Given: the sweep envelope.
    // When: it is sampled at the entry, the middle and the exit of the window.
    // Then: it starts and ends at zero and stays at full amplitude in between,
    // so the light does not appear or vanish in one frame.
    expect(sweepEnvelope(0)).toBe(0)
    expect(sweepEnvelope(1)).toBeCloseTo(0, 5)
    expect(sweepEnvelope(0.5)).toBe(1)
    expect(sweepEnvelope(0.02)).toBeGreaterThan(0)
    expect(sweepEnvelope(0.02)).toBeLessThan(0.2)
    expect(sweepEnvelope(0.98)).toBeLessThan(0.2)
  })
})
