/**
 * Colour pipeline: sRGB decode, linear lighting, extended sRGB encode.
 *
 * The three spaces are asserted separately, because mixing them is what let an
 * earlier version call an encoded number a luminance multiplier.
 */
import { describe, expect, it } from 'vitest'
import { linearToSrgb, linearize, srgbToLinear } from '../src/client/color.ts'

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
    // Given: a set of encoded components across the whole range.
    // When: they are decoded and encoded again.
    // Then: the round trip is stable, so the renderer never double-decodes.
    for (const value of [0, 0.02, 0.1, 0.5, 0.75, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 5)
    }
  })

  it('operator keeps extended values above 1 instead of clipping them', () => {
    // Given: linear values above diffuse white.
    // When: they are encoded for the extended-range canvas.
    // Then: the encode continues linearly above 1, so the framebuffer receives
    // a value above 1 rather than a clamped white.
    expect(linearToSrgb(1)).toBeCloseTo(1, 6)
    expect(linearToSrgb(2)).toBeCloseTo(2, 6)
    expect(linearToSrgb(4)).toBeCloseTo(4, 6)
    expect(linearToSrgb(4)).toBeGreaterThan(1)
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
})
