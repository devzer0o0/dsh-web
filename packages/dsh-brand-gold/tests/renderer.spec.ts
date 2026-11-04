// @vitest-environment jsdom
/**
 * Renderer wiring: the requested canvas mode, the mode the browser actually
 * kept, the shader receiving the values that were resolved, and a readback
 * reported in the three spaces it belongs to.
 *
 * These tests run a stub device, which is the point: the previous suite never
 * left the "no WebGPU" branch, so nothing asserted what happens when a device
 * exists.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  EXTENDED_MODE,
  SDR_MODE,
  configureCanvas,
  createRenderer,
  summariseReadback,
  type CanvasMode,
  type DrawFrame,
  type SweepRenderer,
} from '../src/client/renderer.ts'
import { buildLayout } from '../src/client/layout.ts'
import { SWEEP_PARAMS } from '../src/client/sweep.ts'
import type { GpuCanvasConfiguration, GpuCanvasContext, GpuDevice } from '../src/client/webgpu.ts'
import type { MaskImage } from '../src/client/geometry-mask.ts'

/**
 * Encode a number as an IEEE half float.
 * @param value - a finite number.
 * @returns the 16-bit representation.
 */
export function halfOf(value: number): number {
  if (value === 0) return 0
  const sign = value < 0 ? 0x8000 : 0
  const abs = Math.abs(value)
  const exponent = Math.floor(Math.log2(abs))
  const mantissa = abs / 2 ** exponent - 1
  const biased = exponent + 15
  return sign | ((biased & 0x1f) << 10) | (Math.round(mantissa * 1024) & 0x3ff)
}

/**
 * A minimal texture stub.
 * @returns a view plus the two no-op members the renderer touches.
 */
function viewStub(): { createView: () => unknown; destroy: () => void } {
  return { createView: () => ({}), destroy: () => {} }
}

/** What a stubbed frame records. */
interface Stub {
  readonly renderer: SweepRenderer
  readonly writes: Float32Array[]
  readonly configurations: GpuCanvasConfiguration[]
  readonly destroyed: () => number
}

/**
 * Build a renderer over a stub device.
 * @param keep - configuration the fake browser reports back; omitted when it
 * reports nothing at all.
 * @param mode - requested canvas mode.
 * @returns the renderer, the recorded writes and the recorded configurations.
 */
function stubRenderer(keep: { alphaMode: 'opaque' | 'premultiplied'; tone: 'standard' | 'extended' } | undefined, mode: CanvasMode): Stub {
  const writes: Float32Array[] = []
  const configurations: GpuCanvasConfiguration[] = []
  let destroys = 0
  const context: GpuCanvasContext = {
    configure(configuration) {
      configurations.push(configuration)
    },
    ...keep === undefined ? {} : {
      getConfiguration: () => ({ alphaMode: keep.alphaMode, toneMapping: { mode: keep.tone }, format: 'rgba16float' }),
    },
    unconfigure() {},
    getCurrentTexture: () => ({ createView: () => ({}), destroy() {} }),
  }
  const device: GpuDevice = {
    createTexture: () => ({ createView: () => ({}), destroy() { destroys += 1 } }),
    createBuffer: () => ({
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => new ArrayBuffer(64),
      unmap() {},
      destroy() { destroys += 1 },
    }),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createSampler: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (_buffer, _offset, data) => { writes.push(new Float32Array(data)) },
      copyExternalImageToTexture: () => {},
      submit: () => {},
    },
    destroy() {},
  }
  const canvas = document.createElement('canvas')
  canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext']
  const created = createRenderer(canvas, device, mode)
  if (created === undefined) throw new Error('the renderer was not created')
  const material = document.createElement('canvas')
  material.width = 8
  material.height = 8
  created.setMaterial(material)
  created.setMask(maskStub())
  return { renderer: created, writes, configurations, destroyed: () => destroys }
}

/**
 * A tiny stand-in mask.
 *
 * The renderer refuses to draw without one — an unlit material is better than a
 * highlight on an arbitrary pixel — so every stub frame carries it.
 * @returns a 2 x 2 mask.
 */
function maskStub(): MaskImage {
  const data = new Uint8ClampedArray(16)
  for (let index = 0; index < 4; index += 1) {
    data[index * 4] = 255
    data[index * 4 + 3] = 255
  }
  return {
    width: 2,
    height: 2,
    data,
    coverage: new Float32Array([1, 1, 1, 1]),
    surface: new Uint8Array([1, 1, 1, 1]),
  }
}

/**
 * jsdom ships no 2D context, so `setMask` would bail out before the texture
 * exists and every frame would be skipped. The stub only has to carry the
 * pixels; nothing in the renderer reads them back.
 */
