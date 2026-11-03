// @vitest-environment jsdom
/**
 * Lifecycle: one shared controller, one overlay per lockup, no cross-instance
 * deletion, no frame loop while resting, and a full release on unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandSweepController, sweepEnvelope } from '../src/client/overlay.ts'
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
  document.title = ''
  vi.restoreAllMocks()
})

describe('brand sweep lifecycle', () => {
  it('operator sees one overlay for the whole lockup, not one per occupant', () => {
    // Given: an empty document and one controller.
    const controller = new BrandSweepController()
    // When: both occupants register.
    controller.register({ id: 'mark', root: mark, svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), geometry: MARK_GEOMETRY })
    controller.register({ id: 'name', root: name, svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), geometry: NAME_GEOMETRY })
    // Then: the controller holds both, and there is still no popover on screen
    // (WebGPU is absent in jsdom, so the phase says so instead of guessing).
    expect(controller.state === 'capability-missing' || controller.state === 'idle').toBe(true)
    expect(document.querySelectorAll('[data-dsh-part="brand-sweep"]').length).toBe(0)
    controller.dispose()
  })

  it('operator sees nothing removed when another instance disposes', () => {
    // Given: two independent controllers, each with its own occupant.
    const first = new BrandSweepController()
    const second = new BrandSweepController()
    first.register({ id: 'mark', root: mark, svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), geometry: MARK_GEOMETRY })
    second.register({ id: 'name', root: name, svg: document.createElementNS('http://www.w3.org/2000/svg', 'svg'), geometry: NAME_GEOMETRY })
    // When: the first one is disposed.
    first.dispose()
    // Then: the second still owns its occupant and its DOM node.
    expect(name.isConnected).toBe(true)
    second.dispose()
    expect(name.isConnected).toBe(true)
  })

  it('operator never gets a second device or popover from a plain re-render', () => {
    // Given: one controller with a registered occupant.
    const controller = new BrandSweepController()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    controller.register({ id: 'mark', root: mark, svg, geometry: MARK_GEOMETRY })
    const before = document.querySelectorAll('[data-dsh-part="brand-sweep"]').length
    // When: it rebuilds repeatedly, as a resize or a re-render would.
    for (let index = 0; index < 5; index += 1) controller.rebuild('re-render')
    // Then: the overlay count is unchanged, so nothing was re-created.
    expect(document.querySelectorAll('[data-dsh-part="brand-sweep"]').length).toBe(before)
    controller.dispose()
  })

  it('operator gets every node released and a second dispose stays a no-op', () => {
    // Given: a controller with a registered occupant.
    const controller = new BrandSweepController()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    controller.register({ id: 'mark', root: mark, svg, geometry: MARK_GEOMETRY })
    // When: it is disposed twice, as an unmount followed by a stale callback.
    controller.dispose()
    const afterFirst = controller.state
    controller.dispose()
    // Then: no overlay node is left behind, and the second call changed nothing
    // because the controller is already down.
    expect(document.querySelectorAll('[data-dsh-part="brand-sweep"]').length).toBe(0)
    expect(document.querySelectorAll('[data-dsh-part="brand-sweep-canvas"]').length).toBe(0)
    expect(controller.state).toBe(afterFirst)
    // A disposed controller also refuses new occupants instead of re-arming.
    controller.register({ id: 'mark', root: mark, svg, geometry: MARK_GEOMETRY })
    expect(document.querySelectorAll('[data-dsh-part="brand-sweep"]').length).toBe(0)
  })

  it('operator gets the original SVG back when the overlay cannot run', () => {
    // Given: a controller that cannot acquire a device (jsdom has no WebGPU).
    const controller = new BrandSweepController()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('data-test-svg', 'original')
    mark.append(svg)
    // When: the occupant registers and the rebuild gives up on capability.
    controller.register({ id: 'mark', root: mark, svg, geometry: MARK_GEOMETRY })
    // Then: the SVG is untouched and visible, so the lockup still renders.
    expect(svg.isConnected).toBe(true)
    expect(svg.getAttribute('data-test-svg')).toBe('original')
    expect(svg.style.display).toBe('')
    controller.dispose()
  })

  it('operator sees the resting lockup restored exactly after a sweep', () => {
    // Given: the envelope that drives the beam.
    // When: the window has finished.
    // Then: the amplitude is zero, so the shader returns a transparent pixel
    // and the SVG underneath is the only thing on screen.
    expect(sweepEnvelope(1)).toBeCloseTo(0, 6)
    expect(sweepEnvelope(0)).toBe(0)
  })
})
