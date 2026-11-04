/**
 * Beam geometry and the local warp it drives.
 *
 * Widths are defined once, here, as a **visible full width at half maximum
 * measured on a horizontal cross-section of the lockup** (the row of pixels an
 * observer sees). With a tilt, the beam coordinate
 *
 *     u = (x - centerX) + (y - centerY) * tan(tilt)
 *
 * advances one CSS pixel per horizontal pixel on any fixed row, so the FWHM in
 * `u` and the FWHM across a horizontal cross-section are the same number. The
 * CPU geometry, the WGSL and the tests all use that one definition; nothing is
 * expressed as a raw sigma.
 *
 * @module dsh-brand-gold/beam
 */

/** A point in canvas CSS pixels. */
export interface Point {
  /** Horizontal position. */
  readonly x: number
  /** Vertical position. */
  readonly y: number
}

/**
 * Widths of the beam, in CSS pixels.
 *
 * The wide band, the champagne core and the soft surround share one centre and
 * one tilt but keep their own width and brightness; a single sigma never stands
 * in for all three.
 */
export interface BeamWidths {
  /** Full width at half maximum of the wide gold band, in CSS pixels. */
  readonly mainFwhm: number
  /** Full width at half maximum of the champagne core, in CSS pixels. */
  readonly coreFwhm: number
  /** Gaussian sigma equivalent of `mainFwhm`, in CSS pixels. */
  readonly mainSigma: number
  /** Gaussian sigma equivalent of `coreFwhm`, in CSS pixels. */
  readonly coreSigma: number
  /** Gaussian sigma of the champagne collar, in CSS pixels. */
  readonly collarSigma: number
}

/** Geometry of the beam at one instant. */
export interface BeamSpec {
  /** Beam centre on the horizontal axis, in canvas CSS pixels. */
  readonly centerX: number
  /** Vertical centre the tilt is measured from, in canvas CSS pixels. */
  readonly centerY: number
  /** Tangent of the tilt away from vertical. */
  readonly tanTilt: number
  /** Gaussian sigma of the wide band, in CSS pixels. */
  readonly sigma: number
  /** Gaussian sigma of the champagne core, in CSS pixels. */
  readonly coreSigma: number
  /** Gaussian sigma of the champagne collar between core and band, in CSS pixels. */
  readonly collarSigma: number
  /** Peak upward displacement, in CSS pixels. */
  readonly liftPx: number
  /** Peak magnification at the beam centre. */
  readonly magnifyPeak: number
  /** Radius, in CSS pixels, inside which magnification moves material. */
  readonly magnifyRadiusPx: number
}

/** Ratio that keeps the core from swallowing a small lockup's band. */
const CORE_TO_MAIN_MAX = 0.4

/** The collar sits between the core and the band: narrower than the band. */
const COLLAR_TO_MAIN = 0.42

/**
 * Convert a visible FWHM into the sigma of `exp(-(u/sigma)^2)`.
 * @param fwhm - full width at half maximum, in the same unit as the result.
 * @returns the equivalent sigma.
 */
export function fwhmToSigma(fwhm: number): number {
  return fwhm / (2 * Math.sqrt(Math.log(2)))
}

/**
 * Inverse of {@link fwhmToSigma}, used by the diagnostics and the tests.
 * @param sigma - Gaussian sigma.
 * @returns the visible full width at half maximum.
 */
export function sigmaToFwhm(sigma: number): number {
  return sigma * 2 * Math.sqrt(Math.log(2))
}

/**
 * Widths of the two bands for a lockup of a given width.
 *
 * The core is clamped into a pixel range so it stays visible on a small icon,
 * then capped relative to the wide band so a compact lockup is not flooded by
 * its own floor.
 *
 * @param lockupWidth - actual layout width of the lockup, in CSS pixels.
 * @param mainBandFwhmRatio - band width as a fraction of the lockup width.
 * @param coreFwhmRatio - core width as a fraction of the lockup width.
 * @param coreFwhmMinPx - smallest core width, in CSS pixels.
 * @param coreFwhmMaxPx - largest core width, in CSS pixels.
 * @returns the visible widths and their sigma equivalents, in CSS pixels.
 */
