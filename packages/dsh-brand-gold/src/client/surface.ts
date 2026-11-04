/**
 * What the surface contributes to the reflection, independent of how the mask
 * was rasterized.
 *
 * Two separate questions are answered here, and they must never be merged:
 *
 * 1. **Is this pixel metal at all?** That is a material-class question, and the
 *    mask answers it from the original geometry. A shadowed gold stroke is metal
 *    at 8% luminance; the HARNESS ink is not metal at 8% luminance either. The
 *    previous renderer asked the rasterized colour instead and dropped every
 *    pixel below a fixed brightness, which is the dark-gold hole this round
 *    fixes.
 * 2. **How much light does it return?** That is a shading question, and the
 *    resting luminance plus an albedo floor answer it. The floor keeps the band
 *    visible on the darkest gold; it never decides eligibility, and it is
 *    applied once, so the plate is attenuated once rather than twice.
 *
 * @module dsh-brand-gold/surface
 */

import { linearize } from './color.ts'
import { luminance } from './light.ts'

/** What the mask says about one pixel. */
export interface MaskSample {
  /** Metal coverage, 0..1. Zero means "not metal". */
  readonly metal: number
  /** Plate share of that coverage, 0..1. */
  readonly plate: number
}

/** Response of one pixel to the beam. */
export interface SurfaceResponse {
  /** Whether the pixel may reflect at all. */
  readonly metal: boolean
  /** Amplitude multiplier: 1 on the metal, `plateFactor` on the plate. */
  readonly response: number
  /** Linear luminance of the resting material. */
  readonly baseLuma: number
  /** Band albedo: the resting luminance, floored. */
  readonly albedo: number
}

/**
 * Classify one pixel.
 * @param sample - mask coverage at the pixel.
 * @param srgba - the material texel's encoded channels.
 * @param plateFactor - attenuation of the plate relative to the metal.
 * @param albedoFloor - linear floor the band is multiplied by.
 * @returns the response, with `metal: false` for anything the mask rejected.
 */
export function surfaceResponse(
  sample: MaskSample,
  srgba: readonly [number, number, number],
  plateFactor: number,
  albedoFloor = 0,
): SurfaceResponse {
  const metal = Math.min(1, Math.max(0, sample.metal))
  const baseLuma = luminance(linearize(srgba))
  if (metal <= 0) {
    // Not metal: no response, whatever the pixel's brightness happens to be.
    return { metal: false, response: 0, baseLuma, albedo: baseLuma }
  }
  const plate = Math.min(1, Math.max(0, sample.plate))
  return {
    metal: true,
    // Attenuation is a single linear factor over the whole plate, not a second
    // gate on top of the mask.
    response: 1 + (plateFactor - 1) * plate,
    baseLuma,
    albedo: Math.max(baseLuma, albedoFloor),
  }
}
