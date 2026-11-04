/**
 * The cycle clock: one absolute grid, one timer, one animation loop.
 *
 * A cycle starts at `origin + cycleIndex * periodMs`. The timeline never adds
 * "the sweep that just played" to "the wait that follows it" — that arithmetic
 * is what turned a 3000 ms cadence into a 6000 ms one — and it never runs a
 * `setInterval`, so a slow frame cannot stack a second loop on top of the
 * first. Between windows there is exactly one pending timeout and no animation
 * frame at all.
 *
 * The clock is injected, so the cadence is a property of this module rather
 * than of a browser: a test drives it with a virtual clock and reads back the
 * start times, and the browser runs the same code on `performance.now`.
 *
 * @module dsh-brand-gold/timeline
 */

import type { LockupLayout } from './layout.ts'
import { SWEEP_PARAMS, joinableCycleStart, nextSweepStartAt, type SweepParams } from './sweep.ts'
import { envelopeAt, sampleTrajectory, trajectoryOf, warpAt, type SweepPose } from './trajectory.ts'

/** Every clock and scheduling primitive the timeline needs. */
export interface TimelineClock {
  /** Monotonic milliseconds. */
  now(): number
  /** One-shot timer. */
  setTimeout(handler: () => void, delay: number): number
  /** Cancel a timer. */
  clearTimeout(id: number): void
  /** Next animation frame. */
  requestAnimationFrame(handler: () => void): number
  /** Cancel an animation frame. */
  cancelAnimationFrame(id: number): void
}

/** The browser's own clock. */
export const browserClock: TimelineClock = {
  now: () => performance.now(),
  setTimeout: (handler, delay) => window.setTimeout(handler, delay),
  clearTimeout: (id) => window.clearTimeout(id),
  requestAnimationFrame: (handler) => window.requestAnimationFrame(handler),
  cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
}

/** What one cycle reports when it starts. */
export interface CycleInfo {
  /** Nominal start on the timeline's clock. */
  readonly start: number
  /** Index on the grid, 0 for the first cycle. */
  readonly index: number
  /** How late the timer fired, in milliseconds. */
  readonly late: number
}

/** What one frame reports. */
export interface FrameInfo extends CycleInfo {
  /** Milliseconds from this cycle's nominal start. */
  readonly elapsed: number
  /** The pose the frame draws. */
  readonly pose: SweepPose
}

/** The renderer side of the timeline. */
export interface TimelineSink {
  /** Whether a sweep may run right now (ready, visible, in viewport, motion on). */
  canRun(): boolean
  /** Draw one frame. */
  frame(info: FrameInfo): void
  /** The window closed: the band has left and the lockup is back at rest. */
  rest(): void
  /** A cycle started. */
  cycleStart(info: CycleInfo): void
  /** A cycle was skipped because its window had already closed. */
  skipped?(): void
}

/** The shared cadence. */
export class SweepTimeline {
  private readonly params: SweepParams
  private readonly clock: TimelineClock
  private readonly sink: TimelineSink
  private readonly layoutOf: () => LockupLayout | undefined
  private origin = 0
  private established = false
  private timer: number | undefined
  private armedFor = 0
  private animation = 0
  private running = false
  private disposed = false

  /**
   * @param sink - what to draw, and whether drawing is allowed.
   * @param layoutOf - the live layout; it may be rebuilt between cycles.
   * @param params - timing dials.
   * @param clock - clock and scheduling primitives.
   */
  constructor(
    sink: TimelineSink,
    layoutOf: () => LockupLayout | undefined,
    params: SweepParams = SWEEP_PARAMS,
    clock: TimelineClock = browserClock,
  ) {
    this.sink = sink
    this.layoutOf = layoutOf
    this.params = params
    this.clock = clock
  }

  /** First sweep start, or 0 before one was established. */
  get originAt(): number {
    return this.established ? this.origin : 0
  }

  /** Whether a window is on screen right now. */
  get isRunning(): boolean {
    return this.running
  }

  /** Whether a start is armed. */
  get isArmed(): boolean {
    return this.timer !== undefined
  }

