/**
 * Sweep timing: the period is start-to-start on an absolute grid, the motion is
 * 2700 ms inside a 5000 ms period, and the rest of the period runs no frame.
 */
import { describe, expect, it } from 'vitest'
import {
  SWEEP_PARAMS,
  cycleStartAt,
  idleMs,
  joinableCycleStart,
  nextSweepStartAt,
  sweepProgressAt,
  validateSweepParams,
  type SweepParams,
} from '../src/client/sweep.ts'
import { beamCenterAt, centerAtElapsed, crossingMs, sweepEnvelope, sweepWarp } from '../src/client/overlay.ts'
import { buildLayout } from '../src/client/layout.ts'
import { envelopeAt, sampleTrajectory, trajectoryOf, warpAt } from '../src/client/trajectory.ts'

/** The shipped lockup: whale plus wordmark, at the sidebar's own sizes. */
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

describe('sweep cadence', () => {
  it('operator sees a sweep start every five seconds, not every eight', () => {
    // Given: the shipped tunables.
    // When: five consecutive starts on the grid are read.
    const origin = SWEEP_PARAMS.firstDelayMs
    const starts = [0, 1, 2, 3, 4].map((cycle) => origin + cycle * SWEEP_PARAMS.periodMs)
    // Then: adjacent starts are exactly one period apart, and the window plus
    // the rest fills that period without a gap or an overlap.
    expect(SWEEP_PARAMS.periodMs).toBe(5000)
    expect(SWEEP_PARAMS.firstDelayMs).toBe(SWEEP_PARAMS.periodMs)
    expect(SWEEP_PARAMS.sweepMs).toBe(2700)
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]! - starts[index - 1]!).toBe(SWEEP_PARAMS.periodMs)
    }
    // The motion inside the period is unchanged; only the rest between sweeps
    // grew, so the sweep itself is not slowed down or speeded up.
    expect(idleMs(SWEEP_PARAMS)).toBe(SWEEP_PARAMS.periodMs - SWEEP_PARAMS.sweepMs)
    expect(SWEEP_PARAMS.sweepMs + idleMs(SWEEP_PARAMS)).toBe(SWEEP_PARAMS.periodMs)
  })

  it('operator sees the three stages add up to the window', () => {
    // Given: the stage dials.
    // When: their sum is compared with the window.
    // Then: entry, body and exit exactly fill it, so no stage silently moves the
    // cadence.
    expect(SWEEP_PARAMS.entryMs).toBe(250)
    expect(SWEEP_PARAMS.surfaceMs).toBe(2200)
    expect(SWEEP_PARAMS.exitMs).toBe(250)
    expect(SWEEP_PARAMS.entryMs + SWEEP_PARAMS.surfaceMs + SWEEP_PARAMS.exitMs).toBe(SWEEP_PARAMS.sweepMs)
  })

  it('operator never gets two sweeps on screen at once', () => {
    // Given: the shipped window and period.
    // When: the end of a window is compared with the start of the next one.
    // Then: the window closes before the next one opens.
    expect(SWEEP_PARAMS.sweepMs).toBeLessThan(SWEEP_PARAMS.periodMs)
  })

  it('operator gets an invalid cadence rejected instead of played', () => {
    // Given: dial sets that cannot schedule a sweep.
    const overlap: SweepParams = { ...SWEEP_PARAMS, sweepMs: SWEEP_PARAMS.periodMs }
    const mismatched: SweepParams = { ...SWEEP_PARAMS, exitMs: 500 }
    const zeroStage: SweepParams = { ...SWEEP_PARAMS, surfaceMs: 0 }
    // When: they are validated.
    // Then: each one throws, so a bad profile cannot make the animation lie.
    expect(() => validateSweepParams(overlap)).toThrow(/sweepMs must be shorter/)
    expect(() => validateSweepParams(mismatched)).toThrow(/must equal sweepMs/)
    expect(() => validateSweepParams(zeroStage)).toThrow(/surfaceMs/)
    expect(() => validateSweepParams(SWEEP_PARAMS)).not.toThrow()
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

  it('operator never sees a missed cycle replayed after the tab wakes up', () => {
    // Given: a clock far past the first window.
    const origin = 1000
    // When: the next start is computed from a late reading.
    const late = origin + SWEEP_PARAMS.periodMs * 3 + SWEEP_PARAMS.sweepMs + 300
    // Three whole periods plus a closed window, so it lies in the fourth.
    // Then: the next start is the following grid point, never the missed one,
    // and the grid itself did not move.
    expect(nextSweepStartAt(late, origin)).toBe(origin + Math.floor((late - origin) / SWEEP_PARAMS.periodMs) * SWEEP_PARAMS.periodMs + SWEEP_PARAMS.periodMs)
    expect(nextSweepStartAt(origin, origin)).toBe(origin + SWEEP_PARAMS.periodMs)
    expect(nextSweepStartAt(origin - 200, origin)).toBe(origin)
    expect(cycleStartAt(late, origin)).toBe(origin + Math.floor((late - origin) / SWEEP_PARAMS.periodMs) * SWEEP_PARAMS.periodMs)
  })

  it('operator gets a skipped cycle, not a burst of catch-up cycles', () => {
    // Given: a timer that fires after its window already closed, inside the rest
    // gap of that period.
    const origin = 0
    const afterWindow = SWEEP_PARAMS.sweepMs + 50
    // When: the controller asks whether a cycle is still joinable.
    // Then: it is not, so the sweep is skipped rather than replayed.
    expect(joinableCycleStart(afterWindow, origin, SWEEP_PARAMS, false)).toBeUndefined()
    // A reading a frame late still joins the cycle it belongs to.
    const start = origin + SWEEP_PARAMS.periodMs * 3
    expect(joinableCycleStart(start + 40, origin, SWEEP_PARAMS, false)).toBe(start)
    // A second loop is refused while one is running.
    expect(joinableCycleStart(start + 40, origin, SWEEP_PARAMS, true)).toBeUndefined()
    // After a long sleep exactly one cycle can be joined, never three.
    const joined = new Set<number>()
    for (let step = 10_000; step < 10_100; step += 10) {
      const cycle = joinableCycleStart(step, origin, SWEEP_PARAMS, false)
      if (cycle !== undefined) joined.add(cycle)
    }
    expect(joined.size).toBe(1)
  })
})

