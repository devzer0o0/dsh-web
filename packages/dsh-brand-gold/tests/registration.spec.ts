// @vitest-environment jsdom
/**
 * Occupant registration: a part that registers after another must still reach
 * the metal mask.
 *
 * The live host found this before the tests did: the whale registered first, the
 * mask was built from that one geometry, and the wordmark never became metal.
 * The assertion is therefore about the mask the controller ends up with, not
 * about the registration call succeeding.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrandSweepController } from '../src/client/overlay.ts'
import { MARK_GEOMETRY, NAME_GEOMETRY } from '../src/client/paths.ts'

/** Give an element a layout box, which jsdom does not do. */
function place(element: HTMLElement, width: number, height: number, left = 0, top = 0): void {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect
}

let mark: HTMLElement
let name: HTMLElement

beforeEach(() => {
  mark = document.createElement('span')
  name = document.createElement('span')
  place(mark, 24, 17.66, 16, 58)
  place(name, 156, 24, 48, 54)
  document.body.append(mark, name)
})

afterEach(() => {
  mark.remove()
  name.remove()
})

describe('occupant registration', () => {
  it('operator sees both parts in the mask whichever one registers first', () => {
    // Given: a controller that has already measured the whale.
    const controller = new BrandSweepController()
    const svg = (): SVGSVGElement => document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    controller.register({ id: 'mark', root: mark, svg: svg(), geometry: MARK_GEOMETRY })
    // When: the wordmark registers afterwards.
    controller.register({ id: 'name', root: name, svg: svg(), geometry: NAME_GEOMETRY })
    // Then: the geometry the controller holds covers both parts, so the mask it
    // will upload contains the wordmark and the plate as well as the whale.
    const shapes = controller.geometrySnapshot()
    expect(shapes.size).toBe(2)
    expect(shapes.get('mark')!.outline.length).toBeGreaterThan(0)
    expect(shapes.get('name')!.outline.length).toBeGreaterThan(0)
    expect(shapes.get('name')!.plates.length).toBe(1)
    expect(shapes.get('name')!.exclusions.length).toBeGreaterThan(0)
    controller.dispose()
  })

  it('operator gets the mask rebuilt when a part leaves', () => {
    // Given: both parts registered.
    const controller = new BrandSweepController()
    const svg = (): SVGSVGElement => document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    controller.register({ id: 'mark', root: mark, svg: svg(), geometry: MARK_GEOMETRY })
    controller.register({ id: 'name', root: name, svg: svg(), geometry: NAME_GEOMETRY })
    expect(controller.geometrySnapshot().size).toBe(2)
    // When: the wordmark unregisters.
    controller.unregister('name')
    // Then: only the whale is left in the mask, and nothing stale survives.
    const shapes = controller.geometrySnapshot()
    expect(shapes.size).toBe(1)
    expect(shapes.has('name')).toBe(false)
    controller.dispose()
  })
})
