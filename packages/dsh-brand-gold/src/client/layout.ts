/**
 * Brand coordinate system.
 *
 * The whale mark, the wordmark and the HARNESS plate live in two different
 * SVGs with unrelated viewBoxes. Nothing here treats a viewBox as shared
 * geometry: every part is measured from its **rendered** box, mapped into one
 * viewport coordinate system, and the sweep travels across that system. The
 * canvas and the beam therefore see a single lockup, and the beam crosses the
 * gap between the icon and the wordmark instead of restarting.
 *
 * Units are explicit and converted once:
 *
 * - `box` is the element's rendered box in CSS pixels, never a viewBox size;
 * - `cssScale` is CSS pixels per viewBox unit (the viewBox ratio, with
 *   `preserveAspectRatio` meet semantics);
 * - `dpr` is the only CSS-to-device conversion, applied after the ratio;
 * - `offsetX/offsetY` place a part's viewBox origin in canvas device pixels,
 *   shared padding included.
 *
 * Travel is computed from the **whole band**, not from a tenth of the width:
 * the beam coordinate `q = x + (y - centerY) * tan(tilt)` is measured over every
 * metal vertex, the support radius `R` is taken from the wide band's sigma, and
 * the beam centre runs from `qMin - R - padding` to `qMax + R + padding`, so the
 * first surface is a full band away from the entry point and the last one is a
 * full band away from the exit point.
 *
 * @module dsh-brand-gold/layout
 */

import { beamWidths, fwhmToSigma, tiltTan } from './beam.ts'
import { metalExtent, type ShapeGeometry } from './geometry-mask.ts'
import { SWEEP_PARAMS, type SweepParams } from './sweep.ts'

/** Box in viewport CSS pixels, top-left origin. */
export interface Box {
  /** Left edge. */
  readonly left: number
  /** Top edge. */
  readonly top: number
  /** Width. */
  readonly width: number
  /** Height. */
  readonly height: number
}

/** A rounded plate drawn by a part, in that part's viewBox units. */
export interface PlateGeometry {
  /** Left edge in viewBox units. */
  readonly x: number
  /** Top edge in viewBox units. */
  readonly y: number
  /** Width in viewBox units. */
  readonly width: number
  /** Height in viewBox units. */
  readonly height: number
  /** Corner radius in viewBox units. */
  readonly rx: number
}

/** What one brand occupant contributes to the shared lockup. */
export interface BrandGeometry {
  /** Silhouette path data in the part's viewBox units. */
  readonly paths: readonly string[]
  /** Rounded plates painted by the part (the HARNESS plate). */
  readonly plates?: readonly PlateGeometry[]
  /** Paths that must stay unlit inside a plate (the HARNESS lettering). */
  readonly plateExclusions?: readonly string[]
  /** The part's viewBox, `minX minY width height`. */
  readonly viewBox: string
}

/** Device-pixel rectangle a part may paint into. */
export interface ClipRect {
  /** Left edge in device pixels. */
  readonly left: number
  /** Top edge in device pixels. */
  readonly top: number
  /** Width in device pixels; never rounded, so the material is not rescaled. */
  readonly width: number
  /** Height in device pixels. */
  readonly height: number
}

/** Mapping from a part's viewBox units to the shared canvas. */
export interface PartTransform {
  /** Device pixels per viewBox unit. */
  readonly scale: number
  /** CSS pixels per viewBox unit (the viewBox ratio, DPR excluded). */
  readonly cssScale: number
  /** Device pixels per CSS pixel of this layout. */
  readonly dpr: number
  /** Canvas device-pixel position of the viewBox origin. */
  readonly offsetX: number
  /** Canvas device-pixel position of the viewBox origin. */
  readonly offsetY: number
  /** Canvas device-pixel size of the mapped viewBox. */
  readonly width: number
  /** Canvas device-pixel size of the mapped viewBox. */
  readonly height: number
  /** The part's own box in device pixels; nothing outside it may be painted. */
  readonly clip: ClipRect
  /** Rendered box in viewport CSS pixels. */
  readonly box: Box
}

/** Stage windows inside one sweep, in milliseconds from its start. */
export interface SweepPhases {
  /** Length of the entry stage. */
  readonly entryMs: number
  /** Length of the body stage. */
  readonly surfaceMs: number
  /** Length of the exit stage. */
  readonly exitMs: number
  /** End of the entry stage, where the first surface starts to be lit. */
  readonly surfaceStartMs: number
  /** Start of the exit stage, after the last surface was lit. */
  readonly exitStartMs: number
}

