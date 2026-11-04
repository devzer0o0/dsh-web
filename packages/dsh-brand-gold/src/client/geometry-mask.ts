/**
 * Geometric material mask: which pixels are metal, and which are not.
 *
 * The sweep must light every solid metal surface — including the dark end of
 * the gold ramp — and must never light the HARNESS lettering, a counter, the
 * gap between two strokes or the transparent background. That is a question
 * about **geometry and material class**, not about how bright a pixel happens
 * to be, so this module answers it from the original vectors:
 *
 * - the whale silhouette is the fill region of `WHALE_PATH` (fill rule kept),
 * - the wordmark is the union of every solid stroke in `WORDMARK_PATHS`,
 * - the HARNESS plate is `BADGE_RECT`,
 * - the dark lettering in `BADGE_TEXT_PATHS` is punched out of the plate.
 *
 * A pixel's resting luminance is still used for the material's own shading and
 * tint (see `light.ts`), but it can never decide whether the pixel is eligible
 * to reflect the beam. A shadowed gold stroke that happens to be as dark as the
 * plate ink still receives a highlight; the ink never does.
 *
 * Sub-pixel coverage is resolved by supersampling each destination pixel, so an
 * antialiased contour is neither dropped (a hole along every edge) nor doubled
 * (a bright fringe where two shapes meet).
 *
 * @module dsh-brand-gold/geometry-mask
 */

import type { LockupLayout, PartTransform, PlateGeometry } from './layout.ts'

/** A closed polygon in viewBox units, as a flat `x, y` list. */
export type Poly = readonly number[]

/** Axis-aligned bounds. */
export interface Bounds {
  /** Left edge. */
  readonly minX: number
  /** Top edge. */
  readonly minY: number
  /** Right edge. */
  readonly maxX: number
  /** Bottom edge. */
  readonly maxY: number
}

/** Material class of a pixel. */
export const SURFACE_NONE = 0
/** Solid wordmark or whale metal. */
export const SURFACE_WORDMARK = 1
/** The HARNESS plate, which responds at `plateFactor`. */
export const SURFACE_PLATE = 2

/** Every class a pixel can take. */
export type SurfaceClass = typeof SURFACE_NONE | typeof SURFACE_WORDMARK | typeof SURFACE_PLATE

/** Coverage of the pixels the mask is built at, in device pixels. */
export type SurfaceMap = Uint8Array

/** Extended coverage, 0..1, for the antialiased contour. */
export type CoverageMap = Float32Array

/** Geometry of one part, reduced to what the mask needs. */
export interface ShapeGeometry {
  /** `minX minY width height` of the part. */
  readonly viewBox: readonly [number, number, number, number]
  /** Every solid subpath of the silhouette, plate included. */
  readonly outline: readonly Poly[]
  /** Plate outlines; empty when the part paints no plate. */
  readonly plates: readonly Poly[]
  /** Punched-out lettering inside the plate. */
  readonly exclusions: readonly Poly[]
  /** Bounds of `outline`, in viewBox units. */
  readonly bounds: Bounds
}

/** Edge list of a polygon set, as flat `x1, y1, x2, y2` quadruples. */
export type Edges = Float32Array

/**
 * Build the edge list of a polygon set.
 * @param polys - source polygons.
 * @returns the closed edges, flat.
 */
export function edgesOf(polys: readonly Poly[]): Edges {
  let count = 0
  for (const poly of polys) count += poly.length / 2
  const edges = new Float32Array(count * 4)
  let at = 0
  for (const poly of polys) {
    const total = poly.length / 2
    for (let index = 0; index < total; index += 1) {
      const next = (index + 1) % total
      edges[at] = poly[index * 2]!
      edges[at + 1] = poly[index * 2 + 1]!
      edges[at + 2] = poly[next * 2]!
      edges[at + 3] = poly[next * 2 + 1]!
      at += 4
    }
  }
  return edges
}

/** What a part contributes to the mask. */
export interface MaskPartInput {
  /** The part's original geometry. */
  readonly paths: readonly string[]
  /** Plates painted by the part. */
  readonly plates?: readonly PlateGeometry[]
  /** Paths punched out of the plates. */
  readonly plateExclusions?: readonly string[]
  /** The part's viewBox, `minX minY width height`. */
  readonly viewBox: string
}

