/**
 * The WebGPU renderer behind the sweep canvas.
 *
 * Material: the live lockup is composited once into a canvas and uploaded as an
 * `rgba8unorm-srgb` texture, so the hardware does the sRGB decode and
 * the shader receives exactly the pixels the SVG shows.
 *
 * Deformation: the fragment shader samples that texture **through the inverse
 * warp**, so material, outline and edge coverage move by the same function.
 * There is no second silhouette and no fixed outline mask, so a magnified
 * stroke cannot be cut and a double edge cannot appear.
 *
 * Coverage: the canvas is fully transparent except where the beam lands, so the
 * resting lockup is the SVG underneath and nothing is ever drawn twice.
 *
 * Output: linear light is encoded with the extended sRGB curve. When the host
 * keeps extended range at the lockup's place in the tree, the canvas is
 * `rgba16float` + `toneMapping: 'extended'`; otherwise it falls back to a
 * premultiplied SDR surface with the same shader.
 *
 * @module dsh-brand-gold/renderer
 */

import type { LockupLayout } from './layout.ts'
import {
  BUFFER_USAGE,
  MAP_MODE_READ,
  TEXTURE_USAGE,
  type GpuBindGroup,
  type GpuBuffer,
  type GpuCanvasContext,
  type GpuDevice,
  type GpuPipeline,
  type GpuRenderPipeline,
  type GpuTexture,
} from './webgpu.ts'
import type { SweepParams } from './sweep.ts'

/** Canvas compositing mode. */
export type CanvasMode = 'premultiplied' | 'opaque-extended'

/** Every spatial term mirrors `beam.ts`. */
const WGSL = `
struct Params {
  // x: beam centre, y: falloff sigma, z: tan(tilt), w: unused
  beam: vec4f,
  // x: canvas width, y: canvas height, z: vertical centre, w: lift in px
  frame: vec4f,
  // x: sweep envelope, y: core sigma px, z: core gain, w: extended gain
  light: vec4f,
  // x: magnification, y: plate factor, z: rim gain, w: shade gain
  warp: vec4f,
  // x: plate centre x, y: plate centre y, z: plate half w, w: plate half h
  plate: vec4f,
  // x: plate radius
  plateEdge: vec4f,
};

@group(0) @binding(0) var material: texture_2d<f32>;
@group(0) @binding(1) var materialSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(corners[i], 0.0, 1.0);
}

// Extended sRGB encode: above 1.0 the curve continues linearly, so extended
// values reach the framebuffer instead of being clamped by the transfer.
fn encode(c: f32) -> f32 {
  let v = max(c, 0.0);
  let low = v * 12.92;
  let high = 1.055 * pow(v, 1.0 / 2.4) - 0.055;
  let srgb = select(high, low, v <= 0.0031308);
  return select(srgb, v, v > 1.0);
}

fn beamU(px: vec2f) -> f32 {
  return (px.x - params.beam.x) + (px.y - params.frame.z) * params.beam.z;
}

fn influence(px: vec2f) -> f32 {
  let u = beamU(px) / max(params.beam.y, 0.0001);
  return exp(-(u * u));
}

fn coreBand(px: vec2f) -> f32 {
  let u = beamU(px) / max(params.light.y, 0.0001);
  return exp(-(u * u));
}

// Signed distance to the HARNESS plate, in canvas pixels.
fn plateDistance(px: vec2f) -> f32 {
  let d = abs(px - params.plate.xy) - params.plate.zw + vec2f(params.plateEdge.x, params.plateEdge.x);
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0) - params.plateEdge.x;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = pos.xy;

  // Invert the warp: this destination pixel shows the material that lands on
  // it. The displacement is sub-pixel, so two fixed-point steps converge.
  let nlen = sqrt(1.0 + params.beam.z * params.beam.z);
  let nx = 1.0 / nlen;
  let ny = params.beam.z / nlen;
  var src = px;
  for (var step = 0; step < 2; step = step + 1) {
    let weight = influence(src);
    let along = (src.x - params.beam.x) * nx + (src.y - params.frame.z) * ny;
    let scale = 1.0 + (params.warp.x - 1.0) * weight;
    let radial = along * (1.0 / scale - 1.0);
    src = px - vec2f(nx * radial, ny * radial - params.frame.w * weight);
  }

  let dims = vec2f(textureDimensions(material));
  let texel = textureSampleLevel(material, materialSampler, clamp(src / dims, vec2f(0.0), vec2f(1.0)), 0.0);
  let coverage = clamp(texel.a, 0.0, 1.0);

  // One weight drives everything: magnification, light, highlight and lift all
  // come from the same beam distance, so they cannot disagree.
  let envelope = clamp(params.light.x, 0.0, 1.0);
  let weight = influence(src);

  // The overlay is invisible outside the beam: at rest the SVG underneath is
  // what the eye sees, and no second copy of the lockup is drawn over it.
  let lit = clamp(weight * envelope, 0.0, 1.0);
  let show = smoothstep(0.02, 0.5, lit);
  if (coverage <= 0.004 || show <= 0.004) {
    return vec4f(0.0);
  }

  let plate = 1.0 - smoothstep(-1.0, 1.0, plateDistance(src));
  let response = mix(1.0, params.warp.y, plate);

  // Highlights belong to metal, never to the HARNESS lettering.
  let base = texel.rgb;
  let luma = dot(base, vec3f(0.2126, 0.7152, 0.0722));
  let metalGate = smoothstep(0.24, 0.46, luma);

  let core = coreBand(src);
  let collar = exp(-pow(beamU(src) / max(params.light.y * 3.2, 0.0001), 2.0));
  let collarColor = vec3f(1.0, 0.86, 0.62);
  let coreColor = vec3f(1.0, 0.97, 0.90);

  var rgb = base * (1.0 + 0.5 * lit * response * metalGate);
  rgb = rgb + collarColor * (collar * 0.16 * response * envelope * metalGate);
  rgb = rgb + coreColor * (core * params.light.z * response * envelope * metalGate);

  // Extended range, only while the beam covers this pixel.
  rgb = rgb + coreColor * (params.light.w * core * core * response * envelope * metalGate);

  // Leading-edge rim and trailing shade: the derivative of the same weight
  // tells which side the beam arrives from, so the metal reads as lifted.
  let ahead = influence(src + vec2f(1.5, 1.5));
  let behind = influence(src - vec2f(1.5, 1.5));
  let rise = clamp(ahead - behind, 0.0, 1.0) * envelope * response * metalGate;
  rgb = rgb + vec3f(1.0, 0.95, 0.82) * (rise * params.warp.z);
  rgb = rgb - vec3f(0.10, 0.06, 0.02) * (rise * params.warp.w);

  // Soft shoulder: an SDR surface must not clip into a flat white block, so
  // values above the knee are compressed instead of truncated. Extended mode
  // skips it, because there the value is meant to leave the SDR range.
  if (params.light.w <= 0.0) {
    let knee = 0.72;
    let over = max(rgb - vec3f(knee, knee, knee), vec3f(0.0, 0.0, 0.0));
    rgb = min(rgb, vec3f(knee, knee, knee)) + over / (1.0 + over * 2.4);
  }

  let alpha = coverage * show;
  let encoded = vec3f(encode(rgb.r), encode(rgb.g), encode(rgb.b));
  return vec4f(encoded * alpha, alpha);
}
`

