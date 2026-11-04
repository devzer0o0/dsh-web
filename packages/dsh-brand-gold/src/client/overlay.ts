/**
 * The one owner of the sweep overlay.
 *
 * A single controller serves the whole lockup: both occupants register their
 * element and geometry with it, it measures them into one shared coordinate
 * system, and it drives one canvas, one device and one timeline. It never
 * removes another instance's nodes: cleanup covers only the popover, GPU
 * resources, timers, animation frames and listeners it created itself.
 *
 * Timing is an **absolute grid**: a cycle starts at
 * `origin + cycleIndex * periodMs`, and the controller only ever looks up which
 * cycle it is in. It never adds "this sweep" to "the wait after it", which is
 * how a cadence turns into one twice as long. A late timer resumes the cycle
 * it belongs to; a timer that fires after the window closed skips the missed
 * cycles instead of replaying them.
 *
 * Frames are drawn only inside the sweep window. The resting part of every
 * period runs no animation frame at all; the next sweep is armed with a single
 * timer.
 *
 * The first sweep waits until a material and a mask exist, then waits one
 * period, so the very first cycle is on the same grid as every later one.
 * Ordinary rebuilds — a resize, a theme change, a re-upload — keep the phase:
 * only a first initialisation, an explicit resume from a hidden tab and a GPU
 * reset establish a new origin.
 *
 * @module dsh-brand-gold/overlay
 */

import { diag } from './diag.ts'
import { acquireDevice, currentDevice, gpuStatus, probeCapabilities, resetDevice } from './gpu.ts'
import {
  buildMaskImage,
  shapeGeometryOf,
  type MaskImage,
  type ShapeGeometry,
} from './geometry-mask.ts'
import { buildLayout, boxOf, type Box, type BrandGeometry, type LockupLayout } from './layout.ts'
import { calibrationOf, type Calibration } from './light.ts'
import { compositeMaterial, type MaterialPart } from './material.ts'
import {
  EXTENDED_MODE,
  SDR_MODE,
  createRenderer,
  type CanvasMode,
  type DrawFrame,
  type ReadbackSummary,
  type SweepRenderer,
} from './renderer.ts'
import { SWEEP_PARAMS, validateSweepParams, type SweepParams } from './sweep.ts'
import { SweepTimeline, type CycleInfo, type FrameInfo, type TimelineClock } from './timeline.ts'
import {
  envelopeAt,
  sampleTrajectory,
  trajectoryOf,
  warpAt,
  type SweepPose,
  type TrajectoryPoint,
} from './trajectory.ts'

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
 *   shader verdict, not a display verdict.
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
  readonly estimatedNits: number
  /**
   * Whether over-unity light was proven **in the shader output**. A display
   * measurement would be a different claim, and this field never stands in for
   * one.
   */
  readonly shaderVerified: boolean
  /**
   * Whether the display itself was measured. Always false: the host exposes no
   * photometer, and a value inferred from an assumed reference white is an
   * estimate, not a measurement.
   */
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
 * Sweep envelope over the window: opens during the entry stage, holds at full
 * through the body and the band's tail, and closes once the tail has left.
 * @param progress - 0..1 through the sweep window.
 * @param params - tunables.
 * @returns 0..1 amplitude.
 */
export function sweepEnvelope(progress: number, params: SweepParams = SWEEP_PARAMS): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return envelopeAt(clamped * params.sweepMs, params)
}

/**
 * Deformation amplitude over the window.
 * @param progress - 0..1 through the sweep window.
 * @param params - tunables.
 * @returns 0..1 amplitude; zero is the identity mapping.
 */
export function sweepWarp(progress: number, params: SweepParams = SWEEP_PARAMS): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return warpAt(clamped * params.sweepMs, params)
}

/**
 * Beam centre at one point of the sweep window, on the stage trajectory.
 * @param layout - the measured lockup.
 * @param progress - 0..1 through the sweep window.
 * @param params - tunables.
 * @param points - precomputed control points, when the caller has them.
 * @returns the centre, in device pixels.
 */
