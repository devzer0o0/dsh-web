/**
 * Gold rendition of the sidebar whale mark.
 *
 * The original FishLogo path is kept verbatim; the material is layered inside
 * the silhouette: a warm gold base gradient (key light from the upper left), a
 * narrow softbox specular band restricted to the lit flank, and an inner rim
 * that draws the bevel without growing the outline. Every layer is clipped to
 * the original path, so counters and thin tail strokes stay intact.
 */
import { useId } from 'react'
import { WHALE_HEIGHT, WHALE_PATH, WHALE_WIDTH } from './paths.ts'
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

  return (
    <svg
      className={[styles.root, styles.mark, className].filter(Boolean).join(' ')}
      width={size}
      height={(size * WHALE_HEIGHT) / WHALE_WIDTH}
      viewBox={`0 0 ${WHALE_WIDTH} ${WHALE_HEIGHT}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-dsh-plugin="brand-gold"
      data-dsh-part="mark"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Base: key light upper-left, warm mid gold, deep golden-brown shadow. */}
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

        {/* Softbox reflection: one narrow band crossing the mark, not a per-path sweep. */}
        <linearGradient id={id('spec')} x1="2" y1="10" x2="19" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF9E8" stopOpacity="0" />
          <stop offset="0.33" stopColor="#FFF9E8" stopOpacity="0" />
          <stop offset="0.385" stopColor="#FFEFC2" stopOpacity="0.4" />
          <stop offset="0.42" stopColor="#FFF9E8" stopOpacity="0.92" />
          <stop offset="0.452" stopColor="#F1CE75" stopOpacity="0.22" />
          <stop offset="0.52" stopColor="#FAE8B1" stopOpacity="0" />
          <stop offset="1" stopColor="#FAE8B1" stopOpacity="0" />
        </linearGradient>

        {/* Vertical falloff so the band only sits on the lit flank. */}
        <linearGradient id={id('maskFade')} x1="0" y1="0" x2="0" y2={WHALE_HEIGHT} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.8" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        {/* Inner bevel: hairline light on the upper edge, warm dark under it. */}
        <linearGradient id={id('rim')} x1="0" y1="0" x2="1" y2={WHALE_HEIGHT} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF6DC" stopOpacity="0.85" />
          <stop offset="0.4" stopColor="#FAE8B1" stopOpacity="0.4" />
          <stop offset="0.75" stopColor="#795019" stopOpacity="0.45" />
          <stop offset="1" stopColor="#4A2F0C" stopOpacity="0.6" />
        </linearGradient>

        <mask id={id('mask')} maskUnits="userSpaceOnUse" x="0" y="0" width={WHALE_WIDTH} height={WHALE_HEIGHT}>
          <rect width={WHALE_WIDTH} height={WHALE_HEIGHT} fill={`url(#${id('maskFade')})`} />
        </mask>

        {/* Contact shadow inside the silhouette: lower-right depth without growing the shape. */}
        <linearGradient id={id('depth')} x1="3" y1="2" x2="22" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4A2F0C" stopOpacity="0" />
          <stop offset="0.55" stopColor="#4A2F0C" stopOpacity="0" />
          <stop offset="0.82" stopColor="#4A2F0C" stopOpacity="0.3" />
          <stop offset="1" stopColor="#3A2408" stopOpacity="0.55" />
        </linearGradient>

        <clipPath id={id('clip')}>
          <path d={WHALE_PATH} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id('clip')})`}>
        <path d={WHALE_PATH} fill={`url(#${id('base')})`} />
        <path className={styles.gloss} d={WHALE_PATH} fill={`url(#${id('spec')})`} mask={`url(#${id('mask')})`} />
        <path d={WHALE_PATH} fill={`url(#${id('depth')})`} />
        <path d={WHALE_PATH} fill="none" stroke={`url(#${id('rim')})`} strokeWidth="0.62" />
      </g>
    </svg>
  )
}