/**
 * Decode one IEEE half float.
 * @param bits - raw 16-bit value.
 * @returns the numeric value.
 */
function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits & 0x7c00) >> 10
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

/**
 * Peak colour value in an `rgba16float` readback.
 * @param words - raw half-float words, row padding included.
 * @param bytesPerRow - padded row length in bytes.
 * @param width - row width in pixels.
 * @param height - rows.
 * @returns the peak value, ignoring infinite and NaN samples.
 */
function peakHalfFloat(words: Uint16Array, bytesPerRow: number, width: number, height: number): number {
  const rowWords = bytesPerRow / 2
  let peak = 0
  for (let y = 0; y < height; y += 1) {
    const row = y * rowWords
    for (let x = 0; x < width; x += 1) {
      const base = row + x * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const value = halfToFloat(words[base + channel] ?? 0)
        if (Number.isFinite(value) && value > peak && value < 65504) peak = value
      }
    }
  }
  return peak
}

/** Uniform payload size in bytes (6 vec4 slots). */
const UNIFORM_BYTES = 6 * 16

/** HARNESS plate rectangle in canvas pixels. */
export interface PlateRect {
  /** Left edge. */
  readonly x: number
  /** Top edge. */
  readonly y: number
  /** Width. */
  readonly width: number
  /** Height. */
  readonly height: number
  /** Corner radius. */
  readonly rx: number
}

/** One frame's state. */
export interface DrawFrame {
  /** Beam centre in device pixels. */
  readonly centerX: number
  /** Sweep envelope, 0 while the lockup rests. */
  readonly sweep: number
  /** Layout the canvas is sized to. */
  readonly layout: LockupLayout
  /** Tunables. */
  readonly params: SweepParams
  /** HARNESS plate, when the wordmark is one of the occupants. */
  readonly plate: PlateRect | undefined
}

/** A renderer bound to one canvas. */
export interface SweepRenderer {
  /** Device the renderer runs on. */
  readonly device: GpuDevice
  /** Resize the backing store to the layout. */
  resize(layout: LockupLayout): void
  /** Upload the composited material. */
  setMaterial(material: HTMLCanvasElement): void
  /** Draw one frame into the canvas. */
  draw(frame: DrawFrame): void
  /** Draw one frame offscreen and read its peak linear value. */
  measure(frame: DrawFrame): Promise<number>
  /** Validation message produced while the renderer was created, if any. */
  setupMessage(): string
  /** Why a readback produced nothing, when it did. */
  measureError(): string
  /** Release every GPU resource owned by this renderer. */
  dispose(): void
}

