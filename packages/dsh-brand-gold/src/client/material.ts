/**
 * Composite material: one canvas holding the whole lockup.
 *
 * Each occupant's live SVG is serialized and decoded per part, then drawn into
 * the shared canvas at the transform of the shared coordinate system. The result
 * is exactly what the sidebar shows — same gradients, same bevel, same counters,
 * same plate lettering — held at device resolution and ready to upload as an
 * `rgba8unorm-srgb` texture, where the hardware does the sRGB decode.
 *
 * Parts are rasterized one at a time because each SVG has its own viewBox; the
 * composite is what makes them one lockup for the beam.
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
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return undefined
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  let drawn = 0

  for (const part of parts) {
    const transform = layout.parts.get(part.id)
    if (transform === undefined) continue
    const width = Math.max(1, Math.round(transform.box.width * transform.scale + 4))
    const height = Math.max(1, Math.round(transform.box.height * transform.scale + 4))
    let bitmap: ImageBitmap
    try {
      bitmap = await rasterize(serializeSvg(part.svg, width, height), width, height)
    } catch {
      continue
    }
    ctx.drawImage(bitmap, transform.offsetX, transform.offsetY, transform.box.width * transform.scale, transform.box.height * transform.scale)
    bitmap.close()
    drawn += 1
  }

  return drawn === 0 ? undefined : canvas
}
