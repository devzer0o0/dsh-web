/**
 * Sweep timing: the period is start-to-start, the sweep is a window inside it,
 * and the rest of the period runs no frame at all.
 */
import { describe, expect, it } from 'vitest'
import { SWEEP_PARAMS, nextSweepStartAt, sweepProgressAt } from '../src/client/sweep.ts'
import { beamCenterAt, crossingMs, sweepEnvelope } from '../src/client/overlay.ts'
import { buildLayout } from '../src/client/layout.ts'

describe('sweep timing', () => {
  it('operator sees a sweep every 5s, measured from one start to the next', () => {
    // Given: the shipped tunables and a sweep that started at t = 5000.
    const origin = 5000
    // When: four consecutive starts are read.
    const starts = [0, 1, 2, 3].map((period) => origin + period * SWEEP_PARAMS.periodMs)
    // Then: each start is exactly one period after the previous one, the window
    // is 3600 ms and the lockup rests for the remaining 1400 ms.
    expect(starts[1]! - starts[0]!).toBe(5000)
    expect(starts[2]! - starts[1]!).toBe(5000)
    expect(SWEEP_PARAMS.periodMs).toBe(5000)
    expect(SWEEP_PARAMS.sweepMs).toBe(3600)
    expect(SWEEP_PARAMS.periodMs - SWEEP_PARAMS.sweepMs).toBe(1400)
    expect(SWEEP_PARAMS.firstDelayMs).toBe(5000)
  })

  it('operator never sees one window overlap the next', () => {
    // Given: the shipped window and period.
    // When: the end of a window is compared with the next start.
    // Then: there is a real gap, so two sweeps can never be on screen together.
    expect(SWEEP_PARAMS.sweepMs).toBeLessThan(SWEEP_PARAMS.periodMs)
    expect(SWEEP_PARAMS.fadeInRatio + SWEEP_PARAMS.fadeOutRatio).toBeLessThan(1)
  })

  it('operator sees the beam move only inside its window', () => {
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

  it('operator sees the band fade in and out instead of popping at the edges', () => {
    // Given: the sweep envelope.
    // When: it is sampled at the entry, the middle and the exit of the window.
    // Then: it starts and ends at zero and reaches full amplitude in between.
    expect(sweepEnvelope(0)).toBe(0)
    expect(sweepEnvelope(1)).toBeCloseTo(0, 5)
    expect(sweepEnvelope(0.5)).toBe(1)
    expect(sweepEnvelope(0.02)).toBeGreaterThan(0)
    expect(sweepEnvelope(0.02)).toBeLessThan(0.2)
    expect(sweepEnvelope(0.98)).toBeLessThan(0.2)
  })

  it('operator sees the band enter and leave over a known share of the window', () => {
    // Given: the shipped fade shares.
    const sweepMs = SWEEP_PARAMS.sweepMs
    // When: the envelope reaches full amplitude and starts to fall again.
    // Then: the ramps are a measurable duration, not a single frame.
    const fadeInMs = SWEEP_PARAMS.fadeInRatio * sweepMs
    const fadeOutMs = SWEEP_PARAMS.fadeOutRatio * sweepMs
    expect(fadeInMs).toBeGreaterThan(400)
    expect(fadeOutMs).toBeGreaterThan(400)
    expect(sweepEnvelope(SWEEP_PARAMS.fadeInRatio)).toBeCloseTo(1, 2)
    expect(sweepEnvelope(1 - SWEEP_PARAMS.fadeOutRatio)).toBeCloseTo(1, 2)
  })

  it('operator sees the band travel one way, never back and forth', () => {
    // Given: the layout and the beam centre at ordered progress values.
    const layout = buildLayout(
      new Map([
        ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
        ['name', { left: 48, top: 54, width: 156, height: 24 }],
      ]),
      new Map([
        ['mark', '0 0 23.16 17.04'],
        ['name', '26 0 156 24'],
      ]),
      2,
    )!
    // When: the centre is sampled across the window.
    const samples = [0, 0.25, 0.5, 0.75, 1].map((p) => beamCenterAt(layout.startX, layout.endX, p))
    // Then: it increases monotonically, so the light only moves left to right.
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!).toBeGreaterThan(samples[index - 1]!)
    }
  })

  it('operator sees the centre cross the lockup slowly enough', () => {
    // Given: the full lockup at 1x and at 2x.
    for (const dpr of [1, 2, 3]) {
      const layout = buildLayout(
        new Map([
          ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
          ['name', { left: 48, top: 54, width: 156, height: 24 }],
        ]),
        new Map([
          ['mark', '0 0 23.16 17.04'],
          ['name', '26 0 156 24'],
        ]),
        dpr,
      )!
      // When: the time between centre-left and centre-right is computed.
      const crossing = crossingMs(layout, SWEEP_PARAMS.sweepMs)
      // Then: it is at least 2600 ms, whatever the device pixel ratio.
      expect(crossing).toBeGreaterThanOrEqual(2600)
      expect(crossing).toBeLessThan(SWEEP_PARAMS.sweepMs)
    }
  })
})