/**
 * Create the renderer on a canvas.
 * @param canvas - canvas already sized to the layout.
 * @param device - an acquired device.
 * @param mode - compositing mode.
 * @returns the renderer, or undefined when the canvas cannot take WebGPU.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  device: GpuDevice,
  mode: CanvasMode = 'premultiplied',
): SweepRenderer | undefined {
  const context = canvas.getContext('webgpu') as unknown as GpuCanvasContext | null
  if (context === null) return undefined
  let setupError = ''
  let measureError = ''
  device.pushErrorScope?.('validation')
  const configure = (): void => {
    context.configure({
      device,
      format: 'rgba16float',
      alphaMode: mode === 'opaque-extended' ? 'opaque' : 'premultiplied',
      toneMapping: { mode: mode === 'opaque-extended' ? 'extended' : 'standard' },
      colorSpace: 'srgb',
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT,
    })
  }
  configure()

  const module = device.createShaderModule({ code: WGSL })
  const pipeline: GpuRenderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    primitive: { topology: 'triangle-list' },
  })
  const uniform: GpuBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  void device.popErrorScope?.().then((error) => {
    setupError = error?.message ?? ''
  })

  const uniforms = new Float32Array(UNIFORM_BYTES / 4)
  let texture: GpuTexture | undefined
  let bindGroup: GpuBindGroup | undefined
  let disposed = false


  const writeUniforms = (frame: DrawFrame): void => {
    const { layout, params, plate } = frame
    const tilt = Math.tan((params.tiltDeg * Math.PI) / 180)
    uniforms.set([
      frame.centerX, layout.sigma, tilt, 0,
      layout.width, layout.height, layout.centerY, params.liftPx * layout.dpr,
      frame.sweep, params.coreSigmaPx * layout.dpr, params.coreGain, params.hdrGain,
      params.magnifyPeak, params.plateFactor, 0.26, 0.16,
      plate === undefined ? 0 : plate.x + plate.width / 2,
      plate === undefined ? 0 : plate.y + plate.height / 2,
      plate === undefined ? 0 : plate.width / 2,
      plate === undefined ? 0 : plate.height / 2,
      plate === undefined ? 0 : plate.rx, 0, 0, 0,
    ], 0)
    device.queue.writeBuffer(uniform, 0, uniforms)
  }

  const bind = (group: GpuBindGroup | undefined): GpuBindGroup => {
    if (group !== undefined) return group
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture!.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniform } },
      ],
    })
  }

  return {
    device,
    resize(layout) {
      if (disposed) return
      if (canvas.width === layout.width && canvas.height === layout.height) return
      canvas.width = layout.width
      canvas.height = layout.height
      configure()
      bindGroup = undefined
    },
    setMaterial(material) {
      if (disposed) return
      texture?.destroy()
      texture = device.createTexture({
        size: [material.width, material.height],
        format: 'rgba8unorm-srgb',
        usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture(
        { source: material },
        { texture, premultipliedAlpha: false },
        [material.width, material.height],
      )
      bindGroup = undefined
    },
    draw(frame) {
      if (disposed || texture === undefined) return
      bindGroup = bind(bindGroup)
      writeUniforms(frame)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    async measure(frame) {
      if (disposed || texture === undefined) return 0
      let target: GpuTexture | undefined
      let buffer: GpuBuffer | undefined
      try {
        const width = canvas.width
        const height = canvas.height
        target = device.createTexture({
          size: [width, height],
          format: 'rgba16float',
          usage: TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.COPY_SRC,
        })
        const measured = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: texture.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: uniform } },
          ],
        })
        writeUniforms(frame)
        const bytesPerRow = Math.ceil((width * 8) / 256) * 256
        buffer = device.createBuffer({
          size: bytesPerRow * height,
          usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
        })
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: target.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, measured)
        pass.draw(3)
        pass.end()
        encoder.copyTextureToBuffer?.(
          { texture: target },
          { buffer, bytesPerRow },
          { width, height, depthOrArrayLayers: 1 },
        )
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync?.(MAP_MODE_READ)
        const mapped = buffer.getMappedRange?.()
        if (mapped === undefined) {
          measureError = 'no mapped range'
          return 0
        }
        const peak = peakHalfFloat(new Uint16Array(mapped), bytesPerRow, width, height)
        buffer.unmap?.()
        measureError = 'w=' + width + 'x' + height + ' peak=' + Math.round(peak * 100) / 100
        return peak
      } catch (error) {
        measureError = String(error).slice(0, 140)
        return 0
      } finally {
        buffer?.destroy()
        target?.destroy()
      }
    },
    setupMessage() {
      return setupError
    },
    measureError() {
      return measureError
    },
    dispose() {
      disposed = true
      texture?.destroy()
      texture = undefined
      bindGroup = undefined
      uniform.destroy()
      try {
        context.unconfigure()
      } catch {
        // A lost device throws here; it is gone either way.
      }
    },
  }
}