/** Rendering parameters for one sweep, shared by every canvas. */
export interface LockupLayout {
  /** Union of every part's rendered box, in viewport CSS pixels. */
  readonly box: Box
  /** Device pixels per pixel of the canvas, at the current DPR. */
  readonly dpr: number
  /** Canvas size in device pixels (the union box plus the draw padding). */
  readonly width: number
  readonly height: number
  /** Wide gold band sigma, in device pixels. */
  readonly sigma: number
  /** Champagne core sigma, in device pixels. */
  readonly coreSigma: number
  /** Champagne collar sigma, in device pixels. */
  readonly collarSigma: number
  /** Wide gold band visible FWHM, in CSS pixels. */
  readonly mainFwhm: number
  /** Champagne core visible FWHM, in CSS pixels. */
  readonly coreFwhm: number
  /** Radius of the local magnification, in device pixels. */
  readonly magnifyRadiusPx: number
  /** Finite support radius of the band, in device pixels. */
  readonly supportRadius: number
  /** Vertical centre the beam tilt is measured from, in device pixels. */
  readonly centerY: number
  /** Smallest band coordinate that covers metal, in device pixels. */
  readonly qMin: number
  /** Largest band coordinate that covers metal, in device pixels. */
  readonly qMax: number
  /** First beam centre: a whole support radius before the leftmost surface. */
  readonly centerStart: number
  /** Last beam centre: a whole support radius after the rightmost surface. */
  readonly centerEnd: number
  /** Padding around the union box, in CSS pixels, so the warp cannot clip. */
  readonly pad: number
  /** Stage windows of the sweep. */
  readonly phases: SweepPhases
  /** Part transforms keyed by part id. */
  readonly parts: ReadonlyMap<string, PartTransform>
}

/**
 * Union of two boxes.
 * @param a - first box.
 * @param b - second box.
 * @returns the enclosing box.
 */
