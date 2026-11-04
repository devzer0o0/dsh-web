/**
 * Colour pipeline: decode CSS paints into linear light, compute the material in
 * linear light, then encode to the canvas' declared output space.
 *
 * The spaces are kept strictly apart:
 *
 * 1. Input — CSS paints and the rasterized SVG are sRGB-encoded. The material
 *    texture is `rgba8unorm-srgb`, so its decode happens in hardware;
 *    `srgbToLinear` is the reference implementation, used by tests and by any
 *    colour that arrives as text.
 * 2. Lighting — every mix and gain happens in linear light (`light.ts`).
 * 3. Output — the canvas declares `colorSpace: 'srgb'`, so the shader encodes
 *    with the sRGB transfer curve, **continued above 1.0 by the formula itself**
 *    rather than by a linear pass-through: `1.055 * v^(1/2.4) - 0.055` is the
 *    same function on both sides of white, so extended values stay on the same
 *    curve and the encode is invertible everywhere.
 *
 * The extended range itself comes from `toneMapping: { mode: 'extended' }`, not
 * from the encode. Tone mapping and alpha compositing are independent dials: see
 * `renderer.ts` for the two supported combinations.
 *
 * @module dsh-brand-gold/color
 */

/** Linear RGB triple. */
export type Linear = readonly [number, number, number]

/**
 * Decode one sRGB-encoded channel into linear light.
 * @param value - 0..1 sRGB component.
 * @returns linear component.
 */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * Encode one linear channel with the sRGB curve, extended above white.
 *
 * The standard piecewise transfer up to 1.0, and the same power branch beyond
 * it, so a linear 4.0 encodes to about 1.63 instead of passing through as 4.0.
 * Returning the input unchanged above 1 would be a linear output wearing an sRGB
 * label, and it would make every luminance computed from a readback wrong.
 *
 * @param value - linear component.
 * @returns encoded component, which may exceed 1.
 */
export function linearToSrgb(value: number): number {
  const v = Math.max(value, 0)
  if (v <= 0.0031308) return v * 12.92
  return 1.055 * v ** (1 / 2.4) - 0.055
}

/**
 * Decode an encoded channel that may lie above white.
 * @param value - encoded component.
 * @returns linear component.
 */
export function srgbToLinearExtended(value: number): number {
  const v = Math.max(value, 0)
  if (v <= 0.04045) return v / 12.92
  return ((v + 0.055) / 1.055) ** 2.4
}

/**
 * Decode an RGB triple.
 * @param rgb - sRGB components in 0..1.
 * @returns linear components.
 */
export function linearize(rgb: Linear): Linear {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
}

/**
 * Encode a linear triple.
 * @param rgb - linear components.
 * @returns encoded components, which may exceed 1.
 */
export function encodeSrgb(rgb: Linear): Linear {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])]
}
