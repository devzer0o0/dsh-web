# Brand-gold sweep: acceptance evidence (2026-11-04)

Evidence captured in the running desktop client (Electron 44.7 /
Chromium 152.0.7977.130, macOS 27.2, built-in Liquid Retina XDR), wide sidebar,
dark theme, native 24px lockup height.

| File | What it shows |
|---|---|
| `cycle-frames.png` | Six frames from one recorded cycle: rest, beam entering, whale lit, wordmark lit, HARNESS plate lit, fully restored |
| `cycle.mp4` | The 16s capture the frames were taken from (60 fps) |

## Pooled beam: influence zone at 10x

`influenceSigmaRatio` 0.125 -> 1.25, so the sigma is wider than the lockup and
the light pools over the whole lockup at once instead of crossing it as a band.

`pooled-beam-10x.png` is the result after the fix below. Measured on the
400px-wide lockup: lit span up to 375 of 400 columns, cycle starts 4899-5057ms
apart, windows 1301-1405ms of the 1800ms sweep.

Widening the sigma by itself produced visible ghosting: the radial magnification
term scaled with the beam width, so at sigma 850px a pixel was pulled about 24px
along the radius and sampled a neighbouring stroke, doubling every letter. The
magnification is now bounded to a local radius (`SWEEP_PARAMS.magnifyRadiusPx`,
5 CSS px) in both the shader and `beam.ts`: the light can be arbitrarily wide,
but the optical pull stays local. The layout sigma is also no longer clamped by
the lockup height, which had been silently capping it.

## Dark theme, 1800ms beam

`dark-theme-1800ms.png` is the same widened beam after slowing the sweep from
1200ms to 1800ms, captured with the system in dark appearance so the shell
reports `data-ds-dark-theme` and the plugin uses its dark palette.

- Cycle starts 4932-5091ms apart (start-to-start period unchanged at 5000ms).
- Visible window 1218-1347ms of the 1800ms sweep.
- Lit region spans up to 134 of 340 columns.
- Peak response above the resting level: whale +37.3, wordmark +31.3,
  HARNESS plate +34.3 levels, in that order as the beam crosses.

## Beam width (after the fivefold widening)

`influenceSigmaRatio` is 0.125, so the soft influence zone is about 1/8 of the
lockup width per side. On the 340px lockup the lit region spans up to 117
columns at mid-sweep, covering several letters at once; the specular core stays
about 1-2 CSS px. `wider-beam-frames.png` shows the wider zone crossing the
whale and the first half of the wordmark.

## Measurements from the same capture

- Sweep starts at frames 97, 397 and 697 at 60 fps: period 5000 ms,
  start-to-start, three consecutive cycles.
- Visible window 60 frames: 1000 ms of drawn travel inside each period.
- Response above the resting level, 95th percentile of each region:
  whale +16.3, wordmark +4.7, HARNESS plate +7.7 (levels 0-255). The plate
  responds at roughly half the metal, as configured, and its lettering stays
  dark.
- Restoration: the pre-cycle and post-cycle frames differ by at most a few
  antialiasing samples, single channel at most 15/255.

## What this evidence does not show

Extended-range output on the panel. The shader-level readback is above 1.0, but
the host reported about 1.2x current display headroom and every ScreenCaptureKit
path available here clamped the framebuffer at 1.0, including a full-screen
white reference. See the package README for the split between shader-level and
display-level verification.
