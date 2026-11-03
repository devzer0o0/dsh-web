# dsh-brand-gold · polished-gold brand lockup for DeepSeek Harness

English | [中文](README.zh.md)

<p align="center">
  <strong>Gold rendition of the sidebar brand lockup with a periodic metal sweep</strong><br>
  <em>Original vectors · one shared beam timeline · local magnification and lift · extended-range highlight where the host keeps it</em>
</p>

A pure browser-half DSH Web GUI plugin: it fills the two sidebar brand slots the
shell declares (`sidebar.brand.mark` and `sidebar.brand.name`) with a
polished-gold rendition of the original DeepSeek Harness brand vectors, and runs
one diagonal beam across the whole lockup every 5 seconds.

## What it is

- The whale silhouette, every counter, the wordmark glyph outlines and the
  rounded HARNESS plate come from the shell's own vector data, copied verbatim
  into `src/client/paths.ts`. Nothing is redrawn, cropped from a screenshot or
  substituted with another font.
- Geometry is identical to the stock occupants: the same viewBoxes
  (`0 0 23.16 17.04` and `26 0 156 24`), the same 24px height and the same
  `width = height * aspect` rule, so the sidebar row never reflows.
- The SVG is the material and the fallback. It is never hidden, replaced or
  re-serialized from a hidden state, so any failure of the animated layer leaves
  exactly the static gold lockup on screen.
- Both occupants register at priority `-1`, one step below the official brand
  package, so the slot registry renders the gold rendition while the original
  registrations stay in place. Disabling this plugin hands the slots straight
  back with no reload.
- Theme aware: a dark-surface palette by default, and a one-step-deeper palette
  when the shell is in its light theme (`body:not([data-ds-dark-theme])`). The
  sweep re-reads the palette on a theme change instead of redrawing with the old
  one.

## The sweep

One beam, one timeline, one canvas, shared by both occupants.

| Dial | Value | Where |
|---|---|---|
| Period, start to start | 5000 ms | `SWEEP_PARAMS.periodMs` |
| Visible sweep | 1200 ms | `SWEEP_PARAMS.sweepMs` |
| Rest inside the period | 3800 ms | `periodMs - sweepMs` |
| First sweep after ready | 5000 ms | `SWEEP_PARAMS.firstDelayMs` |
| Direction | left to right only | `overlay.ts` (`startX` to `endX`) |
| Lean off vertical | 25 deg | `SWEEP_PARAMS.tiltDeg` |
| Influence width | about 5% of the lockup per side | `SWEEP_PARAMS.influenceSigmaRatio` |
| Highlight core | about 1-2 CSS px | `SWEEP_PARAMS.coreSigmaPx` |
| Local magnification | 1.08x peak | `SWEEP_PARAMS.magnifyPeak` |
| Local lift | 0.8 CSS px peak | `SWEEP_PARAMS.liftPx` |
| HARNESS plate response | 55% of the metal | `SWEEP_PARAMS.plateFactor` |

Every dial lives in `src/client/sweep.ts`; the geometry that consumes them lives
in `beam.ts` (plain arithmetic, unit-tested) and the shader mirrors it.

How the pieces fit:

1. `layout.ts` measures both occupants from their **rendered** boxes and maps
   each one's own viewBox into a single canvas coordinate system. The two
   viewBoxes are never treated as one space, and the beam crosses the gap
   between the icon and the wordmark instead of restarting at the wordmark.
2. `material.ts` composites the live lockup once per layout or theme change:
   each SVG is serialized with its computed paints inlined and drawn at its own
   transform, then uploaded as an `rgba8unorm-srgb` texture so the hardware does
   the sRGB decode.
3. `renderer.ts` samples that texture **through the inverse warp**. Magnification,
   lift, the highlight and the shading all come from the same beam weight, so the
   material, the outline and the edge alpha deform by one function. There is no
   second silhouette and no fixed outline mask, which is what removes sampling
   holes, double edges and cut strokes.
4. The canvas is fully transparent outside the beam. At rest the SVG underneath
   is the only lockup on screen, so nothing is ever drawn twice and the sweep
   returns to exactly the original shape, size, position and colour.
5. Frames run only inside the 1200 ms window. The rest of the period holds one
   timer; a sweep missed while the page or the lockup was hidden is skipped, not
   replayed, and a second trigger cannot stack a second loop.

`prefers-reduced-motion: reduce` skips registration entirely: no displacement,
no magnification, no periodic flash, just the static polished gold.

## Colour pipeline

The three spaces are kept apart, and each step says which one it is in:

| Step | Space | Where |
|---|---|---|
| CSS paints and the SVG raster | sRGB-encoded | `raster.ts`, `material.ts` |
| Texture decode | done in hardware by `rgba8unorm-srgb` | `renderer.ts` |
| Lighting, magnification, highlight | linear light | shader in `renderer.ts` |
| Output | extended sRGB encode | `encode()` in the shader, `linearToSrgb()` in `color.ts` |
| Alpha | straight, premultiplied at the final write | shader |

The encode continues linearly above 1.0, so an extended value reaches the
framebuffer instead of being clamped by the transfer function. `HDR_PEAK` is a
linear multiplier on the highlight term, never a claim about nits.

## Extended range: what is measured and what is not

The honest split, because an earlier revision of this file mixed the two.

**Shipped and verified in the running desktop client** (Electron 44.7 /
Chromium 152.0.7977.130, macOS 27.2, built-in Liquid Retina XDR):

- The sweep animates: three consecutive cycles measured from screen capture at
  60 fps show starts 5000 ms apart and a 1.0 s visible window each.
- The beam crosses the whale, then the wordmark, then the HARNESS plate; the
  plate lights at roughly half the amplitude of the letters and its lettering
  stays dark and crisp.
- The resting lockup is restored: frames taken before and after a cycle differ
  by at most a few antialiasing samples, at most 15/255 on a single channel.
- No frame loop runs during the rest: the shader is only submitted inside the
  window.
- Nothing paints a rectangle: uncovered pixels are transparent, and the counters,
  the whale cut-outs, the background and the gaps between the marks stay dark.

**Implemented, and verified only at the shader level:**

- The canvas is `rgba16float` with `toneMapping: { mode: 'extended' }` and an
  explicit `colorSpace: 'srgb'`. When the sweep runs, one frame is replayed into
  an offscreen `rgba16float` target and copied back through a mapped buffer. The
  peak decoded linear value in that readback is above 1.0, which proves the
  extended encode produced extended values in the shader's own output.
- The canvas and that readback are reported separately from the display: the
  controller publishes `drawing` when frames are submitted and `verified` only
  when the readback is above 1.02.

**Not verified: that the extra range reaches the panel.**

- On the reference host the display reports a *current* extended-range headroom
  of about 1.2x while the built-in XDR panel advertises 16x potential. Every
  ScreenCaptureKit path available to a local process (screenshot and stream,
  sRGB/bgra10/half-float pixel formats, `captureDynamicRange` set to each value)
  returned a framebuffer clamped at 1.0, including for a full-screen white
  reference. Without a capture path that preserves values above 1.0, the display
  claim cannot be measured here, and it is therefore not claimed.
- The over-unity output is real in the shader and in the storage format; whether
  the compositor and the panel show it depends on the headroom the system grants
  at that moment, which this plugin neither controls nor can report.

This is why the highlight is tuned to read as a metal reflection first: on an
SDR surface the same shader runs with the extended term at zero and applies a
soft shoulder, so the lit metal brightens without clipping into a white block.

## Verification

```sh
cd packages/dsh-brand-gold
pnpm test        # 31 unit tests: sweep timing, beam geometry, colour, layout, lifecycle
../../node_modules/.bin/tsdown
```

The unit tests cover the properties that are easy to break silently: the period
is start-to-start, the warp is invertible (no sampling hole, no double edge), the
extended encode keeps values above 1, the layout refuses to build when the lockup
collapsed, and dispose releases its own listeners once even when called twice.

## Install

### Local checkout

```sh
cd packages/dsh-brand-gold && ../../node_modules/.bin/tsdown
```

Then link the package into the desktop profile and add its plugin row
(`~/.dsh/profiles/desktop/package.json` bundles plus the profile
`cordis.patch.yml`). The row the package ships is:

```yaml
- insert:
    - id: ui-brand-gold
      name: '@linxin666/dsh-client-ui-brand-gold'
```

### From npm

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-brand-gold@latest
```

## Diagnostics

Off by default. Enable it with `?dshBrandGoldDiag=1` on the GUI URL or
`localStorage.setItem('dsh-brand-gold:diag', '1')`, then read
`window.__DSH_BRAND_GOLD__.state` and `.records()`. The state reports the
lifecycle phase (`anchor-missing`, `anchor-hidden`, `zero-size`,
`capability-missing`, `gpu-init-failed`, `material-failed`,
`composite-failed`, `drawing`, `verified`) separately from the GPU capability
verdict, and the buffer is a bounded ring. The window title is never touched and
no network probe is issued.

## License

Apache-2.0
