/**
 * Material raster: the live lockup SVG, decoded at device resolution.
 *
 * The sweep does not invent a second material. It copies the SVG that is on
 * screen — computed paints inlined, because CSS Modules and custom properties
 * do not survive serialization — and uploads it as an `rgba8unorm-srgb` texture.
 * The texture format performs the sRGB decode in hardware, so the shader gets
 * linear light without a hand-rolled conversion, and the warped sample matches
 * the untouched SVG exactly: same ramp, same bevel, same counters.
 *
 * The SVG is never hidden or replaced while the sweep runs, so no path can
 * rasterize an empty element.
 *
 * @module dsh-brand-gold/raster
 */

/** Paint properties that have to be inlined onto the clone. */
const PAINT_PROPERTIES = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stop-color', 'stop-opacity', 'opacity',
] as const

/**
 * Copy computed paint values onto a cloned subtree.
 * @param source - live element.
 * @param clone - its detached clone.
 */
function inlinePaint(source: Element, clone: Element): void {
  const computed = getComputedStyle(source)
  for (const property of PAINT_PROPERTIES) {
    const value = computed.getPropertyValue(property)
    if (value !== '') clone.setAttribute(property, value)
  }
  const sourceChildren = [...source.children]
  const cloneChildren = [...clone.children]
  const shared = Math.min(sourceChildren.length, cloneChildren.length)
  for (let index = 0; index < shared; index += 1) {
    const child = sourceChildren[index]
    const target = cloneChildren[index]
    if (child !== undefined && target !== undefined) inlinePaint(child, target)
  }
}

/**
 * Serialize a live SVG into a standalone data URI at device resolution.
 * @param svg - rendered SVG.
 * @param width - target width in device pixels.
 * @param height - target height in device pixels.
 * @returns the data URI.
 */
export function serializeSvg(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlinePaint(svg, clone)
  clone.removeAttribute('class')
  clone.removeAttribute('style')
  clone.setAttribute('width', String(Math.max(1, Math.round(width))))
  clone.setAttribute('height', String(Math.max(1, Math.round(height))))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
}

/**
 * Decode the serialized lockup into a bitmap at device resolution.
 * @param uri - serialized SVG.
 * @param width - device pixels.
 * @param height - device pixels.
 * @returns the decoded bitmap.
 */
export async function rasterize(uri: string, width: number, height: number): Promise<ImageBitmap> {
  const image = new Image()
  image.src = uri
  await image.decode()
  return await createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(width)),
    resizeHeight: Math.max(1, Math.round(height)),
    resizeQuality: 'high',
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
}