export function beamCenterAt(
  layout: LockupLayout,
  progress: number,
  params: SweepParams = SWEEP_PARAMS,
  points: readonly TrajectoryPoint[] = trajectoryOf(layout, params),
): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return sampleTrajectory(points, clamped * params.sweepMs)
}

/**
 * Same curve, sampled at a wall-clock offset instead of a 0..1 progress.
 * @param layout - the measured lockup.
 * @param elapsed - milliseconds from the start of the sweep.
 * @param params - tunables.
 * @param points - precomputed control points, when the caller has them.
 * @returns the centre, in device pixels.
 */
export function centerAtElapsed(
  layout: LockupLayout,
  elapsed: number,
  params: SweepParams = SWEEP_PARAMS,
  points: readonly TrajectoryPoint[] = trajectoryOf(layout, params),
): number {
  return sampleTrajectory(points, elapsed)
}

/**
 * Time the beam centre spends travelling across the metal, in milliseconds.
 * @param params - tunables.
 * @returns the body stage length.
 */
export function crossingMs(params: SweepParams = SWEEP_PARAMS): number {
  return params.surfaceMs
}

/** The shared sweep controller. */
export class BrandSweepController {
  private readonly occupants = new Map<string, Occupant>()
  private popover: HTMLDivElement | undefined
  private canvas: HTMLCanvasElement | undefined
  private renderer: SweepRenderer | undefined
  private layout: LockupLayout | undefined
  /**
   * The layout the uploaded material and mask belong to. It only moves when an
   * upload succeeds, so a reposition (a scroll) cannot make a later rebuild
   * believe the GPU already holds the new geometry.
   */
  private renderedLayout: LockupLayout | undefined
  private mask: MaskImage | undefined
  private maskKey = ''
  private shapes: Map<string, ShapeGeometry> | undefined
  private resizeObserver: ResizeObserver | undefined
  private intersectionObserver: IntersectionObserver | undefined
  private themeObserver: MutationObserver | undefined
  private displayHandler: (() => void) | undefined
  private motionQuery: MediaQueryList | undefined
  private motionHandler: (() => void) | undefined
  private timeline: SweepTimeline | undefined
  private disposed = false
  private listening = false
  private generation = 0
  private phase: OverlayPhase = 'idle'
  private frames = 0
  private lastSweepAt = 0
  private peakLinear = 0
  private peakComposited = 0
  private shaderVerified = false
  private effectiveMode = 'unknown'
  private ready = false
  private readonly mode: CanvasMode
  private readonly params: SweepParams
  private readonly calibration: Calibration
  private readonly clock: TimelineClock
  private readonly onVisibility = (): void => this.handleVisibility()
  private readonly onViewport = (): void => this.followViewport()

