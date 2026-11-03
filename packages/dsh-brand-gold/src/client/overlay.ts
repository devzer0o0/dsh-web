/**
 * The one owner of the sweep overlay.
 *
 * A single controller serves the whole lockup: both occupants register their
 * element and geometry with it, it measures them into one shared coordinate
 * system, and it drives one canvas, one device and one timeline. It never
 * removes another instance's nodes: cleanup covers only the popover, GPU
 * resources, timers, animation frames and listeners it created itself.
 *
 * Frames are drawn only inside the sweep window. The resting part of every
 * period runs no animation frame at all; the next sweep is armed with a single
 * timer, and a sweep that would be missed while the page or the lockup is hidden
 * is skipped, never replayed.
 *
 * The SVG underneath is never hidden. The overlay is an additive metal response:
 * the beam's light, its local magnification and its lift are drawn above the
 * original lockup and the canvas goes fully transparent outside the beam and
 * outside the metal, so the resting logo is exactly the SVG and nothing double
 * draws.
 *
 * @module dsh-brand-gold/overlay
 */

import { diag } from './diag.ts'
import { acquireDevice, currentDevice, gpuStatus, probeCapabilities, resetDevice } from './gpu.ts'
import { buildLayout, boxOf, type Box, type BrandGeometry, type LockupLayout } from './layout.ts'
import { compositeMaterial, type MaterialPart } from './material.ts'
import { createRenderer, type CanvasMode, type PlateRect, type SweepRenderer } from './renderer.ts'
import { SWEEP_PARAMS, nextSweepStartAt, type SweepParams } from './sweep.ts'

/**
 * Lifecycle phase. Every value is reported on its own, so "nothing drawn" can
 * never be confused with "the host does not support it":
 *
 * - `anchor-missing`: no occupant element is in the document;
 * - `anchor-hidden`: an occupant is mounted but has no layout box;
 * - `zero-size`: the measured lockup collapsed to an empty box;
 * - `capability-missing`: WebGPU, extended range or the popover API is absent;
 * - `gpu-init-failed`: adapter or device acquisition failed;
 * - `material-failed`: the material raster could not be produced;
 * - `composite-failed`: the canvas or the popover could not be created;
 * - `drawing`: frames are being submitted;
 * - `verified`: frames submitted and the shader read back above 1.0.
 *   Display verification is measured separately and never inferred from this.
 */
export type OverlayPhase =
  | 'idle'
  | 'anchor-missing'
  | 'anchor-hidden'
  | 'zero-size'
  | 'capability-missing'
  | 'gpu-init-failed'
  | 'material-failed'
  | 'composite-failed'
  | 'drawing'
  | 'verified'

/** One occupant of the lockup. */
export interface Occupant {
  /** Stable part id. */
  readonly id: string
  /** Root element carrying the rendered box. */
  readonly root: HTMLElement
  /** The SVG that paints this part. */
  readonly svg: SVGSVGElement
  /** Original vectors and plate geometry. */
  readonly geometry: BrandGeometry
}

/** The diagnostic snapshot this controller publishes. */
export interface OverlayState {
  /** Lifecycle phase. */
  readonly phase: OverlayPhase
  /** Canvas compositing mode. */
  readonly mode: CanvasMode
  /** GPU capability state. */
  readonly device: string
  /** Canvas size and device pixel ratio. */
  readonly layout: string
  /** Frames submitted in the current cycle. */
  readonly frames: number
  /** Wall-clock time the last sweep started at. */
  readonly lastSweepAt: number
  /** Peak linear value the shader produced in the last cycle. */
  readonly peak: number
}

const POPOVER_PART = 'brand-sweep'
const CANVAS_PART = 'brand-sweep-canvas'

/** Envelope ramp of the sweep, as a fraction of the sweep window. */
const FADE_IN = 0.16
const FADE_OUT = 0.22

/**
 * Smooth 0..1 ramp.
 * @param edge0 - lower edge.
 * @param edge1 - upper edge.
 * @param value - input.
 * @returns the eased value, clamped to 0..1.
 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0 || 1)))
  return t * t * (3 - 2 * t)
}

/**
 * Sweep envelope over the window: soft entry, near-constant travel, soft exit.
 * @param progress - 0..1 through the sweep window.
 * @returns 0..1 amplitude.
 */
export function sweepEnvelope(progress: number): number {
  const inRamp = smoothstep(0, FADE_IN, progress)
  const outRamp = 1 - smoothstep(1 - FADE_OUT, 1, progress)
  return Math.max(0, Math.min(1, inRamp * outRamp))
}

