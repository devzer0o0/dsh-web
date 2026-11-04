/**
 * Cadence under load: the sweep keeps its three-second grid while the page is
 * busy, and a pending timer is never disturbed by a reposition.
 *
 * The live host found both bugs this covers. A scroll handler called a full
 * rebuild 314 times in nine seconds and cancelled every running cycle, and an
 * `arm()` that cleared and re-armed its timer could drop the grid point the
 * timer was already due for.
 */
import { describe, expect, it } from 'vitest'
import { SweepTimeline, type FrameInfo, type TimelineClock } from '../src/client/timeline.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'
import { buildLayout, type LockupLayout } from '../src/client/layout.ts'
import { shapeGeometryOf } from '../src/client/geometry-mask.ts'
import { MARK_GEOMETRY, NAME_GEOMETRY } from '../src/client/paths.ts'

/** A clock the test advances by hand, with an explicit "handler is busy" window. */
class BusyClock implements TimelineClock {
  time = 0
  private nextId = 1
  private readonly timers = new Map<number, { at: number; handler: () => void }>()
  private readonly frames = new Map<number, () => void>()
  /** While true, due timers stay queued: the page is busy elsewhere. */
  busy = false
  maxTimers = 0

  now(): number {
    return this.time
  }

  setTimeout(handler: () => void, delay: number): number { // test-standards-allow: injected clock, not a test sleep
    const id = this.nextId++
    this.timers.set(id, { at: this.time + Math.max(0, delay), handler })
    this.maxTimers = Math.max(this.maxTimers, this.timers.size)
    return id
  }

  clearTimeout(id: number): void {
    this.timers.delete(id)
  }

  requestAnimationFrame(handler: () => void): number {
    const id = this.nextId++
    this.frames.set(id, handler)
    return id
  }

  cancelAnimationFrame(id: number): void {
    this.frames.delete(id)
  }

  /** Advance time, running due work unless the page is busy. */
  advance(ms: number, frameStep = 8): void {
    const target = this.time + ms
    while (this.time < target) {
      this.time = Math.min(target, this.time + frameStep)
      if (!this.busy) this.drain()
    }
  }

  /** Run every timer that is due and then every queued frame. */
  drain(): void {
    for (;;) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.time)
      if (due.length === 0) break
      for (const [id, timer] of due) {
        this.timers.delete(id)
        timer.handler()
      }
    }
    const frames = [...this.frames.values()]
    this.frames.clear()
    for (const handler of frames) handler()
  }

  get pending(): number {
    return this.timers.size
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

/**
 * Build a started timeline that records its cycle starts.
 * @returns the clock, the timeline and the recorded start times.
 */
function run(): { clock: BusyClock; timeline: SweepTimeline; starts: number[] } {
  const clock = new BusyClock()
  const starts: number[] = []
  const timeline = new SweepTimeline(
    {
      canRun: () => true,
      frame: (_info: FrameInfo) => {},
      rest: () => {},
      cycleStart: (info) => starts.push(info.start),
    },
    () => layout,
    SWEEP_PARAMS,
    clock,
  )
  timeline.start()
  return { clock, timeline, starts }
}

describe('cadence under load', () => {
  it('operator keeps the three-second grid when the page is continuously busy', () => {
    // Given: a running timeline and a page that is busy almost all the time.
    const { clock, timeline, starts } = run()
    // When: five periods pass, with the event handler occupied in each of them.
    for (let period = 0; period < 5; period += 1) {
      clock.advance(SWEEP_PARAMS.periodMs - 120, 8)
      clock.busy = true
      clock.advance(200, 8)
      clock.busy = false
      clock.advance(120, 8)
    }
    // Then: every cycle ran, on the grid, none skipped.
    expect(starts.length).toBe(5)
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]! - starts[index - 1]!).toBe(SWEEP_PARAMS.periodMs)
    }
    timeline.dispose()
  })

  it('operator never gets a pending start pushed back by re-arming', () => {
    // Given: a timeline armed for its first grid point.
    const { clock, timeline, starts } = run()
    const origin = timeline.originAt
    // When: the scroll handler calls arm() every 10 ms up to the grid point.
    while (clock.now() < origin) {
      clock.advance(10, 8)
      timeline.arm()
    }
    // Then: the start is the original grid point, not one push-back later.
    clock.advance(20, 8)
    expect(starts[0]).toBe(origin)
    timeline.dispose()
  })

  it('operator never loses a cycle whose timer fired while the page was busy', () => {
    // Given: a running timeline.
    const { clock, timeline, starts } = run()
    clock.advance(SWEEP_PARAMS.firstDelayMs - 60, 8)
    expect(starts.length).toBe(0)
    // When: the page is busy straight through the grid point, and arm() is
    // called from the scroll handler during it.
    clock.busy = true
    clock.advance(120, 8)
    timeline.arm()
    clock.advance(120, 8)
    // Then: nothing was re-armed behind the pending timer's back.
    expect(clock.pending).toBe(1)
    // When: the page is free again.
    clock.busy = false
    clock.advance(60, 8)
    // Then: the cycle that was due runs, and the next one is a period later.
    expect(starts.length).toBe(1)
    clock.advance(SWEEP_PARAMS.periodMs, 8)
    expect(starts.length).toBe(2)
    expect(starts[1]! - starts[0]!).toBe(SWEEP_PARAMS.periodMs)
    timeline.dispose()
  })

  it('operator never gets two timers from a storm of arm calls', () => {
    // Given: a running timeline.
    const { clock, timeline } = run()
    // When: arm() is called between and inside cycles, hundreds of times.
    for (let index = 0; index < 300; index += 1) {
      timeline.arm()
      clock.advance(37, 8)
    }
    // Then: there was never more than one pending timer.
    expect(clock.maxTimers).toBe(1)
    expect(clock.pending).toBeLessThanOrEqual(1)
    timeline.dispose()
  })
})
