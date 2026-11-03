// @vitest-environment jsdom
/**
 * Brand-gold occupants: the two sidebar brand slots render the original brand
 * vectors with the gold material, without changing geometry or the HARNESS
 * plate's dark lettering.
 */
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { apply } from '../src/client/index.ts'
import {
  BADGE_RECT,
  BADGE_TEXT_PATHS,
  NAME_VIEWBOX,
  WHALE_HEIGHT,
  WHALE_PATH,
  WHALE_WIDTH,
  WORDMARK_PATHS,
} from '../src/client/paths.ts'

interface Occupant {
  component: ComponentType<{ size?: number }>
  priority: number
}

/**
 * Build a slot registry stub that records the occupants the plugin registers.
 * @returns the registered component per slot name, with its priority.
 */
function collectRegistrations(): Map<string, Occupant> {
  const registered = new Map<string, Occupant>()
  const slots = {
    inject(_name: string, callback: () => unknown) {
      const produced = callback()
      if (produced !== null && typeof produced === 'object' && Symbol.iterator in produced) {
        return [...(produced as Iterable<unknown>)]
      }
      return produced
    },
    register(options: { name: string; priority?: number }, component: Occupant['component']) {
      registered.set(options.name, { component, priority: options.priority ?? 0 })
      return () => {}
    },
  }
  apply({ slots } as never)
  return registered
}

/**
 * Read one registered component.
 * @param name - slot name.
 * @returns the component the plugin registered into that slot.
 */
function occupant(name: string): Occupant['component'] {
  const found = collectRegistrations().get(name)
  if (found === undefined) throw new Error(`slot "${name}" was left unoccupied`)
  return found.component
}

afterEach(cleanup)

describe('brand-gold occupants', () => {
  it('operator sees both brand slots filled one priority below the stock occupants', () => {
    // Given: the shell has declared both brand slots.
    const registered = collectRegistrations()
    // When: the plugin applied itself; registration happened through inject.
    const names = [...registered.keys()].sort()
    // Then: exactly the two brand slots, each shadowing the stock occupant.
    expect(names).toEqual(['sidebar.brand.mark', 'sidebar.brand.name'])
    expect([...registered.values()].map((entry) => entry.priority)).toEqual([-1, -1])
  })

  it('operator sees the original whale silhouette and viewBox in the gold mark', () => {
    // Given: the mark occupant is registered.
    const Mark = occupant('sidebar.brand.mark')
    // When: render it at the sidebar's native size.
    const { container } = render(<Mark size={24} />)
    // Then: same viewBox and the original path painted by a gradient.
    const svg = container.querySelector('svg')
    const painted = [...container.querySelectorAll('g > path')]
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${WHALE_WIDTH} ${WHALE_HEIGHT}`)
    expect(svg?.getAttribute('data-dsh-plugin')).toBe('brand-gold')
    expect(painted.map((node) => node.getAttribute('d'))).toEqual([
      WHALE_PATH,
      WHALE_PATH,
      WHALE_PATH,
      WHALE_PATH,
    ])
    expect(painted[0]?.getAttribute('fill')).toBe('url(#bg-mark-' + painted[0]!.closest('svg')!.querySelector('[id]')!.id.split('-')[2] + '-base)')
    expect(container.querySelector('clipPath path')?.getAttribute('d')).toBe(WHALE_PATH)
  })

  it('operator sees the original glyphs, the rounded plate and its dark lettering', () => {
    // Given: the name occupant is registered.
    const Name = occupant('sidebar.brand.name')
    // When: render it at the sidebar's native size.
    const { container } = render(<Name size={24} />)
    // Then: same viewBox, every original glyph, the same plate and dark ink.
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(NAME_VIEWBOX)
    const dirs = [...container.querySelectorAll('path')].map((node) => node.getAttribute('d'))
    for (const glyph of WORDMARK_PATHS) expect(dirs).toContain(glyph)
    for (const glyph of BADGE_TEXT_PATHS) expect(dirs).toContain(glyph)
    const plate = [...container.querySelectorAll('rect')].find(
      (node) => node.getAttribute('width') === String(BADGE_RECT.width),
    )
    expect(plate?.getAttribute('height')).toBe(String(BADGE_RECT.height))
    expect(plate?.getAttribute('rx')).toBe(String(BADGE_RECT.rx))
    const ink = [...container.querySelectorAll('path')].filter(
      (node) => node.getAttribute('fill') === 'var(--bg-gold-ink, #2E2008)',
    )
    expect(ink.map((node) => node.getAttribute('d'))).toEqual(BADGE_TEXT_PATHS)
  })

  it('operator mounting both halves never sees two elements sharing an SVG id', () => {
    // Given: both occupants come from the same plugin instance.
    const Mark = occupant('sidebar.brand.mark')
    const Name = occupant('sidebar.brand.name')
    // When: mount them side by side, as the sidebar row does.
    const first = render(<Mark size={24} />)
    const second = render(<Name size={24} />)
    // Then: every gradient, clip and mask id belongs to exactly one element.
    const ids = [
      ...first.container.querySelectorAll('[id]'),
      ...second.container.querySelectorAll('[id]'),
    ].map((node) => node.id)
    expect(ids.length).toBeGreaterThan(10)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('bg-'))).toBe(true)
  })
})