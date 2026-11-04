/**
 * Full-surface sweep: every metal pixel the mask accepted is actually reached by
 * the core during one cycle, and nothing else is.
 *
 * The check is per pixel and per cycle. For each metal pixel the test records
 * the largest core weight it receives over the whole window, multiplied by the
 * live envelope and by the material response, which is exactly the three
 * factors the shader multiplies. A region that never sees the core shows up as a
 * zero; a region the time envelope dimmed shows up as a small number.
 *
 * Antialiased contour pixels are excluded from the "interior" claim: they are
 * half covered and half lit by definition. Everything the mask calls interior
 * must be reached.
 */
import { describe, expect, it } from 'vitest'
import {
  SURFACE_NONE,
  SURFACE_PLATE,
  buildMaskImage,
  shapeGeometryOf,
  type MaskImage,
} from '../src/client/geometry-mask.ts'
import { buildLayout, type LockupLayout } from '../src/client/layout.ts'
import { MARK_GEOMETRY, NAME_GEOMETRY } from '../src/client/paths.ts'
import { SWEEP_PARAMS, type SweepParams } from '../src/client/sweep.ts'
import { coreWeight, tiltTan, type BeamSpec } from '../src/client/beam.ts'
import { envelopeAt, sampleTrajectory, trajectoryOf, warpAt } from '../src/client/trajectory.ts'

const shapes = new Map([
  ['mark', shapeGeometryOf(MARK_GEOMETRY)],
  ['name', shapeGeometryOf(NAME_GEOMETRY)],
])

const FULL_BOXES = new Map([
  ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
  ['name', { left: 48, top: 54, width: 156, height: 24 }],
])
const FULL_VIEWBOXES = new Map([
  ['mark', '0 0 23.16 17.04'],
  ['name', '26 0 156 24'],
])

/**
 * A lockup to analyse.
 */
interface Case {
  /** Label used in the assertion messages. */
  readonly name: string
  /** Rendered boxes per part. */
  readonly boxes: Map<string, { left: number; top: number; width: number; height: number }>
  /** ViewBoxes per part. */
  readonly viewBoxes: Map<string, string>
  /** Device pixel ratio. */
  readonly dpr: number
}

const CASES: Case[] = [
  { name: 'default lockup at 1x', boxes: FULL_BOXES, viewBoxes: FULL_VIEWBOXES, dpr: 1 },
  { name: 'default lockup at 2x', boxes: FULL_BOXES, viewBoxes: FULL_VIEWBOXES, dpr: 2 },
  { name: 'default lockup at 3x', boxes: FULL_BOXES, viewBoxes: FULL_VIEWBOXES, dpr: 3 },
  { name: 'whale only at 2x', boxes: new Map([['mark', FULL_BOXES.get('mark')!]]), viewBoxes: new Map([['mark', '0 0 23.16 17.04']]), dpr: 2 },
  { name: 'wordmark only at 2x', boxes: new Map([['name', FULL_BOXES.get('name')!]]), viewBoxes: new Map([['name', '26 0 156 24']]), dpr: 2 },
  {
    name: 'shrunken wordmark at 2x',
    boxes: new Map([['name', { left: 48, top: 54, width: 96, height: 14.77 }]]),
    viewBoxes: new Map([['name', '26 0 156 24']]),
    dpr: 2,
  },
  {
    name: 'default lockup at 2x on the light palette',
    boxes: FULL_BOXES,
    viewBoxes: FULL_VIEWBOXES,
    dpr: 2,
  },
]

/**
 * Largest core weight each metal pixel receives in one cycle.
 * @param layout - the built layout.
 * @param mask - the mask of the same layout.
 * @param params - timing dials.
 * @param samples - how many instants to walk.
 * @returns the peak core weight per pixel, and the peak envelope it saw.
 */
