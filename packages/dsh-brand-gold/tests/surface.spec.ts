/**
 * Surface response: eligibility comes from the geometry, brightness only decides
 * how much light comes back.
 */
import { describe, expect, it } from 'vitest'
import { SURFACE_PLATE, SURFACE_WORDMARK, buildMaskImage, shapeGeometryOf } from '../src/client/geometry-mask.ts'
import { buildLayout } from '../src/client/layout.ts'
import { MARK_GEOMETRY, NAME_GEOMETRY } from '../src/client/paths.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'
import { sweepLight } from '../src/client/light.ts'
import { surfaceResponse } from '../src/client/surface.ts'

const shapes = new Map([
  ['mark', shapeGeometryOf(MARK_GEOMETRY)],
  ['name', shapeGeometryOf(NAME_GEOMETRY)],
])
const layout = buildLayout(
  new Map([
    ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
    ['name', { left: 48, top: 54, width: 156, height: 24 }],
  ]),
  new Map([
    ['mark', '0 0 23.16 17.04'],
    ['name', '26 0 156 24'],
  ]),
  2,
  SWEEP_PARAMS,
  shapes,
)!

describe('surface response', () => {
  it('operator gets the same eligibility from dark gold and bright gold', () => {
    // Given: the darkest and the brightest gold on the ramp.
    const dark = surfaceResponse({ metal: 1, plate: 0 }, [0.09, 0.06, 0.03], SWEEP_PARAMS.plateFactor, SWEEP_PARAMS.bandAlbedoFloor)
    const bright = surfaceResponse({ metal: 1, plate: 0 }, [0.94, 0.79, 0.49], SWEEP_PARAMS.plateFactor, SWEEP_PARAMS.bandAlbedoFloor)
    // When: the response is read.
    // Then: both are metal with the full wordmark response; only the albedo
    // differs, and the floor keeps the dark one visible.
    expect(dark.metal).toBe(true)
    expect(bright.metal).toBe(true)
    expect(dark.response).toBe(bright.response)
    expect(dark.albedo).toBeGreaterThan(dark.baseLuma)
    expect(dark.albedo).toBeLessThan(bright.albedo)
  })

  it('operator never gets light on a pixel the mask rejected, however bright it is', () => {
    // Given: a white pixel the geometric mask says is not metal.
    const rejected = surfaceResponse({ metal: 0, plate: 0 }, [1, 1, 1], SWEEP_PARAMS.plateFactor, SWEEP_PARAMS.bandAlbedoFloor)
    // When: the light model is asked for its luminance under a full beam.
    const light = sweepLight(
      { baseLuma: rejected.baseLuma, band: 1, core: 1, collar: 1, envelope: 1, response: rejected.response, metal: 0 },
      SWEEP_PARAMS.bandGain,
      SWEEP_PARAMS.collarGain,
      7.88,
      SWEEP_PARAMS.bandAlbedoFloor,
    )
    // Then: nothing is added at all.
    expect(rejected.metal).toBe(false)
    expect(light.targetLuma).toBeCloseTo(rejected.baseLuma, 9)
    expect(light.coreLuma).toBe(0)
  })

  it('operator gets the plate attenuated once, at the shipped share', () => {
    // Given: the same point classified as wordmark and as plate.
    const wordmark = surfaceResponse({ metal: 1, plate: 0 }, [0.6, 0.42, 0.14], SWEEP_PARAMS.plateFactor, SWEEP_PARAMS.bandAlbedoFloor)
    const plate = surfaceResponse({ metal: 1, plate: 1 }, [0.6, 0.42, 0.14], SWEEP_PARAMS.plateFactor, SWEEP_PARAMS.bandAlbedoFloor)
    // When: the light each returns is compared.
    const lit = (response: number): number => sweepLight(
      { baseLuma: wordmark.baseLuma, band: 1, core: 0.4, collar: 0.3, envelope: 1, response, metal: 1 },
      SWEEP_PARAMS.bandGain,
      SWEEP_PARAMS.collarGain,
      7.88,
      SWEEP_PARAMS.bandAlbedoFloor,
    ).targetLuma - wordmark.baseLuma
    // Then: the response itself is the factor, and the plate's light never
    // exceeds it — the core spends a smaller ceiling on the plate, so the ratio
    // is at most the factor rather than its square.
    expect(plate.response).toBeCloseTo(SWEEP_PARAMS.plateFactor, 9)
    const ratio = lit(plate.response) / lit(1)
    expect(ratio).toBeLessThan(1)
    expect(ratio).toBeGreaterThan(SWEEP_PARAMS.plateFactor * SWEEP_PARAMS.plateFactor)
  })

  it('operator gets a mask whose classes match the parts they come from', () => {
    // Given: the mask of the shipped lockup.
    const mask = buildMaskImage(layout, shapes)!
    // When: the two classes are counted.
    let wordmark = 0
    let plate = 0
    for (let index = 0; index < mask.coverage.length; index += 1) {
      if (mask.coverage[index]! <= 0) continue
      if (mask.surface[index] === SURFACE_PLATE) plate += 1
      else if (mask.surface[index] === SURFACE_WORDMARK) wordmark += 1
    }
    // Then: both exist, and the plate is the smaller of the two.
    expect(wordmark).toBeGreaterThan(1000)
    expect(plate).toBeGreaterThan(500)
    expect(plate).toBeLessThan(wordmark)
  })
})