/** The shared sweep controller. */
export class BrandSweepController {
  private readonly occupants = new Map<string, Occupant>()
  private popover: HTMLDivElement | undefined
  private canvas: HTMLCanvasElement | undefined
  private renderer: SweepRenderer | undefined
  private layout: LockupLayout | undefined
  private resizeObserver: ResizeObserver | undefined
  private intersectionObserver: IntersectionObserver | undefined
  private themeObserver: MutationObserver | undefined
  private displayHandler: (() => void) | undefined
  private frame = 0
  private timer: number | undefined
  private origin = 0
  private armed = false
  private disposed = false
  private listening = false
  private generation = 0
  private phase: OverlayPhase = 'idle'
  private frames = 0
  private lastSweepAt = 0
  private peak = 0
  private readonly mode: CanvasMode
  private readonly params: SweepParams
  private readonly onVisibility = (): void => this.handleVisibility()
  private readonly onViewport = (): void => this.rebuild('viewport')

  /**
   * @param params - tunables; the shipped defaults unless a test overrides them.
   * @param mode - compositing mode of the canvas.
   */
  constructor(params: SweepParams = SWEEP_PARAMS, mode: CanvasMode = 'premultiplied') {
    this.params = params
    this.mode = mode
  }

  /** Current phase, for the diagnostic and the tests. */
  get state(): OverlayPhase {
    return this.phase
  }

  /** Compositing mode in use. */
  get canvasMode(): CanvasMode {
    return this.mode
  }

  /**
   * Register one occupant and re-measure the lockup.
   * @param occupant - element, SVG, geometry and id.
   */
  register(occupant: Occupant): void {
    if (this.disposed) return
    this.occupants.set(occupant.id, occupant)
    this.listen()
    this.observe(occupant.root)
    this.rebuild('register:' + occupant.id)
  }

  /**
   * Drop one occupant; the overlay is released when the last one leaves.
   * @param id - part id.
   */
  unregister(id: string): void {
    this.occupants.delete(id)
    if (this.occupants.size === 0) {
      this.dispose()
      return
    }
    this.rebuild('unregister:' + id)
  }

