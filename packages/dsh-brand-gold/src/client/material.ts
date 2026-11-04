/**
 * Composite material: one canvas holding the whole lockup.
 *
 * Each occupant's live SVG is serialized, decoded at **device resolution** and
 * drawn into the shared canvas through the part transform, clipped to the
 * part's own box.
 *
 * The units are explicit, because getting them wrong is invisible until a
 * highlight lands on a copy of the lockup that is a few percent too large:
 *
 * 1. the serialized SVG gets `width/height` in CSS pixels of the element's box,
 *    so the browser lays it out at its natural `viewBox` aspect;
 * 2. `createImageBitmap(..., { resizeWidth, resizeHeight })` scales that layout
 *    to exactly `cssScale * dpr` device pixels — the one conversion point;
 * 3. the bitmap is drawn at the part's transform offset, **not** re-scaled on
 *    the way in.
 *
 * Reading `box.width * transform.scale` would multiply a CSS size by a viewBox
 * ratio and call the product device pixels; the bitmap then had four device
 * pixels of extra padding crammed back into the same box, and every path drifted
 * by the difference. Nothing here does that any more.
 *
 * @module dsh-brand-gold/material
 */

import type { LockupLayout } from './layout.ts'
import { rasterize, serializeSvg } from './raster.ts'

/** One part to composite. */
export interface MaterialPart {
  /** Part id, matching the layout entry. */
  readonly id: string
  /** The live SVG of this part. */
  readonly svg: SVGSVGElement
}

/**
 * Composite every part into one canvas.
 * @param layout - shared layout, with the transform of every part.
 * @param parts - live SVGs to rasterize.
 * @returns the composite canvas, or undefined when no part could be rasterized.
 */
export async function compositeMaterial(
  layout: LockupLayout,
  parts: readonly MaterialPart[],
): Promise<HTMLCanvasElement | undefined> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(layout.width))
  canvas.height = Math.max(1, Math.round(layout.height))
  const ctx = canvas.getContext('2d')
  if (ctx === null) return undefined
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  let drawn = 0

  for (const part of parts) {
    const transform = layout.parts.get(part.id)
    if (transform === undefined) continue
    // The SVG is laid out at its own box in CSS pixels, then resized once to the
    // device size the transform maps the viewBox onto.
    const targetWidth = Math.max(1, Math.round(transform.width))
    const targetHeight = Math.max(1, Math.round(transform.height))
    let bitmap: ImageBitmap
    try {
      bitmap = await rasterize(
        serializeSvg(part.svg, transform.box.width, transform.box.height),
        targetWidth,
        targetHeight,
      )
    } catch {
      continue
    }
    ctx.save()
    ctx.beginPath()
    // Clip to the part's own box: the artwork is centred inside it, so nothing
    // may bleed into a neighbour's pixels or into the shared padding.
    ctx.rect(
      Math.floor(transform.clip.left),
      Math.floor(transform.clip.top),
      Math.ceil(transform.clip.width),
      Math.ceil(transform.clip.height),
    )
    ctx.clip()
    ctx.drawImage(bitmap, transform.offsetX, transform.offsetY, targetWidth, targetHeight)
    ctx.restore()
    bitmap.close()
    drawn += 1
  }

  return drawn === 0 ? undefined : canvas
}
