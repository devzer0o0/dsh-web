/**
 * Cycle and lifecycle: the cadence on a controlled clock, the rebuild rules and
 * the absence of leftover loops.
 *
 * Nothing here waits for a real frame. The clock is a queue the test advances by
 * hand, so "a sweep starts every 3000 ms" is observed as a fact about the
 * timeline rather than as a hope about a browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SweepTimeline, type FrameInfo, type TimelineClock } from '../src/client/timeline.ts'
import { SWEEP_PARAMS, nextSweepStartAt } from '../src/client/sweep.ts'
import { buildLayout, type LockupLayout } from '../src/client/layout.ts'
import { shapeGeometryOf } from '../src/client/geometry-mask.ts'
import { MARK_GEOMETRY, NAME_GEOMETRY } from '../src/client/paths.ts'

/** A clock and scheduler the test advances by hand. */
class ControlledClock implements TimelineClock {
  now_ms = 0
  private nextId = 1
  readonly timers = new Map<number, { at: number; handler: () => void }>()
  readonly frames = new Map<number, () => void>()
  timerCount = 0
  maxTimers = 0
  frameCount = 0
  maxFrames = 0

  now(): number {
    return this.now_ms
  }

  setTimeout(handler: () => void, delay: number): number { // test-standards-allow: injected clock, not a test sleep
    const id = this.nextId++
    this.timers.set(id, { at: this.now_ms + Math.max(0, delay), handler })
    this.timerCount = this.timers.size
    this.maxTimers = Math.max(this.maxTimers, this.timerCount)
    return id
  }

  clearTimeout(id: number): void {
    this.timers.delete(id)
    this.timerCount = this.timers.size
  }

  requestAnimationFrame(handler: () => void): number {
    const id = this.nextId++
    this.frames.set(id, handler)
    this.frameCount = this.frames.size
    this.maxFrames = Math.max(this.maxFrames, this.frameCount)
    return id
  }

  cancelAnimationFrame(id: number): void {
    this.frames.delete(id)
    this.frameCount = this.frames.size
  }

  /**
   * Advance the clock, running every timer and frame that falls due.
   * @param ms - milliseconds to advance.
   * @param frameStep - simulated frame interval.
   */
  advance(ms: number, frameStep = 8): void {
    const target = this.now_ms + ms
    while (this.now_ms < target) {
      const nextTimer = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      const nextFrame = this.frames.size > 0 ? this.now_ms + frameStep : Infinity
      const timerAt = nextTimer === undefined ? Infinity : nextTimer[1].at
      const step = Math.min(target, timerAt, nextFrame)
      this.now_ms = step
      if (timerAt <= this.now_ms && nextTimer !== undefined) {
        this.timers.delete(nextTimer[0])
        this.timerCount = this.timers.size
        nextTimer[1].handler()
        continue
      }
      const due = [...this.frames.entries()]
      this.frames.clear()
      this.frameCount = 0
      for (const [, handler] of due) {
        this.frameCount += 1
        handler()
      }
      if (due.length === 0 && step >= target) break
    }
  }

  /** Run every pending frame once, without moving the clock. */
  flushFrame(): void {
    const handlers = [...this.frames.values()]
    this.frames.clear()
    for (const handler of handlers) handler()
  }
}

const shapes = new Map([
  ['mark', shapeGeometryOf(MARK_GEOMETRY)],
  ['name', shapeGeometryOf(NAME_GEOMETRY)],
])
const layout: LockupLayout = buildLayout(
  new Map([
    ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
    ['name', { left: 48, top: 54, width: 156, height: 24 }],
  ]),
  new Map([
    ['mark', '0 0 23.16 17.04'],
    ['name', '26 0 156 24'],
  ]),
  2,
  SWEEP_PARAMS,
  shapes,
)!

/** What a run recorded. */
interface Recorder {
  readonly starts: number[]
  readonly frameTimes: number[]
  readonly restTimes: number[]
  readonly clock: ControlledClock
  readonly timeline: SweepTimeline
}

/**
 * Build a timeline that records what it does.
 * @param layoutOf - layout provider, so a test can simulate a resize.
 * @param canRun - permission hook, so a test can simulate a hidden tab.
 * @returns the recorder.
 */
