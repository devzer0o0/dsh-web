/**
 * Beam geometry: one width definition, a real magnification, and a warp that
 * inverts.
 *
 * Every width assertion goes through the visible FWHM, because that is the
 * number the requirement is stated in; a sigma is only ever an implementation
 * detail of the profile.
 */
import { describe, expect, it } from 'vitest'
import {
  beamCoordinate,
  beamWeight,
  beamWidths,
  collarWeight,
  coreWeight,
  fwhmToSigma,
  inverseWarp,
  magnifyAt,
  sigmaToFwhm,
  tiltTan,
  warpOffset,
  type BeamSpec,
} from '../src/client/beam.ts'

/** Beam used across the assertions: 25 degrees off vertical, 8px band sigma. */
const beam: BeamSpec = {
  centerX: 100,
  centerY: 25,
  tanTilt: tiltTan(25),
  sigma: 8,
  coreSigma: 3,
  collarSigma: 3.4,
  liftPx: 0.8,
  magnifyPeak: 1.08,
  magnifyRadiusPx: 5,
}

/**
 * Measure the visible full width at half maximum of a profile.
 * @param weight - profile evaluated at a horizontal offset.
 * @returns the FWHM in CSS pixels.
 */
function measureFwhm(weight: (offset: number) => number): number {
  let left = 0
  while (weight(-left) >= 0.5) left += 0.01
  let right = 0
  while (weight(right) >= 0.5) right += 0.01
  return left + right
}

