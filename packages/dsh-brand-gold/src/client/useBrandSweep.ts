/**
 * React binding for the brand sweep.
 *
 * The hook owns only two refs and the registration. Measurement, GPU work and
 * timing live in the shared controller, so re-rendering the sidebar never
 * creates a device, a popover or a second timeline. Unmounting unregisters this
 * occupant; the controller releases its own resources when the last one leaves.
 *
 * Geometry is a frozen module-level constant, so its identity is stable and the
 * effect cannot re-run because of it.
 *
 * @module dsh-brand-gold/useBrandSweep
 */
import { useEffect, useRef, type RefObject } from 'react'
import type { BrandGeometry } from './layout.ts'
import { sharedController } from './overlay.ts'

/** Reduced-motion query: the sweep is off, the static gold stays. */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Refs handed back to the component. */
export interface BrandSweepRefs {
  /** Root element of the occupant. */
  readonly root: RefObject<HTMLSpanElement>
  /** The SVG that paints the occupant. */
  readonly svg: RefObject<SVGSVGElement>
}

/**
 * Register a lockup part with the shared sweep controller.
 * @param id - stable part id.
 * @param geometry - static module-level geometry of this part.
 * @returns the refs to attach to the root element and its SVG.
 */
export function useBrandSweep(id: string, geometry: BrandGeometry): BrandSweepRefs {
  const root = useRef<HTMLSpanElement>(null)
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const element = root.current
    const shape = svg.current
    if (element === null || shape === null) return
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(REDUCED_MOTION).matches) {
      return
    }
    const controller = sharedController()
    controller.register({ id, root: element, svg: shape, geometry })
    return () => controller.unregister(id)
  }, [id, geometry])

  return { root, svg }
}