/** One encoded mask pixel triple. */
export interface MaskPixel {
  /** Metal coverage, 0..1. */
  readonly metal: number
  /** 1 when the pixel belongs to the HARNESS plate, 0 otherwise. */
  readonly plate: number
}

/** Supersampling grid per axis for the contour. */
const SUBSAMPLES = 4

/**
 * Largest chord error, in viewBox units, when flattening a cubic.
 *
 * The whale and the glyphs are almost entirely curves whose extremes sit
 * *between* control points, so a coarse flattening does not just round a corner:
 * it shaves the top and the bottom off the silhouette and the mask stops
 * covering the real surface. The step count comes from the curve's own second
 * difference, which bounds that error properly.
 */
const FLATTEN_TOLERANCE = 0.01

/** Smallest and largest subdivisions of one cubic segment. */
const MIN_STEPS = 6
const MAX_STEPS = 96

/**
 * Split a path's data into commands and numbers.
 * @param data - path `d` attribute.
 * @returns command letters interleaved with their numeric arguments.
 */
function tokenize(data: string): string[] {
  return data.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
}

/**
 * Read one number from the token stream.
 * @param tokens - stream.
 * @param at - index to read.
 * @returns the value, or 0 when the stream ended.
 */
function numberAt(tokens: readonly string[], at: number): number {
  const token = tokens[at]
  if (token === undefined) return 0
  const value = Number(token)
  return Number.isFinite(value) ? value : 0
}

/**
 * Flatten one path into closed polygons.
 *
 * Only the absolute commands the brand data actually uses are handled
 * (`M L H V C Z`); the original vectors contain no arcs, curves-to or
 * shorthands. An unknown command ends the shape instead of guessing.
 *
 * @param data - path `d` attribute.
 * @returns the polygons, in viewBox units.
 */
export function flattenPath(data: string): Poly[] {
  const tokens = tokenize(data)
  const polys: Poly[] = []
  let current: number[] = []
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let index = 0
  let command = ''
  const push = (px: number, py: number): void => {
    current.push(px, py)
  }
  const closeShape = (): void => {
    if (current.length >= 6) polys.push(current)
    current = []
  }
  while (index < tokens.length) {
    const token = tokens[index]!
    if (/[A-Za-z]/.test(token)) {
      command = token
      index += 1
      if (command === 'Z' || command === 'z') {
        push(startX, startY)
        closeShape()
        x = startX
        y = startY
        continue
      }
    }
    if (command === 'M') {
      closeShape()
      x = numberAt(tokens, index)
      y = numberAt(tokens, index + 1)
      startX = x
      startY = y
      push(x, y)
      index += 2
      // Subsequent pairs are implicit line-tos.
      command = 'L'
      continue
    }
    if (command === 'L') {
      x = numberAt(tokens, index)
      y = numberAt(tokens, index + 1)
      push(x, y)
      index += 2
      continue
    }
    if (command === 'H') {
      x = numberAt(tokens, index)
      push(x, y)
      index += 1
      continue
    }
    if (command === 'V') {
      y = numberAt(tokens, index)
      push(x, y)
      index += 1
      continue
    }
    if (command === 'C') {
      const x1 = numberAt(tokens, index)
      const y1 = numberAt(tokens, index + 1)
      const x2 = numberAt(tokens, index + 2)
      const y2 = numberAt(tokens, index + 3)
      const x3 = numberAt(tokens, index + 4)
      const y3 = numberAt(tokens, index + 5)
      // Deviation of a cubic from its control polygon is bounded by
      // (3/4) * max(|P0 - 2P1 + P2|, |P1 - 2P2 + P3|) / n^2, so the step count
      // that keeps the error under the tolerance follows from those two vectors.
      const bendA = Math.hypot(x - 2 * x1 + x2, y - 2 * y1 + y2)
      const bendB = Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3)
      const bend = Math.max(bendA, bendB, 1e-6)
      const steps = Math.min(
        MAX_STEPS,
        Math.max(MIN_STEPS, Math.ceil(Math.sqrt((0.75 * bend) / FLATTEN_TOLERANCE))),
      )
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps
        const it = 1 - t
        const px = it * it * it * x + 3 * it * it * t * x1 + 3 * it * t * t * x2 + t * t * t * x3
        const py = it * it * it * y + 3 * it * it * t * y1 + 3 * it * t * t * y2 + t * t * t * y3
        push(px, py)
      }
      x = x3
      y = y3
      index += 6
      continue
    }
    // Unknown command: stop rather than fabricate geometry.
    break
  }
  closeShape()
  return polys
}

