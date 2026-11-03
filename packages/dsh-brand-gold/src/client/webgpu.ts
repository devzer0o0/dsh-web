/**
 * The slice of the WebGPU API this plugin uses.
 *
 * The DOM type library in this cohort ships no WebGPU types, and the package
 * must not depend on a DSH checkout for a handful of members. The canvas
 * context members that are not in the standard `GPUCanvasContext` (extended
 * tone mapping, the output colour space) are declared here explicitly, so the
 * configuration is checked at compile time instead of silently ignored.
 *
 * @module dsh-brand-gold/webgpu
 */

/** `GPUTextureUsage` bits used by the specular layer. */
export const TEXTURE_USAGE = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  RENDER_ATTACHMENT: 0x10,
} as const

/** `GPUBufferUsage` bits used by the specular layer. */
export const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
} as const

/** `GPUMapMode.READ`. */
export const MAP_MODE_READ = 0x0001

/** Canvas configuration accepted by Chromium's HDR path. */
export interface GpuCanvasConfiguration {
  /** Device rendering the canvas. */
  device: GpuDevice
  /** Half-float storage; required for any value above 1.0. */
  format: 'rgba16float'
  /** Opaque: over-unity values were measured to survive only on this mode. */
  alphaMode: 'opaque' | 'premultiplied'
  /** `extended` or the compositor clamps everything at 1.0. */
  toneMapping: { mode: 'standard' | 'extended' }
  /** Declared output space of the canvas. */
  colorSpace: 'srgb' | 'display-p3'
  /** Usage bits; the layer only renders. */
  usage: number
}

/** Texture handle. */
export interface GpuTexture {
  /** View used as a bind-group entry or attachment. */
  createView(): unknown
  /** Release the allocation. */
  destroy(): void
}

/** Buffer handle. */
export interface GpuBuffer {
  /** Map the buffer for reading. */
  mapAsync?(mode: number): Promise<ArrayBuffer | undefined | void>
  /** Get the mapped range. */
  getMappedRange?(): ArrayBuffer
  /** Release the mapping. */
  unmap?(): void
  /** Release the allocation. */
  destroy(): void
}

/** Bind group handle. */
export interface GpuBindGroup {}

/** Unused placeholder kept for the type import shape. */
export type GpuPipeline = unknown

/** Render pipeline handle. */
export interface GpuRenderPipeline {
  /** Layout of the bind group declared with `layout: 'auto'`. */
  getBindGroupLayout(index: number): unknown
}

/** Render pass encoder subset. */
export interface GpuRenderPass {
  /** Bind the pipeline. */
  setPipeline(pipeline: GpuRenderPipeline): void
  /** Bind a group. */
  setBindGroup(index: number, group: GpuBindGroup): void
  /** Draw `vertices` vertices. */
  draw(vertices: number): void
  /** Close the pass. */
  end(): void
}

/** Command encoder subset. */
export interface GpuCommandEncoder {
  /** Open a render pass. */
  beginRenderPass(descriptor: unknown): GpuRenderPass
  /** Copy a texture into a buffer. */
  copyTextureToBuffer?(
    source: { texture: GpuTexture },
    destination: { buffer: GpuBuffer; bytesPerRow: number; offset?: number },
    copySize: { width: number; height: number; depthOrArrayLayers: number },
  ): void
  /** Finish the command buffer. */
  finish(): unknown
}

/** Device subset. */
export interface GpuDevice {
  /** Create a texture. */
  createTexture(descriptor: unknown): GpuTexture
  /** Create a buffer. */
  createBuffer(descriptor: { size: number; usage: number }): GpuBuffer
  /** Compile a shader module. */
  createShaderModule(descriptor: { code: string }): unknown
  /** Create a render pipeline. */
  createRenderPipeline(descriptor: unknown): GpuRenderPipeline
  /** Create a bind group. */
  createBindGroup(descriptor: unknown): GpuBindGroup
  /** Create a sampler. */
  createSampler(descriptor: { magFilter: 'linear' | 'nearest'; minFilter: 'linear' | 'nearest' }): unknown
  /** Encode commands. */
  createCommandEncoder(): GpuCommandEncoder
  /** Submit queue. */
  readonly queue: {
    /** Write uniform data. */
    writeBuffer(buffer: GpuBuffer, offset: number, data: Float32Array): void
    /** Upload a canvas as a texture (the composited material). */
    copyExternalImageToTexture(
      source: { source: ImageBitmap | HTMLCanvasElement },
      destination: { texture: GpuTexture; premultipliedAlpha?: boolean },
      copySize: [number, number],
    ): void
    /** Submit finished command buffers. */
    submit(buffers: unknown[]): void
  }
  /** Push a validation error scope. */
  pushErrorScope?(filter: 'validation' | 'out-of-memory' | 'internal'): void
  /** Pop the innermost error scope. */
  popErrorScope?(): Promise<{ message?: string } | null>
  /** Loss handler; fires when the device is taken away (GPU reset, driver update). */
  lost?: Promise<{ reason?: string; message?: string }>
  /** Validation-error listener (uncaptured GPU errors). */
  addEventListener?: (type: 'uncapturederror', listener: (event: { error?: { message?: string } }) => void) => void
  /** Release the device. */
  destroy(): void
}

/** Adapter subset. */
export interface GpuAdapter {
  /** Acquire a logical device. */
  requestDevice(): Promise<GpuDevice>
}

/** Entry point subset. */
export interface Gpu {
  /** Acquire an adapter; null when the browser refuses. */
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<GpuAdapter | null>
}

/** Canvas context subset with the extended-range configuration members. */
export interface GpuCanvasContext {
  /** Apply the canvas configuration. */
  configure(configuration: GpuCanvasConfiguration): void
  /** Remove the configuration. */
  unconfigure(): void
  /** Current swap-chain texture. */
  getCurrentTexture(): GpuTexture
}

/**
 * Read `navigator.gpu` without assuming the global type.
 * @returns the entry point, or undefined when WebGPU is unavailable.
 */
export function navigatorGpu(): Gpu | undefined {
  return (navigator as unknown as { gpu?: Gpu }).gpu
}
