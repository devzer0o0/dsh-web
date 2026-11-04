/**
 * Geometric material mask: which pixels are metal is decided by the original
 * vectors, never by how bright the rasterized pixel happens to be.
 */
import { describe, expect, it } from 'vitest'
import {
  SURFACE_NONE,
  SURFACE_PLATE,
  SURFACE_WORDMARK,
  buildMaskImage,
  flattenPath,
  inside,
  platePoly,
  shapeGeometryOf,
  surfaceAt,
  type RasterShape,
} from '../src/client/geometry-mask.ts'
import { buildLayout } from '../src/client/layout.ts'
import { BADGE_RECT, BADGE_TEXT_PATHS, MARK_GEOMETRY, NAME_GEOMETRY, WHALE_PATH } from '../src/client/paths.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'
import { surfaceResponse } from '../src/client/surface.ts'

const markGeometry = shapeGeometryOf(MARK_GEOMETRY)
const nameGeometry = shapeGeometryOf(NAME_GEOMETRY)
const shapes = new Map([
  ['mark', markGeometry],
  ['name', nameGeometry],
])

const boxes = new Map([
  ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
  ['name', { left: 48, top: 54, width: 156, height: 24 }],
])
const viewBoxes = new Map([
  ['mark', '0 0 23.16 17.04'],
  ['name', '26 0 156 24'],
])

/**
 * Build the mask of the shipped lockup at one device pixel ratio.
 * @param dpr - device pixels per CSS pixel.
 * @returns the layout and the mask.
 */
function build(dpr: number) {
  const layout = buildLayout(boxes, viewBoxes, dpr, SWEEP_PARAMS, shapes)!
  const mask = buildMaskImage(layout, shapes)!
  return { layout, mask }
}

/**
 * Device pixel of a viewBox point of one part.
 * @param layout - the built layout.
 * @param id - part id.
 * @param point - viewBox coordinates.
 * @returns the pixel index, or -1 when outside the canvas.
 */
function pixelOf(
  layout: ReturnType<typeof build>['layout'],
  id: string,
  point: { x: number; y: number },
): number {
  const transform = layout.parts.get(id)!
  const geometry = shapes.get(id)!
  const x = Math.round(transform.offsetX + (point.x - geometry.viewBox[0]) * transform.scale)
  const y = Math.round(transform.offsetY + (point.y - geometry.viewBox[1]) * transform.scale)
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return -1
  return y * layout.width + x
}

