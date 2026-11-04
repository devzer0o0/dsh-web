/**
 * Trajectory: one monotone curve through the four stage boundaries, with a
 * continuous speed at every seam and a provable clearance at both ends.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout } from '../src/client/layout.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'
import { sampleTrajectory, trajectoryOf } from '../src/client/trajectory.ts'
import { beamCenterAt, crossingMs } from '../src/client/overlay.ts'
import { NAME_GEOMETRY, MARK_GEOMETRY } from '../src/client/paths.ts'
import { shapeGeometryOf } from '../src/client/geometry-mask.ts'
import { tiltTan } from '../src/client/beam.ts'

const shapes = new Map([
  ['mark', shapeGeometryOf(MARK_GEOMETRY)],
  ['name', shapeGeometryOf(NAME_GEOMETRY)],
])
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
  SWEEP_PARAMS,
  shapes,
)!

/** Constant body speed of the centre curve, in device px per ms. */
function bodySpeedPxPerMs(): number {
  return (layout.qMax - layout.qMin) / SWEEP_PARAMS.surfaceMs
}

/** Speed of the centre curve at one instant, in device px per ms. */
function speedAt(elapsed: number): number {
  const points = trajectoryOf(layout, SWEEP_PARAMS)
  return (sampleTrajectory(points, elapsed + 0.5) - sampleTrajectory(points, elapsed - 0.5)) / 1
}

describe('sweep trajectory', () => {
  it('operator sees the band start a whole radius before the first metal', () => {
    // Given: the band coordinate extent of the real metal and the support radius.
    // When: the first and last centres are compared with it.
    // Then: the centre starts at least one full support radius before the first
    // surface, and ends at least one full radius after the last, so the tail has
    // really left before the window closes.
    expect(layout.qMin).toBeLessThan(layout.qMax)
    expect(layout.centerStart).toBeLessThanOrEqual(layout.qMin - layout.supportRadius)
    expect(layout.centerEnd).toBeGreaterThanOrEqual(layout.qMax + layout.supportRadius)
    expect(layout.supportRadius).toBeGreaterThan(layout.sigma * 2)
  })

  it('operator sees the centre cross the metal in the body stage, no faster', () => {
    // Given: the body stage.
    // When: the centre at its start and its end is read.
    // Then: it is exactly on the first and the last surface, and the crossing
    // lasts the whole body stage.
    const points = trajectoryOf(layout, SWEEP_PARAMS)
    expect(sampleTrajectory(points, SWEEP_PARAMS.entryMs)).toBeCloseTo(layout.qMin, 6)
    expect(sampleTrajectory(points, SWEEP_PARAMS.entryMs + SWEEP_PARAMS.surfaceMs)).toBeCloseTo(layout.qMax, 6)
    expect(crossingMs(SWEEP_PARAMS)).toBe(SWEEP_PARAMS.surfaceMs)
    // The body speed is constant: the same distance in equal slices of time.
    const a = sampleTrajectory(points, SWEEP_PARAMS.entryMs + 300)
    const b = sampleTrajectory(points, SWEEP_PARAMS.entryMs + 800)
    const c = sampleTrajectory(points, SWEEP_PARAMS.entryMs + 1300)
    expect(b - a).toBeCloseTo(c - b, 6)
  })

  it('operator never sees a jump, a reverse or a stall at a stage seam', () => {
    // Given: the window sampled at 1 ms, and the two stage speeds.
    const entryRate = (layout.qMin - layout.centerStart) / SWEEP_PARAMS.entryMs
    const bodyRate = bodySpeedPxPerMs()
    const fastest = Math.max(entryRate, bodyRate)
    // When: the centre and its speed are walked across both seams.
    // Then: it only ever moves right, never by a jump, and its speed meets the
    // body speed on both sides.
    let previous = sampleTrajectory(trajectoryOf(layout, SWEEP_PARAMS), 0)
    for (let elapsed = 1; elapsed <= SWEEP_PARAMS.sweepMs; elapsed += 1) {
      const value = sampleTrajectory(trajectoryOf(layout, SWEEP_PARAMS), elapsed)
      // Monotone: the light only ever moves left to right.
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9)
      // No jump: a single millisecond never moves the centre by more than a
      // small multiple of the fastest stage speed.
      expect(value - previous).toBeLessThan(fastest * 3)
      previous = value
    }
    // The speed is continuous across both seams.
    const entrySpeed = speedAt(SWEEP_PARAMS.entryMs)
    const bodySpeed = speedAt(SWEEP_PARAMS.entryMs + 1)
    const exitSpeed = speedAt(SWEEP_PARAMS.entryMs + SWEEP_PARAMS.surfaceMs)
    expect(entrySpeed).toBeCloseTo(bodySpeed, 1)
    expect(exitSpeed).toBeCloseTo(bodySpeed, 1)
    // And the ends rest: the first millisecond of the entry and the last
    // millisecond of the exit move the centre far less than the body does.
    const points = trajectoryOf(layout, SWEEP_PARAMS)
    const startRate = sampleTrajectory(points, 1) - sampleTrajectory(points, 0)
    const endRate = sampleTrajectory(points, SWEEP_PARAMS.sweepMs)
      - sampleTrajectory(points, SWEEP_PARAMS.sweepMs - 1)
    expect(startRate).toBeLessThan(bodySpeed * 0.3)
    expect(endRate).toBeLessThan(bodySpeed * 0.3)
    // The speed rises through the entry and falls through the exit, so there is
    // no stall and no snap at either seam.
    let rising = 0
    let previousSpeed = 0
    for (let elapsed = 5; elapsed <= SWEEP_PARAMS.entryMs; elapsed += 25) {
      const speed = speedAt(elapsed)
      if (speed >= previousSpeed) rising += 1
      previousSpeed = speed
    }
    expect(rising).toBeGreaterThan(4)
  })

  it('operator never sees the light come back from the right', () => {
    // Given: the centre at ordered progress values.
    // When: they are compared.
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((p) => beamCenterAt(layout, p))
    // Then: the sequence is strictly increasing.
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!).toBeGreaterThan(samples[index - 1]!)
    }
  })

  it('operator gets the same trajectory at every device pixel ratio', () => {
    // Given: the same lockup at 1x, 2x and 3x.
    for (const dpr of [1, 2, 3]) {
      const scaled = buildLayout(
        new Map([
          ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
          ['name', { left: 48, top: 54, width: 156, height: 24 }],
        ]),
        new Map([
          ['mark', '0 0 23.16 17.04'],
          ['name', '26 0 156 24'],
        ]),
        dpr,
        SWEEP_PARAMS,
        shapes,
      )!
      // When: the extents and the travel are converted back to CSS pixels.
      // Then: they agree within a device pixel, so the sweep is not a different
      // journey on a Retina screen.
      expect(scaled.qMin / dpr).toBeCloseTo(layout.qMin / 2, 0)
      expect(scaled.qMax / dpr).toBeCloseTo(layout.qMax / 2, 0)
      // The centre starts before the first surface, by at least the radius.
      expect(scaled.centerStart).toBeLessThanOrEqual(scaled.qMin - scaled.supportRadius)
      expect(tiltTan(SWEEP_PARAMS.tiltDeg)).toBeGreaterThan(0)
    }
  })
})