/**
 * Flatten a rounded rectangle into one polygon.
 * @param plate - plate geometry in viewBox units.
 * @returns the outline.
 */
export function platePoly(plate: PlateGeometry): Poly {
  const radius = Math.max(0, Math.min(plate.rx, Math.min(plate.width, plate.height) / 2))
  const points: number[] = []
  const corners = [
    { cx: plate.x + plate.width - radius, cy: plate.y + radius, from: -Math.PI / 2 },
    { cx: plate.x + plate.width - radius, cy: plate.y + plate.height - radius, from: 0 },
    { cx: plate.x + radius, cy: plate.y + plate.height - radius, from: Math.PI / 2 },
    { cx: plate.x + radius, cy: plate.y + radius, from: Math.PI },
  ]
  const steps = 8
  for (const corner of corners) {
    for (let step = 0; step <= steps; step += 1) {
      const angle = corner.from + (step / steps) * (Math.PI / 2)
      points.push(corner.cx + Math.cos(angle) * radius, corner.cy + Math.sin(angle) * radius)
    }
  }
  return points
}

/**
 * Bounds of a polygon list.
 * @param polys - polygons.
 * @returns the enclosing bounds; empty when there is nothing to enclose.
 */
export function polyBounds(polys: readonly Poly[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys) {
    for (let at = 0; at + 1 < poly.length; at += 2) {
      const x = poly[at]!
      const y = poly[at + 1]!
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/**
 * Nonzero winding test for one polygon.
 * @param poly - flat `x, y` list.
 * @param x - sample point.
 * @param y - sample point.
 * @returns the winding number.
 */
function winding(poly: Poly, x: number, y: number): number {
  let count = 0
  const total = poly.length / 2
  for (let at = 0; at < total; at += 1) {
    const ax = poly[at * 2]!
    const ay = poly[at * 2 + 1]!
    const bx = poly[((at + 1) % total) * 2]!
    const by = poly[((at + 1) % total) * 2 + 1]!
    if (ay <= y) {
      if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) count += 1
    } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) {
      count -= 1
    }
  }
  return count
}

/**
 * Is a point inside a shape, under the nonzero fill rule?
 * @param polys - the shape's subpaths.
 * @param x - sample point.
 * @param y - sample point.
 * @returns true when the point is inside.
 */
export function inside(polys: readonly Poly[], x: number, y: number): boolean {
  let total = 0
  for (const poly of polys) total += winding(poly, x, y)
  return total !== 0
}

/**
 * Build the mask geometry of one part from its original vectors.
 * @param input - paths, plates, punched lettering and viewBox.
 * @returns the reduced geometry.
 */
export function shapeGeometryOf(input: MaskPartInput): ShapeGeometry {
  const viewBox = input.viewBox.split(/\s+/).map(Number)
  const solid: Poly[] = []
  for (const path of input.paths) solid.push(...flattenPath(path))
  const plates: Poly[] = (input.plates ?? []).map(platePoly)
  // The plate is solid metal too; it is one shape with the silhouette, and its
  // separate copy only decides the response factor.
  const outline: Poly[] = [...solid, ...plates]
  // The plate is solid metal, so it belongs to the winding that decides
  // "inside the part"; only its separate copy decides the response factor.
  const exclusions: Poly[] = []
  for (const path of input.plateExclusions ?? []) exclusions.push(...flattenPath(path))
  const geometry: ShapeGeometry & {
    solidEdges: Edges
    plateEdges: Edges
    exclusionEdges: Edges
  } = {
    viewBox: [viewBox[0] ?? 0, viewBox[1] ?? 0, viewBox[2] ?? 1, viewBox[3] ?? 1],
    outline,
    plates,
    exclusions,
    bounds: polyBounds(outline),
    solidEdges: edgesOf([...solid, ...plates]),
    plateEdges: edgesOf(plates),
    exclusionEdges: edgesOf(exclusions),
  }
  return geometry
}

/** A shape with its precomputed edge lists, as the rasterizer wants it. */
export interface RasterShape extends ShapeGeometry {
  /** Edges of the solid silhouette and plates. */
  readonly solidEdges: Edges
  /** Edges of the plate outlines. */
  readonly plateEdges: Edges
  /** Edges of the punched lettering. */
  readonly exclusionEdges: Edges
}

/**
 * Material class at one viewBox point.
 * @param geometry - the part's geometry.
 * @param x - viewBox x.
 * @param y - viewBox y.
 * @returns the class.
 */
export function surfaceAt(geometry: ShapeGeometry, x: number, y: number): SurfaceClass {
  if (!inside(geometry.outline, x, y)) return SURFACE_NONE
  if (geometry.exclusions.length > 0 && inside(geometry.exclusions, x, y)) return SURFACE_NONE
  if (geometry.plates.length > 0 && inside(geometry.plates, x, y)) return SURFACE_PLATE
  return SURFACE_WORDMARK
}

/** One mask texture, at the resolution of the sweep canvas. */
export interface MaskImage {
  /** Width in device pixels. */
  readonly width: number
  /** Height in device pixels. */
  readonly height: number
  /**
   * RGBA bytes: R is metal coverage (0..1), G the share of that coverage that
   * belongs to the HARNESS plate, B the share that belongs to the solid
   * silhouette, A is constant. Coverage data, never a colour.
   */
  readonly data: Uint8ClampedArray
  /** Metal coverage per pixel, 0..1. */
  readonly coverage: CoverageMap
  /** Material class per pixel. */
  readonly surface: Uint8Array
}

/**
 * Map a device pixel centre to a part's viewBox coordinate.
 *
 * This is the inverse of the mapping `partTransform` applies, and it is the
 * only one used: the material raster, the mask and the plate quad all go
 * through the same numbers, so a highlight cannot land on a copy of the lockup
 * that is a few percent larger.
 *
 * @param transform - the part's transform.
 * @param viewBox - the part's `minX minY width height`.
 * @param deviceX - device-pixel x.
 * @param deviceY - device-pixel y.
 * @returns the viewBox point, or undefined for a degenerate transform.
 */
export function viewBoxPointAt(
  transform: PartTransform,
  viewBox: readonly [number, number, number, number],
  deviceX: number,
  deviceY: number,
): { x: number; y: number } | undefined {
  const cssScale = transform.cssScale
  if (!(cssScale > 0) || !(transform.scale > 0)) return undefined
  return {
    x: viewBox[0] + (deviceX / transform.dpr - transform.offsetX / transform.dpr) / cssScale,
    y: viewBox[1] + (deviceY / transform.dpr - transform.offsetY / transform.dpr) / cssScale,
  }
}

/**
 * Scan-convert one part into the mask.
 *
 * Every scanline is sampled `subsamples` times at fixed x offsets. The
 * winding number is accumulated **incrementally** along the row: each edge
 * contributes a constant +-1/+1-step between its two crossings, so a row costs
 * one pass over the edges plus one pass over the pixels instead of one point-in-
 * polygon test per sample. That is what makes a full-lockup mask cheap enough
 * to rebuild on a resize instead of stalling the frame.
 *
 * @param target - output buffers.
 * @param transform - the part's transform.
 * @param geometry - the part's geometry, with its edge lists.
 * @param rowRange - first and last scanline to fill, inclusive.
 */
function rasterizePart(
  target: MaskTarget,
  transform: PartTransform,
  geometry: RasterShape,
  rowRange: { first: number; last: number },
): void {
  const { width, class1, class2 } = target
  const scale = transform.scale
  if (!(scale > 0)) return
  const originX = transform.offsetX - geometry.viewBox[0] * scale
  const originY = transform.offsetY - geometry.viewBox[1] * scale
  const topDevice = Math.max(rowRange.first, Math.floor(originY + geometry.bounds.minY * scale))
  const bottomDevice = Math.min(rowRange.last, Math.ceil(originY + geometry.bounds.maxY * scale))
  if (bottomDevice < topDevice) return
  const leftLimit = Math.max(0, Math.floor(originX + geometry.bounds.minX * scale) - 2)
  const rightLimit = Math.min(width - 1, Math.ceil(originX + geometry.bounds.maxX * scale) + 2)
  const step = 1 / SUBSAMPLES
  const offsets = new Float32Array(SUBSAMPLES)
  for (let index = 0; index < SUBSAMPLES; index += 1) offsets[index] = (index + 0.5) * step

  // Row-level winding contributions, in columns of the supersampled grid.
  const columns = (width + 1) * SUBSAMPLES
  const solid = new Int16Array(columns + 1)
  const plate = new Int16Array(columns + 1)
  const keep = new Int16Array(columns + 1)

  /**
   * Add one edge list's crossing deltas to a row.
   * @param edges - flat edge list, device pixels.
   * @param deviceY - the row's sample line.
   * @param into - the column delta buffer.
   */
  const accumulate = (edges: Edges, deviceY: number, into: Int16Array): void => {
    for (let at = 0; at + 3 < edges.length; at += 4) {
      // Edges are stored in viewBox units; the scanline is in device pixels, so
      // the vertical test happens after the transform, or a row would be tested
      // against the wrong coordinate space.
      const ay = originY + edges[at + 1]! * scale
      const by = originY + edges[at + 3]! * scale
      if (ay === by) continue
      let dir = 0
      let edgeX = 0
      if (ay <= deviceY && by > deviceY) {
        dir = 1
        edgeX = edges[at]!
      } else if (by <= deviceY && ay > deviceY) {
        dir = -1
        edgeX = edges[at + 2]!
      } else {
        continue
      }
      const x = originX + edgeX * scale
      const column = Math.round(x / step)
      if (column < 0 || column >= columns) continue
      // The winding only changes at the crossing; walking the row left to right
      // turns the whole scanline into one running sum.
      into[column] = into[column]! + dir
    }
  }

  for (let py = topDevice; py <= bottomDevice; py += 1) {
    solid.fill(0)
    plate.fill(0)
    keep.fill(0)
    for (let sub = 0; sub < SUBSAMPLES; sub += 1) {
      const deviceY = py + offsets[sub]!
      accumulate(geometry.solidEdges, deviceY, solid)
      if (geometry.plateEdges.length > 0) accumulate(geometry.plateEdges, deviceY, plate)
      if (geometry.exclusionEdges.length > 0) accumulate(geometry.exclusionEdges, deviceY, keep)
    }
    let wind = 0
    let plateWind = 0
    let keepWind = 0
    // The winding is a running sum from the first column: everything left of
    // the shape still has to be added, or the run would start inside a hole.
    for (let px = 0; px < leftLimit; px += 1) {
      const start = px * SUBSAMPLES
      for (let sub = 0; sub < SUBSAMPLES; sub += 1) {
        wind += solid[start + sub]!
        plateWind += plate[start + sub]!
        keepWind += keep[start + sub]!
      }
    }
    for (let px = leftLimit; px <= rightLimit; px += 1) {
      let hits = 0
      let plateHits = 0
      const start = px * SUBSAMPLES
      for (let sub = 0; sub < SUBSAMPLES; sub += 1) {
        const column = start + sub
        wind += solid[column]!
        plateWind += plate[column]!
        keepWind += keep[column]!
        if (wind !== 0 && keepWind === 0) {
          hits += 1
          if (plateWind !== 0) plateHits += 1
        }
      }
      if (hits === 0) continue
      const index = py * width + px
      const alpha = hits / SUBSAMPLES
      const isPlate = plateHits > 0 && plateHits * 2 >= hits
      // The two classes are kept apart until every part has been drawn, so a
      // pixel where the whale's antialiased edge meets the wordmark is a union
      // instead of an overwrite.
      if (isPlate) class2[index] = class2[index]! + alpha
      else class1[index] = class1[index]! + alpha
    }
  }
}

/** Working buffers of a mask build. */
interface MaskTarget {
  /** Width in device pixels. */
  readonly width: number
  /** Metal coverage from non-plate parts, per pixel. */
  readonly class1: Float32Array
  /** Metal coverage from plate parts, per pixel. */
  readonly class2: Float32Array
}

/**
 * Rasterize the metal mask for the whole lockup.
 *
 * @param layout - the shared layout.
 * @param shapes - geometry per part id.
 * @returns the mask image, or undefined when no part has geometry.
 */
export function buildMaskImage(
  layout: LockupLayout,
  shapes: ReadonlyMap<string, ShapeGeometry>,
): MaskImage | undefined {
  const width = Math.max(1, Math.round(layout.width))
  const height = Math.max(1, Math.round(layout.height))
  if (shapes.size === 0) return undefined
  const data = new Uint8ClampedArray(width * height * 4)
  const coverage = new Float32Array(width * height)
  const surface = new Uint8Array(width * height)
  const class1 = new Float32Array(width * height)
  const class2 = new Float32Array(width * height)
  data.fill(0)
  const target: MaskTarget = { width, class1, class2 }
  for (const [id, geometry] of shapes) {
    const transform = layout.parts.get(id)
    if (transform === undefined) continue
    const shaped = geometry as RasterShape
    if (shaped.solidEdges === undefined) {
      // A geometry that skipped the edge cache falls back to the polygon test.
      rasterizePartInexact(target, transform, geometry)
    } else {
      rasterizePart(target, transform, shaped, { first: 0, last: height - 1 })
    }
  }
  let painted = 0
  for (let index = 0; index < coverage.length; index += 1) {
    const a1 = Math.min(1, class1[index]!)
    const a2 = Math.min(1, class2[index]!)
    if (a1 <= 0 && a2 <= 0) continue
    // Union coverage: two antialiased edges meeting in one pixel are one
    // surface, not 1.5 of one.
    const metal = 1 - (1 - a1) * (1 - a2)
    // Plate share of that coverage; an overlapping non-plate edge wins half of
    // the ambiguous pixel, so the plate never bleeds into the lettering.
    const plateTerm = a2 * (1 - a1) + a1 * a2 * 0.5
    const share = metal > 1e-6 ? Math.min(1, plateTerm / metal) : 0
    coverage[index] = metal
    surface[index] = share > 0.5 ? SURFACE_PLATE : SURFACE_WORDMARK
    const base = index * 4
    data[base] = Math.round(metal * 255)
    data[base + 1] = Math.round(share * 255)
    data[base + 2] = Math.round((1 - share) * metal * 255)
    data[base + 3] = 255
    painted += 1
  }
  if (painted === 0) return undefined
  return { width, height, data, coverage, surface }
}

/**
 * Point-sampling fallback for a geometry without an edge cache.
 * @param target - output buffers.
 * @param transform - the part's transform.
 * @param geometry - the part's geometry.
 */
function rasterizePartInexact(
  target: MaskTarget,
  transform: PartTransform,
  geometry: ShapeGeometry,
): void {
  const { width, class1, class2 } = target
  const height = class1.length / Math.max(width, 1)
  const step = 1 / SUBSAMPLES
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let hits = 0
      let plateHits = 0
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const point = viewBoxPointAt(transform, geometry.viewBox, px + (sx + 0.5) * step, py + (sy + 0.5) * step)
          if (point === undefined) continue
          const bounds = geometry.bounds
          if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) continue
          const kind = surfaceAt(geometry, point.x, point.y)
          if (kind === SURFACE_NONE) continue
          hits += 1
          if (kind === SURFACE_PLATE) plateHits += 1
          break
        }
      }
      if (hits === 0) continue
      const index = py * width + px
      const alpha = hits / (SUBSAMPLES * SUBSAMPLES)
      const isPlate = plateHits > 0 && plateHits * 2 >= hits
      if (isPlate) class2[index] = class2[index]! + alpha
      else class1[index] = class1[index]! + alpha
    }
  }
}