describe('sweep envelope and stage continuity', () => {
  it('operator never gets the first or the last surface dimmed by a fade', () => {
    // Given: the shipped stages.
    const { entryMs, surfaceMs, sweepMs } = SWEEP_PARAMS
    // When: the envelope is read where the first and the last surface are lit.
    // Then: it is already full at the first surface and still full at the last,
    // so coverage is never traded away for a fade.
    expect(envelopeAt(entryMs, SWEEP_PARAMS)).toBe(1)
    expect(envelopeAt(entryMs - 1, SWEEP_PARAMS)).toBeGreaterThan(0.99)
    expect(envelopeAt(entryMs + surfaceMs, SWEEP_PARAMS)).toBe(1)
    expect(envelopeAt(entryMs + surfaceMs + 199, SWEEP_PARAMS)).toBe(1)
    // The amplitude only returns to zero after the tail left the last surface.
    expect(envelopeAt(sweepMs, SWEEP_PARAMS)).toBe(0)
    expect(envelopeAt(0, SWEEP_PARAMS)).toBe(0)
  })

  it('operator sees the deformation restored exactly at rest', () => {
    // Given: the warp amplitude through the window.
    // When: it is read at the two ends and in the middle.
    // Then: it is zero at both ends, so the shader maps destination onto source
    // and the resting lockup is the SVG itself.
    expect(warpAt(0, SWEEP_PARAMS)).toBe(0)
    expect(warpAt(SWEEP_PARAMS.sweepMs, SWEEP_PARAMS)).toBe(0)
    expect(warpAt(SWEEP_PARAMS.entryMs, SWEEP_PARAMS)).toBe(1)
    expect(sweepWarp(0)).toBe(0)
    expect(sweepWarp(1)).toBe(0)
  })

  it('operator sees the band arrive and leave smoothly, never popping', () => {
    // Given: the envelope over the window.
    // When: it is sampled at the entry, the middle and the exit.
    // Then: it starts and ends at zero, reaches full amplitude in between, and
    // the shadowed band is monotone.
    expect(sweepEnvelope(0)).toBe(0)
    expect(sweepEnvelope(1)).toBeCloseTo(0, 6)
    expect(sweepEnvelope(0.5)).toBe(1)
    expect(sweepEnvelope(0.02)).toBeGreaterThan(0)
    let previous = 0
    for (let step = 0; step <= 20; step += 1) {
      const value = sweepEnvelope(step / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})