describe('geometric material mask', () => {
  it('operator gets every solid gold surface marked as metal, dark or light', () => {
    // Given: the shipped lockup and its mask.
    const { layout, mask } = build(2)
    // When: a point on the pale end of the ramp and one deep in the shadowed
    // end of a wordmark stroke are read from the mask.
    const lightBand = pixelOf(layout, 'name', { x: 100, y: 11 })
    const shadowBand = pixelOf(layout, 'name', { x: 180, y: 12 })
    // Then: both are metal — membership is a property of the geometry, so the
    // dark end of the ramp can never be filtered out by a brightness threshold.
    expect(lightBand).toBeGreaterThanOrEqual(0)
    expect(mask.coverage[lightBand]!).toBeGreaterThan(0)
    expect(mask.coverage[shadowBand]!).toBeGreaterThan(0)
  })

  it('operator gets a metal set that does not move when the material gets darker', () => {
    // Given: a bright and a nearly black sample of the same pixel.
    const bright = surfaceResponse({ metal: 1, plate: 0 }, [0.85, 0.7, 0.4], SWEEP_PARAMS.plateFactor, 0.05)
    const dark = surfaceResponse({ metal: 1, plate: 0 }, [0.09, 0.07, 0.04], SWEEP_PARAMS.plateFactor, 0.05)
    // When: their eligibility and their light are compared.
    // Then: both are metal, the dark one simply returns less light — the floor
    // keeps the wide band readable without ever granting eligibility.
    expect(bright.metal).toBe(true)
    expect(dark.metal).toBe(true)
    expect(dark.baseLuma).toBeLessThan(bright.baseLuma)
    expect(dark.albedo).toBeGreaterThan(dark.baseLuma)
    // A pixel the mask rejected stays unlit no matter how bright it is.
    const rejected = surfaceResponse({ metal: 0, plate: 0 }, [1, 1, 1], SWEEP_PARAMS.plateFactor, 0.05)
    expect(rejected.metal).toBe(false)
    expect(rejected.response).toBe(0)
  })

  it('operator never gets a highlight inside a counter or a gap', () => {
    // Given: the whale's counters and the gaps inside the letters.
    const whale = flattenPath(WHALE_PATH)
    // When: points inside the whale's cut-outs are tested — the notch between
    // the jaw and the fin, and the hollow above the tail.
    const counters = [
      { x: 3.5, y: 6.5 },
      { x: 5.5, y: 8.5 },
      { x: 12.4, y: 8.3 },
    ]
    // Then: they are outside the fill, and the mask says so.
    for (const point of counters) {
      expect(inside(whale, point.x, point.y)).toBe(false)
      expect(surfaceAt(markGeometry, point.x, point.y)).toBe(SURFACE_NONE)
    }
    // The letter holes: the bowl of the first "e" and the counter of the "d".
    const holes = [
      { x: 68.9, y: 13.2 },
      { x: 104.6, y: 9.9 },
    ]
    for (const hole of holes) {
      expect(surfaceAt(nameGeometry, hole.x, hole.y)).toBe(SURFACE_NONE)
    }
  })

  it('operator gets the HARNESS lettering excluded from the plate', () => {
    // Given: the plate rectangle and the punched lettering.
    const plate = platePoly(BADGE_RECT)
    // When: a point on a letter stroke and a point on the bare plate are read.
    const onLetter = { x: 133.2, y: 12.5 }
    const onPlate = { x: 129.7, y: 12.9 }
    // Then: the plate is metal with the plate class, the letter is not metal.
    expect(inside([plate], onPlate.x, onPlate.y)).toBe(true)
    expect(surfaceAt(nameGeometry, onPlate.x, onPlate.y)).toBe(SURFACE_PLATE)
    expect(surfaceAt(nameGeometry, onLetter.x, onLetter.y)).toBe(SURFACE_NONE)
    // Every declared exclusion path really participates in the mask.
    expect(nameGeometry.exclusions.length).toBe(BADGE_TEXT_PATHS.flatMap((path) => flattenPath(path)).length)
  })

  it('operator sees the whole plate respond, corners included', () => {
    // Given: the mask of the wordmark.
    const { layout, mask } = build(2)
    // When: points just inside each corner of the plate are read.
    const corners = [
      { x: BADGE_RECT.x + 0.9, y: BADGE_RECT.y + 0.9 },
      { x: BADGE_RECT.x + BADGE_RECT.width - 0.9, y: BADGE_RECT.y + 0.9 },
      { x: BADGE_RECT.x + 0.9, y: BADGE_RECT.y + BADGE_RECT.height - 0.9 },
      { x: BADGE_RECT.x + BADGE_RECT.width - 0.9, y: BADGE_RECT.y + BADGE_RECT.height - 0.9 },
    ]
    // Then: all four are metal, and all four are the plate class.
    for (const corner of corners) {
      const index = pixelOf(layout, 'name', corner)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(mask.coverage[index]!).toBeGreaterThan(0)
      expect(mask.surface[index]).toBe(SURFACE_PLATE)
    }
  })

  it('operator never gets background, shadow or transparent pixels counted as metal', () => {
    // Given: the shipped mask.
    const { mask } = build(2)
    // When: a pixel above the lockup and one in the gap between the parts are read.
    const above = 2 * mask.width + 20
    const gap = Math.round(mask.height / 2) * mask.width + Math.round(mask.width * 0.17)
    // Then: neither is metal.
    expect(mask.coverage[above]!).toBe(0)
    expect(mask.coverage[gap]!).toBe(0)
    expect(mask.surface[above]).toBe(SURFACE_NONE)
  })

  it('operator gets antialiased contours as partial coverage, not as holes or fringes', () => {
    // Given: the mask at 2x.
    const { mask } = build(2)
    // When: the pixel classes are counted.
    let interior = 0
    let partial = 0
    for (let index = 0; index < mask.coverage.length; index += 1) {
      const value = mask.coverage[index]!
      if (value >= 0.999) interior += 1
      else if (value > 0) partial += 1
    }
    // Then: there is a real interior and a thin antialiased rim around it, and
    // the rim is far smaller than the interior — no double coverage band.
    expect(interior).toBeGreaterThan(3000)
    expect(partial).toBeGreaterThan(100)
    expect(partial).toBeLessThan(interior)
    // The classes only ever hold the two metal kinds, or none at all.
    for (const value of mask.surface) {
      expect(value === SURFACE_NONE || value === SURFACE_WORDMARK || value === SURFACE_PLATE).toBe(true)
    }
  })

  it('operator gets the same coverage at every device pixel ratio', () => {
    // Given: the same lockup at 1x, 2x and 3x.
    const counts = [1, 2, 3].map((dpr) => {
      const { mask } = build(dpr)
      let metal = 0
      for (const value of mask.coverage) if (value > 0.5) metal += 1
      return metal / (dpr * dpr)
    })
    // When: the per-CSS-pixel metal area is compared.
    // Then: it is the same surface, so a Retina screen does not get a different
    // mask than a 1x one.
    expect(counts[1]! / counts[0]!).toBeGreaterThan(0.85)
    expect(counts[1]! / counts[0]!).toBeLessThan(1.15)
    expect(counts[2]! / counts[0]!).toBeGreaterThan(0.85)
    expect(counts[2]! / counts[0]!).toBeLessThan(1.15)
  })

  it('operator gets a mask that is coverage data and never a colour image', () => {
    // Given: a metal pixel and a plate pixel.
    const { layout, mask } = build(1)
    const letter = pixelOf(layout, 'name', { x: 100, y: 11 })!
    const plate = pixelOf(layout, 'name', { x: 129.7, y: 12.9 })!
    // When: their encoded bytes are read.
    const letterBytes = [...mask.data.slice(letter * 4, letter * 4 + 4)]
    const plateBytes = [...mask.data.slice(plate * 4, plate * 4 + 4)]
    // Then: R is coverage, G is the plate share, and every pixel is fully
    // opaque coverage — no premultiplied colour, nothing an sRGB decode could
    // touch.
    expect(letterBytes[0]).toBeGreaterThan(200)
    expect(letterBytes[1]).toBe(0)
    expect(letterBytes[3]).toBe(255)
    expect(plateBytes[1]).toBeGreaterThan(200)
    expect(plateBytes[3]).toBe(255)
  })
})