export function unionBox(a: Box, b: Box): Box {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  const right = Math.max(a.left + a.width, b.left + b.width)
  const bottom = Math.max(a.top + a.height, b.top + b.height)
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * Viewport box of a rendered element.
 * @param element - the occupant's root element.
 * @returns its box, or undefined when it has no layout box yet.
 */
export function boxOf(element: Element): Box | undefined {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return undefined
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/**
 * Map a part's viewBox onto its rendered box, honouring `preserveAspectRatio`
 * meet semantics (the shell fixes the box to the viewBox aspect, but a rounded
 * width must not skew the geometry).
 *
 * @param viewBox - `minX minY width height`.
 * @param box - rendered box in viewport CSS pixels.
 * @param origin - top-left of the lockup in viewport CSS pixels.
 * @param dpr - device pixels per CSS pixel.
 * @param pad - canvas padding in CSS pixels.
 * @returns the transform for that part.
 */
export function partTransform(
  viewBox: string,
  box: Box,
  origin: { readonly left: number; readonly top: number },
  dpr: number,
  pad: number,
): PartTransform {
  const [minX = 0, minY = 0, vbWidth = 1, vbHeight = 1] = viewBox.split(/\s+/).map(Number)
  const cssScale = Math.min(box.width / Math.max(vbWidth, 1e-6), box.height / Math.max(vbHeight, 1e-6))
  // The artwork is centred inside its own box when the box is not exactly the
  // viewBox aspect; both offsets are derived from the same ratio, so the
  // material, the mask and the plate quad agree to the pixel.
  const contentLeft = box.left + (box.width - vbWidth * cssScale) / 2
  const contentTop = box.top + (box.height - vbHeight * cssScale) / 2
  const offsetX = (contentLeft - origin.left + pad) * dpr
  const offsetY = (contentTop - origin.top + pad) * dpr
  const width = vbWidth * cssScale * dpr
  const height = vbHeight * cssScale * dpr
  return {
    scale: cssScale * dpr,
    cssScale,
    dpr,
    offsetX,
    offsetY,
    width,
    height,
    clip: { left: offsetX, top: offsetY, width, height },
    box,
  }
}

/**
 * The support radius of the band, in CSS pixels.
 * @param mainFwhm - visible band width, in CSS pixels.
 * @param params - sweep dials.
 * @returns the radius where the profile is exactly zero.
 */
export function supportRadiusCss(mainFwhm: number, params: SweepParams = SWEEP_PARAMS): number {
  return fwhmToSigma(mainFwhm) * params.supportSigmas
}

/**
 * Band-coordinate extent of the metal, in device pixels.
 *
 * @param layout - the lockup.
 * @param shapes - geometry per part id, when the mask was built.
 * @param tanTilt - tangent of the beam lean.
 * @returns the extent, from the metal itself when it is known.
 */
export function bandExtent(
  layout: Pick<LockupLayout, 'box' | 'pad' | 'dpr' | 'centerY' | 'parts'>,
  shapes: ReadonlyMap<string, ShapeGeometry> | undefined,
  tanTilt: number,
): { min: number; max: number } {
  const full = shapes === undefined
    ? undefined
    : metalExtent(layout as LockupLayout, shapes, tanTilt)
  if (full !== undefined) return full
  // Without geometry, the union box corners are the conservative bound. They
  // include the lean at both vertical extremes, so the ends are still covered.
  const left = layout.pad * layout.dpr
  const right = (layout.pad + layout.box.width) * layout.dpr
  const top = layout.pad * layout.dpr
  const bottom = (layout.pad + layout.box.height) * layout.dpr
  const q = [
    left + (top - layout.centerY) * tanTilt,
    left + (bottom - layout.centerY) * tanTilt,
    right + (top - layout.centerY) * tanTilt,
    right + (bottom - layout.centerY) * tanTilt,
  ]
  return { min: Math.min(...q), max: Math.max(...q) }
}

/**
 * Build the shared layout from the live part boxes.
 * @param boxes - rendered box per part id.
 * @param viewBoxes - viewBox per part id.
 * @param dpr - device pixels per CSS pixel.
 * @param params - sweep dials.
 * @param shapes - geometry per part id, used for the exact band extent.
 * @returns the layout, or undefined when a part has collapsed.
 */
export function buildLayout(
  boxes: ReadonlyMap<string, Box>,
  viewBoxes: ReadonlyMap<string, string>,
  dpr: number,
  params: SweepParams = SWEEP_PARAMS,
  shapes?: ReadonlyMap<string, ShapeGeometry>,
): LockupLayout | undefined {
  if (boxes.size === 0) return undefined
  let union: Box | undefined
  for (const box of boxes.values()) {
    union = union === undefined ? box : unionBox(union, box)
  }
  if (union === undefined || union.width < 1 || union.height < 1) return undefined
  const pad = Math.ceil(params.liftPx + 2) + 1
  const width = Math.max(1, Math.round((union.width + pad * 2) * dpr))
  const height = Math.max(1, Math.round((union.height + pad * 2) * dpr))
  const widths = beamWidths(
    union.width,
    params.mainBandFwhmRatio,
    params.coreFwhmRatio,
    params.coreFwhmMinPx,
    params.coreFwhmMaxPx,
  )
  const centerY = (pad + union.height / 2) * dpr
  const tanTilt = tiltTan(params.tiltDeg)
  const parts = new Map<string, PartTransform>()
  for (const [id, box] of boxes) {
    const viewBox = viewBoxes.get(id)
    if (viewBox === undefined) continue
    parts.set(id, partTransform(viewBox, box, union, dpr, pad))
  }
  const supportRadius = supportRadiusCss(widths.mainFwhm, params) * dpr
  const partial = {
    box: union,
    pad,
    dpr,
    centerY,
    parts,
  }
  const extent = bandExtent(partial, shapes, tanTilt)
  // The padding covers the largest displacement the warp can produce (a
  // magnified source point plus the lift) and a pixel of antialiasing.
  const warpPadding = (params.magnifyRadiusPx * (params.magnifyPeak - 1) + params.liftPx + 1) * dpr
  const padding = Math.max(params.travelPaddingPx * dpr, warpPadding)
  return {
    box: union,
    dpr,
    width,
    height,
    sigma: widths.mainSigma * dpr,
    coreSigma: widths.coreSigma * dpr,
    collarSigma: widths.collarSigma * dpr,
    mainFwhm: widths.mainFwhm,
    coreFwhm: widths.coreFwhm,
    magnifyRadiusPx: params.magnifyRadiusPx * dpr,
    supportRadius,
    centerY,
    qMin: extent.min,
    qMax: extent.max,
    centerStart: extent.min - supportRadius - padding,
    centerEnd: extent.max + supportRadius + padding,
    pad,
    phases: {
      entryMs: params.entryMs,
      surfaceMs: params.surfaceMs,
      exitMs: params.exitMs,
      surfaceStartMs: params.entryMs,
      exitStartMs: params.entryMs + params.surfaceMs,
    },
    parts,
  }
}
