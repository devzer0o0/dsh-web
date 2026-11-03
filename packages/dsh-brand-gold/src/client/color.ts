/**
 * Colour pipeline: decode CSS paints into linear light, compute the material
 * in linear light, then encode to the canvas' declared output space.
 *
 * The three spaces are kept strictly apart:
 *
 * 1. Input — CSS paints and the rasterized SVG are sRGB-encoded. `srgbToLinear`
 *    is the only place they are decoded.
 * 2. Lighting — every mix and gain happens in linear light.
 * 3. Output — the canvas is configured `rgba16float` + `toneMapping.extended` +
 *    `colorSpace: 'srgb'`, so the shader encodes with the extended sRGB curve:
 *    the transfer function continues above 1.0 linearly instead of clipping, and
 *    the framebuffer keeps values above 1.0 for the compositor.
 *
 * The canvas is opaque (`alphaMode: 'opaque'`): over-unity values were measured
 * to survive only on an opaque surface. Coverage therefore comes from the shape
 * itself — the shader writes the RGB zero wherever the material is not metal —
 * and the canvas is displayed through a CSS mask built from the same warped
 * shape, so nothing is ever painted over the sidebar background.
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
 * Encode one linear channel with the extended sRGB curve.
 *
 * This is the exact function the shader runs (`encode` in `renderer.ts`):
 * the standard sRGB transfer up to 1.0, then a linear continuation above it, so
 * a value of 2.0 stays 2.0 instead of being pulled back under 1.0 by the
 * `1.055 * v^(1/2.4)` branch. Anything that encodes differently here would be a
 * second, disagreeing colour pipeline.
 *
 * @param value - linear component; values above 1 are preserved above 1.
 * @returns encoded component.
 */
export function linearToSrgb(value: number): number {
  const v = Math.max(value, 0)
  if (v <= 0.0031308) return v * 12.92
  if (v > 1) return v
  return 1.055 * v ** (1 / 2.4) - 0.055
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
 * Parse any CSS colour into sRGB components.
 *
 * The browser is the parser: the value is painted onto a 1x1 canvas and read
 * back, which handles `rgb()`, `rgba()`, `color(srgb ...)`, `oklch()`, named
 * colours and `color-mix()` alike. Unsupported values paint nothing, so the
 * probe pixel stays at its transparent initial state.
 *
 * @param css - colour text.
 * @returns 0..1 sRGB components with alpha, or undefined when unparseable.
 */
export function parseCssColor(css: string): [number, number, number, number] | undefined {
  if (typeof document === 'undefined') return undefined
  const trimmed = css.trim()
  if (trimmed === '' || trimmed === 'none' || trimmed === 'transparent') return undefined
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return undefined
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = trimmed
    if (ctx.fillStyle === '#000' && /^#[0]{3,8}$/i.test(trimmed) === false && trimmed.startsWith('#')) return undefined
    ctx.globalCompositeOperation = 'copy'
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    const alpha = (data[3] ?? 0) / 255
    if (alpha <= 0) return undefined
    return [(data[0] ?? 0) / 255, (data[1] ?? 0) / 255, (data[2] ?? 0) / 255, alpha]
  } catch {
    return undefined
  }
}

/**
 * Resolve a CSS custom property on an element.
 * @param element - element to read from.
 * @param name - custom property name, including the leading dashes.
 * @param fallback - value when the property is not set.
 * @returns the resolved text.
 */
export function readCustomProperty(element: Element, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** The material palette in linear light, plus the tints of the sweep. */
export interface MaterialPalette {
  /** Gold ramp, dark end (shadow side). */
  readonly goldDeep: Linear
  /** Gold ramp, mid tone. */
  readonly goldMid: Linear
  /** Gold ramp, lit end. */
  readonly goldLight: Linear
  /** HARNESS plate, mid tone, deliberately softer than the letters. */
  readonly plateMid: Linear
  /** HARNESS plate, lit end. */
  readonly plateLight: Linear
  /** HARNESS lettering; never lit by the sweep. */
  readonly plateInk: Linear
  /** Specular core, pale gold to warm white. */
  readonly core: Linear
  /** Collar around the core, champagne. */
  readonly collar: Linear
  /** Rim highlight on the leading edge of a lifted stroke. */
  readonly rim: Linear
  /** Shadow under the trailing edge, warm brown. */
  readonly shade: Linear
}

/** Fallback palette: the dark-theme ramp from `brand-gold.module.css`. */
const FALLBACK_TINTS = {
  goldDeep: '#795019',
  goldMid: '#C08E2C',
  goldLight: '#EFCB7C',
  plateMid: '#CBA043',
  plateLight: '#F6E3B2',
  plateInk: '#2E2008',
} as const

/**
 * Build the palette from the live CSS custom properties.
 * @param element - element the theme variables are resolved on.
 * @returns the palette in linear light.
 */
export function readPalette(element: Element): MaterialPalette {
  const tint = (name: string, fallback: string): Linear => {
    const parsed = parseCssColor(readCustomProperty(element, name, fallback))
    if (parsed === undefined) return linearize(hexToUnit(fallback))
    // The custom properties are sRGB-encoded CSS colours: decode once, here.
    return linearize([parsed[0], parsed[1], parsed[2]])
  }
  const goldDeep = tint('--bg-gold-7', FALLBACK_TINTS.goldDeep)
  const goldMid = tint('--bg-gold-4', FALLBACK_TINTS.goldMid)
  const goldLight = tint('--bg-gold-0', FALLBACK_TINTS.goldLight)
  return {
    goldDeep,
    goldMid,
    goldLight,
    plateMid: tint('--bg-gold-plate-3', FALLBACK_TINTS.plateMid),
    plateLight: tint('--bg-gold-plate-0', FALLBACK_TINTS.plateLight),
    plateInk: tint('--bg-gold-ink', FALLBACK_TINTS.plateInk),
    core: [1.0, 0.972, 0.902],
    collar: [1.0, 0.878, 0.678],
    rim: [1.0, 0.949, 0.82],
    shade: [0.086, 0.055, 0.019],
  }
}

/**
 * Parse a `#rrggbb` literal into 0..1 components.
 * @param hex - colour literal.
 * @returns sRGB components.
 */
function hexToUnit(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ]
}

/**
 * Detect the light theme the shell signals by dropping `data-ds-dark-theme`.
 * @param element - element inside the brand lockup.
 * @returns true in the light theme.
 */
export function isLightTheme(element: Element): boolean {
  const root = element.ownerDocument?.body ?? null
  if (root === null) return false
  return !root.hasAttribute('data-ds-dark-theme')
}
