/**
 * Gold rendition of the sidebar whale mark.
 *
 * The original FishLogo path is kept verbatim; the material is layered inside
 * the silhouette:
 *
 * 1. a warm gold base ramp, key light from the upper left,
 * 2. a counter-light ramp from the lower right, so the metal has a second,
 *    dimmer transition instead of darkening in one direction only,
 * 3. a contact shadow on the shadow side,
 * 4. the softbox reflection: a narrow band with a champagne collar, painted
 *    after the shadow so the highlight is not buried under it,
 * 5. an inner rim that draws the bevel without growing the outline.
 *
 * Every layer is clipped to the original path, so counters and thin tail
 * strokes stay intact. The periodic sweep is not part of this SVG: the shared
 * controller draws it into a canvas above the lockup, deforming and lighting
 * only the pixels the beam covers. This SVG is the fallback and the layout
 * baseline; if the sweep cannot run, the gold material is simply static.
 *
 * @module dsh-brand-gold/GoldBrandMark
 */
import { useId } from 'react'
import { MARK_GEOMETRY, WHALE_HEIGHT, WHALE_PATH, WHALE_WIDTH } from './paths.ts'
import { useBrandSweep } from './useBrandSweep.ts'
import styles from './brand-gold.module.css'

/** Props handed down by the sidebar slot. */
export interface GoldBrandMarkProps {
  /** Rendered width in CSS pixels (the shell passes 24). */
  size?: number
  /** Optional class from the host. */
  className?: string
}

/**
 * Render the whale mark in polished gold.
 * @param props - slot-provided size and class.
 * @returns the gold whale SVG.
 */
export function GoldBrandMark({ size = 24, className }: GoldBrandMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (part: string) => `bg-mark-${uid}-${part}`
  const height = (size * WHALE_HEIGHT) / WHALE_WIDTH
  const viewBox = `0 0 ${WHALE_WIDTH} ${WHALE_HEIGHT}`
  const sweep = useBrandSweep('mark', MARK_GEOMETRY)

  return (
    <span
      ref={sweep.root}
      className={[styles.root, styles.mark, className].filter(Boolean).join(' ')}
      style={{ width: size, height }}
      data-dsh-plugin="brand-gold"
      data-dsh-part="mark"
    >
      <svg
        ref={sweep.svg}
        className={styles.svg}
        width={size}
        height={height}
        viewBox={viewBox}
        fill="none"
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Base: key light upper-left through warm gold into golden-brown. */}
          <linearGradient id={id('base')} x1="2" y1="0.6" x2="18" y2="17" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--bg-gold-0, #EFCB7C)" />
            <stop offset="0.12" stopColor="var(--bg-gold-1, #E6BC66)" />
            <stop offset="0.3" stopColor="var(--bg-gold-2, #DBAD4E)" />
            <stop offset="0.46" stopColor="var(--bg-gold-3, #D3A23C)" />
            <stop offset="0.62" stopColor="var(--bg-gold-4, #C08E2C)" />
            <stop offset="0.78" stopColor="var(--bg-gold-5, #A87728)" />
            <stop offset="0.9" stopColor="var(--bg-gold-6, #8B5D1C)" />
            <stop offset="1" stopColor="var(--bg-gold-7, #795019)" />
          </linearGradient>

          {/*
           * Counter-light: the bounce a polished solid returns on its shadow
           * side. Weak, and only near the lower-right edge, so the mark is lit
           * from two directions instead of being darkened along one axis.
           */}
          <linearGradient id={id('bounce')} x1="21" y1="16" x2="8" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFE8B0" stopOpacity="0.34" />
            <stop offset="0.35" stopColor="#F3CE80" stopOpacity="0.14" />
            <stop offset="0.62" stopColor="#F3CE80" stopOpacity="0" />
            <stop offset="1" stopColor="#F3CE80" stopOpacity="0" />
          </linearGradient>

          {/* Softbox reflection: one narrow band across the lit flank. */}
          <linearGradient id={id('spec')} x1="2" y1="10" x2="19" y2="3" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFDF4" stopOpacity="0" />
            <stop offset="0.3" stopColor="#FFFDF4" stopOpacity="0" />
            <stop offset="0.37" stopColor="#FFE9B8" stopOpacity="0.5" />
            <stop offset="0.44" stopColor="#FFF0C6" stopOpacity="0.88" />
            <stop offset="0.5" stopColor="#F1CE78" stopOpacity="0.4" />
            <stop offset="0.58" stopColor="#FAE8B1" stopOpacity="0" />
            <stop offset="1" stopColor="#FAE8B1" stopOpacity="0" />
          </linearGradient>

          {/*
           * Vertical falloff keeps the band on the lit flank. The stops stay high
           * across the upper two thirds so the band core keeps its full opacity
           * instead of being multiplied down to a faint wash by the mask.
           */}
          <linearGradient id={id('maskFade')} x1="0" y1="0" x2="0" y2={WHALE_HEIGHT} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.96" />
            <stop offset="0.82" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
          </linearGradient>

          {/* Inner bevel: hairline light on the upper edge, warm dark under it. */}
          <linearGradient id={id('rim')} x1="0" y1="0" x2="1" y2={WHALE_HEIGHT} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFF6DC" stopOpacity="0.9" />
            <stop offset="0.4" stopColor="#FAE8B1" stopOpacity="0.45" />
            <stop offset="0.75" stopColor="#795019" stopOpacity="0.45" />
            <stop offset="1" stopColor="#4A2F0C" stopOpacity="0.6" />
          </linearGradient>

          <mask id={id('mask')} maskUnits="userSpaceOnUse" x="0" y="0" width={WHALE_WIDTH} height={WHALE_HEIGHT}>
            <rect width={WHALE_WIDTH} height={WHALE_HEIGHT} fill={`url(#${id('maskFade')})`} />
          </mask>

          {/* Contact shadow on the shadow side, painted before the reflection. */}
          <linearGradient id={id('depth')} x1="3" y1="2" x2="22" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4A2F0C" stopOpacity="0" />
            <stop offset="0.58" stopColor="#4A2F0C" stopOpacity="0" />
            <stop offset="0.84" stopColor="#4A2F0C" stopOpacity="0.26" />
            <stop offset="1" stopColor="#3A2408" stopOpacity="0.5" />
          </linearGradient>

          <clipPath id={id('clip')}>
            <path d={WHALE_PATH} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${id('clip')})`}>
          <path d={WHALE_PATH} fill={`url(#${id('base')})`} />
          <path d={WHALE_PATH} fill={`url(#${id('bounce')})`} />
          <path d={WHALE_PATH} fill={`url(#${id('depth')})`} />
          <g className={styles.gloss} mask={`url(#${id('mask')})`}>
            <path d={WHALE_PATH} fill={`url(#${id('spec')})`} />
          </g>
          <path d={WHALE_PATH} fill="none" stroke={`url(#${id('rim')})`} strokeWidth="0.62" />
        </g>
      </svg>
    </span>
  )
}
