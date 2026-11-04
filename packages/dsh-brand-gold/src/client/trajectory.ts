/**
 * The one trajectory of a sweep: stage timing, the beam centre and the two
 * amplitudes that travel with it.
 *
 * The beam centre is a monotone cubic Hermite curve through four control
 * points — entry, first metal, last metal, exit — with tangents chosen so the
 * speed is continuous at both seams:
 *
 * - the entry eases in from rest and carries a slope that already matches the
 *   body speed where it meets the first surface,
 * - the body runs at one constant speed, so the eye reads a steady crossing
 *   rather than an acceleration,
 * - the exit leaves at that same speed and eases out to rest.
 *
 * Because the curve is monotone, the centre never reverses inside the window.
 * Because every stage boundary sits on the same curve, there is no jump, no
 * reverse and no stall where the stages meet.
 *
 * The travel is expressed in the beam's own coordinate, so the band's entry and
 * exit are defined by where the *whole band* is, not by where the canvas is.
 *
 * @module dsh-brand-gold/trajectory
 */

import type { LockupLayout } from './layout.ts'
import type { SweepParams } from './sweep.ts'

/** One control point of the centre curve. */
export interface TrajectoryPoint {
  /** Time from the start of the sweep, in milliseconds. */
  readonly t: number
  /** Beam centre at that time, in device pixels. */
  readonly value: number
  /** Speed at that time, in device pixels per millisecond. */
  readonly slope: number
}

/** State of the sweep at one instant. */
export interface SweepPose {
  /** Beam centre, in device pixels. */
  readonly centerX: number
  /** Light amplitude, 0..1. */
  readonly envelope: number
  /** Deformation amplitude, 0..1; 1 at full magnification and lift. */
  readonly warp: number
}

/**
 * Control points of the centre curve.
 * @param layout - the measured lockup.
 * @param params - timing dials.
 * @returns the four points, in order.
 */
export function trajectoryOf(
  layout: LockupLayout,
  params: SweepParams,
): readonly TrajectoryPoint[] {
  const bodySlope = (layout.qMax - layout.qMin) / Math.max(params.surfaceMs, 1e-6)
  return [
    { t: 0, value: layout.centerStart, slope: 0 },
    { t: params.entryMs, value: layout.qMin, slope: bodySlope },
    { t: params.entryMs + params.surfaceMs, value: layout.qMax, slope: bodySlope },
    { t: params.sweepMs, value: layout.centerEnd, slope: 0 },
  ]
}

/**
 * Evaluate a cubic Hermite segment between two control points.
 * @param a - first point.
 * @param b - second point.
 * @param t - time inside the segment, in milliseconds.
 * @returns the interpolated value.
 */
function hermite(a: TrajectoryPoint, b: TrajectoryPoint, t: number): number {
  const span = b.t - a.t
  if (!(span > 0)) return b.value
  const s = Math.min(1, Math.max(0, t / span))
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return h00 * a.value + h10 * span * a.slope + h01 * b.value + h11 * span * b.slope
}

/**
 * Evaluate the centre curve.
 * @param points - control points, ordered by time.
 * @param elapsed - milliseconds from the start of the sweep.
 * @returns the beam centre, in device pixels.
 */
export function sampleTrajectory(points: readonly TrajectoryPoint[], elapsed: number): number {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) return 0
  if (elapsed <= first.t) return first.value
  if (elapsed >= last.t) return last.value
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    if (elapsed <= b.t) return hermite(a, b, elapsed - a.t)
  }
  return last.value
}

/**
 * Smooth 0..1 ramp.
 * @param value - input, clamped to 0..1.
 * @returns the eased value.
 */
export function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

/**
 * Light amplitude through the window.
 *
 * It opens over the entry stage, which ends when the beam reaches the first
 * metal surface, so no lit pixel is dimmed by a fade. It stays at full through
 * the whole body **and** through the exit stage, because the exit stage is the
 * band's tail still sweeping the last surface; only when the support radius has
 * left that surface (80% of the exit) does the amplitude return to zero.
 *
 * @param elapsed - milliseconds from the start of the sweep.
 * @param params - timing dials.
 * @returns 0..1.
 */
export function envelopeAt(elapsed: number, params: SweepParams): number {
  if (elapsed <= 0 || elapsed >= params.sweepMs) return 0
  if (elapsed < params.entryMs) return smoothstep01(elapsed / params.entryMs)
  const exitStart = params.entryMs + params.surfaceMs
  if (elapsed < exitStart) return 1
  const progress = (elapsed - exitStart) / params.exitMs
  if (progress <= 0.8) return 1
  return 1 - smoothstep01((progress - 0.8) / 0.2)
}

/**
 * Deformation amplitude through the window.
 *
 * Entry reaches full magnification before the first surface is lit, the body
 * holds it, and the exit returns it to zero — a zero amplitude is the identity
 * mapping, so the resting lockup is exactly the SVG underneath.
 *
 * @param elapsed - milliseconds from the start of the sweep.
 * @param params - timing dials.
 * @returns 0..1.
 */
export function warpAt(elapsed: number, params: SweepParams): number {
  if (elapsed <= 0 || elapsed >= params.sweepMs) return 0
  if (elapsed < params.entryMs) return smoothstep01(elapsed / params.entryMs)
  const exitStart = params.entryMs + params.surfaceMs
  if (elapsed < exitStart) return 1
  const progress = (elapsed - exitStart) / params.exitMs
  if (progress <= 0.5) return 1
  return 1 - smoothstep01((progress - 0.5) / 0.5)
}

/**
 * Full pose at one instant.
 * @param layout - the measured lockup.
 * @param params - timing dials.
 * @param elapsed - milliseconds from the start of the sweep.
 * @param points - precomputed control points, when the caller has them.
 * @returns the centre and the two amplitudes.
 */
export function sweepPoseAt(
  layout: LockupLayout,
  params: SweepParams,
  elapsed: number,
  points: readonly TrajectoryPoint[] = trajectoryOf(layout, params),
): SweepPose {
  return {
    centerX: sampleTrajectory(points, elapsed),
    envelope: envelopeAt(elapsed, params),
    warp: warpAt(elapsed, params),
  }
}
