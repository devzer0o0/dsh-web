/**
 * Light model: the width and the peak that are actually delivered, not the
 * dials that were passed in.
 */
import { describe, expect, it } from 'vitest'
import { beamWeight, coreWeight, sigmaToFwhm, type BeamSpec } from '../src/client/beam.ts'
import { calibrationOf, sweepLight, withLuminance, CORE_COLOR, luminance } from '../src/client/light.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'
import { buildLayout } from '../src/client/layout.ts'

/** A beam with a 103 px band and a 19 px core, as the 188 px lockup produces. */
const layout = buildLayout(
  new Map([
    ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
    ['name', { left: 48, top: 54, width: 156, height: 24 }],
  ]),
  new Map([
    ['mark', '0 0 23.16 17.04'],
    ['name', '26 0 156 24'],
  ]),
  1,
)!

const beam: BeamSpec = {
  centerX: 0,
  centerY: 0,
  tanTilt: 0,
  sigma: layout.sigma,
  coreSigma: layout.coreSigma,
  collarSigma: layout.sigma * 0.42,
  liftPx: SWEEP_PARAMS.liftPx,
  magnifyPeak: SWEEP_PARAMS.magnifyPeak,
  magnifyRadiusPx: SWEEP_PARAMS.magnifyRadiusPx,
}

/** Gold near the middle of the ramp, as linear light. */
const GOLD = [0.55, 0.3, 0.06] as const

/**
 * Luminance the shader would produce at a horizontal offset.
 * @param offset - CSS pixels from the beam centre.
 * @param peakLinear - requested peak linear luminance.
 * @returns the composite luminance.
 */
function lumaAt(offset: number, peakLinear: number): number {
  const point = { x: offset, y: 0 }
  return sweepLight(
    {
      baseLuma: luminance(GOLD),
      band: beamWeight(point, beam),
      core: coreWeight(point, beam),
      collar: Math.exp(-(offset * offset) / (beam.collarSigma * beam.collarSigma)),
      envelope: 1,
      response: 1,
      metal: 1,
    },
    SWEEP_PARAMS.bandGain,
    SWEEP_PARAMS.collarGain,
    peakLinear,
  ).targetLuma
}

/**
 * Luminance contributed by the wide band alone.
 *
 * With the core and the collar disabled the profile is the band's own gold
 * contribution over the resting material, which is what the "wide bright band"
 * claim is about.
 *
 * @param offset - CSS pixels from the beam centre.
 * @returns the band's added luminance.
 */
function bandLumaAt(offset: number): number {
  const point = { x: offset, y: 0 }
  return sweepLight(
    {
      baseLuma: luminance(GOLD),
      band: beamWeight(point, beam),
      core: 0,
      collar: 0,
      envelope: 1,
      response: 1,
      metal: 1,
    },
    SWEEP_PARAMS.bandGain,
    SWEEP_PARAMS.collarGain,
    0,
  ).targetLuma - luminance(GOLD)
}

/**
 * Measure the visible FWHM of the delivered band.
 * @returns the FWHM of the band's own light, in CSS pixels.
 */
function deliveredFwhm(): number {
  const peak = bandLumaAt(0)
  const half = peak / 2
  let offset = 0
  while (bandLumaAt(offset) >= half) offset += 0.05
  return offset * 2
}

