/**
 * The WebGPU renderer behind the sweep canvas.
 *
 * Material: the live lockup is composited once into a canvas and uploaded as an
 * `rgba8unorm-srgb` texture, so the hardware does the sRGB decode and the
 * shader receives linear light without a second, hand-rolled conversion.
 *
 * Deformation: the fragment shader samples that texture **through the inverse
 * warp**, so material, outline and edge coverage move by the same function.
 * There is no second silhouette and no fixed outline mask, so a magnified stroke
 * cannot be cut and a double edge cannot appear.
 *
 * Coverage: the canvas is transparent except where the beam lands, so the
 * resting lockup is the SVG underneath and nothing is ever drawn twice.
 *
 * Output: tone mapping and alpha compositing are two independent dials.
 * `alphaMode` decides how the canvas composites with the page; `toneMapping`
 * decides whether values above 1.0 survive. The extended path is a floating
 * point surface with `toneMapping: { mode: 'extended' }`; the SDR path is the
 * same shader with the extended ceiling removed.
 *
 * @module dsh-brand-gold/renderer
 */

import type { LockupLayout } from './layout.ts'
import { encodeSrgb, linearToSrgb, srgbToLinearExtended } from './color.ts'
import { luminance } from './light.ts'
import {
  BUFFER_USAGE,
  MAP_MODE_READ,
  TEXTURE_USAGE,
  type GpuBindGroup,
  type GpuBuffer,
  type GpuCanvasContext,
  type GpuCanvasConfiguration,
  type GpuDevice,
  type GpuRenderPipeline,
  type GpuTexture,
} from './webgpu.ts'
import type { SweepParams } from './sweep.ts'

/** Canvas alpha compositing mode. Independent of the tone-mapping mode. */
export type CanvasAlphaMode = 'premultiplied' | 'opaque'

/** Tone-mapping mode of the canvas. Independent of the alpha mode. */
export type CanvasToneMode = 'extended' | 'standard'

/** A complete canvas configuration choice. */
export interface CanvasMode {
  /** How the canvas composites with the page. */
  readonly alpha: CanvasAlphaMode
  /** Whether values above 1.0 survive to the compositor. */
  readonly tone: CanvasToneMode
}

/** Shipped default: transparent premultiplied SDR, the always-safe path. */
export const SDR_MODE: CanvasMode = Object.freeze({ alpha: 'premultiplied', tone: 'standard' })

/** Extended-range mode: still transparent, over-unity values preserved. */
export const EXTENDED_MODE: CanvasMode = Object.freeze({ alpha: 'premultiplied', tone: 'extended' })

