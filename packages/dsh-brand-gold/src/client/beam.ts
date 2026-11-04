/**
 * Beam geometry and the local warp it drives.
 *
 * The shader in `hdr.ts` mirrors these functions exactly; keeping them here as
 * plain arithmetic makes them testable without a GPU.
 *
 * @module dsh-brand-gold/beam
 */

/**
 * Radius, in CSS pixels, inside which the magnification actually pulls
 * material. The influence zone is a wide light, but a magnification that scaled
 * with its full width would sample material tens of pixels away and ghost the
 * stroke; the optical effect is local by nature.
 */
/** A point in canvas CSS pixels. */
export interface Point {
  /** Horizontal position. */
  readonly x: number
  /** Vertical position. */
  readonly y: number
}

/** Geometry of the beam at one instant. */
export interface BeamSpec {
  /** Beam centre on the horizontal axis, in canvas CSS pixels. */
  readonly centerX: number
  /** Vertical centre the tilt is measured from, in canvas CSS pixels. */
  readonly centerY: number
  /** Tangent of the tilt away from vertical. */
  readonly tanTilt: number
  /** Falloff width of the soft influence zone, in CSS pixels. */
  readonly sigma: number
  /** Peak upward displacement, in CSS pixels. */
  readonly liftPx: number
  /** Peak magnification at the beam centre. */
  readonly magnifyPeak: number
  /** Radius, in CSS pixels, inside which magnification pulls material. */
  readonly magnifyRadiusPx: number
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
 * Smooth influence weight of the beam at one point.
 * @param point - canvas CSS pixel.
 * @param beam - current beam geometry.
 * @returns 1 at the axis, decaying to 0 outside the influence zone.
 */
export function beamWeight(point: Point, beam: BeamSpec): number {
  const u = beamCoordinate(point, beam)
  return Math.exp(-(u * u) / (beam.sigma * beam.sigma))
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
  // Bounded neighbourhood: beyond it the material is not magnified, only lit.
  const local = Math.max(-beam.magnifyRadiusPx, Math.min(distance, beam.magnifyRadiusPx))
  const radial = local * (1 / scale - 1)
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
