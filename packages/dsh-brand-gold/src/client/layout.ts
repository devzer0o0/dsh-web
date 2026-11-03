/**
 * Brand coordinate system.
 *
 * The whale mark, the wordmark and the HARNESS plate live in two different
 * SVGs with unrelated viewBoxes. Nothing here treats a viewBox as shared
 * geometry: every part is measured from its **rendered** box, mapped into one
 * viewport coordinate system, and the sweep travels across that system. The
 * popover canvas and the beam therefore see a single lockup, and the beam
 * crosses the gap between the icon and the wordmark instead of restarting.
 *
 * @module dsh-brand-gold/layout
 */

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

/** Mapping from a part's viewBox units to the shared canvas. */
export interface PartTransform {
  /** Device pixels per viewBox unit. */
  readonly scale: number
  /** Canvas device-pixel offset of the part's rendered box. */
  readonly offsetX: number
  /** Canvas device-pixel offset of the part's rendered box. */
  readonly offsetY: number
  /** Rendered box in viewport CSS pixels. */
  readonly box: Box
}

/** Rendering parameters for one sweep, shared by every canvas. */
export interface LockupLayout {
  /** Union of every part's rendered box, in viewport CSS pixels. */
  readonly box: Box
  /** Device pixels per CSS pixel. */
  readonly dpr: number
  /** Canvas size in device pixels (the union box plus the draw padding). */
  readonly width: number
  readonly height: number
  /** Beam falloff width (sigma) in device pixels. */
  readonly sigma: number
  /** Vertical centre the beam tilt is measured from, in device pixels. */
  readonly centerY: number
  /** First beam centre, in device pixels (left of the lockup). */
  readonly startX: number
  /** Last beam centre, in device pixels (right of the lockup). */
  readonly endX: number
  /** Padding around the union box, in CSS pixels, so the warp cannot clip. */
  readonly pad: number
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
 * @param viewBox - `minX minY width height`.
 * @param box - rendered box in viewport CSS pixels.
 * @param origin - top-left of the canvas in viewport CSS pixels.
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
  const [minX = 0, minY = 0, width = 1, height = 1] = viewBox.split(/\s+/).map(Number)
  const scale = Math.min(box.width / width, box.height / height)
  const offsetX = ((box.left - origin.left + pad) * dpr)
  const offsetY = ((box.top - origin.top + pad) * dpr)
  return { scale: scale * dpr, offsetX, offsetY, box }
}

/**
 * Build the shared layout from the live part boxes.
 * @param boxes - rendered box per part id.
 * @param viewBoxes - viewBox per part id.
 * @param dpr - device pixels per CSS pixel.
 * @param params - sweep dials.
 * @returns the layout, or undefined when a part has collapsed.
 */
export function buildLayout(
  boxes: ReadonlyMap<string, Box>,
  viewBoxes: ReadonlyMap<string, string>,
  dpr: number,
  params: SweepParams = SWEEP_PARAMS,
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
  const sigma = Math.max(2, Math.min(union.width * params.influenceSigmaRatio, union.height * 0.5)) * dpr
  const centerY = (pad + union.height / 2) * dpr
  const margin = params.travelMarginPx * dpr
  const parts = new Map<string, PartTransform>()
  for (const [id, box] of boxes) {
    const viewBox = viewBoxes.get(id)
    if (viewBox === undefined) continue
    parts.set(id, partTransform(viewBox, box, union, dpr, pad))
  }
  return {
    box: union,
    dpr,
    width,
    height,
    sigma,
    centerY,
    startX: (pad - params.travelMarginPx) * dpr - sigma * 3,
    endX: (pad + union.width + params.travelMarginPx) * dpr + sigma * 3,
    pad,
    parts,
  }
}
