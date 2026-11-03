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
| Reflection geometry | `GoldBrandMark.tsx` / `GoldBrandName.tsx` | Base gradient axis, softbox band position and width, bevel rim, depth ramp |

Raising a highlight means brightening one stop of the specular gradient, not
adding another band: the reflection structure is intentionally three layers, so
the lockup does not turn into stripes at 24px.

## What is verified and what is not

Verified in the running desktop client at the native 24px height (wide sidebar),
in the narrow and collapsed sidebar states, and in a headless-Chrome render of
the exact component output at 1x and 4x on both the dark and the light theme.

Not claimed: real HDR output. The highlights are ordinary SDR color stops inside
the SVG, tuned to read as metal on a normal display. No HDR color space, no
Display P3 declaration and no brightness filter are involved; on an HDR-capable
panel the browser tone-maps these same SDR values.

## License

Apache-2.0
