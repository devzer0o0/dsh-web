# Brand-gold sweep: acceptance evidence (2026-11-04)

Evidence captured in the running desktop client (Electron 44.7 /
Chromium 152.0.7977.130, macOS 27.2, built-in Liquid Retina XDR), wide sidebar,
dark theme, native 24px lockup height.

| File | What it shows |
|---|---|
| `cycle-frames.png` | Six frames from one recorded cycle: rest, beam entering, whale lit, wordmark lit, HARNESS plate lit, fully restored |
| `cycle.mp4` | The 16s capture the frames were taken from (60 fps) |

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
