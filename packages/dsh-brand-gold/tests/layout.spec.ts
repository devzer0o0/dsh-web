/**
 * Shared coordinate system: the two SVGs become one lockup, the beam crosses
 * the gap between them instead of restarting, and the travel does not grow with
 * the band width.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout, partTransform, travelOverhang, unionBox, type Box } from '../src/client/layout.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'

/** Square the sidebar renders the whale in. */
const markBox: Box = { left: 16, top: 58, width: 24, height: 17.66 }
/** Box the wordmark occupies beside it. */
const nameBox: Box = { left: 48, top: 54, width: 156, height: 24 }

const boxes = new Map([
  ['mark', markBox],
  ['name', nameBox],
])
const viewBoxes = new Map([
  ['mark', '0 0 23.16 17.04'],
  ['name', '26 0 156 24'],
])

describe('brand coordinate system', () => {
  it('operator sees one lockup, not two independent viewBoxes', () => {
    // Given: the two rendered boxes the sidebar produces.
    // When: the shared layout is built at 2x.
    const layout = buildLayout(boxes, viewBoxes, 2)
    if (layout === undefined) throw new Error('the lockup layout was not built')
    // Then: the union covers both parts, and each part keeps its own transform.
    expect(layout.box.left).toBe(16)
    expect(layout.box.width).toBeCloseTo(188, 5)
    expect(layout.parts.size).toBe(2)
    const mark = layout.parts.get('mark')!
    const name = layout.parts.get('name')!
    expect(mark.scale).toBeCloseTo((24 / 23.16) * 2, 4)
    expect(name.scale).toBeCloseTo((24 / 24) * 2, 4)
    expect(mark.offsetX).toBeLessThan(name.offsetX)
  })

  it('operator sees the beam travel across the whole lockup, through the gap', () => {
    // Given: the shared layout.
    const layout = buildLayout(boxes, viewBoxes, 2)!
    // When: the travel range is read.
    // Then: it starts left of the whale and ends right of the plate.
    expect(layout.startX).toBeLessThan(layout.parts.get('mark')!.offsetX)
    expect(layout.endX).toBeGreaterThan(layout.parts.get('name')!.offsetX + nameBox.width * layout.dpr)
  })

  it('operator gets the declared band and core widths in CSS pixels, not a sigma dial', () => {
    // Given: the 188 px lockup and the shipped ratios.
    const layout = buildLayout(boxes, viewBoxes, 2)!
    // When: the layout's widths are read back.
    // Then: they are the visible targets, and the sigma is only their
    // equivalent under the profile the shader uses.
    expect(layout.mainFwhm).toBeCloseTo(188 * 0.55, 5)
    expect(layout.coreFwhm).toBeCloseTo(18.8, 5)
    expect(layout.sigma / layout.dpr).toBeCloseTo(layout.mainFwhm / (2 * Math.sqrt(Math.log(2))), 5)
    expect(layout.coreSigma / layout.dpr).toBeCloseTo(layout.coreFwhm / (2 * Math.sqrt(Math.log(2))), 5)
  })

  it('operator never gets a faster crossing from a wider band', () => {
    // Given: the shipped ratios and a band twice as wide.
    const narrow = buildLayout(boxes, viewBoxes, 2, { ...SWEEP_PARAMS, mainBandFwhmRatio: 0.55 })!
    const wide = buildLayout(boxes, viewBoxes, 2, { ...SWEEP_PARAMS, mainBandFwhmRatio: 1.1 })!
    // When: the travel and the distance the centre must cover are compared.
    const narrowSpan = narrow.endX - narrow.startX
    const wideSpan = wide.endX - wide.startX
    // Then: widening the band changes neither the travel nor the lockup, so the
    // centre crosses the body in the same time.
    expect(wide.mainFwhm).toBeGreaterThan(narrow.mainFwhm * 1.9)
    expect(wideSpan).toBeCloseTo(narrowSpan, 6)
    expect(wide.startX).toBeCloseTo(narrow.startX, 6)
    expect(wide.endX).toBeCloseTo(narrow.endX, 6)
  })

  it('operator gets an entry and exit measured from the lockup, not from the band', () => {
    // Given: the 188 x 24 lockup and the shipped dials.
    // When: the overhang is computed.
    const overhang = travelOverhang(188, 24, SWEEP_PARAMS)
    // Then: it is about a tenth of the width plus the tilt compensation, and it
    // does not depend on the band sigma at all.
    const lean = 0.5 * 24 * Math.tan((25 * Math.PI) / 180)
    expect(overhang).toBeCloseTo(18.8 + lean + 5 + 0.8, 3)
    const widerBand = travelOverhang(188, 24, { ...SWEEP_PARAMS, mainBandFwhmRatio: 2 })
    expect(widerBand).toBeCloseTo(overhang, 9)
  })

  it('operator never sees the lifted stroke clipped by the canvas edge', () => {
    // Given: the mark alone.
    const layout = buildLayout(new Map([['mark', markBox]]), new Map([['mark', '0 0 23.16 17.04']]), 2)!
    // When: the padding is compared with the lift the beam applies.
    // Then: the canvas is larger than the lockup by at least the lift.
    expect(layout.pad).toBeGreaterThan(0.8)
    expect(layout.width).toBeGreaterThan(Math.round(markBox.width * layout.dpr))
    expect(layout.height).toBeGreaterThan(Math.round(markBox.height * layout.dpr))
  })

  it('operator gets no overlay at all when the lockup has collapsed', () => {
    // Given: a box the sidebar collapsed to nothing.
    // When: the layout is built.
    // Then: it refuses to produce one instead of dividing by zero.
    expect(buildLayout(new Map([['mark', { left: 0, top: 0, width: 0, height: 0 }]]), new Map([['mark', '0 0 1 1']]), 2))
      .toBeUndefined()
    expect(buildLayout(new Map(), new Map(), 2)).toBeUndefined()
  })

  it('operator sees a part mapped onto its rendered box, at the device ratio exactly once', () => {
    // Given: a viewBox half the size of the box it is drawn into.
    const box: Box = { left: 100, top: 50, width: 40, height: 20 }
    // When: the transform is computed against a lockup origin of 10, 10 at 2x.
    const transform = partTransform('0 0 20 10', box, { left: 10, top: 10 }, 2, 2)
    // Then: the scale is the aspect ratio times the device ratio, and the
    // offsets are the CSS position minus the origin, converted once.
    expect(transform.scale).toBeCloseTo(4, 5)
    expect(transform.offsetX).toBeCloseTo((100 - 10 + 2) * 2, 5)
    expect(transform.offsetY).toBeCloseTo((50 - 10 + 2) * 2, 5)
  })

  it('operator gets a union box that encloses both parts', () => {
    // Given: two boxes with a gap between them.
    // When: their union is taken.
    // Then: the union spans from the left edge of the first to the right of the second.
    expect(unionBox(markBox, nameBox)).toEqual({ left: 16, top: 54, width: 188, height: 24 })
  })
})