/**
 * Metal extent along the beam coordinate, in CSS pixels of the lockup.
 *
 * The beam coordinate `q = x + (y - centreY) * tan(tilt)` is linear in `x` and
 * `y`, so its extremes over a polygon are at the polygon's vertices — the
 * extent is exact, not a box approximation. The tilt is included, so the top
 * and bottom edges are covered, not just the horizontal span.
 *
 * @param layout - the shared layout.
 * @param shapes - geometry per part id.
 * @param tanTilt - tangent of the beam lean.
 * @returns the extent in device pixels, or undefined without geometry.
 */
export function metalExtent(
  layout: LockupLayout,
  shapes: ReadonlyMap<string, ShapeGeometry>,
  tanTilt: number,
): { min: number; max: number } | undefined {
  let min = Infinity
  let max = -Infinity
  for (const [id, geometry] of shapes) {
    const transform = layout.parts.get(id)
    if (transform === undefined) continue
    const collect = (polys: readonly Poly[]): void => {
      for (const poly of polys) {
        for (let at = 0; at + 1 < poly.length; at += 2) {
          const x = transform.offsetX + (poly[at]! - geometry.viewBox[0]) * transform.scale
          const y = transform.offsetY + (poly[at + 1]! - geometry.viewBox[1]) * transform.scale
          const q = x + (y - layout.centerY) * tanTilt
          if (q < min) min = q
          if (q > max) max = q
        }
      }
    }
    collect(geometry.outline)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
  return { min, max }
}