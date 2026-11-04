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
 * The first sweep waits for the material to be uploaded, not merely for a GPU
 * device to exist: an animation that starts before there is anything to light
 * would spend its first cycle on an empty canvas.
 *
 * @module dsh-brand-gold/overlay
 */

import { diag } from './diag.ts'
import { acquireDevice, currentDevice, gpuStatus, probeCapabilities, resetDevice } from './gpu.ts'
import { buildLayout, boxOf, type Box, type BrandGeometry, type LockupLayout } from './layout.ts'
import { calibrationOf, type Calibration } from './light.ts'
import { compositeMaterial, type MaterialPart } from './material.ts'
import {
  EXTENDED_MODE,
  SDR_MODE,
  createRenderer,
  type CanvasMode,
  type DrawFrame,
  type PlateRect,
  type ReadbackSummary,
  type SweepRenderer,
} from './renderer.ts'
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
 * - `verified`: frames submitted and the shader read back above 1.0. This is a
 *   shader verdict; `displayVerified` is measured separately and never inferred
 *   from it.
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
  /** Requested canvas mode. */
  readonly mode: string
  /** Canvas mode actually in effect, as read back from the context. */
  readonly effectiveMode: string
  /** GPU capability state. */
  readonly device: string
  /** Canvas size and device pixel ratio. */
  readonly layout: string
  /** Frames submitted in the current cycle. */
  readonly frames: number
  /** Wall-clock time the last sweep started at. */
  readonly lastSweepAt: number
  /** Luminance the shader asked for at the core centre, in SDR-relative units. */
  readonly requestedPeakLinear: number
  /** Peak linear luminance the offscreen readback found. */
  readonly peakLinear: number
  /** Peak coverage-weighted linear luminance, what a compositor would show. */
  readonly peakComposited: number
  /** Luminance in nits implied by the readback and the reference white. */
  readonly measuredNits: number
  /** Whether the logo is being composited with extended range. */
  readonly displayVerified: boolean
  /** Reference white and headroom provenance. */
  readonly calibration: string
}

const POPOVER_PART = 'brand-sweep'
const CANVAS_PART = 'brand-sweep-canvas'

/** Reduced-motion query: the sweep is off, the static gold stays. */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Above this linear luminance the shader verdict counts as proven. */
const SHADER_HDR_FLOOR = 1.02

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
 * @param params - tunables; the fade shares come from here.
 * @returns 0..1 amplitude.
 */
export function sweepEnvelope(progress: number, params: SweepParams = SWEEP_PARAMS): number {
  const fadeIn = Math.max(params.fadeInRatio, 1e-4)
  const fadeOut = Math.max(params.fadeOutRatio, 1e-4)
  const inRamp = smoothstep(0, fadeIn, progress)
  const outRamp = 1 - smoothstep(1 - fadeOut, 1, progress)
  return Math.max(0, Math.min(1, inRamp * outRamp))
}

/**
 * Beam centre at one point of the sweep window.
 * @param startX - first centre, in device pixels.
 * @param endX - last centre, in device pixels.
 * @param progress - 0..1 through the sweep window.
 * @returns the centre, in device pixels.
 */
export function beamCenterAt(startX: number, endX: number, progress: number): number {
  return startX + (endX - startX) * Math.min(1, Math.max(0, progress))
}

/**
 * Time the beam centre spends inside the lockup, in milliseconds.
 *
 * The centre travels at a constant rate between `startX` and `endX`, so the
 * share of the window it spends between the lockup's two edges is exactly the
 * share of the travel those edges represent.
 *
 * @param layout - the measured layout.
 * @param sweepMs - length of the visible window.
 * @returns milliseconds from the centre reaching the left edge to the right edge.
 */