  /**
   * Re-measure and redraw without touching the device or the timeline.
   * @param reason - diagnostic label.
   */
  rebuild(reason: string): void {
    if (this.disposed) return
    if (this.occupants.size === 0) {
      this.phase = 'anchor-missing'
      this.publish()
      return
    }
    const boxes = new Map<string, Box>()
    const viewBoxes = new Map<string, string>()
    let mounted = false
    for (const occupant of this.occupants.values()) {
      if (occupant.root.isConnected) mounted = true
      const box = boxOf(occupant.root)
      if (box === undefined) continue
      boxes.set(occupant.id, box)
      viewBoxes.set(occupant.id, occupant.geometry.viewBox)
    }
    if (boxes.size === 0) {
      this.phase = mounted ? 'anchor-hidden' : 'anchor-missing'
      this.publish()
      this.hide()
      return
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const layout = buildLayout(boxes, viewBoxes, dpr, this.params)
    if (layout === undefined) {
      this.phase = 'zero-size'
      this.publish()
      this.hide()
      return
    }
    this.layout = layout
    diag.record('layout', { reason, width: layout.width, height: layout.height, dpr })
    if (!this.prepare()) return
    this.place()
    this.show()
    this.schedule()
    void this.upload()
  }

  /**
   * Ensure the device, renderer, popover and canvas exist.
   * @returns true when drawing can proceed.
   */
  private prepare(): boolean {
    const status = probeCapabilities()
    if (status.phase === 'unsupported-webgpu' || status.phase === 'unsupported-range') {
      this.phase = 'capability-missing'
      this.publish()
      diag.record('capability-missing', { reason: status.reason })
      return false
    }
    const device = currentDevice()
    if (device === undefined) {
      const mine = this.generation
      this.publish()
      void acquireDevice().then((acquired) => {
        if (this.disposed || mine !== this.generation) return
        if (acquired === undefined) {
          this.phase = 'gpu-init-failed'
          this.publish()
          return
        }
        this.rebuild('device-ready')
      })
      return false
    }
    if (this.renderer === undefined) {
      const canvas = this.ensureCanvas()
      if (canvas === undefined) {
        this.phase = 'composite-failed'
        this.publish()
        return false
      }
      const renderer = createRenderer(canvas, device, this.mode)
      if (renderer === undefined) {
        this.phase = 'composite-failed'
        this.publish()
        diag.record('renderer-failed')
        return false
      }
      this.renderer = renderer
    }
    if (this.popover === undefined && !this.createPopover()) {
      this.phase = 'composite-failed'
      this.publish()
      return false
    }
    this.renderer.resize(this.layout!)
    return true
  }

  /**
   * Create the canvas.
   * @returns the canvas, or undefined when the document refuses one.
   */
  private ensureCanvas(): HTMLCanvasElement | undefined {
    if (this.canvas !== undefined) return this.canvas
    const canvas = document.createElement('canvas')
    canvas.dataset.dshPart = CANVAS_PART
    canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none'
    this.canvas = canvas
    return canvas
  }

  /**
   * Create and open the manual popover that carries the canvas.
   * @returns true when the popover is in the top layer.
   */
  private createPopover(): boolean {
    const canvas = this.canvas
    if (canvas === undefined) return false
    const shell = document.createElement('div')
    shell.setAttribute('popover', 'manual')
    shell.dataset.dshPart = POPOVER_PART
    shell.style.cssText = [
      'position:fixed',
      'margin:0',
      'padding:0',
      'border:0',
      'background:transparent',
      'overflow:visible',
      'pointer-events:none',
      'inset:auto',
      'visibility:hidden',
    ].join(';')
    shell.append(canvas)
    document.body.append(shell)
    try {
      ;(shell as unknown as { showPopover(): void }).showPopover()
    } catch (error) {
      shell.remove()
      this.canvas = undefined
      diag.record('popover-failed', { reason: String(error).slice(0, 120) })
      return false
    }
    this.popover = shell
    diag.record('popover-open')
    return true
  }

  /** Position the popover over the lockup, including the pad the warp needs. */
  private place(): void {
    const popover = this.popover
    const layout = this.layout
    if (popover === undefined || layout === undefined) return
    popover.style.left = layout.box.left - layout.pad + 'px'
    popover.style.top = layout.box.top - layout.pad + 'px'
    popover.style.width = layout.box.width + layout.pad * 2 + 'px'
    popover.style.height = layout.box.height + layout.pad * 2 + 'px'
  }

  /** Make the canvas visible; it stays empty (fully transparent) at rest. */
  private show(): void {
    if (this.popover === undefined) return
    this.popover.style.visibility = ''
    this.place()
  }

  /** Hide the canvas while the lockup is off-screen or covered. */
  private hide(): void {
    if (this.popover !== undefined) this.popover.style.visibility = 'hidden'
  }

  /**
   * Composite the live lockup and hand it to the renderer.
   *
   * Async by nature; the generation guards against a resize, a theme change or
   * a later layout replacing this result after it resolves.
   */
  private async upload(): Promise<void> {
    const mine = ++this.generation
    const layout = this.layout
    const renderer = this.renderer
    if (layout === undefined || renderer === undefined) return
    const parts: MaterialPart[] = []
    for (const occupant of this.occupants.values()) parts.push({ id: occupant.id, svg: occupant.svg })
    const material = await compositeMaterial(layout, parts)
    if (this.disposed || mine !== this.generation || material === undefined) {
      if (material === undefined && !this.disposed && mine === this.generation) {
        this.phase = 'material-failed'
        this.publish()
        diag.record('material-failed')
      }
      return
    }
    renderer.setMaterial(material)
    this.peak = 0
    this.frames = 0
    this.drawRest()
    this.phase = this.phase === 'verified' ? 'verified' : 'drawing'
    this.publish()
  }

  /** Paint the resting state (no beam) once. */
  private drawRest(): void {
    const layout = this.layout
    if (layout === undefined) return
    this.draw(layout.startX - layout.sigma * 6, 0)
  }

  /**
   * Parameters for drawing.
   *
   * The extended-range gain is only handed to a canvas that actually keeps
   * extended values; on an SDR surface the same shader runs with the extended
   * term at zero, so the highlight is a metal reflection instead of a clipped
   * white patch.
   * @returns the effective tunables.
   */
  private drawParams(): SweepParams {
    return this.mode === 'opaque-extended' ? this.params : { ...this.params, hdrGain: 0 }
  }

  /** The HARNESS plate of the wordmark, in canvas pixels. */
  private plateOf(): PlateRect | undefined {
    const rect = this.plateRect()
    return rect === undefined ? undefined : { x: rect.x, y: rect.y, width: rect.width, height: rect.height, rx: rect.rx }
  }

  private plateRect(): { x: number; y: number; width: number; height: number; rx: number } | undefined {
    const layout = this.layout
    if (layout === undefined) return undefined
    const name = this.occupants.get('name')
    const plate = name?.geometry.plates?.[0]
    const transform = layout.parts.get('name')
    if (plate === undefined || transform === undefined) return undefined
    const [minX = 0, minY = 0] = name!.geometry.viewBox.split(/\s+/).map(Number)
    return {
      x: transform.offsetX + (plate.x - minX) * transform.scale,
      y: transform.offsetY + (plate.y - minY) * transform.scale,
      width: plate.width * transform.scale,
      height: plate.height * transform.scale,
      rx: plate.rx * transform.scale,
    }
  }

  /**
   * Draw one frame.
   * @param centerX - beam centre in device pixels.
   * @param sweep - envelope amplitude.
   */
  private draw(centerX: number, sweep: number): void {
    const renderer = this.renderer
    const layout = this.layout
    if (renderer === undefined || layout === undefined) return
    const plate = this.plateRect()
    renderer.draw({
      centerX,
      sweep,
      layout,
      params: this.params,
      plate: plate === undefined ? undefined : { x: plate.x, y: plate.y, width: plate.width, height: plate.height, rx: plate.rx },
    })
    this.frames += 1
  }

  /** Arm the next sweep with exactly one timer. */
  private schedule(): void {
    if (this.disposed) return
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer)
      this.timer = undefined
    }
    this.armed = false
    if (document.hidden || !this.inViewport()) return
    const now = performance.now()
    if (this.origin === 0) this.origin = now + this.params.firstDelayMs
    const start = nextSweepStartAt(now, this.origin, this.params)
    this.armed = true
    diag.record('armed', { delay: Math.round(start - now) })
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      this.startSweep()
    }, Math.max(0, start - now))
  }

  /** Run exactly one sweep inside the shared timeline. */
  private startSweep(): void {
    if (this.disposed || !this.armed || this.renderer === undefined) return
    this.armed = false
    if (document.hidden || !this.inViewport()) {
      this.schedule()
      return
    }
    const now = performance.now()
    const period = Math.floor((now - this.origin) / this.params.periodMs)
    const start = this.origin + period * this.params.periodMs
    if (now - start > this.params.sweepMs) {
      diag.record('sweep-skipped', { late: Math.round(now - start) })
      this.schedule()
      return
    }
    this.lastSweepAt = Date.now()
    this.peak = 0
    diag.record('sweep-start', { late: Math.round(now - start) })
    const tick = (): void => {
      this.frame = 0
      if (this.disposed) return
      const layout = this.layout
      if (layout === undefined || this.renderer === undefined) return
      const elapsed = performance.now() - start
      const progress = Math.min(1, Math.max(0, elapsed / this.params.sweepMs))
      const centerX = layout.startX + (layout.endX - layout.startX) * progress
      this.draw(centerX, sweepEnvelope(progress))
      if (this.frames % 3 === 0) this.publish()
      if (progress < 1) {
        this.frame = window.requestAnimationFrame(tick)
        return
      }
      // The beam has left the lockup: paint the resting state once and stop.
      // The measurement runs on its own and upgrades the phase when it lands.
      this.drawRest()
      void this.measureCycle()
      this.publish()
      this.schedule()
    }
    this.frame = window.requestAnimationFrame(tick)
  }

  /**
   * Measure one mid-sweep frame offscreen and record the peak linear value.
   *
   * This is the shader-level check: it proves the extended encode produced
   * values above 1.0 in the shader's own output. It is not a display
   * measurement, and the phase only reaches `verified` when it passes.
   */
  private async measureCycle(): Promise<void> {
    const renderer = this.renderer
    const layout = this.layout
    if (renderer === undefined || layout === undefined) return
    const plate = this.plateRect()
    const centerX = (layout.startX + layout.endX) / 2
    const peak = await renderer.measure({
      centerX,
      sweep: 1,
      layout,
      params: this.drawParams(),
      plate: plate === undefined ? undefined : { x: plate.x, y: plate.y, width: plate.width, height: plate.height, rx: plate.rx },
    })
    if (this.disposed) return
    this.peak = peak
    if (peak > 1.02 && this.phase === 'drawing') this.phase = 'verified'
    diag.record('measure', { peak: Math.round(peak * 100) / 100, error: renderer.measureError().slice(0, 120) })
    this.publish()
  }

  /**
   * Is any part of the lockup inside the viewport?
   * @returns true when the union box intersects the viewport.
   */
  private inViewport(): boolean {
    const layout = this.layout
    if (layout === undefined) return false
    const { box } = layout
    return box.top + box.height > 0
      && box.top < window.innerHeight
      && box.left + box.width > 0
      && box.left < window.innerWidth
  }

  /** Re-arm after the page becomes visible again, skipping missed sweeps. */
  private handleVisibility(): void {
    if (this.disposed) return
    if (document.hidden) {
      this.cancel()
      return
    }
    this.origin = performance.now() + this.params.periodMs
    this.rebuild('visible')
  }

  /** Stop the animation-frame loop and the pending timer. */
  private cancel(): void {
    if (this.frame !== 0) {
      window.cancelAnimationFrame(this.frame)
      this.frame = 0
    }
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer)
      this.timer = undefined
    }
    this.armed = false
  }

  /** Push the diagnostic snapshot. */
  private publish(): void {
    if (!diag.enabled) return
    const layout = this.layout
    const state: OverlayState = {
      phase: this.phase,
      mode: this.mode,
      device: gpuStatus().phase,
      layout: layout === undefined ? 'none' : layout.width + 'x' + layout.height + '@' + layout.dpr,
      frames: this.frames,
      lastSweepAt: this.lastSweepAt,
      peak: this.peak,
    }
    diag.publish(state)
  }

  /** Attach the window listeners once. */
  private listen(): void {
    if (this.listening || this.disposed) return
    this.listening = true
    window.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('resize', this.onViewport)
    window.addEventListener('scroll', this.onViewport, true)
    if (typeof MutationObserver === 'function') {
      this.themeObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName === 'data-ds-dark-theme' || record.attributeName === 'class') {
            // A theme change needs the material re-read, not just a redraw.
            this.rebuild('theme')
            return
          }
        }
      })
      this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
    }
    this.watchDisplay()
  }

  /**
   * Observe one occupant's layout and visibility.
   * @param root - the occupant's root element.
   */
  private observe(root: HTMLElement): void {
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver ??= new ResizeObserver(() => this.rebuild('resize'))
      this.resizeObserver.observe(root)
    }
    if (typeof IntersectionObserver === 'function') {
      this.intersectionObserver ??= new IntersectionObserver(() => {
        if (!this.inViewport()) {
          this.cancel()
          this.hide()
        } else {
          this.rebuild('intersect')
        }
      })
      this.intersectionObserver.observe(root)
    }
  }

  /** Rebuild when the effective device pixel ratio changes. */
  private watchDisplay(): void {
    if (typeof window.matchMedia !== 'function') return
    this.displayHandler?.()
    const query = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)')
    const handler = (): void => {
      if (query.matches) return
      query.removeEventListener('change', handler)
      this.rebuild('dpr')
      this.watchDisplay()
    }
    query.addEventListener('change', handler)
    this.displayHandler = () => query.removeEventListener('change', handler)
  }

  /** Release everything this controller owns. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.cancel()
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.themeObserver?.disconnect()
    this.displayHandler?.()
    this.resizeObserver = undefined
    this.intersectionObserver = undefined
    this.themeObserver = undefined
    this.displayHandler = undefined
    if (this.listening) {
      window.removeEventListener('visibilitychange', this.onVisibility)
      window.removeEventListener('resize', this.onViewport)
      window.removeEventListener('scroll', this.onViewport, true)
      this.listening = false
    }
    this.renderer?.dispose()
    this.renderer = undefined
    try {
      ;(this.popover as unknown as { hidePopover?(): void } | undefined)?.hidePopover?.()
    } catch {
      // A popover already out of the top layer is fine.
    }
    this.popover?.remove()
    this.popover = undefined
    this.canvas = undefined
    this.layout = undefined
    if (shared === this) shared = undefined
    diag.record('dispose')
  }

  /** Drop the device and rebuild on a fresh one (diagnostic and device loss). */
  resetGpu(): void {
    this.renderer?.dispose()
    this.renderer = undefined
    resetDevice()
    this.generation += 1
    this.rebuild('gpu-reset')
  }
}

/** The module-level controller, shared by every occupant of this plugin. */
let shared: BrandSweepController | undefined

/**
 * Acquire the shared controller.
 * @returns the controller, created on first use.
 */
export function sharedController(): BrandSweepController {
  shared ??= new BrandSweepController()
  return shared
}