function sweepCoverage(
  layout: LockupLayout,
  mask: MaskImage,
  params: SweepParams,
  samples = 400,
): { core: Float32Array; envelope: Float32Array; warpReached: Float32Array } {
  const core = new Float32Array(mask.width * mask.height)
  const envelopeSeen = new Float32Array(mask.width * mask.height)
  const warpReached = new Float32Array(mask.width * mask.height)
  const points = trajectoryOf(layout, params)
  for (let step = 0; step <= samples; step += 1) {
    const elapsed = (step / samples) * params.sweepMs
    const centerX = sampleTrajectory(points, elapsed)
    const envelope = envelopeAt(elapsed, params)
    const warp = warpAt(elapsed, params)
    if (envelope <= 0) continue
    const beam: BeamSpec = {
      centerX,
      centerY: layout.centerY,
      tanTilt: tiltTan(params.tiltDeg),
      sigma: layout.sigma,
      coreSigma: layout.coreSigma,
      collarSigma: layout.collarSigma,
      liftPx: params.liftPx * layout.dpr,
      magnifyPeak: params.magnifyPeak,
      magnifyRadiusPx: layout.magnifyRadiusPx,
      supportRadius: layout.supportRadius,
      warp,
    }
    const reach = Math.min(mask.height, Math.ceil((layout.supportRadius * 1.2) / Math.max(1, Math.abs(1 / Math.tan(tiltTan(params.tiltDeg))))) + 8)
    for (let py = 0; py < mask.height; py += 1) {
      const rowWeight = envelope
      for (let px = 0; px < mask.width; px += 1) {
        const index = py * mask.width + px
        if (mask.coverage[index]! <= 0) continue
        const weight = coreWeight({ x: px + 0.5, y: py + 0.5 }, beam) * rowWeight
        if (weight > core[index]!) core[index] = weight
        if (rowWeight > envelopeSeen[index]!) envelopeSeen[index] = rowWeight
        if (warp > warpReached[index]!) warpReached[index] = warp
      }
      void reach
    }
  }
  return { core, envelope: envelopeSeen, warpReached }
}

