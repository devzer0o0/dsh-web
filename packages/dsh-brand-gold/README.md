# dsh-brand-gold · polished-gold brand lockup for DeepSeek Harness

English | [中文](README.zh.md)

<p align="center">
  <strong>Gold rendition of the sidebar brand lockup with a periodic metal sweep</strong><br>
  <em>Original vectors · one shared beam timeline · wide gold band with a short champagne core · local magnification and lift</em>
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
| Visible window | 2700 ms | `SWEEP_PARAMS.sweepMs` |
| Rest inside the period | 2300 ms | `periodMs - sweepMs` |
| First sweep after the material is ready | 5000 ms | `SWEEP_PARAMS.firstDelayMs` |
| Stage A, entry | 250 ms | `SWEEP_PARAMS.entryMs` |
| Stage B, over the metal | 2200 ms | `SWEEP_PARAMS.surfaceMs` |
| Stage C, exit | 250 ms | `SWEEP_PARAMS.exitMs` |
| Direction | left to right only | `trajectory.ts` (`centerStart` to `centerEnd`) |
| Lean off vertical | 25 deg | `SWEEP_PARAMS.tiltDeg` |
| Wide gold band, FWHM | 0.55 x lockup width | `SWEEP_PARAMS.mainBandFwhmRatio` |
| Champagne core, FWHM | clamp(0.10 x W, 12, 24) CSS px | `SWEEP_PARAMS.coreFwhmRatio`, `coreFwhmMinPx`, `coreFwhmMaxPx` |
| Finite band support | 3 sigma, windowed to zero | `SWEEP_PARAMS.supportSigmas`, `beam.ts` |
| Entry and exit travel | one full support radius past the outer metal | `layout.ts` (`centerStart`, `centerEnd`) |
| Metal eligibility | geometric mask, never brightness | `geometry-mask.ts`, `surface.ts` |
| Band albedo floor | 0.22 linear | `SWEEP_PARAMS.bandAlbedoFloor` |
| Local magnification | 1.08x peak, 5 CSS px radius | `SWEEP_PARAMS.magnifyPeak`, `magnifyRadiusPx` |
| Local lift | 0.8 CSS px peak | `SWEEP_PARAMS.liftPx` |
| HARNESS plate response | 55% of the metal | `SWEEP_PARAMS.plateFactor` |
| Requested core peak | 1600 nits short-time | `SWEEP_PARAMS.peakNits` |

Every dial lives in `src/client/sweep.ts`; the geometry that consumes them lives
in `beam.ts` and `light.ts` (plain arithmetic, unit-tested) and the shader
mirrors them term for term.

**Widths are visible FWHM values, in CSS pixels, on a horizontal cross-section.**
With a tilt, the beam coordinate `u = (x - cx) + (y - cy) * tan(tilt)` advances
one CSS pixel per horizontal pixel on any fixed row, so the FWHM in `u` and the
FWHM an observer measures across the lockup are the same number. Sigma is never
written down as a dial: `beam.ts` derives `sigma = FWHM / (2 * sqrt(ln 2))` and the
tests measure the delivered profile instead of checking the input.

Measured on the shipped 188 x 24 CSS px lockup at DPR 2:

| Quantity | Value |
|---|---|
| Canvas | 392 x 64 device px |
| Wide band FWHM | 103.4 CSS px |
| Core FWHM | 18.8 CSS px |
| Band support radius | 186.3 CSS px |
| Metal extent along the beam | 3.3 .. 194.1 CSS px |
| Centre travel | -187.0 .. 384.4 CSS px |
| Centre crossing the metal | 2200 ms (stage B) |
| Centre speed over the metal | about 87 CSS px/s |
| Envelope | opens over 250 ms, full from the first surface to the last, closes after the tail leaves |

How the pieces fit:

1. `layout.ts` measures both occupants from their **rendered** boxes and maps
   each one's own viewBox into a single canvas coordinate system. The two
   viewBoxes are never treated as one space, and the beam crosses the gap
   between the icon and the wordmark instead of restarting at the wordmark.
   Travel is computed from the **whole band**: the beam coordinate
   `q = x + (y - centerY) * tan(tilt)` is measured over every metal vertex, the
   support radius `R` comes from the band's sigma, and the centre runs from
   `qMin - R - padding` to `qMax + R + padding`. The first surface is therefore
   a full band away from the entry point and the last one a full band away from
   the exit point, and the canvas itself only covers the lockup.