function run(layoutOf: () => LockupLayout | undefined = () => layout, canRun: () => boolean = () => true): Recorder {
  const clock = new ControlledClock()
  const starts: number[] = []
  const frameTimes: number[] = []
  const restTimes: number[] = []
  const timeline = new SweepTimeline(
    {
      canRun,
      frame: (info: FrameInfo) => frameTimes.push(info.elapsed),
      rest: () => restTimes.push(clock.now()),
      cycleStart: (info) => starts.push(clock.now()),
    },
    layoutOf,
    SWEEP_PARAMS,
    clock,
  )
  timeline.start()
  return { starts, frameTimes, restTimes, clock, timeline }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cycle lifecycle', () => {
  it('operator sees the first sweep start one delay after the resources are ready', () => {
    // Given: a timeline that has just been started at t = 0.
    const recorder = run()
    const { clock, timeline, starts } = recorder
    // When: the clock is advanced to just before and just after the delay.
    clock.advance(SWEEP_PARAMS.firstDelayMs - 1)
    expect(starts.length).toBe(0)
    clock.advance(2)
    // Then: the first sweep starts exactly one delay in.
    expect(starts).toEqual([SWEEP_PARAMS.firstDelayMs])
    timeline.dispose()
  })

  it('operator sees starts exactly 3000 ms apart for five cycles', () => {
    // Given: a running timeline.
    const { clock, timeline, starts } = run()
    // When: it is left to run for five periods plus a margin.
    clock.advance(SWEEP_PARAMS.firstDelayMs + SWEEP_PARAMS.periodMs * 5 - 1, 8)
    // Then: the starts are the grid itself — 3000 ms apart, never 5700 or 6000.
    expect(starts.length).toBe(5)
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]! - starts[index - 1]!).toBe(SWEEP_PARAMS.periodMs)
    }
    expect(starts[0]).toBe(SWEEP_PARAMS.firstDelayMs)
    expect(starts[4]! - starts[0]!).toBe(SWEEP_PARAMS.periodMs * 4)
    timeline.dispose()
  })

  it('operator sees a 2700 ms animation and a 300 ms rest inside every period', () => {
    // Given: a running timeline and its frame log.
    const { clock, timeline, frameTimes, restTimes, starts } = run()
    // When: two cycles run.
    clock.advance(SWEEP_PARAMS.firstDelayMs + SWEEP_PARAMS.periodMs * 2 + 400, 8)
    // Then: the frames cover 0..2700 ms of the cycle and stop, and the rest is
    // painted once, 300 ms before the next start.
    expect(frameTimes.length).toBeGreaterThan(50)
    expect(Math.max(...frameTimes)).toBeLessThanOrEqual(SWEEP_PARAMS.sweepMs + 8)
    expect(Math.min(...frameTimes)).toBeLessThan(20)
    const firstRest = restTimes[0]!
    const secondStart = starts[1]!
    expect(secondStart - firstRest).toBeGreaterThan(SWEEP_PARAMS.periodMs - SWEEP_PARAMS.sweepMs - 16)
    expect(secondStart - firstRest).toBeLessThan(SWEEP_PARAMS.periodMs - SWEEP_PARAMS.sweepMs + 16)
    timeline.dispose()
  })

  it('operator never gets two loops or two timers at once', () => {
    // Given: a running timeline.
    const { clock, timeline } = run()
    // When: it runs for several periods.
    clock.advance(SWEEP_PARAMS.firstDelayMs + SWEEP_PARAMS.periodMs * 4, 8)
    // Then: at no point were two animation loops or two timers live.
    expect(clock.maxFrames).toBe(1)
    expect(clock.maxTimers).toBeLessThanOrEqual(1)
    expect(clock.timers.size + clock.frames.size).toBeLessThanOrEqual(1)
    timeline.dispose()
  })

  it('operator never gets a duplicated timer when the rebuild happens mid-sweep', () => {
    // Given: a running timeline caught in the middle of a window.
    const { clock, timeline, restTimes } = run()
    clock.advance(SWEEP_PARAMS.firstDelayMs + SWEEP_PARAMS.sweepMs / 2, 8)
    // When: a rebuild cancels the cycle.
    const cancelled = timeline.cancelCycle()
    // Then: the frames stop, the rest is painted, and exactly one timer is armed.
    expect(cancelled).toBe(true)
    expect(clock.frames.size).toBe(0)
    expect(restTimes.length).toBeGreaterThan(0)
    expect(clock.timers.size).toBe(1)
    expect(timeline.isRunning).toBe(false)
    timeline.dispose()
  })

  it('operator does not get the next sweep pushed back by a rebuild', () => {
    // Given: a timeline that started at t = 0.
    const { clock, timeline, starts } = run()
    clock.advance(SWEEP_PARAMS.firstDelayMs - 100, 8)
    // When: a rebuild arrives just before the first sweep.
    timeline.arm()
    // Then: the first start is still the grid point, not one period later.
    clock.advance(200, 8)
    expect(starts[0]).toBe(SWEEP_PARAMS.firstDelayMs)
    // And repeated rebuilds cannot postpone it forever.
    const origin = timeline.originAt
    for (let index = 0; index < 5; index += 1) {
      timeline.arm()
      clock.advance(20, 8)
    }
    expect(timeline.originAt).toBe(origin)
    expect(nextSweepStartAt(clock.now(), origin)).toBeGreaterThanOrEqual(clock.now())
    timeline.dispose()
  })

  it('operator gets the missed cycles skipped, not replayed, after a long pause', () => {
    // Given: a running timeline.
    const { clock, timeline, starts } = run()
    clock.advance(SWEEP_PARAMS.firstDelayMs + 200, 8)
    const before = starts.length
    // When: the clock jumps forward by ten periods without any frame time.
    clock.now_ms += SWEEP_PARAMS.periodMs * 10
    clock.advance(SWEEP_PARAMS.periodMs, 8)
    // Then: only the cycles after the jump run; the ten missed ones are gone.
    expect(starts.length - before).toBe(1)
    timeline.dispose()
  })

  it('operator gets nothing at all while the lockup cannot be drawn', () => {
    // Given: a timeline whose lockup is not drawable.
    let allowed = false
    const { clock, timeline, starts } = run(() => layout, () => allowed)
    // When: time passes with the permission off.
    clock.advance(SWEEP_PARAMS.periodMs * 4, 8)
    // Then: no cycle started, and no animation frame was ever queued.
    expect(starts.length).toBe(0)
    expect(clock.maxFrames).toBe(0)
    // When: the permission comes back on.
    allowed = true
    timeline.arm()
    clock.advance(SWEEP_PARAMS.periodMs, 8)
    // Then: exactly one cycle runs, one delay later.
    expect(starts.length).toBe(1)
    timeline.dispose()
  })

  it('operator gets everything released on dispose', () => {
    // Given: a running timeline.
    const { clock, timeline } = run()
    clock.advance(SWEEP_PARAMS.firstDelayMs + 500, 8)
    // When: it is disposed inside the window.
    timeline.dispose()
    // Then: no timer, no frame, and further time changes nothing.
    expect(clock.timers.size).toBe(0)
    expect(clock.frames.size).toBe(0)
    const starts = [...clock.timers.keys()]
    clock.advance(SWEEP_PARAMS.periodMs * 3, 8)
    expect(starts.length).toBe(0)
    expect(timeline.isRunning).toBe(false)
    expect(timeline.isArmed).toBe(false)
  })

  it('operator gets a fresh grid on resume, one delay out', () => {
    // Given: a running timeline that has already swept.
    const { clock, timeline, starts } = run()
    clock.advance(SWEEP_PARAMS.firstDelayMs + SWEEP_PARAMS.periodMs + 100, 8)
    const before = starts.length
    // When: it resumes after the tab was hidden.
    timeline.resume()
    // Then: the next start is one full delay from the resume, not from the old
    // grid, and nothing is replayed.
    clock.advance(SWEEP_PARAMS.firstDelayMs - 1, 8)
    expect(starts.length).toBe(before)
    clock.advance(2, 8)
    expect(starts.length).toBe(before + 1)
    timeline.dispose()
  })
})