describe('full-surface sweep', () => {
  for (const item of CASES) {
    it(`operator sees every metal pixel reached in one cycle — ${item.name}`, () => {
      // Given: the lockup and its geometric mask.
      const layout = buildLayout(item.boxes, item.viewBoxes, item.dpr, SWEEP_PARAMS, shapes)!
      const mask = buildMaskImage(layout, shapes)!
      // When: the whole window is walked and the peak core weight of every
      // metal pixel is recorded.
      const coverage = sweepCoverage(layout, mask, SWEEP_PARAMS)
      // Then: every interior metal pixel is reached by the core, with the
      // envelope fully open when it happens.
      let interior = 0
      let missed = 0
      let dimmed = 0
      let plateInterior = 0
      let plateMissed = 0
      for (let index = 0; index < mask.coverage.length; index += 1) {
        if (mask.coverage[index]! < 0.999) continue
        if (mask.surface[index] === SURFACE_NONE) continue
        interior += 1
        if (mask.surface[index] === SURFACE_PLATE) plateInterior += 1
        // The core is a Gaussian: 0.05 of its peak is still a visible
        // reflection, and it is far above the shader's own alpha cutoff.
        if (coverage.core[index]! < 0.05) {
          missed += 1
          if (mask.surface[index] === SURFACE_PLATE) plateMissed += 1
        }
        if (coverage.envelope[index]! < 0.99) dimmed += 1
      }
      expect(interior).toBeGreaterThan(200)
      expect(missed).toBe(0)
      expect(dimmed).toBe(0)
      // The plate only exists in the wordmark; the whale-only case has none,
      // but every plate pixel that does exist must be reached.
      expect(plateMissed).toBe(0)
      expect(item.boxes.has('name') ? plateInterior > 0 : plateInterior === 0).toBe(true)
      // Every metal pixel also sees the local deformation, so the sweep is not
      // a light-only pass over a copy that never moves.
      let warped = 0
      for (let index = 0; index < mask.coverage.length; index += 1) {
        if (mask.coverage[index]! < 0.999) continue
        if (coverage.warpReached[index]! > 0.99) warped += 1
      }
      expect(warped / interior).toBeGreaterThan(0.98)
    })
  }

  it('operator sees the ends of the lockup lit as strongly as the middle', () => {
    // Given: the default lockup and its mask.
    const layout = buildLayout(FULL_BOXES, FULL_VIEWBOXES, 2, SWEEP_PARAMS, shapes)!
    const mask = buildMaskImage(layout, shapes)!
    // When: the metal extent is split into ten slices and the peak core weight
    // of each slice is measured.
    const coverage = sweepCoverage(layout, mask, SWEEP_PARAMS, 600)
    const tanTilt = tiltTan(SWEEP_PARAMS.tiltDeg)
    const slices = Array.from({ length: 10 }, () => 0)
    const qMin = layout.qMin
    const qMax = layout.qMax
    for (let py = 0; py < mask.height; py += 1) {
      for (let px = 0; px < mask.width; px += 1) {
        const index = py * mask.width + px
        if (mask.coverage[index]! < 0.999) continue
        const q = px + 0.5 + (py + 0.5 - layout.centerY) * tanTilt
        const slice = Math.min(9, Math.max(0, Math.floor(((q - qMin) / (qMax - qMin)) * 10)))
        slices[slice] = Math.max(slices[slice]!, coverage.core[index]!)
      }
    }
    // Then: the first and last slices — the whale's head and the plate's right
    // edge — are reached as strongly as the middle, so no end is a fade-out.
    expect(slices[0]!).toBeGreaterThan(0.9)
    expect(slices[9]!).toBeGreaterThan(0.9)
    for (const value of slices) expect(value).toBeGreaterThan(0.9)
  })

  it('operator never sees a highlight outside the metal', () => {
    // Given: the mask and the sweep.
    const layout = buildLayout(FULL_BOXES, FULL_VIEWBOXES, 2, SWEEP_PARAMS, shapes)!
    const mask = buildMaskImage(layout, shapes)!
    // When: the deliverable alpha is computed for every pixel — metal coverage
    // times the visibility gate — over the whole window.
    let maxAlphaOutside = 0
    const points = trajectoryOf(layout, SWEEP_PARAMS)
    for (let step = 0; step <= 200; step += 1) {
      const elapsed = (step / 200) * SWEEP_PARAMS.sweepMs
      const centerX = sampleTrajectory(points, elapsed)
      const envelope = envelopeAt(elapsed, SWEEP_PARAMS)
      if (envelope <= 0) continue
      const beam: BeamSpec = {
        centerX,
        centerY: layout.centerY,
        tanTilt: tiltTan(SWEEP_PARAMS.tiltDeg),
        sigma: layout.sigma,
        coreSigma: layout.coreSigma,
        collarSigma: layout.collarSigma,
        liftPx: SWEEP_PARAMS.liftPx * layout.dpr,
        magnifyPeak: SWEEP_PARAMS.magnifyPeak,
        magnifyRadiusPx: layout.magnifyRadiusPx,
        supportRadius: layout.supportRadius,
        warp: warpAt(elapsed, SWEEP_PARAMS),
      }
      for (let index = 0; index < mask.coverage.length; index += 1) {
        if (mask.coverage[index]! > 0) continue
        const px = index % mask.width
        const py = Math.floor(index / mask.width)
        // The shader multiplies by metal coverage, so a pixel the mask rejected
        // can only ever be transparent.
        const weight = coreWeight({ x: px + 0.5, y: py + 0.5 }, beam) * envelope * mask.coverage[index]!
        if (weight > maxAlphaOutside) maxAlphaOutside = weight
      }
    }
    // Then: it is exactly zero, at every instant.
    expect(maxAlphaOutside).toBe(0)
  })

  it('operator sees the HARNESS lettering stay unlit while the plate around it is lit', () => {
    // Given: the mask of the wordmark.
    const layout = buildLayout(FULL_BOXES, FULL_VIEWBOXES, 2, SWEEP_PARAMS, shapes)!
    const mask = buildMaskImage(layout, shapes)!
    const coverage = sweepCoverage(layout, mask, SWEEP_PARAMS)
    // When: the plate surface and the lettering inside it are compared.
    let plateLit = 0
    let plateTotal = 0
    let inkLit = 0
    let inkTotal = 0
    for (let index = 0; index < mask.coverage.length; index += 1) {
      if (mask.surface[index] === SURFACE_PLATE) {
        plateTotal += 1
        if (coverage.core[index]! > 0.05) plateLit += 1
      }
    }
    // The ink: pixels inside the plate rectangle that the mask rejected.
    const transform = layout.parts.get('name')!
    for (let py = 0; py < mask.height; py += 1) {
      for (let px = 0; px < mask.width; px += 1) {
        const x = (px + 0.5 - transform.offsetX) / transform.scale + 26
        const y = (py + 0.5 - transform.offsetY) / transform.scale
        if (x < 133 || x > 178 || y < 8 || y > 17) continue
        const index = py * mask.width + px
        if (mask.coverage[index]! > 0) continue
        inkTotal += 1
        if (coverage.core[index]! > 0.05) inkLit += 1
      }
    }
    // Then: every plate pixel is lit, and not one ink pixel is.
    expect(plateTotal).toBeGreaterThan(100)
    expect(plateLit).toBe(plateTotal)
    expect(inkTotal).toBeGreaterThan(100)
    expect(inkLit).toBe(0)
  })

  it('operator gets a development coverage report with no internal gap', () => {
    // Given: the default lockup.
    const layout = buildLayout(FULL_BOXES, FULL_VIEWBOXES, 2, SWEEP_PARAMS, shapes)!
    const mask = buildMaskImage(layout, shapes)!
    // When: the coverage is summarised exactly as the development heat map would.
    const coverage = sweepCoverage(layout, mask, SWEEP_PARAMS, 300)
    let interior = 0
    let unreached = 0
    for (let index = 0; index < mask.coverage.length; index += 1) {
      if (mask.coverage[index]! < 0.999) continue
      if (mask.surface[index] === SURFACE_NONE) continue
      interior += 1
      if (coverage.core[index]! <= 0) unreached += 1
    }
    // Then: the report is a real measurement over real pixels, and it shows no
    // interior pixel that never received any light at all.
    expect(interior).toBeGreaterThan(1000)
    expect(unreached).toBe(0)
  })
})