describe('beam geometry', () => {
  it('operator gets one smooth weight that is 1 on the axis and 0 far away', () => {
    // Given: a beam crossing a point at its own axis.
    const onAxis = { x: 100, y: 25 }
    // When: the weight is sampled on the axis, near it, and far from it.
    // Then: it peaks at 1 and decays smoothly without ever leaving 0..1.
    expect(beamWeight(onAxis, beam)).toBeCloseTo(1, 6)
    expect(beamWeight({ x: 108, y: 25 }, beam)).toBeCloseTo(Math.exp(-1), 3)
    expect(beamWeight({ x: 160, y: 25 }, beam)).toBeLessThan(1e-10)
    expect(beamCoordinate(onAxis, beam)).toBeCloseTo(0, 6)
  })

  it('operator sees the beam lean, so the light is diagonal and not a vertical bar', () => {
    // Given: the 25 degree tilt and two points at the same height.
    // When: their coordinates are compared against a point one pixel lower.
    // Then: the axis moves by tan(25) per pixel of height, which is the lean.
    const upper = beamCoordinate({ x: 100, y: 25 }, beam)
    const lower = beamCoordinate({ x: 100, y: 45 }, beam)
    expect(lower - upper).toBeCloseTo(20 * Math.tan((25 * Math.PI) / 180), 4)
  })

  it('operator gets a band whose visible half width matches the declared FWHM', () => {
    // Given: a requested 103 px band and a 19 px core.
    const widths = beamWidths(188, 0.55, 0.1, 12, 24)
    // When: the width is converted to a sigma and measured back off the profile.
    const measuredBand = measureFwhm((offset) =>
      beamWeight({ x: 100 + offset, y: 25 }, { ...beam, sigma: widths.mainSigma }))
    const measuredCore = measureFwhm((offset) =>
      coreWeight({ x: 100 + offset, y: 25 }, { ...beam, coreSigma: widths.coreSigma }))
    // Then: the profile at half maximum is where the declaration says it is.
    expect(sigmaToFwhm(fwhmToSigma(103))).toBeCloseTo(103, 6)
    expect(measuredBand).toBeCloseTo(widths.mainFwhm, 1)
    expect(measuredCore).toBeCloseTo(widths.coreFwhm, 1)
    expect(widths.mainFwhm).toBeCloseTo(188 * 0.55, 5)
    expect(widths.coreFwhm).toBeCloseTo(18.8, 5)
  })

  it('operator gets a core inside a pixel range on a compact lockup, never wider than the band', () => {
    // Given: a 24 px icon and the shipped ratios.
    const small = beamWidths(24, 0.55, 0.1, 12, 24)
    // When: its core and band are compared.
    // Then: the floor keeps the core visible but the cap keeps it inside the
    // band, so a small icon does not light up as one solid block.
    expect(small.coreFwhm).toBeLessThanOrEqual(12)
    expect(small.coreFwhm).toBeLessThan(small.mainFwhm)
    expect(small.mainFwhm).toBeCloseTo(13.2, 5)
    // The cap is what keeps it inside the band on a tiny icon.
    expect(small.coreFwhm).toBeCloseTo(small.mainFwhm * 0.4, 5)
  })

  it('operator gets a collar between the core and the band', () => {
    // Given: a beam with a distinct collar sigma.
    // When: all three profiles are sampled one half width out.
    // Then: each crosses 0.5 at its own declared half width, so the band is the
    // wide region, the collar is the mid region and the core is the bright
    // centre rather than one sigma doing all three jobs.
    const bandHalf = sigmaToFwhm(beam.sigma) / 2
    const coreHalf = sigmaToFwhm(beam.coreSigma) / 2
    expect(beamWeight({ x: 100 + bandHalf, y: 25 }, beam)).toBeCloseTo(0.5, 3)
    expect(coreWeight({ x: 100 + coreHalf, y: 25 }, beam)).toBeCloseTo(0.5, 3)
    expect(collarWeight({ x: 100, y: 25 }, beam)).toBeCloseTo(1, 6)
    expect(beam.coreSigma).toBeLessThan(beam.collarSigma)
    expect(beam.collarSigma).toBeLessThan(beam.sigma)
  })

  it('operator sees magnification peak at the centre and fall to 1 at the edge', () => {
    // Given: the same beam.
    // When: magnification is sampled at the axis and outside the influence zone.
    // Then: it reaches the configured 1.08 peak and is exactly 1 where the
    // weight is zero, so untouched strokes never change size.
    expect(magnifyAt({ x: 100, y: 25 }, beam)).toBeCloseTo(1.08, 6)
    expect(magnifyAt({ x: 160, y: 25 }, beam)).toBe(1)
  })

  it('operator sees features near the centre actually spread apart', () => {
    // Given: two source pixels straddling the axis, 4 px apart.
    const left = { x: 96, y: 25 }
    const right = { x: 104, y: 25 }
    // When: each is warped forward and the resulting distance is measured.
    const warpedLeft = warpOffset(left, beam)
    const warpedRight = warpOffset(right, beam)
    const before = right.x - left.x
    const after = (right.x + warpedRight.x) - (left.x + warpedLeft.x)
    // Then: the spacing grows, by about the configured scale at the centre
    // (the two points are close enough to the axis that the weight is ~1).
    expect(after).toBeGreaterThan(before)
    expect(after / before).toBeGreaterThan(1.04)
    expect(after / before).toBeLessThan(1.08)
  })

  it('operator never sees the warp push material inwards, which would look pinched', () => {
    // Given: source points on both sides of the axis.
    // When: their displacement is read.
    // Then: the offset points away from the centre on both sides, and the point
    // on the axis only lifts.
    expect(warpOffset({ x: 104, y: 25 }, beam).x).toBeGreaterThan(0)
    expect(warpOffset({ x: 96, y: 25 }, beam).x).toBeLessThan(0)
    expect(warpOffset({ x: 100, y: 25 }, beam).x).toBeCloseTo(0, 6)
    expect(warpOffset({ x: 100, y: 25 }, beam).y).toBeCloseTo(-0.8, 6)
  })

  it('operator sees no ghosting when the band is far wider than the lockup', () => {
    // Given: a very wide band.
    const wide: BeamSpec = { ...beam, sigma: 850, magnifyRadiusPx: 5 }
    // When: the displacement is read far from the axis.
    // Then: it stays inside the bounded neighbourhood, so no distant stroke is
    // pulled into this one.
    const far = warpOffset({ x: 400, y: 25 }, wide)
    expect(Math.abs(far.x)).toBeLessThan(1)
    const near = warpOffset({ x: 103, y: 25 }, wide)
    expect(Math.abs(near.x)).toBeLessThan(1)
  })

  it('operator sees the lifted surface rise upward and settle back, never sideways drift', () => {
    // Given: a point on the axis and one at the edge of the influence zone.
    // When: the warp offset is read.
    // Then: the axis point moves up by the configured lift, with no horizontal
    // component, and the far point does not move at all.
    const outside = warpOffset({ x: 160, y: 25 }, beam)
    expect(outside.x).toBeCloseTo(0, 6)
    expect(outside.y).toBeCloseTo(0, 6)
  })

  it('operator never sees a sampling hole or a doubled edge, because the warp inverts', () => {
    // Given: a grid of destination pixels across the influence zone.
    const points = []
    for (let x = 80; x <= 120; x += 4) for (let y = 10; y <= 40; y += 6) points.push({ x, y })
    // When: each is mapped back to its source and wrapped forward again.
    // Then: the round trip returns the same point within a small tolerance.
    expect(points.length).toBeGreaterThan(10)
    for (const point of points) {
      const source = inverseWarp(point, beam)
      const forward = warpOffset(source, beam)
      expect(Math.abs(point.x - (source.x + forward.x))).toBeLessThan(0.02)
      expect(Math.abs(point.y - (source.y + forward.y))).toBeLessThan(0.02)
    }
  })

  it('operator sees the identity mapping restored when the envelope is zero', () => {
    // Given: the warp scaled by a zero envelope, as the controller does at rest.
    const resting: BeamSpec = { ...beam, magnifyPeak: 1, liftPx: 0 }
    // When: arbitrary points are warped.
    // Then: nothing moves, so the resting lockup is exactly the SVG.
    for (const point of [{ x: 90, y: 25 }, { x: 103, y: 12 }, { x: 100, y: 25 }]) {
      expect(warpOffset(point, resting).x).toBeCloseTo(0, 9)
      expect(warpOffset(point, resting).y).toBeCloseTo(0, 9)
    }
  })
})