export function crossingMs(layout: LockupLayout, sweepMs: number): number {
  const left = layout.pad * layout.dpr
  const right = (layout.pad + layout.box.width) * layout.dpr
  const span = layout.endX - layout.startX
  if (span <= 0) return 0
  return ((right - left) / span) * sweepMs
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
  private motionQuery: MediaQueryList | undefined
  private motionHandler: (() => void) | undefined
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
  private peakLinear = 0
  private peakComposited = 0
  private displayVerified = false
  private effectiveMode = 'unknown'
  private ready = false
  private readonly mode: CanvasMode
  private readonly params: SweepParams
  private readonly calibration: Calibration
  private readonly onVisibility = (): void => this.handleVisibility()
  private readonly onViewport = (): void => this.rebuild('viewport')

  /**
   * @param params - tunables; the shipped defaults unless a test overrides them.
   * @param mode - compositing and tone-mapping mode of the canvas.
   * @param headroom - reported extended-range headroom, when the host exposes it.
   */
  constructor(
    params: SweepParams = SWEEP_PARAMS,
    mode: CanvasMode = EXTENDED_MODE,
    headroom: number | undefined = undefined,
  ) {
    this.params = params
    this.mode = mode
    this.calibration = calibrationOf(
      params.peakNits,
      params.sdrWhiteNits,
      params.assumedSdrWhiteNits,
      headroom,
    )
  }

  /** Current phase, for the diagnostic and the tests. */
  get state(): OverlayPhase {
    return this.phase
  }

  /** Compositing mode in use. */
  get canvasMode(): CanvasMode {
    return this.mode
  }

  /** Calibration record this controller reports. */
  get calibrationRecord(): Calibration {
    return this.calibration
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
    if (this.motionAllowed() === false) {
      // Reduced motion was switched on at runtime: stop everything and leave
      // the static gold SVG as the lockup.
      this.cancel()
      this.hide()
      this.ready = false
      this.phase = 'idle'
      this.publish()
      return
    }
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
    diag.record('layout', {
      reason,
      width: layout.width,
      height: layout.height,
      dpr,
      band: Math.round(layout.mainFwhm * 10) / 10,
      core: Math.round(layout.coreFwhm * 10) / 10,
      crossing: Math.round(crossingMs(layout, this.params.sweepMs)),
    })
    if (!this.prepare()) return
    this.place()
    this.show()
    if (this.ready) this.schedule()
    void this.upload()
  }

  /**
   * Ensure the device, renderer, popover and canvas exist.
   * @returns true when drawing can proceed.
   */
  private prepare(): boolean {
    const status = probeCapabilities()
    if (status.phase === 'unsupported-webgpu' || !status.popover) {
      // Without WebGPU there is no sweep at all; without the popover API the
      // canvas cannot reach the top layer. Both leave the static gold standing.
      this.phase = 'capability-missing'
      this.publish()
      diag.record('capability-missing', { reason: status.reason })
      return false
    }
    // The extended request is always attempted when WebGPU exists. The media
    // query is a display hint, not the canvas contract: Chromium keeps
    // `toneMapping: 'extended'` where `(dynamic-range: high)` still reads
    // false, so the decision is taken from the configuration read back after
    // `configure` (see `createRenderer`), never from the query alone.
    const device = currentDevice()
    if (device === undefined) {
      const mine = this.generation
      this.publish()
      void acquireDevice().then((acquired) => {
        if (this.disposed || mine !== this.generation) return undefined
        if (acquired === undefined) {
          this.phase = 'gpu-init-failed'
          this.publish()
          return undefined
        }
        this.rebuild('device-ready')
        return undefined
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
      this.effectiveMode = renderer.alpha + '/' + renderer.tone
      if (renderer.tone === 'standard' && this.mode.tone === 'extended') {
        diag.record('sdr-fallback', { reason: 'the canvas kept standard tone mapping' })
      }
      diag.record('renderer', { requested: this.mode.alpha + '/' + this.mode.tone, effective: this.effectiveMode })
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

  /** The HARNESS plate of the wordmark, in canvas pixels. */
  private plateOf(): PlateRect | undefined {
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
   * Build the one frame description used by both `draw` and `measure`.
   *
   * A single resolver is what keeps the two paths comparable: they share the
   * effective parameters, the same layout, the same envelope and the same
   * material, so a readback can never disagree with what is on screen because of
   * a duplicated expression.
   *
   * @param centerX - beam centre in device pixels.
   * @param sweep - envelope amplitude.
   * @returns the frame.
   */
  private resolveFrame(centerX: number, sweep: number): DrawFrame | undefined {
    const layout = this.layout
    if (layout === undefined) return undefined
    return {
      centerX,
      sweep,
      layout,
      params: this.params,
      peakLinear: this.calibration.requestedPeakLinear,
      plate: this.plateOf(),
    }
  }

  /**
   * Composite the live lockup and hand it to the renderer.
   *
   * Async by nature; the generation guards against a resize, a theme change or
   * a later layout replacing this result after it resolves. The timeline only
   * becomes ready here, once a material exists, so the first sweep is a full
   * delay after the resources are genuinely usable.
   */
  private async upload(): Promise<void> {
    const mine = ++this.generation
    const layout = this.layout
    const renderer = this.renderer
    if (layout === undefined || renderer === undefined) return
    this.ready = false
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
    this.frames = 0
    this.drawRest()
    this.ready = true
    this.phase = this.phase === 'verified' ? 'verified' : 'drawing'
    this.publish()
    // The first sweep is measured from the moment the material is usable.
    this.origin = performance.now() + this.params.firstDelayMs
    this.schedule()
  }

  /** Paint the resting state (no beam) once. */
  private drawRest(): void {
    const layout = this.layout
    const renderer = this.renderer
    if (layout === undefined || renderer === undefined) return
    const frame = this.resolveFrame(layout.startX, 0)
    if (frame === undefined) return
    renderer.draw(frame)
    this.frames += 1
  }

  /**
   * Draw one frame.
   * @param centerX - beam centre in device pixels.
   * @param sweep - envelope amplitude.
   */
  private draw(centerX: number, sweep: number): void {
    const renderer = this.renderer
    const frame = this.resolveFrame(centerX, sweep)
    if (renderer === undefined || frame === undefined) return
    renderer.draw(frame)
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
    if (!this.ready) return
    if (document.hidden || !this.inViewport() || this.motionAllowed() === false) return
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
    if (document.hidden || !this.inViewport() || this.motionAllowed() === false) {
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
    diag.record('sweep-start', { late: Math.round(now - start) })
    // The beam position is sampled at most twice a second, which is enough to
    // read the crossing off a real display without flooding the ring buffer.
    let nextTrace = 0
    const tick = (): void => {
      this.frame = 0
      if (this.disposed) return
      const layout = this.layout
      if (layout === undefined || this.renderer === undefined) return
      const elapsed = performance.now() - start
      const progress = Math.min(1, Math.max(0, elapsed / this.params.sweepMs))
      const envelope = sweepEnvelope(progress, this.params)
      this.draw(beamCenterAt(layout.startX, layout.endX, progress), envelope)
      if (elapsed >= nextTrace) {
        nextTrace = elapsed + 100
        diag.record('beam', {
          t: Math.round(elapsed),
          css: Math.round((beamCenterAt(layout.startX, layout.endX, progress) / layout.dpr) * 10) / 10,
          envelope: Math.round(envelope * 100) / 100,
        })
      }
      if (this.frames % 3 === 0) this.publish()
      if (progress < 1) {
        this.frame = window.requestAnimationFrame(tick)
        return
      }
      // The beam has left the lockup: paint the resting state once and stop.
      // The measurement runs on its own and upgrades the phase when it lands.
      this.drawRest()
      // The readback allocates a texture and a mapped buffer; it is diagnostic
      // work and never runs on every cycle unless diagnostics were requested.
      if (diag.enabled) void this.measureCycle()
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
   * measurement, and `displayVerified` is never derived from it.
   */
  private async measureCycle(): Promise<void> {
    const renderer = this.renderer
    const layout = this.layout
    if (renderer === undefined || layout === undefined) return
    const frame = this.resolveFrame(beamCenterAt(layout.startX, layout.endX, 0.5), 1)
    if (frame === undefined) return
    const summary: ReadbackSummary = await renderer.measure(frame)
    if (this.disposed) return
    this.peakLinear = summary.peakLinearLuma
    this.peakComposited = summary.peakCompositedLuma
    // Only an extended canvas can actually present over-unity light; on a
    // standard surface the readback above 1.0 would be a shader-only artifact.
    this.displayVerified = this.effectiveMode.endsWith('/extended') && this.peakComposited > SHADER_HDR_FLOOR
    if (summary.peakLinearLuma > SHADER_HDR_FLOOR && this.phase === 'drawing') this.phase = 'verified'
    diag.record('measure', {
      peak: Math.round(summary.peakLinearLuma * 1000) / 1000,
      composited: Math.round(summary.peakCompositedLuma * 1000) / 1000,
      covered: summary.coveredPixels,
      error: renderer.measureError().slice(0, 120),
    })
    this.publish()
  }

  /**
   * Is the lockup inside the viewport?
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

  /**
   * Whether automatic motion is allowed right now.
   * @returns false under `prefers-reduced-motion: reduce`, true otherwise.
   */
  private motionAllowed(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return !window.matchMedia(REDUCED_MOTION).matches
  }

  /** Re-arm after the page becomes visible again, skipping missed sweeps. */
  private handleVisibility(): void {
    if (this.disposed) return
    if (document.hidden) {
      this.cancel()
      return
    }
    this.origin = performance.now() + this.params.firstDelayMs
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
      mode: this.mode.alpha + '/' + this.mode.tone,
      effectiveMode: this.effectiveMode,
      device: gpuStatus().phase,
      layout: layout === undefined ? 'none' : layout.width + 'x' + layout.height + '@' + layout.dpr,
      frames: this.frames,
      lastSweepAt: this.lastSweepAt,
      requestedPeakLinear: this.calibration.requestedPeakLinear,
      peakLinear: this.peakLinear,
      peakComposited: this.peakComposited,
      measuredNits: this.peakComposited * (this.calibration.sdrWhiteNits ?? this.params.assumedSdrWhiteNits),
      displayVerified: this.displayVerified,
      calibration: this.calibration.sdrWhiteSource + '/headroom:' + this.calibration.headroomSource,
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
    this.watchMotion()
  }

  /** Follow `prefers-reduced-motion` while the plugin is mounted. */
  private watchMotion(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    this.motionHandler?.()
    const query = window.matchMedia(REDUCED_MOTION)
    const handler = (): void => this.rebuild('reduced-motion')
    query.addEventListener?.('change', handler)
    this.motionQuery = query
    this.motionHandler = () => query.removeEventListener?.('change', handler)
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
    this.motionHandler?.()
    this.resizeObserver = undefined
    this.intersectionObserver = undefined
    this.themeObserver = undefined
    this.displayHandler = undefined
    this.motionHandler = undefined
    this.motionQuery = undefined
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
    this.ready = false
    if (shared === this) shared = undefined
    diag.record('dispose')
  }

  /** Drop the device and rebuild on a fresh one (diagnostic and device loss). */
  resetGpu(): void {
    this.renderer?.dispose()
    this.renderer = undefined
    this.ready = false
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

/** The default canvas mode: extended tone mapping behind transparency. */
export { EXTENDED_MODE, SDR_MODE }