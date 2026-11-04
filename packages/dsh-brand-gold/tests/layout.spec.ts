/**
 * Shared coordinate system: the two SVGs become one lockup, and the beam
 * crosses the gap between them instead of restarting at the wordmark.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout, partTransform, unionBox, type Box } from '../src/client/layout.ts'

/** Square the sidebar renders the whale in. */
const markBox: Box = { left: 16, top: 58, width: 24, height: 17.66 }
/** Box the wordmark occupies beside it. */
const nameBox: Box = { left: 48, top: 54, width: 156, height: 24 }

describe('brand coordinate system', () => {
  it('operator sees one lockup, not two independent viewBoxes', () => {
    // Given: the two rendered boxes the sidebar produces.
    const boxes = new Map([
      ['mark', markBox],
      ['name', nameBox],
    ])
    const viewBoxes = new Map([
      ['mark', '0 0 23.16 17.04'],
      ['name', '26 0 156 24'],
    ])
    // When: the shared layout is built at 2x.
    const layout = buildLayout(boxes, viewBoxes, 2)
    if (layout === undefined) throw new Error('the lockup layout was not built')
    // Then: the union covers both parts, and each part keeps its own transform
    // rather than being treated as if it shared the other's viewBox.
    expect(layout.box.left).toBe(16)
    expect(layout.box.width).toBeCloseTo(188, 5)
    expect(layout.parts.size).toBe(2)
    const mark = layout.parts.get('mark')!
    const name = layout.parts.get('name')!
    // Each part is scaled by its own viewBox-to-box ratio (the whale's box is
    // its own aspect, the wordmark's is its own), which is exactly why the two
    // viewBoxes must not be used as one coordinate system.
    expect(mark.scale).toBeCloseTo((24 / 23.16) * 2, 4)
    expect(name.scale).toBeCloseTo((24 / 24) * 2, 4)
    expect(mark.offsetX).toBeLessThan(name.offsetX)
  })

  it('operator sees the beam travel across the whole lockup, through the gap', () => {
    // Given: the shared layout.
    const layout = buildLayout(
      new Map([
        ['mark', markBox],
        ['name', nameBox],
      ]),
      new Map([
        ['mark', '0 0 23.16 17.04'],
        ['name', '26 0 156 24'],
      ]),
      2,
    )!
    // When: the travel range is read.
    // Then: it starts left of the whale and ends right of the plate, so the
    // beam never restarts at the wordmark's own left edge.
    expect(layout.startX).toBeLessThan(layout.parts.get('mark')!.offsetX)
    expect(layout.endX).toBeGreaterThan(layout.parts.get('name')!.offsetX + nameBox.width * layout.dpr)
    // The influence zone is a dialog, not a hairline: it tracks the configured
    // fraction of the lockup width and is not clamped by the lockup height.
    expect(layout.sigma / (layout.box.width * layout.dpr)).toBeCloseTo(0.125, 2)
  })

  it('operator never sees the lifted stroke clipped by the canvas edge', () => {
    // Given: the shared layout.
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

  it('operator sees a part mapped onto its rendered box, not its viewBox', () => {
    // Given: a viewBox narrower than the box it is drawn into.
    const box: Box = { left: 100, top: 50, width: 40, height: 20 }
    // When: the transform is computed against a canvas origin of 10, 10.
    const transform = partTransform('0 0 20 10', box, { left: 10, top: 10 }, 2, 2)
    // Then: the scale is the smaller axis ratio times the device ratio, and the
    // offsets are the rendered position minus the canvas origin.
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