2. `material.ts` composites the live lockup once per layout or theme change:
   each SVG is serialized with its computed paints inlined and drawn at its own
   transform, then uploaded as an `rgba8unorm-srgb` texture so the hardware does
   the sRGB decode.
3. `geometry-mask.ts` rasterizes a mask from the **original vectors**: the
   whale's fill, every wordmark stroke, the HARNESS plate, with the plate
   lettering and every counter punched out. It is `rgba8unorm` coverage data,
   never an sRGB image, built by a scanline pass with four subsamples per pixel,
   so it costs a couple of milliseconds at DPR 3. A pixel is metal because of
   the geometry it belongs to; its brightness only decides how much light it
   returns. The band is multiplied by a linear albedo floor, so the darkest gold
   and the plate still show a reflection instead of a dimmer copy of a beam that
   skipped them.
4. `renderer.ts` samples that texture **through the inverse warp**. A source
   pixel `d` off the axis lands `d * scale` off it, so features near the centre
   are genuinely spread apart; the displacement is bounded to
   `magnifyRadiusPx`, so a wide band cannot pull distant material in. The GPU and
   `beam.ts` agree to within one device pixel on the same material.
5. The canvas is fully transparent outside the beam. At rest the SVG underneath
   is the only lockup on screen, so nothing is ever drawn twice and the sweep
   returns to exactly the original shape, size, position and colour.
6. Frames run only inside the 2700 ms window. The rest of the period holds one
   timer; a sweep missed while the page or the lockup was hidden is skipped, not
   replayed, and a second trigger cannot stack a second loop. A pending timer is
   never cleared and re-armed while the grid is unchanged, and a reposition
   moves the overlay without re-uploading the material, so scrolling or
   resizing during a session cannot delay the next start.
7. The first sweep is armed when the material **and the mask** have been
   uploaded, one delay out, so the first cycle never runs against an empty
   canvas. Ordinary rebuilds keep that grid: only a first initialisation, a
   resume from a hidden tab and a GPU reset establish a new origin.

`prefers-reduced-motion: reduce` is re-read on every rebuild and on every change
event: no displacement, no magnification, no periodic highlight, just the static
polished gold, switched on or off without a reload.

## Colour pipeline

The spaces are kept apart, and each step says which one it is in:

| Step | Space | Where |
|---|---|---|
| CSS paints and the SVG raster | sRGB-encoded | `raster.ts`, `material.ts` |
| Texture decode | done in hardware by `rgba8unorm-srgb` | `renderer.ts` |
| Lighting, magnification, highlight | linear light | shader in `renderer.ts`, mirrored by `light.ts` |
| Output | sRGB encode, continued above 1.0 by the same branch | `encode()` in the shader, `linearToSrgb()` in `color.ts` |
| Alpha | straight, premultiplied at the final write | shader |

`linearToSrgb` runs `1.055 * v^(1/2.4) - 0.055` on both sides of white, so a
linear 4.0 encodes to about 1.82 rather than passing through as 4.0. The
decode is its exact inverse, which is what lets a readback be reported as linear
light instead of as an encoded channel pretending to be one.

## Brightness: the 1600 nit target

The peak is a **requested linear luminance**, not a gain added to other gains:

```
requestedPeakLinear = peakNits / sdrReferenceWhiteNits
```

with `peakNits = 1600` (the user-reported short-time peak of their panel) and the
reference white either measured or assumed. The core spends only the budget left
under that ceiling — `max(ceiling - lit, 0)` — so the band, the collar and the
core cannot add up past the target, and the composite peak is the target by
construction. Every tint is normalised by its own luminance first, so "1200 in
the red channel" can never stand in for "1200 nits".

**What is known on the current host, and what is not:**