  /**
   * Establish the grid for the first time, one delay out.
   *
   * Called once, after the resources are genuinely usable; later resource
   * updates call {@link arm} instead, so an ordinary rebuild cannot keep
   * pushing the next sweep back by another full delay.
   */
  start(): void {
    if (this.disposed) return
    this.origin = this.clock.now() + this.params.firstDelayMs
    this.established = true
    this.arm()
  }

  /**
   * Establish a fresh grid, for a resume from a hidden tab or a GPU reset.
   *
   * Skipping the cycles that passed while the tab slept is the point: the grid
   * moves once, and the next start is one delay away instead of a burst of
   * catch-up sweeps.
   */
  resume(): void {
    if (this.disposed) return
    this.stop()
    this.start()
  }

  /** Arm the next start on the existing grid, or leave it as it is. */
  arm(): void {
    if (this.disposed || !this.established) return
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.running) return
    if (!this.sink.canRun()) return
    const now = this.clock.now()
    const next = nextSweepStartAt(now, this.origin, this.params)
    this.armedFor = next
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      this.fire()
    }, Math.max(0, next - now))
  }

  /** Run the cycle whose window is still open, if there is one. */
  private fire(): void {
    if (this.disposed) return
    if (!this.sink.canRun()) {
      this.arm()
      return
    }
    const now = this.clock.now()
    const start = joinableCycleStart(now, this.origin, this.params, this.running)
    if (start === undefined) {
      // A timer that fired a hair early — before the grid point it was armed
      // for — is not a missed cycle: it is the very same cycle, one frame
      // sooner. Wait out the remainder instead of counting a skip.
      if (this.armedFor > now) {
        this.arm()
        return
      }
      // Otherwise the window this timer belonged to has already closed, so the
      // cycle is genuinely missed: record it and arm the next grid point.
      this.sink.skipped?.()
      this.arm()
      return
    }
    const info: CycleInfo = {
      start,
      index: Math.round((start - this.origin) / this.params.periodMs),
      late: now - start,
    }
    this.sink.cycleStart(info)
    this.running = true
    this.tick(info)
  }

  /** Draw one frame and schedule the next. */
  private tick(info: CycleInfo): void {
    this.animation = 0
    if (this.disposed) return
    const layout = this.layoutOf()
    if (layout === undefined) {
      this.finish()
      return
    }
    const elapsed = this.clock.now() - info.start
    const points = trajectoryOf(layout, this.params)
    this.sink.frame({
      ...info,
      elapsed,
      pose: {
        centerX: sampleTrajectory(points, elapsed),
        envelope: envelopeAt(elapsed, this.params),
        warp: warpAt(elapsed, this.params),
      },
    })
    if (elapsed < this.params.sweepMs) {
      this.animation = this.clock.requestAnimationFrame(() => this.tick(info))
      return
    }
    this.finish()
  }

  /** Close the window, repaint the rest state and arm the next cycle. */
  private finish(): void {
    this.running = false
    this.sink.rest()
    this.arm()
  }

  /**
   * Abandon a running window without moving the grid.
   *
   * A resize, a theme change or a material re-upload can land mid-sweep; the
   * old frames are dropped and the next cycle starts where the grid says it
   * should, so the phase survives the rebuild.
   */
  cancelCycle(): boolean {
    if (!this.running) return false
    this.cancelAnimation()
    this.running = false
    // The window ended without finishing, so the resting state has to be
    // repainted before anyone draws on top of a half-swept canvas.
    this.sink.rest()
    this.arm()
    return true
  }

  /** Drop the grid entirely (unmount, hidden tab, capability loss). */
  stop(): void {
    if (this.timer !== undefined) {
      this.clock.clearTimeout(this.timer)
      this.timer = undefined
    }
    this.cancelAnimation()
    this.running = false
  }

  /** Release everything and refuse further work. */
  dispose(): void {
    this.stop()
    this.disposed = true
    this.established = false
    this.origin = 0
  }

  /** Cancel the pending animation frame, if any. */
  private cancelAnimation(): void {
    if (this.animation !== 0) {
      this.clock.cancelAnimationFrame(this.animation)
      this.animation = 0
    }
  }
}
