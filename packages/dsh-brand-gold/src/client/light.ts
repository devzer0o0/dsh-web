/**
 * Light model: the linear luminance a sweep requests at each point.
 *
 * This module is the single source of truth for the light distribution. The
 * WGSL in `renderer.ts` mirrors {@link sweepLight} term for term, and the tests
 * assert the **resulting** distribution (band FWHM, core FWHM, final peak
 * luminance) rather than the input dials.
 *
 * The peak is a final linear luminance, not a gain added on top of other gains:
 *
 *     requestedPeakLinear = peakNits / sdrReferenceWhiteNits
 *
 * and no pixel exceeds it. The core is given exactly the remaining luminance
 * budget — `max(ceiling - lit, 0)` — so "base + band + collar + core" cannot
 * silently overshoot the target, and the peak of the composite is the target by
 * construction rather than by luck.
 *
 * Every colour is normalised by its own luminance before it is scaled, so
 * "1200 in the red channel" can never stand in for "1200 nits".
 *
 * @module dsh-brand-gold/light
 */
import type { Linear } from './color.ts'

/** Peak capability the user reported for the screen, in nits. */
export const SCREEN_PEAK_NITS = 1600

/** LT.709 luminance coefficients, used for every normalisation here. */
const LUMA: Linear = [0.2126, 0.7152, 0.0722]
/** Pale champagne-white core, linear. */
export const CORE_COLOR: Linear = [1.0, 0.972, 0.902]
/** Warm champagne collar around the core, linear. */
export const COLLAR_COLOR: Linear = [1.0, 0.878, 0.678]

/**
 * Relative luminance of a linear RGB triple.
 * @param rgb - linear components.
 * @returns the LT.709 luminance.
 */
export function luminance(rgb: Linear): number {
  return rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
}

/**
 * Scale a linear colour so it carries exactly `target` luminance.
 * @param rgb - linear components of the tint.
 * @param target - requested luminance.
 * @returns the normalised triple; all zero when the tint is black.
 */
export function withLuminance(rgb: Linear, target: number): Linear {
  const own = luminance(rgb)
  if (own <= 0) return [0, 0, 0]
  const factor = target / own
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor]
}

/**
 * Where the requested peak linear luminance comes from, and whether it is a
 * measurement or an assumption.
 */
export interface Calibration {
  /** Screen peak capability reported by the user, in nits. */
  readonly screenPeakNits: number
  /** Short-time peak this sweep asks for at the core centre, in nits. */
  readonly requestedPeakNits: number
  /** SDR reference white, in nits, when it is known. */
  readonly sdrWhiteNits: number | undefined
  /** Whether the reference white was measured or assumed. */
  readonly sdrWhiteSource: 'measured' | 'assumed'
  /** Requested peak as a linear multiplier of SDR white. */
  readonly requestedPeakLinear: number
  /** Available extended-range headroom, when the host reports it. */
  readonly headroom: number | undefined
  /** Whether the headroom was read from the display or is unknown. */
  readonly headroomSource: 'display' | 'unknown'
}

/**
 * Resolve the calibration record from the dials.
 * @param peakNits - requested peak luminance.
 * @param sdrWhiteNits - measured SDR reference white, when known.
 * @param assumedSdrWhiteNits - reference white to assume while it is unknown.
 * @param headroom - reported extended-range headroom, when the host exposes it.
 * @returns the calibration record.
 */
export function calibrationOf(
  peakNits: number,
  sdrWhiteNits: number | undefined,
  assumedSdrWhiteNits: number,
  headroom: number | undefined,
): Calibration {
  const known = sdrWhiteNits !== undefined && sdrWhiteNits > 0
  const white = known ? sdrWhiteNits! : Math.max(assumedSdrWhiteNits, 1)
  return {
    screenPeakNits: SCREEN_PEAK_NITS,
    requestedPeakNits: peakNits,
    sdrWhiteNits: known ? sdrWhiteNits : undefined,
    sdrWhiteSource: known ? 'measured' : 'assumed',
    requestedPeakLinear: peakNits / white,
    headroom,
    headroomSource: headroom === undefined ? 'unknown' : 'display',
  }
}

/** Inputs of one point's light. */
export interface LightInput {
  /** Luminance of the resting material at this point. */
  readonly baseLuma: number
  /** Wide band weight, 0..1. */
  readonly band: number
  /** Champagne core weight, 0..1. */
  readonly core: number
  /** Collar weight around the core, 0..1. */
  readonly collar: number
  /** Sweep envelope, 0 while the lockup rests. */
  readonly envelope: number
  /** 1 on the wordmark, `plateFactor` on the HARNESS plate. */
  readonly response: number
  /** 1 on gold, 0 on the dark HARNESS lettering. */
  readonly metal: number
}

/** Linear light of one point. */
export interface LightResult {
  /** Total linear luminance this point must end up with. */
  readonly targetLuma: number
  /** Luminance added on top of the gold band by the core. */
  readonly coreLuma: number
  /** Luminance the gold band contributes over the resting material. */
  readonly bandLuma: number
}

/**
 * Additive linear light of the beam at one point.
 *
 * `targetLuma` is the luminance the shader must produce: gold under the wide
 * band, walking up to the requested peak as the core term rises. `coreLuma` is
 * the part that needs the pale core colour, so the shader can add it as one
 * normalised tint instead of guessing channel gains.
 *
 * @param input - weights at the point.
 * @param bandGain - band luminance relative to SDR white.
 * @param collarGain - collar luminance relative to SDR white.
 * @param peakLinear - requested peak luminance at the core centre.
 * @returns the target luminance and the core's share of it.
 */
export function sweepLight(
  input: LightInput,
  bandGain: number,
  collarGain: number,
  peakLinear: number,
): LightResult {
  // `gate` is the material gate only; the plate attenuation is a separate
  // linear factor so the plate really gets `plateFactor` of the added light
  // instead of its square.
  const gate = input.envelope * input.metal
  if (gate <= 0) return { targetLuma: input.baseLuma, coreLuma: 0, bandLuma: 0 }
  const response = input.response * gate
  const bandLuma = input.baseLuma * bandGain * input.band * response
  const litLuma = input.baseLuma + bandLuma + collarGain * input.collar * response
  const coreTerm = input.core * input.core * gate
  const ceiling = peakLinear * response
  const targetLuma = litLuma + Math.max(ceiling - litLuma, 0) * coreTerm
  return { targetLuma, coreLuma: targetLuma - litLuma, bandLuma }
}