/**
 * Shared GPU context for the brand sweep.
 *
 * One module-level holder owns the device, the adapter and the capability
 * verdict, so a re-render, a second lockup instance or a theme change never
 * acquires a second device. It also owns the generation counter: every async
 * acquisition carries a generation, and a result whose generation is stale is
 * dropped instead of overwriting current resources.
 *
 * @module dsh-brand-gold/gpu
 */
import { diag } from './diag.ts'
import { navigatorGpu, type GpuAdapter, type GpuDevice } from './webgpu.ts'

/** Capability state, reported separately from any render state. */
export type GpuPhase =
  | 'unknown'
  | 'unsupported-webgpu'
  | 'unsupported-range'
  // `unsupported-range` means "WebGPU exists but the display reports no extended
  // range"; it is an SDR verdict, not a refusal to draw.
  | 'adapter-missing'
  | 'device-missing'
  | 'lost'
  | 'ready'

/** Everything the diagnostic needs to tell the states apart. */
export interface GpuStatus {
  /** Capability verdict. */
  readonly phase: GpuPhase
  /** `navigator.gpu` present. */
  readonly hasGpu: boolean
  /** `(dynamic-range: high)` matched at probe time. */
  readonly highRange: boolean
  /** `showPopover` exists, so an element can reach the top layer. */
  readonly popover: boolean
  /** `isSecureContext`. */
  readonly secure: boolean
  /** Human-readable reason for the current phase. */
  readonly reason: string
}

/** Media query the shell reports when extended range is available. */
const HIGH_RANGE_QUERY = '(dynamic-range: high)'

/** Generation of the current device; async work stamps it and checks it back. */
let generation = 0

let adapter: GpuAdapter | undefined
let device: GpuDevice | undefined
let ready: Promise<GpuDevice | undefined> | undefined
let status: GpuStatus = {
  phase: 'unknown',
  hasGpu: false,
  highRange: false,
  popover: false,
  secure: false,
  reason: 'not probed',
}

/**
 * Probe the host capabilities this layer needs.
 * @returns the live status.
 */
export function probeCapabilities(): GpuStatus {
  const hasGpu = typeof navigator !== 'undefined' && navigatorGpu() !== undefined
  const highRange = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(HIGH_RANGE_QUERY).matches
    : false
  const popover = typeof HTMLElement !== 'undefined'
    && typeof (HTMLElement.prototype as unknown as { showPopover?: unknown }).showPopover === 'function'
  const secure = typeof window !== 'undefined' ? window.isSecureContext !== false : false
  let phase: GpuPhase = 'unknown'
  let reason = ''
  if (!hasGpu) {
    phase = 'unsupported-webgpu'
    reason = 'navigator.gpu is missing'
  } else if (!highRange) {
    phase = 'unsupported-range'
    reason = 'the display reports no extended dynamic range'
  } else if (!popover) {
    phase = 'unsupported-range'
    reason = 'the popover API is missing, so the canvas cannot reach the top layer'
  } else {
    // The device is not part of the verdict; acquisition decides that below.
    phase = device !== undefined ? 'ready' : 'unknown'
    reason = device !== undefined ? 'device ready' : 'capabilities available, device not acquired'
  }
  status = { phase, hasGpu, highRange, popover, secure, reason }
  return status
}

/**
 * Current capability status without re-probing.
 * @returns the cached status.
 */
export function gpuStatus(): GpuStatus {
  return status
}

/**
 * Acquire (or reuse) the shared device.
 *
 * The returned device is only valid while `generation` still matches what this
 * call observed; callers compare `gpuGeneration()` before committing work.
 *
 * @returns the device, or undefined when the host cannot provide one.
 */
export function acquireDevice(): Promise<GpuDevice | undefined> {
  if (device !== undefined) return Promise.resolve(device)
  if (ready !== undefined) return ready
  const probe = probeCapabilities()
  if (!probe.hasGpu) {
    diag.record('gpu.unsupported', { phase: probe.phase, reason: probe.reason })
    return Promise.resolve(undefined)
  }
  // A missing extended range is not a reason to refuse a device: the same
  // shader draws the wide, slow SDR sweep, and only the over-unity ceiling is
  // dropped. The verdict stays in `status` so the diagnostic keeps them apart.
  const mine = generation
  ready = (async (): Promise<GpuDevice | undefined> => {
    try {
      const gpu = navigatorGpu()
      if (gpu === undefined) return undefined
      adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) ?? undefined
      if (adapter === undefined) {
        status = { ...probeCapabilities(), phase: 'adapter-missing', reason: 'requestAdapter returned null' }
        diag.record('gpu.adapter-missing')
        return undefined
      }
      const acquired = await adapter.requestDevice()
      if (mine !== generation) {
        // A newer reset happened while acquisition was in flight.
        acquired.destroy()
        diag.record('gpu.stale-device')
        return undefined
      }
      acquired.addEventListener?.('uncapturederror', (event) => {
        diag.record('gpu.error', { reason: (event.error?.message ?? 'unknown').slice(0, 200) })
        // eslint-disable-next-line no-console
        console.error('[brand-gold] GPU error:', event.error?.message)
        diag.record('gpu.validation', { reason: (event.error?.message ?? '').slice(0, 140) })
      })
      device = acquired
      void acquired.lost?.then((info) => {
        if (device !== acquired) return
        device = undefined
        adapter = undefined
        ready = undefined
        status = { ...probeCapabilities(), phase: 'lost', reason: info?.message ?? info?.reason ?? 'device lost' }
        diag.record('gpu.lost', { reason: status.reason })
        return undefined
      })
      const caps = probeCapabilities()
      status = { ...caps, phase: 'ready', reason: 'device ready' }
      diag.record('gpu.ready')
      return device
    } catch (error) {
      status = { ...probeCapabilities(), phase: 'device-missing', reason: String(error).slice(0, 160) }
      diag.record('gpu.error', { reason: status.reason })
      return undefined
    } finally {
      if (mine === generation) ready = undefined
    }
  })()
  return ready
}

/**
 * Generation stamp of the current device.
 * @returns a number that changes whenever the device is reset.
 */
export function gpuGeneration(): number {
  return generation
}

/**
 * Drop the shared device; every renderer built on it must be rebuilt.
 */
export function resetDevice(): void {
  generation += 1
  ready = undefined
  adapter = undefined
  const current = device
  device = undefined
  if (current !== undefined) {
    try {
      current.destroy()
    } catch {
      // A lost device is already gone.
    }
  }
  status = { ...probeCapabilities(), phase: 'unknown', reason: 'device reset' }
  diag.record('gpu.reset')
}

/**
 * The shared device, when one is already acquired.
 * @returns the device or undefined.
 */
export function currentDevice(): GpuDevice | undefined {
  return device
}