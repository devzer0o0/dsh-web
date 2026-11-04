/**
 * Opt-in diagnostics for the brand sweep.
 *
 * Silent by default: nothing is logged, the window title is never touched and
 * no network request is issued. Enable it with `?dshBrandGoldDiag=1` on the GUI
 * URL or `localStorage.setItem('dsh-brand-gold:diag', '1')`; the live state is
 * then readable from `window.__DSH_BRAND_GOLD__`. The buffer is a bounded ring,
 * so a long session cannot grow it without limit.
 *
 * @module dsh-brand-gold/diag
 */

/**
 * Ring-buffer capacity. Beam sampling records about ten entries a second, so
 * this holds three complete sweep cycles plus the lifecycle events around them.
 */
const CAPACITY = 320

/** One timestamped record. */
export interface DiagRecord {
  /** Milliseconds since the module loaded. */
  readonly at: number
  /** Short event name. */
  readonly event: string
  /** Optional payload, already reduced to primitives. */
  readonly data?: Readonly<Record<string, string | number | boolean>>
}

/** Diagnostics sink shared by every module of this plugin. */
export interface DiagSink {
  /** Whether anything should be collected at all. */
  readonly enabled: boolean
  /** Append one record; a no-op while disabled. */
  record(event: string, data?: Record<string, string | number | boolean>): void
  /** Replace the published live state. */
  publish(state: unknown): void
  /** Buffered records, oldest first. */
  records(): readonly DiagRecord[]
}

const startedAt = now()

/**
 * Clock that also works in a bare test environment.
 * @returns milliseconds.
 */
function now(): number {
  return typeof performance === 'object' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/**
 * Read the opt-in switch.
 * @returns true when diagnostics were explicitly requested.
 */
function enabledByEnvironment(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const query = new URLSearchParams(window.location.search)
    if (query.get('dshBrandGoldDiag') === '1') return true
    return window.localStorage?.getItem('dsh-brand-gold:diag') === '1'
  } catch {
    return false
  }
}

const buffer: DiagRecord[] = []
const enabled = enabledByEnvironment()

if (enabled && typeof window !== 'undefined') {
  try {
    ;(window as unknown as Record<string, unknown>).__DSH_BRAND_GOLD__ = {
      records: () => buffer.slice(),
      state: null as unknown,
    }
  } catch {
    // A locked-down window object is not a reason to fail the plugin.
  }
}

/** Process-wide diagnostic sink. */
export const diag: DiagSink = {
  enabled,
  record(event, data) {
    if (!enabled) return
    buffer.push({ at: Math.round(now() - startedAt), event, data })
    if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY)
  },
  publish(state) {
    if (!enabled || typeof window === 'undefined') return
    try {
      const target = (window as unknown as Record<string, unknown>).__DSH_BRAND_GOLD__ as { state?: unknown } | undefined
      if (target !== undefined) target.state = state
    } catch {
      // ignore
    }
  },
  records() {
    return buffer.slice()
  },
}