/** Every spatial term mirrors `beam.ts`. */
const WGSL = `
struct Params {
  // x: beam centre, y: band sigma, z: tan(tilt), w: (unused)
  beam: vec4f,
  // x: canvas width, y: canvas height, z: vertical centre, w: lift in device px
  frame: vec4f,
  // x: sweep envelope, y: core sigma, z: collar sigma, w: peak linear luminance
  light: vec4f,
  // x: magnification, y: plate factor, z: band gain, w: collar gain
  warp: vec4f,
  // x: local magnification radius in device px
  warpEdge: vec4f,
  // x: plate centre x, y: plate centre y, z: plate half w, w: plate half h
  plate: vec4f,
  // x: plate radius, y: 1 while the extended ceiling is available
  plateEdge: vec4f,
};

@group(0) @binding(0) var material: texture_2d<f32>;
@group(0) @binding(1) var materialSampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

const LUMA = vec3f(0.2126, 0.7152, 0.0722);
const CORE_COLOR = vec3f(1.0, 0.972, 0.902);
const COLLAR_COLOR = vec3f(1.0, 0.878, 0.678);

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(corners[i], 0.0, 1.0);
}

// sRGB encode on the declared output space, continued above 1.0 by the same
// branch, so an extended luminance keeps its place on the curve.
fn encode(c: f32) -> f32 {
  let v = max(c, 0.0);
  let low = v * 12.92;
  let high = 1.055 * pow(v, 1.0 / 2.4) - 0.055;
  return select(high, low, v <= 0.0031308);
}

fn beamU(px: vec2f) -> f32 {
  return (px.x - params.beam.x) + (px.y - params.frame.z) * params.beam.z;
}

fn bandAt(px: vec2f) -> f32 {
  let u = beamU(px) / max(params.beam.y, 0.0001);
  return exp(-(u * u));
}

fn coreAt(px: vec2f) -> f32 {
  let u = beamU(px) / max(params.light.y, 0.0001);
  return exp(-(u * u));
}

fn collarAt(px: vec2f) -> f32 {
  let u = beamU(px) / max(params.light.z, 0.0001);
  return exp(-(u * u));
}

// Signed distance to the HARNESS plate, in canvas pixels.
fn plateDistance(px: vec2f) -> f32 {
  let d = abs(px - params.plate.xy) - params.plate.zw + vec2f(params.plateEdge.x, params.plateEdge.x);
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0) - params.plateEdge.x;
}

fn toned(color: vec3f, wanted: f32) -> vec3f {
  let own = dot(color, LUMA);
  if (own <= 0.0) { return vec3f(0.0); }
  return color * (wanted / own);
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
    let weight = bandAt(src);
    let along = (src.x - params.beam.x) * nx + (src.y - params.frame.z) * ny;
    let scale = 1.0 + (params.warp.x - 1.0) * weight;
    // Bounded neighbourhood, mirroring magnifyRadiusPx in beam.ts: the light
    // can be wide, but magnification must not sample material far away.
    let local = clamp(along, -params.warpEdge.x, params.warpEdge.x);
    let radial = local * (scale - 1.0);
    src = px - vec2f(nx * radial, ny * radial - params.frame.w * weight);
  }

  let dims = vec2f(textureDimensions(material));
  let texel = textureSampleLevel(material, materialSampler, clamp(src / dims, vec2f(0.0), vec2f(1.0)), 0.0);
  let coverage = clamp(texel.a, 0.0, 1.0);

  let envelope = clamp(params.light.x, 0.0, 1.0);
  let band = bandAt(src);
  let lit = clamp(band * envelope, 0.0, 1.0);
  let show = smoothstep(0.02, 0.5, lit);
  if (coverage <= 0.004 || show <= 0.004) {
    return vec4f(0.0);
  }

  let plate = 1.0 - smoothstep(-1.0, 1.0, plateDistance(src));
  let response = mix(1.0, params.warp.y, plate);

  // Highlights belong to metal, never to the HARNESS lettering.
  let base = texel.rgb;
  let baseLuma = dot(base, LUMA);
  let metal = smoothstep(0.24, 0.46, baseLuma);

  let gate = envelope * metal;
  let collar = collarAt(src);
  let core = coreAt(src);

  // Band first: gold, layered over the resting material. The plate factor is a
  // linear attenuation of the added light, applied once.
  let response2 = response * gate;
  let bandLuma = baseLuma * params.warp.z * band * response2;
  let litLuma = baseLuma + bandLuma + params.warp.w * collar * response2;

  // The core spends only the luminance budget left under the ceiling, so the
  // composite cannot overshoot the requested peak.
  let ceiling = params.light.w * response2;
  let coreTerm = core * core * gate;
  let coreLuma = max(ceiling - litLuma, 0.0) * coreTerm;
  let wanted = litLuma + coreLuma;

  // Split the target between the metal's own hue and the pale core tint.
  let hue = mix(base, CORE_COLOR, clamp(coreLuma / max(wanted, 0.0001), 0.0, 1.0));
  var rgb = toned(hue, wanted);

  // Leading-edge rim and trailing shade: the derivative of the same weight
  // tells which side the beam arrives from, so the metal reads as lifted.
  let ahead = bandAt(src + vec2f(1.5, 1.5));
  let behind = bandAt(src - vec2f(1.5, 1.5));
  let rise = clamp(ahead - behind, 0.0, 1.0) * response2;
  rgb = rgb + vec3f(1.0, 0.95, 0.82) * (rise * 0.05);
  rgb = rgb - vec3f(0.10, 0.06, 0.02) * (rise * 0.04);

  // Soft shoulder on an SDR surface: a clipped white patch would destroy the
  // gold. The extended surface skips it, because there the value is meant to
  // leave the SDR range.
  if (params.plateEdge.y < 0.5) {
    let knee = vec3f(0.72, 0.72, 0.72);
    let over = max(rgb - knee, vec3f(0.0));
    rgb = min(rgb, knee) + over / (1.0 + over * 2.4);
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
export function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits & 0x7c00) >> 10
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

/** One readback summary, kept in the three spaces apart. */
export interface ReadbackSummary {
  /** Largest encoded channel in the frame. */
  readonly peakEncoded: number
  /** Largest linear channel, after decoding each pixel. */
  readonly peakLinearChannel: number
  /** Largest linear luminance of a pixel's colour. */
  readonly peakLinearLuma: number
  /** Largest coverage-weighted linear luminance (what a compositor sees). */
  readonly peakCompositedLuma: number
  /** Number of pixels with a non-zero covered area. */
  readonly coveredPixels: number
  /** Per-column coverage-weighted linear luminance, for geometry diagnostics. */
  readonly columns?: readonly number[]
}

/**
 * Summarise an `rgba16float` readback.
 *
 * The encoded channels, the decoded linear channels, the linear luminance and
 * the coverage-weighted luminance are reported separately: an encoded 255 is not
 * a luminance, and an edge pixel with almost no alpha must not masquerade as a
 * brightness peak.
 *
 * @param words - raw half-float words, row padding included.
 * @param bytesPerRow - padded row length in bytes.
 * @param width - row width in pixels.
 * @param height - rows.
 * @returns the readback summary.
 */
export function summariseReadback(
  words: Uint16Array,
  bytesPerRow: number,
  width: number,
  height: number,
  withColumns = false,
): ReadbackSummary {
  const rowWords = bytesPerRow / 2
  let peakEncoded = 0
  let peakLinearChannel = 0
  let peakLinearLuma = 0
  let peakCompositedLuma = 0
  let coveredPixels = 0
  const columns = withColumns ? Array.from({ length: width }, () => 0) : undefined
  for (let y = 0; y < height; y += 1) {
    const row = y * rowWords
    for (let x = 0; x < width; x += 1) {
      const base = row + x * 4
      const r = halfToFloat(words[base] ?? 0)
      const g = halfToFloat(words[base + 1] ?? 0)
      const b = halfToFloat(words[base + 2] ?? 0)
      const a = halfToFloat(words[base + 3] ?? 0)
      if (!Number.isFinite(a) || a <= 0.002) continue
      coveredPixels += 1
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue
      peakEncoded = Math.max(peakEncoded, r, g, b)
      // The shader returns premultiplied encoded colour; divide the coverage
      // back out before decoding, so a faint edge cannot read as darkness.
      const linear = [
        srgbToLinearExtended(Math.min(Math.max(r, 0) / a, 65504)),
        srgbToLinearExtended(Math.min(Math.max(g, 0) / a, 65504)),
        srgbToLinearExtended(Math.min(Math.max(b, 0) / a, 65504)),
      ] as const
      peakLinearChannel = Math.max(peakLinearChannel, linear[0], linear[1], linear[2])
      const luma = luminance(linear)
      peakLinearLuma = Math.max(peakLinearLuma, luma)
      const composited = luma * Math.min(a, 1)
      peakCompositedLuma = Math.max(peakCompositedLuma, composited)
      if (columns !== undefined) columns[x] += composited
    }
  }
  if (columns !== undefined) for (let x = 0; x < width; x += 1) columns[x] /= height
  return { peakEncoded, peakLinearChannel, peakLinearLuma, peakCompositedLuma, coveredPixels, columns }
}

/** Uniform payload size in bytes (7 vec4 slots). */
const UNIFORM_BYTES = 7 * 16

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
  /** Effective tunables; the same object for `draw` and `measure`. */
  readonly params: SweepParams
  /** Requested peak linear luminance at the core centre. */
  readonly peakLinear: number
  /** HARNESS plate, when the wordmark is one of the occupants. */
  readonly plate: PlateRect | undefined
}

/** A renderer bound to one canvas. */
export interface SweepRenderer {
  /** Device the renderer runs on. */
  readonly device: GpuDevice
  /** Tone-mapping mode actually in effect. */
  readonly tone: CanvasToneMode
  /** Alpha mode actually in effect. */
  readonly alpha: CanvasAlphaMode
  /** Resize the backing store to the layout. */
  resize(layout: LockupLayout): void
  /** Upload the composited material. */
  setMaterial(material: HTMLCanvasElement): void
  /** Draw one frame into the canvas. */
  draw(frame: DrawFrame): void
  /** Draw one frame offscreen (no canvas write) and summarise the readback. */
  measure(frame: DrawFrame): Promise<ReadbackSummary>
  /** Validation message produced while the renderer was created, if any. */
  setupMessage(): string
  /** Why a readback produced nothing, when it did. */
  measureError(): string
  /** Release every GPU resource owned by this renderer. */
  dispose(): void
}

/**
 * Apply a canvas configuration and read back what the browser kept.
 *
 * `configure` not throwing does not mean the mode took effect: Chromium falls
 * back on its own for an unsupported tone-mapping or format combination, so the
 * effective values are read from `getConfiguration()` when the browser offers
 * it and reported separately from the requested ones.
 *
 * @param context - the canvas context.
 * @param device - the device.
 * @param mode - requested mode.
 * @returns the mode actually in effect and the readback, when available.
 */
export function configureCanvas(
  context: GpuCanvasContext,
  device: GpuDevice,
  mode: CanvasMode,
): { effective: CanvasMode; reported?: Partial<CanvasMode> } {
  const configuration: GpuCanvasConfiguration = {
    device,
    format: 'rgba16float',
    alphaMode: mode.alpha,
    toneMapping: { mode: mode.tone },
    colorSpace: 'srgb',
    usage: TEXTURE_USAGE.RENDER_ATTACHMENT,
  }
  context.configure(configuration)
  const read = context.getConfiguration?.()
  if (read === undefined) return { effective: mode }
  const reported: Partial<CanvasMode> = {
    alpha: read.alphaMode,
    tone: read.toneMapping?.mode,
  }
  return {
    effective: {
      alpha: reported.alpha ?? mode.alpha,
      tone: reported.tone ?? mode.tone,
    },
    reported,
  }
}

/**
 * Create the renderer on a canvas.
 * @param canvas - canvas already sized to the layout.
 * @param device - an acquired device.
 * @param mode - compositing and tone-mapping mode.
 * @returns the renderer, or undefined when the canvas cannot take WebGPU.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  device: GpuDevice,
  mode: CanvasMode = SDR_MODE,
): SweepRenderer | undefined {
  const context = canvas.getContext('webgpu') as unknown as GpuCanvasContext | null
  if (context === null) return undefined
  let setupError = ''
  let measureError = ''
  let effective: CanvasMode = mode
  device.pushErrorScope?.('validation')
  const configure = (): void => {
    try {
      effective = configureCanvas(context, device, mode).effective
    } catch (error) {
      setupError = String(error).slice(0, 160)
    }
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
    const message = error?.message ?? ''
    if (message !== '') setupError = message
    return undefined
  })

  const uniforms = new Float32Array(UNIFORM_BYTES / 4)
  let texture: GpuTexture | undefined
  let bindGroup: GpuBindGroup | undefined
  let disposed = false

  const writeUniforms = (frame: DrawFrame): void => {
    const { layout, params, plate } = frame
    const tilt = Math.tan((params.tiltDeg * Math.PI) / 180)
    // The extended ceiling is only requested on a canvas that survived with the
    // extended tone-mapping mode; otherwise the shader gets zero and uses the
    // SDR shoulder instead of writing values the compositor would clamp.
    const extended = effective.tone === 'extended'
    uniforms.set([
      frame.centerX, layout.sigma, tilt, 0,
      layout.width, layout.height, layout.centerY, params.liftPx * layout.dpr,
      frame.sweep, layout.coreSigma, layout.sigma * 0.42, extended ? frame.peakLinear : 0,
      params.magnifyPeak, params.plateFactor, params.bandGain, params.collarGain,
      layout.magnifyRadiusPx, 0, 0, 0,
      plate === undefined ? 0 : plate.x + plate.width / 2,
      plate === undefined ? 0 : plate.y + plate.height / 2,
      plate === undefined ? 0 : plate.width / 2,
      plate === undefined ? 0 : plate.height / 2,
      plate === undefined ? 0 : plate.rx, extended ? 1 : 0, 0, 0,
    ], 0)
    device.queue.writeBuffer(uniform, 0, uniforms)
  }

  const bind = (group: GpuBindGroup | undefined): GpuBindGroup => {
    if (group !== undefined) return group
    if (texture === undefined) throw new Error('brand-gold: no material uploaded')
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniform } },
      ],
    })
  }

  /** Encode one frame into `view`, optionally copying the target out afterwards. */
  const render = (
    frame: DrawFrame,
    view: unknown,
    copy?: { buffer: GpuBuffer; bytesPerRow: number; texture: GpuTexture },
  ): void => {
    if (texture === undefined) return
    const group = bind(bindGroup)
    writeUniforms(frame)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.draw(3)
    pass.end()
    if (copy !== undefined) {
      encoder.copyTextureToBuffer?.(
        { texture: copy.texture },
        { buffer: copy.buffer, bytesPerRow: copy.bytesPerRow },
        { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
      )
    }
    device.queue.submit([encoder.finish()])
  }

  return {
    device,
    get tone() {
      return effective.tone
    },
    get alpha() {
      return effective.alpha
    },
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
      render(frame, context.getCurrentTexture().createView())
    },
    async measure(frame) {
      const empty: ReadbackSummary = {
        peakEncoded: 0, peakLinearChannel: 0, peakLinearLuma: 0, peakCompositedLuma: 0, coveredPixels: 0,
      }
      if (disposed || texture === undefined) return empty
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
        const bytesPerRow = Math.ceil((width * 8) / 256) * 256
        buffer = device.createBuffer({
          size: bytesPerRow * height,
          usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ,
        })
        render(frame, target.createView(), { buffer, bytesPerRow, texture: target })
        await buffer.mapAsync?.(MAP_MODE_READ)
        const mapped = buffer.getMappedRange?.()
        if (mapped === undefined) {
          measureError = 'no mapped range'
          return empty
        }
        const summary = summariseReadback(new Uint16Array(mapped), bytesPerRow, width, height, true)
        buffer.unmap?.()
        measureError = 'w=' + width + 'x' + height
          + ' luma=' + Math.round(summary.peakLinearLuma * 1000) / 1000
          + ' covered=' + summary.coveredPixels
        return summary
      } catch (error) {
        measureError = String(error).slice(0, 140)
        return empty
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

/** Exported for the tests: the reference encode the shader implements. */
export { linearToSrgb, encodeSrgb }