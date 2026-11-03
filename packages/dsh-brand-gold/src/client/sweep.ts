/**
 * Sweep timing and the tunable dials behind the brand highlight.
 *
 * Every number the animation depends on lives here: the period is measured from
 * one sweep start to the next (never "play, then wait"), the sweep itself is a
 * fixed window inside that period, and the first one waits for the resources.
 *
 * @module dsh-brand-gold/sweep
 */

/** Tunables for the periodic sweep. */
export interface SweepParams {
  /** Start-to-start period, in milliseconds. */
  readonly periodMs: number
  /** Length of the visible sweep inside each period, in milliseconds. */
  readonly sweepMs: number
  /** Delay between resources becoming ready and the first sweep, in milliseconds. */
  readonly firstDelayMs: number
  /** Lean of the beam away from vertical, in degrees. */
  readonly tiltDeg: number
  /** Beam falloff width (sigma) as a fraction of the lockup width. */
  readonly influenceSigmaRatio: number
  /** Sigma of the sharp specular core, in CSS pixels (about a 1-2px core). */
  readonly coreSigmaPx: number
  /** Peak local magnification at the beam centre. */
  readonly magnifyPeak: number
  /** Peak upward lift at the beam centre, in CSS pixels. */
  readonly liftPx: number
  /** Extra linear gain applied to the metal under the beam. */
  readonly metalGain: number
  /** Linear gain of the sharp specular core. */
  readonly coreGain: number
  /** Extended-range gain added during the sweep (linear, relative to SDR white). */
  readonly hdrGain: number
  /** HARNESS plate attenuation: the plate reacts, but less than the metal. */
  readonly plateFactor: number
  /** Extra travel beyond the lockup bounds, in CSS pixels, so the beam enters and leaves. */
  readonly travelMarginPx: number
}

/**
 * Initial implementation values. Adjust only when the native size shows a
 * broken stroke, distortion or something clearly unnatural, and say why.
 */
export const SWEEP_PARAMS: SweepParams = Object.freeze({
  periodMs: 5000,
  sweepMs: 1200,
  firstDelayMs: 5000,
  tiltDeg: 25,
  influenceSigmaRatio: 0.025,
  coreSigmaPx: 0.7,
  magnifyPeak: 1.08,
  liftPx: 0.8,
  metalGain: 0.55,
  coreGain: 1.2,
  hdrGain: 1.1,
  plateFactor: 0.55,
  travelMarginPx: 3,
})

/**
 * Progress of the sweep window that contains `now`.
 * @param now - monotonic clock reading, in milliseconds.
 * @param origin - the first sweep start on the same clock.
 * @param params - timing dials.
 * @returns 0..1 inside the sweep window, or null while the lockup rests.
 */
export function sweepProgressAt(
  now: number,
  origin: number,
  params: SweepParams = SWEEP_PARAMS,
): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(origin)) return null
  const elapsed = now - origin
  if (elapsed < 0) return null
  const within = elapsed % params.periodMs
  if (within >= params.sweepMs) return null
  return within / params.sweepMs
}

/**
 * Next period boundary at or after `now`.
 * @param now - monotonic clock reading, in milliseconds.
 * @param origin - the first sweep start on the same clock.
 * @param params - timing dials.
 * @returns the clock value the next sweep starts at.
 */
export function nextSweepStartAt(
  now: number,
  origin: number,
  params: SweepParams = SWEEP_PARAMS,
): number {
  if (now < origin) return origin
  const periods = Math.floor((now - origin) / params.periodMs) + 1
  return origin + periods * params.periodMs
}
