/**
 * Sweep timing and the tunable dials behind the brand highlight.
 *
 * "Every five seconds" is a **start-to-start** period, not "play, then wait":
 * a cycle begins at `origin + cycleIndex * periodMs` and the window inside it
 * is 2700 ms (entry, body, exit), so the lockup rests for the remaining 2300 ms.
 * Nothing re-accumulates "play time + wait time", which is what once turned a
 * three-second request into a six-second one.
 *
 * Widths are expressed as a **visible** full width at half maximum, on a
 * horizontal cross-section of the lockup, in CSS pixels. `beam.ts` owns the
 * conversion to the sigma the profile uses, and the WGSL in `renderer.ts`
 * mirrors that conversion exactly.
 *
 * @module dsh-brand-gold/sweep
 */

/** Tunables for the periodic sweep. */
export interface SweepParams {
  /** Start-to-start period, in milliseconds. */
  readonly periodMs: number
  /** Stage A: travel from the entry point to the first metal surface. */
  readonly entryMs: number
  /** Stage B: travel across the metal itself, at a near-constant speed. */
  readonly surfaceMs: number
  /** Stage C: travel from the last surface out to the exit point. */
  readonly exitMs: number
  /** Length of the visible window inside each period, in milliseconds. */
  readonly sweepMs: number
  /** Delay between resources becoming ready and the first sweep. */
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
  /**
   * Linear albedo floor the wide band is multiplied by, so the darkest gold and
   * the HARNESS plate still show a readable reflection. It gates how bright the
   * band is, never whether a pixel is lit: eligibility comes from the mask.
   */
  readonly bandAlbedoFloor: number
  /** Champagne collar added around the core, relative to SDR white. */
  readonly collarGain: number
  /** HARNESS plate attenuation: the plate reacts, but less than the metal. */
  readonly plateFactor: number
  /** Short-time peak luminance requested at the core centre, in nits. */
  readonly peakNits: number
  /**
   * Gaussians of the wide band inside the finite support radius. Beyond
   * `supportSigmas * sigma` the profile is windowed to exactly zero, so the
   * travel has a finite, provable end.
   */
  readonly supportSigmas: number
  /** Travel padding, in CSS pixels, covering the warp and antialiasing. */
  readonly travelPaddingPx: number
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
 * Shipped values.
 *
 * The band widths are visible targets, not sigma dials: 0.55 x W of wide band
 * with a 0.10 x W core, clamped to 12..24 CSS px, gives a 103 px band and a
 * 19 px core on the shipped 188 px lockup.
 *
 * Timing: 250 + 2200 + 250 = 2700 ms of motion inside a 5000 ms period, so the
 * lockup rests for 2300 ms and the next sweep starts exactly 5000 ms after the
 * previous one started.
 */
export const SWEEP_PARAMS: SweepParams = Object.freeze({
  periodMs: 5000,
  entryMs: 250,
  surfaceMs: 2200,
  exitMs: 250,
  sweepMs: 2700,
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
  bandAlbedoFloor: 0.22,
  collarGain: 0.16,
  plateFactor: 0.55,
  supportSigmas: 3,
  travelPaddingPx: 4,
  peakNits: 1600,
  assumedSdrWhiteNits: 203,
})

/**
 * Reject a dial set that cannot schedule a sweep.
 *
 * The checks are about the timeline the controller actually runs: a window that
 * does not fit its period would overlap the next sweep, a window whose stages do
 * not add up would silently change the cadence, and a non-positive stage would
 * divide by zero in the trajectory.
 *
 * @param params - dial set to check.
 * @throws TypeError naming the first invalid field.
 */
export function validateSweepParams(params: SweepParams): void {
  const fail = (message: string): never => {
    throw new TypeError('brand-gold: ' + message)
  }
  const positive = [
    'periodMs', 'sweepMs', 'entryMs', 'surfaceMs', 'exitMs', 'tiltDeg',
    'mainBandFwhmRatio', 'coreFwhmRatio', 'coreFwhmMinPx', 'coreFwhmMaxPx',
    'magnifyRadiusPx', 'plateFactor', 'peakNits', 'assumedSdrWhiteNits',
  ] as const
  for (const key of positive) {
    if (!Number.isFinite(params[key]) || params[key] <= 0) fail(key + ' must be a positive number')
  }
  if (params.firstDelayMs < 0 || !Number.isFinite(params.firstDelayMs)) fail('firstDelayMs must be finite and non-negative')
  if (params.magnifyPeak < 1) fail('magnifyPeak must be at least 1')
  if (params.liftPx < 0) fail('liftPx must be non-negative')
  if (params.sweepMs >= params.periodMs) fail('sweepMs must be shorter than periodMs, or cycles would overlap')
  if (Math.abs(params.entryMs + params.surfaceMs + params.exitMs - params.sweepMs) > 1e-6) {
    fail('entryMs + surfaceMs + exitMs must equal sweepMs')
  }
  if (params.supportSigmas < 2) fail('supportSigmas must be at least 2, or the window would clip the band')
  if (!(params.bandAlbedoFloor >= 0) || params.bandAlbedoFloor > 1) fail('bandAlbedoFloor must be within 0..1')
  if (params.travelPaddingPx < 0) fail('travelPaddingPx must be non-negative')
  if (params.tiltDeg >= 90) fail('tiltDeg must stay below 90 degrees')
}

/** Resting time inside one period, in milliseconds. */
export function idleMs(params: SweepParams = SWEEP_PARAMS): number {
  return Math.max(0, params.periodMs - params.sweepMs)
}

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
 * Start of the cycle that contains `now`.
 * @param now - monotonic clock reading.
 * @param origin - the first sweep start.
 * @param params - timing dials.
 * @returns the cycle's nominal start; never later than `now`.
 */
export function cycleStartAt(
  now: number,
  origin: number,
  params: SweepParams = SWEEP_PARAMS,
): number {
  if (now <= origin) return origin
  const periods = Math.floor((now - origin) / params.periodMs)
  return origin + periods * params.periodMs
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

/**
 * The cycle the controller should start right now, if one is still live.
 *
 * A timer that fires a frame or two late resumes the cycle it belongs to; a
 * reading from after the window closed (a backgrounded tab, a stalled
 * compositor) is a missed cycle and is skipped instead of replayed, because the
 * origin is an absolute grid: skipping never shifts the following cycles.
 *
 * @param now - monotonic clock reading.
 * @param origin - the first sweep start.
 * @param params - timing dials.
 * @param running - true while the previous window is still on screen.
 * @returns the nominal start to run at, or undefined when none is live.
 */
export function joinableCycleStart(
  now: number,
  origin: number,
  params: SweepParams = SWEEP_PARAMS,
  running = false,
): number | undefined {
  if (!Number.isFinite(now) || !Number.isFinite(origin)) return undefined
  if (now < origin) return undefined
  if (running) return undefined
  const start = cycleStartAt(now, origin, params)
  const late = now - start
  if (late < 0 || late >= params.sweepMs) return undefined
  return start
}