  /**
   * @param params - tunables; the shipped defaults unless a test overrides them.
   * @param mode - compositing and tone-mapping mode of the canvas.
   * @param headroom - reported extended-range headroom, when the host exposes it.
   * @param clock - clock and scheduling primitives; injectable so the cadence
   * is testable without a browser frame loop.
   */
  constructor(
    params: SweepParams = SWEEP_PARAMS,
    mode: CanvasMode = EXTENDED_MODE,
    headroom: number | undefined = undefined,
    clock: TimelineClock | undefined = undefined,
  ) {
    validateSweepParams(params)
    this.params = params
    this.mode = mode
    this.clock = clock ?? {
      now: () => performance.now(),
      setTimeout: (handler, delay) => window.setTimeout(handler, delay),
      clearTimeout: (id) => window.clearTimeout(id),
      requestAnimationFrame: (handler) => window.requestAnimationFrame(handler),
      cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    }
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
   * Geometry currently backing the mask, for the tests and the diagnostic.
   * @returns the shape map (a copy of the entries, not the live map).
   */
  geometrySnapshot(): Map<string, ShapeGeometry> {
    this.shapes ??= this.buildShapes()
    return new Map(this.shapes)
  }

  /** First sweep start on the controller's clock; 0 until it is established. */
  get originAt(): number {
    return this.timeline?.originAt ?? 0
  }

  /** Whether a sweep window is on screen right now. */
  get sweeping(): boolean {
    return this.timeline?.isRunning ?? false
  }

  /**
   * Register one occupant and re-measure the lockup.
   * @param occupant - element, SVG, geometry and id.
   */
  register(occupant: Occupant): void {
    if (this.disposed) return
    this.occupants.set(occupant.id, occupant)
    // A new shape changes the metal mask, so the cached geometry of the other
    // occupants has to be rebuilt with it; keeping the first build would leave
    // every later part outside the mask.
    this.shapes = undefined
    this.mask = undefined
    this.maskKey = ''
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
    this.shapes = undefined
    this.mask = undefined
    this.maskKey = ''
    if (this.occupants.size === 0) {
      this.dispose()
      return
    }
    this.rebuild('unregister:' + id)
  }

  /**
   * Re-measure and redraw without touching the device or the timeline phase.
   * @param reason - diagnostic label.
   */
  rebuild(reason: string): void {
    if (this.disposed) return
    if (this.motionAllowed() === false) {
      // Reduced motion was switched on at runtime: stop everything and leave
      // the static gold SVG as the lockup.
      this.timeline?.stop()
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
    const shapes = this.shapes ?? this.buildShapes()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const layout = buildLayout(boxes, viewBoxes, dpr, this.params, shapes)
    if (layout === undefined) {
      this.phase = 'zero-size'
      this.publish()
      this.hide()
      return
    }
    const unchanged = this.sameLayout(layout)
    this.layout = layout
    diag.record('layout', {
      reason,
      width: layout.width,
      height: layout.height,
      dpr,
      band: Math.round(layout.mainFwhm * 10) / 10,
      core: Math.round(layout.coreFwhm * 10) / 10,
      support: Math.round(layout.supportRadius / dpr * 10) / 10,
      travel: Math.round((layout.centerEnd - layout.centerStart) / dpr * 10) / 10,
    })
    if (!this.prepare()) return
    this.place()
    this.show()
    this.publish()
    // A rebuild that measured the same lockup at the same size has nothing new
    // to upload: re-uploading it would cancel a running cycle and, under a
    // stream of scroll or resize events, starve the sweep of its start.
    if (unchanged && this.ready && this.maskKey === layout.width + 'x' + layout.height) {
      this.syncTimeline()
      return
    }
    void this.upload()
  }

  /**
   * Build the mask geometry of every part from its original vectors.
   * @returns the geometry per part id.
   */
  private buildShapes(): Map<string, ShapeGeometry> {
    const shapes = new Map<string, ShapeGeometry>()
    for (const occupant of this.occupants.values()) {
      shapes.set(occupant.id, shapeGeometryOf(occupant.geometry))
    }
    this.shapes = shapes
    this.mask = undefined
    return shapes
  }

  /**
   * Follow the lockup when the page scrolls or the window resizes.
   *
   * A sidebar sits in the page flow: scrolling moves it, so the overlay has to
   * move with it. That is a reposition, not a rebuild — re-measuring on every
   * scroll event would cancel the running sweep and, while a session streams and
   * scrolls continuously, keep the next one from ever starting.
   */
  private followViewport(): void {
    if (this.disposed) return
    this.remeasureBoxes()
    this.place()
    if (this.ready) this.timeline?.arm()
  }

  /**
   * Re-read the occupants' boxes without rebuilding the material.
   *
   * Cost is one getBoundingClientRect per occupant plus a layout rebuild: cheap
   * enough for a scroll handler. The material and the mask are only re-uploaded
   * when a part actually moved or resized, which is what rebuild() decides.
   */
  private remeasureBoxes(): void {
    const boxes = new Map<string, Box>()
    const viewBoxes = new Map<string, string>()
    for (const occupant of this.occupants.values()) {
      const box = boxOf(occupant.root)
      if (box === undefined) continue
      boxes.set(occupant.id, box)
      viewBoxes.set(occupant.id, occupant.geometry.viewBox)
    }
    if (boxes.size === 0) return
    const shapes = this.shapes ?? this.buildShapes()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const layout = buildLayout(boxes, viewBoxes, dpr, this.params, shapes)
    if (layout !== undefined) this.layout = layout
  }

  /**
   * Does a freshly measured layout describe the same lockup in the same place?
   * @param layout - the layout just measured.
   * @returns true when no part moved, resized or changed device ratio.
   */
  private sameLayout(layout: LockupLayout): boolean {
    const previous = this.renderedLayout
    if (previous === undefined || this.mask === undefined) return false
    if (previous.width !== layout.width || previous.height !== layout.height) return false
    if (previous.dpr !== layout.dpr) return false
    if (previous.parts.size !== layout.parts.size) return false
    for (const [id, part] of layout.parts) {
      const before = previous.parts.get(id)
      if (before === undefined) return false
      if (Math.abs(before.offsetX - part.offsetX) > 0.01) return false
      if (Math.abs(before.offsetY - part.offsetY) > 0.01) return false
      if (before.width !== part.width || before.height !== part.height) return false
    }
    return true
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

  /**
   * Build the one frame description used by both `draw` and `measure`.
   *
   * A single resolver is what keeps the two paths comparable: they share the
   * effective parameters, the same layout, the same pose and the same material,
   * so a readback can never disagree with what is on screen because of a
   * duplicated expression.
   *
   * @param pose - centre and amplitudes at one instant.
   * @returns the frame.
   */
  private resolveFrame(pose: SweepPose): DrawFrame | undefined {
    const layout = this.layout
    if (layout === undefined) return undefined
    return {
      centerX: pose.centerX,
      sweep: pose.envelope,
      warp: pose.warp,
      layout,
      params: this.params,
      peakLinear: this.calibration.requestedPeakLinear,
    }
  }

  /**
   * Composite the live lockup, build the metal mask and hand both to the
   * renderer.
   *
   * Async by nature; the generation guards against a resize, a theme change or
   * a later layout replacing this result after it resolves. The timeline only
   * becomes ready here, once a material and a mask exist. A rebuild that lands
   * mid-sweep cancels the running cycle and rejoins the next one on the grid
   * instead of moving the grid.
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
    if (this.disposed || mine !== this.generation) return
    if (material === undefined) {
      this.phase = 'material-failed'
      this.publish()
      diag.record('material-failed')
      return
    }
    const shapes = this.shapes ?? this.buildShapes()
    // The mask is coverage per canvas pixel, so it is only reusable at the size
    // it was built for; a resize (or a DPR change) rebuilds it.
    const key = layout.width + 'x' + layout.height
    const mask = this.maskKey === key ? this.mask : undefined
    const built = mask ?? buildMaskImage(layout, shapes)
    if (built === undefined) {
      this.phase = 'material-failed'
      this.publish()
      diag.record('mask-failed')
      return
    }
    this.mask = built
    this.maskKey = key
    renderer.setMaterial(material)
    renderer.setMask(built)
    this.renderedLayout = layout
    this.frames = 0
    this.drawPose(this.restPose())
    this.ready = true
    if (this.phase !== 'verified') this.phase = 'drawing'
    this.publish()
    // Ordinary rebuilds keep the grid; only the first upload starts it.
    this.syncTimeline()
  }

  /**
   * Pose of the resting lockup: no light, no deformation.
   * @returns the pose.
   */
  private restPose(): SweepPose {
    const layout = this.layout
    return { centerX: layout?.centerStart ?? 0, envelope: 0, warp: 0 }
  }

  /** Paint one pose. */
  private drawPose(pose: SweepPose): void {
    const renderer = this.renderer
    const frame = this.resolveFrame(pose)
    if (renderer === undefined || frame === undefined) return
    renderer.draw(frame)
    this.frames += 1
  }

  /**
   * Ensure the timeline exists and decide what it should do about the grid.
   *
   * Only the first initialisation establishes an origin. A rebuild for a resize,
   * a theme change or a material re-upload keeps the phase: if a window is open
   * it is cancelled cleanly and the next cycle is the next point on the same
   * grid, never "one more full delay from now".
   */
  private syncTimeline(): void {
    if (this.disposed) return
    if (this.timeline === undefined) {
      this.timeline = new SweepTimeline(
        {
          canRun: () => this.canRun(),
          frame: (info) => this.onFrame(info),
          rest: () => this.onRest(),
          cycleStart: (info) => this.onCycleStart(info),
          skipped: () => diag.record('sweep-skipped'),
        },
        () => this.layout,
        this.params,
        this.clock,
      )
      this.timeline.start()
      diag.record('origin', { source: 'initial', firstDelay: this.params.firstDelayMs })
      return
    }
    if (this.timeline.cancelCycle()) {
      // A rebuild landed inside a live window: stop the stale frames, put the
      // resting lockup back, and let the grid decide the next start.
      this.drawPose(this.restPose())
      diag.record('cycle-cancelled', { reason: 'rebuild' })
    }
    this.timeline.arm()
  }

  /**
   * Whether a sweep may run right now.
   * @returns true when the material exists and the lockup is visible.
   */
  private canRun(): boolean {
    if (this.disposed || !this.ready || this.renderer === undefined) return false
    if (document.hidden || !this.inViewport()) return false
    return this.motionAllowed() !== false
  }

  /**
   * Draw one frame of the running cycle.
   * @param info - cycle, time and pose.
   */
  private onFrame(info: FrameInfo): void {
    if (!this.canRun()) return
    this.drawPose(info.pose)
    if (this.frames % 3 === 0) this.publish()
  }

  /** Close the window: paint the resting state once and record the reading. */
  private onRest(): void {
    this.drawPose(this.restPose())
    // The readback allocates a texture and a mapped buffer; it is diagnostic
    // work and never runs on every cycle unless diagnostics were requested.
    if (diag.enabled) void this.measureCycle()
    this.publish()
  }

  /**
   * Record the start of one cycle.
   * @param info - the cycle's grid position and lateness.
   */
  private onCycleStart(info: CycleInfo): void {
    this.lastSweepAt = Date.now()
    diag.record('sweep-start', { late: Math.round(info.late), cycle: info.index })
  }


  /**
   * Measure one mid-sweep frame offscreen and record the peak linear value.
   *
   * This is the shader-level check: it proves the extended encode produced
   * values above 1.0 in the shader's own output. It is not a display
   * measurement, and no field on this controller claims otherwise.
   */
  private async measureCycle(): Promise<void> {
    const renderer = this.renderer
    const layout = this.layout
    if (renderer === undefined || layout === undefined) return
    const mid = sampleTrajectory(trajectoryOf(layout, this.params), (this.params.entryMs + this.params.surfaceMs) / 2)
    const frame = this.resolveFrame({ centerX: mid, envelope: 1, warp: 1 })
    if (frame === undefined) return
    const summary: ReadbackSummary = await renderer.measure(frame)
    if (this.disposed) return
    this.peakLinear = summary.peakLinearLuma
    this.peakComposited = summary.peakCompositedLuma
    // Only an extended canvas can actually present over-unity light; on a
    // standard surface the readback above 1.0 would be a shader-only artifact.
    this.shaderVerified = this.effectiveMode.endsWith('/extended') && this.peakLinear > SHADER_HDR_FLOOR
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
    // A tab that was hidden for a while must not replay the cycles it missed.
    // It gets a fresh grid, one full delay out, exactly like a first start.
    this.timeline?.resume()
    this.rebuild('visible')
  }

  /** Stop the animation-frame loop and the pending timer. */
  private cancel(): void {
    this.timeline?.stop()
  }

  /** Push the diagnostic snapshot. */
  private publish(): void {
    if (!diag.enabled) return
    const layout = this.layout
    const white = this.calibration.sdrWhiteNits ?? this.params.assumedSdrWhiteNits
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
      // An estimate from an assumed reference white, named as one.
      estimatedNits: this.peakComposited * white,
      shaderVerified: this.shaderVerified,
      // No photometer was read, so the display is not verified.
      displayVerified: false,
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
    this.renderedLayout = undefined
    this.mask = undefined
    this.maskKey = ''
    this.shapes = undefined
    this.ready = false
    this.timeline?.dispose()
    this.timeline = undefined
    if (shared === this) shared = undefined
    diag.record('dispose')
  }

  /** Drop the device and rebuild on a fresh one (diagnostic and device loss). */
  resetGpu(): void {
    this.cancel()
    this.timeline?.dispose()
    this.timeline = undefined
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