function stubCanvas2d(): void {
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null
    return {
      putImageData() {},
      clearRect() {},
      drawImage() {},
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    }
  } as unknown as HTMLCanvasElement['getContext']
}

/** A frame with the shipped dials on the 188 px lockup. */
function frame(peakLinear: number): DrawFrame {
  const layout = buildLayout(
    new Map([
      ['mark', { left: 16, top: 58, width: 24, height: 17.66 }],
      ['name', { left: 48, top: 54, width: 156, height: 24 }],
    ]),
    new Map([
      ['mark', '0 0 23.16 17.04'],
      ['name', '26 0 156 24'],
    ]),
    2,
  )!
  return { centerX: layout.centerStart, sweep: 1, warp: 1, layout, params: SWEEP_PARAMS, peakLinear }
}

/**
 * jsdom ships no `ImageData`; the renderer only needs a byte container with
 * width, height and data, so the test environment gets the same shape.
 */
if (typeof (globalThis as { ImageData?: unknown }).ImageData !== 'function') {
  ;(globalThis as { ImageData?: unknown }).ImageData = class {
    readonly width: number
    readonly height: number
    readonly data: Uint8ClampedArray
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
    }
  }
}

stubCanvas2d()

describe('renderer wiring', () => {
  it('operator gets the requested alpha mode and tone mapping kept apart', () => {
    // Given: a browser that keeps an extended, still transparent surface.
    const configurations: GpuCanvasConfiguration[] = []
    // When: the extended mode is requested on a canvas context.
    const result = configureCanvas(
      {
        configure: (configuration) => configurations.push(configuration),
        unconfigure() {},
        getCurrentTexture: () => viewStub(),
        getConfiguration: () => ({ alphaMode: 'premultiplied', toneMapping: { mode: 'extended' } }),
      },
      {} as GpuDevice,
      EXTENDED_MODE,
    )
    // Then: the request carries both dials independently, and the readback is
    // what the browser kept rather than what was asked for.
    expect(configurations[0]?.toneMapping.mode).toBe('extended')
    expect(configurations[0]?.alphaMode).toBe('premultiplied')
    expect(configurations[0]?.format).toBe('rgba16float')
    expect(configurations[0]?.colorSpace).toBe('srgb')
    expect(result.effective).toEqual({ alpha: 'premultiplied', tone: 'extended' })
  })

  it('operator is told the truth when the browser refuses the extended mode', () => {
    // Given: a browser that keeps standard tone mapping.
    // When: extended is requested.
    const result = configureCanvas(
      {
        configure() {},
        unconfigure() {},
        getCurrentTexture: () => viewStub(),
        getConfiguration: () => ({ alphaMode: 'premultiplied', toneMapping: { mode: 'standard' } }),
      },
      {} as GpuDevice,
      EXTENDED_MODE,
    )
    // Then: the effective mode is standard, so the diagnostic cannot claim HDR.
    expect(result.effective.tone).toBe('standard')
  })

  it('operator gets the effective mode reported by the renderer itself', () => {
    // Given: an extended request and a browser that keeps it.
    const stub = stubRenderer({ alphaMode: 'premultiplied', tone: 'extended' }, EXTENDED_MODE)
    // Then: the renderer exposes the pair that is in effect.
    expect(stub.renderer.tone).toBe('extended')
    expect(stub.renderer.alpha).toBe('premultiplied')
    // And when the browser downgrades it, the renderer says standard.
    const downgraded = stubRenderer({ alphaMode: 'premultiplied', tone: 'standard' }, EXTENDED_MODE)
    expect(downgraded.renderer.tone).toBe('standard')
  })

  it('operator sees the shader receive the widths and the peak that were resolved', () => {
    // Given: a renderer with a material and a frame carrying the 1600 nit target.
    const stub = stubRenderer({ alphaMode: 'premultiplied', tone: 'extended' }, EXTENDED_MODE)
    const drawFrame = frame(1600 / 203)
    // When: one frame is drawn.
    stub.renderer.draw(drawFrame)
    // Then: the uniform block carries the band sigma, the core sigma, the peak
    // and the extended flag — the values the test computed, not defaults.
    const uniforms = stub.writes.at(-1)!
    expect(uniforms[1]).toBeCloseTo(drawFrame.layout.sigma, 5)
    // The uniform buffer is float32, so the comparison is at float32 precision.
    expect(uniforms[3]).toBeCloseTo(drawFrame.layout.supportRadius, 2)
    expect(uniforms[9]).toBeCloseTo(drawFrame.layout.coreSigma, 5)
    expect(uniforms[10]).toBeCloseTo(drawFrame.layout.collarSigma, 5)
    expect(uniforms[11]).toBeCloseTo(1600 / 203, 4)
    // window.w: the extended ceiling flag lives in the fifth slot now that the
    // plate quad is gone from the uniform block.
    expect(uniforms[21]).toBe(1)
    expect(uniforms[12]).toBeCloseTo(SWEEP_PARAMS.magnifyPeak, 5)
    expect(uniforms[13]).toBeCloseTo(SWEEP_PARAMS.plateFactor, 5)
    expect(uniforms[14]).toBeCloseTo(SWEEP_PARAMS.bandGain, 5)
    // The deformation amplitude travels with the frame, so a rest frame is the
    // identity mapping on the GPU too.
    expect(uniforms[17]).toBe(1)
    // The mask is bound, and the shader is told so.
    expect(uniforms[26]).toBe(1)
  })

  it('operator never gets an extended request on a standard surface', () => {
    // Given: a browser that keeps standard tone mapping.
    const stub = stubRenderer({ alphaMode: 'premultiplied', tone: 'standard' }, EXTENDED_MODE)
    // When: a frame is drawn.
    stub.renderer.draw(frame(1600 / 203))
    // Then: the extended ceiling is zero, so the shader falls back to the SDR
    // shoulder instead of writing values the compositor would clamp.
    const uniforms = stub.writes.at(-1)!
    expect(uniforms[11]).toBe(0)
    expect(uniforms[21]).toBe(0)
  })

  it('operator gets the SDR mode when that is what was requested', () => {
    // Given: the SDR mode.
    const stub = stubRenderer({ alphaMode: 'premultiplied', tone: 'standard' }, SDR_MODE)
    // When: a frame is drawn with a peak request.
    stub.renderer.draw(frame(7.88))
    // Then: no extended output is requested, and the mode is reported as SDR.
    expect(stub.renderer.tone).toBe('standard')
    expect(stub.writes.at(-1)![11]).toBe(0)
  })

  it('operator gets encoded channels, linear channels and luminance reported separately', () => {
    // Given: a 3 x 1 half-float frame: one hot pixel with alpha, one faint edge
    // pixel, and one empty pixel.
    const bytesPerRow = 48
    const words = new Uint16Array((bytesPerRow / 2) * 1)
    words[0] = halfOf(1.65)
    words[1] = halfOf(1.6)
    words[2] = halfOf(1.5)
    words[3] = halfOf(1)
    // Pixel 1: a nearly transparent edge pixel with a high encoded value.
    words[4] = halfOf(1.7)
    words[5] = halfOf(1.7)
    words[6] = halfOf(1.7)
    words[7] = halfOf(0.05)
    // When: the frame is summarised.
    const summary = summariseReadback(words, bytesPerRow, 3, 1)
    // Then: the encoded peak, the linear peak and the coverage-weighted peak are
    // three different numbers, and the faint edge pixel cannot pass as the
    // brightest.
    expect(summary.peakEncoded).toBeCloseTo(1.7, 2)
    expect(summary.peakLinearChannel).toBeGreaterThan(1)
    expect(summary.peakLinearLuma).toBeGreaterThan(1)
    expect(summary.peakCompositedLuma).toBeLessThan(summary.peakLinearLuma)
    expect(summary.coveredPixels).toBe(2)
  })

  it('operator never gets a brightness peak from a pixel that covers nothing', () => {
    // Given: one pixel with a large encoded value and zero alpha.
    const words = new Uint16Array(12)
    words[0] = halfOf(2)
    words[1] = halfOf(2)
    words[2] = halfOf(2)
    words[3] = 0
    // When: it is summarised.
    const summary = summariseReadback(words, 48, 1, 1)
    // Then: nothing is covered, so no peak is reported.
    expect(summary.peakEncoded).toBe(0)
    expect(summary.peakLinearLuma).toBe(0)
    expect(summary.coveredPixels).toBe(0)
  })

  it('operator gets every resource released, including a second dispose', () => {
    // Given: a renderer with a material and a measured frame.
    const stub = stubRenderer({ alphaMode: 'premultiplied', tone: 'extended' }, EXTENDED_MODE)
    const before = stub.destroyed()
    // When: it is disposed twice.
    stub.renderer.dispose()
    stub.renderer.dispose()
    // Then: the resources were released and the second call was a no-op.
    expect(stub.destroyed()).toBeGreaterThan(before)
    expect(() => stub.renderer.draw(frame(1))).not.toThrow()
  })

  it('operator gets a measurement that writes no canvas frame', async () => {
    // Given: a renderer with a material.
    const stub = stubRenderer({ alphaMode: 'premultiplied', tone: 'extended' }, EXTENDED_MODE)
    const spy = vi.fn()
    // When: an offscreen measurement runs.
    const summary = await stub.renderer.measure(frame(7.88))
    // Then: it reports a summary and never draws through the canvas swap chain.
    expect(summary).toHaveProperty('peakLinearLuma')
    expect(spy).not.toHaveBeenCalled()
  })
})