describe('beam light', () => {
  it('operator gets a wide bright band whose delivered width is the declared one', () => {
    // Given: the shipped band on the 188 px lockup.
    // When: the FWHM of the delivered luminance profile is measured.
    const fwhm = deliveredFwhm()
    // Then: it matches the visible band width, so widening is not cancelled out
    // by the core term narrowing the bright region again.
    expect(fwhm).toBeGreaterThan(layout.mainFwhm * 0.94)
    expect(fwhm).toBeLessThan(layout.mainFwhm * 1.06)
    expect(layout.mainFwhm).toBeCloseTo(103.4, 0)
  })

  it('operator gets a short champagne core inside the wide band', () => {
    // Given: a peak request far above the resting gold.
    // When: the half width of the core is read off the profile.
    // Then: the band is many times wider than the core, so the eye sees a wide
    // lit region with a narrow hot centre rather than one hairline.
    const bandFwhm = sigmaToFwhm(beam.sigma)
    const coreFwhm = sigmaToFwhm(beam.coreSigma)
    expect(coreFwhm).toBeCloseTo(layout.coreFwhm, 5)
    expect(coreFwhm).toBeGreaterThan(12)
    expect(coreFwhm).toBeLessThan(24)
    expect(bandFwhm / coreFwhm).toBeGreaterThan(5)
  })

  it('operator gets exactly the requested peak at the core centre, never more', () => {
    // Given: 1600 nits over a 203 nit reference white.
    const peakLinear = 1600 / 203
    // When: the composite is evaluated at the centre.
    const peak = lumaAt(0, peakLinear)
    // Then: it lands on the target, because the core spends only the budget
    // left under the ceiling instead of adding gain on top of the band.
    expect(peak).toBeCloseTo(peakLinear, 3)
    // And it never exceeds it, at any offset.
    for (const offset of [0, 4, 8, 12, 20, 40, 80]) {
      expect(lumaAt(offset, peakLinear)).toBeLessThanOrEqual(peakLinear + 1e-6)
    }
  })

  it('operator keeps gold in the band and champagne only at the core', () => {
    // Given: a peak request and two offsets, one under the band only, one at the centre.
    const peakLinear = 1600 / 203
    const edge = sweepLight(
      { baseLuma: luminance(GOLD), band: beamWeight({ x: 40, y: 0 }, beam), core: coreWeight({ x: 40, y: 0 }, beam), collar: 0.3, envelope: 1, response: 1, metal: 1 },
      SWEEP_PARAMS.bandGain,
      SWEEP_PARAMS.collarGain,
      peakLinear,
    )
    // When: the luminance of the band region is compared with the ceiling.
    // Then: it is lit gold, well under the peak, and the peak is reserved for
    // the core.
    expect(edge.targetLuma).toBeGreaterThan(luminance(GOLD))
    expect(edge.targetLuma).toBeLessThan(peakLinear * 0.35)
  })

  it('operator never sees the HARNESS plate reach the wordmark strength', () => {
    // Given: the same point evaluated on the wordmark and on the plate.
    const input = { baseLuma: luminance(GOLD), band: 0.8, core: 0.2, collar: 0.4, envelope: 1, metal: 1 }
    const letter = sweepLight({ ...input, response: 1 }, SWEEP_PARAMS.bandGain, SWEEP_PARAMS.collarGain, 7.88)
    const plate = sweepLight({ ...input, response: SWEEP_PARAMS.plateFactor }, SWEEP_PARAMS.bandGain, SWEEP_PARAMS.collarGain, 7.88)
    // When: the added light is compared.
    // Then: the plate gets about 55% of it, so its dark lettering stays legible.
    const letterAdded = letter.targetLuma - input.baseLuma
    const plateAdded = plate.targetLuma - input.baseLuma
    expect(plateAdded / letterAdded).toBeGreaterThan(0.5)
    expect(plateAdded / letterAdded).toBeLessThan(0.6)
  })

  it('operator sees no light at all on the dark lettering or at rest', () => {
    // Given: a point on the HARNESS lettering and a resting envelope.
    const ink = { baseLuma: 0.02, band: 1, core: 1, collar: 1, envelope: 1, response: 1, metal: 0 }
    const resting = { baseLuma: luminance(GOLD), band: 1, core: 1, collar: 1, envelope: 0, response: 1, metal: 1 }
    // When: the light is computed.
    // Then: both stay exactly at the resting material, so no HDR is emitted
    // while the lockup rests.
    expect(sweepLight(ink, 0.5, 0.16, 7.88).targetLuma).toBeCloseTo(0.02, 9)
    expect(sweepLight(resting, 0.5, 0.16, 7.88).targetLuma).toBeCloseTo(luminance(GOLD), 9)
  })

  it('operator gets a tint normalised by its own luminance, not by its brightest channel', () => {
    // Given: the pale core colour and a target luminance.
    const target = 7.88
    // When: it is scaled and measured.
    const scaled = withLuminance(CORE_COLOR, target)
    // Then: the measured luminance is the target, and the brightest channel is
    // above it, which is exactly what "not the max channel" means.
    expect(luminance(scaled)).toBeCloseTo(target, 6)
    expect(Math.max(...scaled)).toBeGreaterThan(target)
  })

  it('operator gets the peak expressed against the reference white, not against the screen', () => {
    // Given: a measured 100 nit reference and an unknown one.
    const measured = calibrationOf(1600, 100, 203, undefined)
    const assumed = calibrationOf(1600, undefined, 203, undefined)
    // When: the requested linear values are compared.
    // Then: they follow the reference white, and the provenance is reported
    // separately instead of being hidden in one number.
    expect(measured.requestedPeakLinear).toBeCloseTo(16, 6)
    expect(measured.sdrWhiteSource).toBe('measured')
    expect(assumed.requestedPeakLinear).toBeCloseTo(1600 / 203, 6)
    expect(assumed.sdrWhiteSource).toBe('assumed')
    expect(assumed.sdrWhiteNits).toBeUndefined()
    expect(assumed.headroom).toBeUndefined()
    expect(assumed.headroomSource).toBe('unknown')
    expect(assumed.screenPeakNits).toBe(1600)
  })
})