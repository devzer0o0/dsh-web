# dsh-brand-gold · polished-gold brand lockup for DeepSeek Harness

English | [中文](README.zh.md)

<p align="center">
  <strong>Gold rendition of the sidebar brand lockup: whale mark, deepseek wordmark and HARNESS plate</strong><br>
  <em>Original vectors · layered metal material · SDR-safe highlights · static by default</em>
</p>

A pure browser-half DSH Web GUI plugin: it fills the two sidebar brand slots the
shell declares (`sidebar.brand.mark` and `sidebar.brand.name`) with a polished-gold
rendition of the original DeepSeek Harness brand vectors. No DSH source is
modified and the host half has no behavior.

## What it is

- The whale silhouette, every counter, the wordmark glyph outlines and the
  rounded HARNESS plate come from the shell's own vector data, copied verbatim
  into `src/client/paths.ts`. Nothing is redrawn, cropped from a screenshot or
  substituted with another font.
- Geometry is identical to the stock occupants: the same viewBoxes
  (`0 0 23.16 17.04` and `26 0 156 24`), the same 24px height and the same
  `width = height * aspect` rule, so the sidebar row never reflows.
- Material is layered inside the silhouettes: a warm gold base gradient (key
  light upper left, deep golden-brown shadow lower right), one narrow softbox
  specular band shared across the whole lockup, a thin bevel rim and a very
  light contact shadow. Every layer is clipped to the original path.
- The HARNESS plate keeps its rounded rectangle and its dark lettering: the
  letters are punched over the plate, never filled with the same gold.
- Both occupants register at priority `-1`, one step below the official brand
  package, so the slot registry renders the gold rendition while the original
  registrations stay in place. Disabling this plugin hands the slots straight
  back with no reload.
- Theme aware: a dark-surface palette by default, and a one-step-deeper palette
  when the shell is in its light theme (`body:not([data-ds-dark-theme])`), so the
  same gold reads as metal on white instead of washing out.
- `prefers-reduced-motion` is honored; the only motion is an optional hover
  sheen on the specular layer that never changes size or layout.

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

## Material tunables

All of it lives in two places, and both are deliberately coarse:

| Layer | Where | What it controls |
|---|---|---|
| Palette | `src/client/brand-gold.module.css` | `--bg-gold-0…7` (mark and letters), `--bg-gold-plate-0…5` (plate), `--bg-gold-ink` (lettering), plus the light-theme overrides |
| Reflection geometry | `GoldBrandMark.tsx` / `GoldBrandName.tsx` | Base gradient axis, counter-light, softbox band position and width, hover band, bevel rim, depth ramp |

The stack is base, counter-light, contact shadow, softbox reflection, hover
reflection, bevel rim, in that order. Two details matter more than the palette:

- The contact shadow is painted **before** the reflection. Painting it after
  buries the highlight under the shadow side, which is what made the first
  iteration look matte.
- The reflection is a full-opacity core. At `0.92` opacity under a vertical
  falloff mask the effective coverage is about `0.56`, so the band reads as a
  wash instead of a reflection; the core now stays at `1` and the mask keeps at
  least `0.94` across the lit half.

Hovering the row moves the reflection band across the metal and cross-fades to a
second, white band of the same geometry, so the specular ceiling rises instead of
re-showing the highlight that is already there. `prefers-reduced-motion` keeps
the brighter band but drops the travel.

## What is verified and what is not

Verified in the running desktop client at the native 24px height (wide sidebar),
in the narrow and collapsed sidebar states, and in a headless-Chrome render of
the exact component output at 1x and 4x on both the dark and the light theme.

Not delivered: real HDR output. It was built, measured and rejected, and the
measurements are the reason the lockup stays SDR:

| Path | Measured result on the reference host |
|---|---|
| Display headroom | Built-in XDR panel, `maximumPotentialExtendedDynamicRangeColorComponentValue` 16, current headroom about 6.3, and `(dynamic-range: high)` matches in the renderer |
| CSS `color(srgb 4 4 4)` / `color(rec2100-pq …)`, with and without `dynamic-range-limit: no-limit` | Never above 1.0 in the framebuffer — the compositor clamps it |
| Opaque WebGPU canvas, `rgba16float`, `toneMapping: 'extended'` | Reads back 4.0 when it is a direct child of `document.body`; 0.98 — clamped to SDR — when the same canvas lives inside the sidebar subtree |
| Same canvas masked or clipped in CSS, or blended on the body only | Masking and `clip-path` clamp it; `mix-blend-mode: plus-lighter` on the body only keeps the over-unity values |

So over-unity pixels are reachable in this renderer, but not at the lockup's
place in the tree: the sidebar subtree clamps them. Rendering the highlight on a
body-level overlay was tried and abandons either the clipping to the brand shape
or the composition with the sidebar's own stacking context, and a layer that can
only be bright where the logo is not is not an HDR logo. Shipping the SDR
material — crisp, layered, correct on every display — was the honest outcome.

If a future host lets a canvas inside the sidebar keep extended range, the hook
point is a single extra reflection layer over the SVG; nothing in the geometry
or the palette would have to move.

## License

Apache-2.0