| Quantity | Value | Provenance |
|---|---|---|
| Screen peak capability | 1600 nits | reported by the user |
| SDR reference white | 203 nits | **assumed**, the macOS default; not measured here |
| `requestedPeakLinear` | 7.88 | derived from the two rows above |
| Available headroom | unknown | no API exposes it to this plugin |
| Measured screen luminance | not measured | see below |

The assumed reference white is a dial (`SWEEP_PARAMS.sdrWhiteNits` takes a
measured value; `assumedSdrWhiteNits` is the fallback) and the diagnostic records
which one was used, so a measurement can be plugged in without touching the
shader. **Nothing here claims a measured 1600 nits**: the plugin reports the
requested relative luminance and says the absolute reading is outstanding.

## Extended range: what is measured and what is not

Three levels, kept apart on purpose.

**1. Extended values exist in the render target — measured.**

On a real GPU (Chromium 156, stub-free harness driving the shipped
`createRenderer`), a mid-sweep frame over the gold material reads back:

| Mode | Effective config | Peak encoded | Peak linear luma | Target |
|---|---|---|---|---|
| Extended | `premultiplied` + `extended`, `rgba16float`, `srgb` | 2.50 | 7.869 | 7.882 |
| SDR | `premultiplied` + `standard` | 0.997 | 0.882 | n/a |

The extended row is a correct linear value above 1.0 in the shader's own output;
the SDR row shows the same shader with the ceiling removed, so the difference is
the tone-mapping mode and not a different code path.

**2. The compositing path can present extended range — measured in the host.**

In the running desktop client the canvas reports back
`toneMapping: { mode: 'extended' }`, `alphaMode: 'premultiplied'`,
`format: 'rgba16float'`, `colorSpace: 'srgb'` through
`getConfiguration()`, and the controller publishes
`displayVerified: true` from a coverage-weighted readback of 7.876 linear
(≈1599 nits against the 203 nit assumption). Note that
`(dynamic-range: high)` still reads `false` on this host: the media query is a
display hint, and the canvas contract is what decides.

**3. The panel actually emitting 1600 nits — not measured.**

- No local capture path preserves values above 1.0, so a screenshot cannot be
  used as evidence; an SDR screenshot clamps at 255 and proves nothing about
  nits.
- The plugin exposes `displayVerified` (the compositor kept extended values) but
  never reports it as a physical measurement.
- A physical reading needs a calibrated meter aimed at the core while it fires,
  with the reference white and the measurement geometry recorded. That has not
  been done here.

On a surface that keeps standard tone mapping, the same shader runs with the
extended ceiling at zero and applies a soft shoulder, so the lit metal brightens
without clipping into a white block — the wide band and the slow crossing are
unchanged.

## Verification

```sh
cd packages/dsh-brand-gold
pnpm test        # 69 unit tests: sweep timing, beam geometry, light distribution,
                 # colour encode/decode, layout, renderer wiring, lifecycle
../../node_modules/.bin/tsdown
```

The tests target the properties that are easy to break silently: the delivered
band FWHM (not the input dial), the core FWHM, the composite peak against the
requested ceiling, gold kept in the band, the plate at 55%, the warp displacing
outward and inverting, the extended encode/decode round trip above 1, the layout
refusing to build when the lockup collapsed, the travel not growing with the
band, and the renderer handing the shader the values that were resolved.

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
`window.__DSH_BRAND_GOLD__.state` and `.records()`.

The state reports the lifecycle phase (`anchor-missing`, `anchor-hidden`,
`zero-size`, `capability-missing`, `gpu-init-failed`, `material-failed`,
`composite-failed`, `drawing`, `verified`) separately from the GPU capability
verdict, and adds:

- `mode` / `effectiveMode`: requested versus `getConfiguration()` readback,
  alpha and tone mapping spelled out separately;
- `requestedPeakLinear`, `peakLinear`, `peakComposited`, `measuredNits`;
- `displayVerified`: whether the compositor kept extended values;
- `calibration`: reference-white and headroom provenance (`assumed/headroom:unknown`);
- `beam` records inside the ring: sampled beam position and envelope, about ten
  a second, which is how the crossing time and speed above were measured.

The GPU readback allocates a texture and a mapped buffer, so it runs only when
diagnostics are enabled — never once per cycle on every user's machine.

## License

Apache-2.0