export function beamWidths(
  lockupWidth: number,
  mainBandFwhmRatio: number,
  coreFwhmRatio: number,
  coreFwhmMinPx: number,
  coreFwhmMaxPx: number,
): BeamWidths {
  const width = Math.max(lockupWidth, 1)
  const mainFwhm = width * mainBandFwhmRatio
  const requested = width * coreFwhmRatio
  const clamped = Math.min(Math.max(requested, coreFwhmMinPx), Math.max(coreFwhmMaxPx, coreFwhmMinPx))
  const coreFwhm = Math.min(clamped, mainFwhm * CORE_TO_MAIN_MAX)
  const mainSigma = fwhmToSigma(mainFwhm)
  return {
    mainFwhm,
    coreFwhm,
    mainSigma,
    coreSigma: fwhmToSigma(coreFwhm),
    collarSigma: mainSigma * COLLAR_TO_MAIN,
  }
}

/**
 * Tangent of an angle given in degrees.
 * @param degrees - angle away from vertical.
 * @returns its tangent.
 */
export function tiltTan(degrees: number): number {
  return Math.tan((degrees * Math.PI) / 180)
}

/**
 * Signed distance from the beam axis, measured across the beam.
 * @param point - canvas CSS pixel.
 * @param beam - current beam geometry.
 * @returns distance in CSS pixels; zero on the axis.
 */
export function beamCoordinate(point: Point, beam: BeamSpec): number {
  return point.x - beam.centerX + (point.y - beam.centerY) * beam.tanTilt
}

/**
 * Wide gold band weight at one point.
 * @param point - canvas CSS pixel.
 * @param beam - current beam geometry.
 * @returns 1 on the axis, 0.5 at the band's half width, decaying to 0 outside.
 */
export function beamWeight(point: Point, beam: BeamSpec): number {
  const u = beamCoordinate(point, beam)
  return Math.exp(-(u * u) / (beam.sigma * beam.sigma))
}

/**
 * Champagne core weight at one point.
 * @param point - canvas CSS pixel.
 * @param beam - current beam geometry.
 * @returns 1 on the axis, 0.5 at the core's half width.
 */
export function coreWeight(point: Point, beam: BeamSpec): number {
  const u = beamCoordinate(point, beam)
  return Math.exp(-(u * u) / (beam.coreSigma * beam.coreSigma))
}

/**
 * Champagne collar weight at one point.
 * @param point - canvas CSS pixel.
 * @param beam - current beam geometry.
 * @returns 1 on the axis, 0.5 at the collar's half width.
 */
export function collarWeight(point: Point, beam: BeamSpec): number {
  const u = beamCoordinate(point, beam)
  return Math.exp(-(u * u) / (beam.collarSigma * beam.collarSigma))
}

/**
 * Local magnification at one point.
 * @param point - canvas CSS pixel.
 * @param beam - current beam geometry.
 * @returns a scale factor between 1 and `magnifyPeak`.
 */
export function magnifyAt(point: Point, beam: BeamSpec): number {
  return 1 + (beam.magnifyPeak - 1) * beamWeight(point, beam)
}

/**
 * Displacement the warp applies to a source point.
 *
 * A source pixel `d` pixels off the axis lands `d * scale` pixels off it, so
 * features near the centre are genuinely spread apart by `scale`. The
 * displacement is bounded to the magnification radius: the light may be wide,
 * but it must never pull material in from tens of pixels away.
 *
 * @param point - source position in canvas CSS pixels.
 * @param beam - current beam geometry.
 * @returns the offset the point appears at.
 */
export function warpOffset(point: Point, beam: BeamSpec): Point {
  const weight = beamWeight(point, beam)
  const normalLength = Math.hypot(1, beam.tanTilt)
  const nx = 1 / normalLength
  const ny = beam.tanTilt / normalLength
  const distance = (point.x - beam.centerX) * nx + (point.y - beam.centerY) * ny
  const scale = 1 + (beam.magnifyPeak - 1) * weight
  const local = Math.max(-beam.magnifyRadiusPx, Math.min(distance, beam.magnifyRadiusPx))
  // Forward warp: magnified material moves away from the axis, by (scale - 1).
  const radial = local * (scale - 1)
  return { x: nx * radial, y: ny * radial - beam.liftPx * weight }
}

/**
 * Invert the warp, so a destination pixel can find the material it shows.
 * Two fixed-point steps are enough: the displacement is a fraction of a pixel.
 * @param point - destination position in canvas CSS pixels.
 * @param beam - current beam geometry.
 * @param iterations - refinement steps.
 * @returns the source position that lands on `point`.
 */
export function inverseWarp(point: Point, beam: BeamSpec, iterations = 2): Point {
  let source = point
  for (let index = 0; index < iterations; index += 1) {
    const offset = warpOffset(source, beam)
    source = { x: point.x - offset.x, y: point.y - offset.y }
  }
  return source
}