/**
 * Colour pipeline: sRGB decode, linear lighting, and an extended sRGB encode
 * that stays on the same curve above white.
 */
import { describe, expect, it } from 'vitest'
import {
  encodeSrgb,
  linearToSrgb,
  linearize,
  srgbToLinear,
  srgbToLinearExtended,
} from '../src/client/color.ts'

describe('colour pipeline', () => {
  it('operator gets a correct sRGB decode at the standard landmarks', () => {
    // Given: the sRGB transfer function.
    // When: black, mid grey and white are decoded to linear light.
    // Then: the mid grey lands where the standard puts it, not at 0.5.
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 6)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 6)
  })

  it('operator gets the same value back after decode and encode', () => {
    // Given: a set of encoded components across the whole SDR range.
    // When: they are decoded and encoded again.
    // Then: the round trip is stable, so the renderer never double-decodes.
    for (const value of [0, 0.02, 0.1, 0.5, 0.75, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 5)
    }
  })

  it('operator gets the sRGB curve continued above white, not a linear pass-through', () => {
    // Given: linear values above diffuse white.
    // When: they are encoded for the srgb canvas.
    // Then: the same power branch applies, so 2.0 encodes to about 1.36 and 4.0
    // to about 1.63 — not to 2.0 and 4.0, which would be linear output wearing
    // an sRGB label.
    expect(linearToSrgb(1)).toBeCloseTo(1, 6)
    expect(linearToSrgb(2)).toBeCloseTo(1.055 * 2 ** (1 / 2.4) - 0.055, 6)
    expect(linearToSrgb(4)).toBeCloseTo(1.055 * 4 ** (1 / 2.4) - 0.055, 6)
    expect(linearToSrgb(4)).toBeGreaterThan(1.8)
    expect(linearToSrgb(4)).toBeLessThan(1.9)
    expect(linearToSrgb(16)).toBeGreaterThan(2.4)
  })

  it('operator gets an invertible encode at extended values', () => {
    // Given: linear values from below the knee to a strong HDR peak.
    const values = [0.0001, 0.002, 0.0031308, 0.02, 0.5, 1, 1.5, 2, 7.88, 16]
    // When: each is encoded and decoded again.
    // Then: the round trip returns the original, so a readback can be trusted as
    // linear light instead of being an encoded channel pretending to be one.
    for (const value of values) {
      expect(srgbToLinearExtended(linearToSrgb(value))).toBeCloseTo(value, 6)
    }
  })

  it('operator never gets a finite value that the encode turns into infinity', () => {
    // Given: a large but finite luminance.
    const big = 60000
    // When: it is encoded and decoded.
    // Then: the result stays finite and ordered, so a pathological value cannot
    // read as "the brightest possible".
    expect(Number.isFinite(linearToSrgb(big))).toBe(true)
    expect(linearToSrgb(big)).toBeGreaterThan(linearToSrgb(16))
  })

  it('operator sees a palette decoded once, not twice', () => {
    // Given: an encoded colour triple.
    // When: it is linearized for the shader.
    // Then: each channel is decoded exactly once.
    const linear = linearize([1, 0.5, 0])
    expect(linear[0]).toBeCloseTo(1, 6)
    expect(linear[1]).toBeCloseTo(0.214, 3)
    expect(linear[2]).toBe(0)
  })

  it('operator gets an encoded triple that follows the same curve per channel', () => {
    // Given: a linear triple with one extended channel.
    const encoded = encodeSrgb([0.5, 1.5, 3])
    // When: it is compared with the single-channel function.
    // Then: the channels are encoded independently and consistently.
    expect(encoded[0]).toBeCloseTo(linearToSrgb(0.5), 9)
    expect(encoded[1]).toBeCloseTo(linearToSrgb(1.5), 9)
    expect(encoded[2]).toBeCloseTo(linearToSrgb(3), 9)
    expect(encoded[2]).toBeGreaterThan(1)
  })
})