/**
 * Sweep timing and the tunable dials behind the brand highlight.
 *
 * Every number the animation depends on lives here: the period is measured from
 * one sweep start to the next (never "play, then wait"), the sweep itself is a
 * fixed window inside that period, and the first one waits for the resources.
 *
 * Widths are expressed as a **visible** full width at half maximum, on a
 * horizontal cross-section of the lockup (the same row of pixels an observer
 * sees), in CSS pixels. `beam.ts` owns the conversion to the sigma the
 * profile uses, and the WGSL in `renderer.ts` mirrors that conversion exactly.
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
  /**
   * Full width at half maximum of the wide gold band, as a fraction of the
   * lockup width, measured on a horizontal cross-section.
   */
  readonly mainBandFwhmRatio: number
  /**
   * Full width at half maximum of the champagne core, as a fraction of the
   * lockup width, before the pixel floor and ceiling are applied.
   */
  readonly coreFwhmRatio: number
  /** Smallest core width, in CSS pixels. */
  readonly coreFwhmMinPx: number
  /** Largest core width, in CSS pixels. */
  readonly coreFwhmMaxPx: number
  /** Peak local magnification at the beam centre. */
  readonly magnifyPeak: number
  /**
   * Radius, in CSS pixels, inside which magnification moves material. The band
   * can be far wider than this without ghosting, because the optical effect is
   * local even when the light is broad.
   */
  readonly magnifyRadiusPx: number
  /** Peak upward lift at the beam centre, in CSS pixels. */
  readonly liftPx: number
  /** Extra linear gain applied to the gold band over the metal. */
  readonly bandGain: number
  /** Champagne collar added around the core, relative to SDR white. */
  readonly collarGain: number
  /** HARNESS plate attenuation: the plate reacts, but less than the metal. */
  readonly plateFactor: number
  /** Share of the sweep window spent fading the band in. */
  readonly fadeInRatio: number
  /** Share of the sweep window spent fading the band out. */
  readonly fadeOutRatio: number
  /**
   * Horizontal travel beyond the lockup, as a fraction of its width. The band
   * only has to clear the lockup far enough for its envelope to reach zero;
   * making this scale with the band width would speed the crossing up again.
   */
  readonly travelMarginRatio: number
  /** Short-time peak luminance requested at the core centre, in nits. */
  readonly peakNits: number
  /**
   * SDR reference white of the display, in nits, when it is known. `undefined`
   * means uncalibrated: `assumedSdrWhiteNits` is used and reported as an
   * assumption, never as a measurement.
   */
  readonly sdrWhiteNits?: number
  /** Reference white assumed while `sdrWhiteNits` is unknown. */
  readonly assumedSdrWhiteNits: number
}

/**
 * Initial implementation values.
 *
 * The band widths are visible targets, not the old sigma dials: 0.55 x W of
 * wide band with a 0.10 x W core, clamped to 12..24 CSS px, gives a 103 px band
 * and a 19 px core on the shipped 188 px lockup.
 */
export const SWEEP_PARAMS: SweepParams = Object.freeze({
  periodMs: 5000,
  sweepMs: 3600,
  firstDelayMs: 5000,
  tiltDeg: 25,
  mainBandFwhmRatio: 0.55,
  coreFwhmRatio: 0.1,
  coreFwhmMinPx: 12,
  coreFwhmMaxPx: 24,
  magnifyPeak: 1.08,
  magnifyRadiusPx: 5,
  liftPx: 0.8,
  bandGain: 0.5,
  collarGain: 0.16,
  plateFactor: 0.55,
  fadeInRatio: 0.14,
  fadeOutRatio: 0.16,
  travelMarginRatio: 0.1,
  peakNits: 1600,
  assumedSdrWhiteNits: 203,
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
