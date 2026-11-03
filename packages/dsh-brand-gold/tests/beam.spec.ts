/**
 * Beam geometry: one weight drives magnification, lift, light and highlight, and
 * the warp is invertible so the shader can sample through it.
 */
import { describe, expect, it } from 'vitest'
import {
  beamCoordinate,
  beamWeight,
  inverseWarp,
  magnifyAt,
  tiltTan,
  warpOffset,
  type BeamSpec,
} from '../src/client/beam.ts'

/** Beam used across the assertions: 25 degrees off vertical, 8px falloff. */
const beam: BeamSpec = {
  centerX: 100,
  centerY: 25,
  tanTilt: tiltTan(25),
  sigma: 8,
  liftPx: 0.8,
  magnifyPeak: 1.08,
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

  it('operator sees magnification peak at the centre and fall to 1 at the edge', () => {
    // Given: the same beam.
    // When: magnification is sampled at the axis and outside the influence zone.
    // Then: it reaches the configured 1.08 peak and is exactly 1 where the
    // weight is zero, so untouched strokes never change size.
    expect(magnifyAt({ x: 100, y: 25 }, beam)).toBeCloseTo(1.08, 6)
    expect(magnifyAt({ x: 160, y: 25 }, beam)).toBe(1)
  })

  it('operator sees the lifted surface rise upward and settle back, never sideways drift', () => {
    // Given: a point on the axis and one at the edge of the influence zone.
    // When: the warp offset is read.
    // Then: the axis point moves up by the configured lift, with no horizontal
    // component, and the far point does not move at all.
    const centre = warpOffset({ x: 100, y: 25 }, beam)
    expect(centre.x).toBeCloseTo(0, 6)
    expect(centre.y).toBeCloseTo(-0.8, 6)
    const outside = warpOffset({ x: 160, y: 25 }, beam)
    expect(outside.x).toBeCloseTo(0, 6)
    expect(outside.y).toBeCloseTo(0, 6)
  })

  it('operator never sees a sampling hole or a doubled edge, because the warp inverts', () => {
    // Given: a grid of destination pixels across the influence zone.
    // When: each is mapped back to its source and wrapped forward again.
    // Then: the round trip returns the same point within a small tolerance, so
    // the shader samples exactly the material that belongs at each pixel.
    const points = []
    for (let x = 80; x <= 120; x += 4) for (let y = 10; y <= 40; y += 6) points.push({ x, y })
    expect(points.length).toBeGreaterThan(10)
    for (const point of points) {
      const source = inverseWarp(point, beam)
      const forward = warpOffset(source, beam)
      expect(Math.abs(point.x - (source.x + forward.x))).toBeLessThan(0.02)
      expect(Math.abs(point.y - (source.y + forward.y))).toBeLessThan(0.02)
    }
  })
})
