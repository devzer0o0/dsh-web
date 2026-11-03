/**
 * Gold rendition of the sidebar wordmark: the deepseek glyphs plus the HARNESS
 * plate, both drawn from the original vector data.
 *
 * One continuous reflection spans the whole lockup (user-space gradients over
 * the shared viewBox), so the letters read as a single machined plate instead
 * of each glyph carrying its own copy of the gradient. The plate keeps its
 * rounded rectangle and its dark lettering; its sheen stays weaker than the
 * wordmark so the name remains the focal point.
 */
import { useId } from 'react'
import { BADGE_RECT, BADGE_TEXT_PATHS, NAME_VIEWBOX, WORDMARK_PATHS } from './paths.ts'
import styles from './brand-gold.module.css'

/** Props handed down by the sidebar slot. */
export interface GoldBrandNameProps {
  /** Rendered height in CSS pixels (the shell's wordmark uses 24). */
  size?: number
  /** Optional class from the host. */
  className?: string
}

const [VB_X, VB_Y, VB_W, VB_H] = NAME_VIEWBOX.split(' ').map(Number)

/**
 * Render the wordmark and the HARNESS plate in polished gold.
 * @param props - slot-provided size and class.
 * @returns the gold wordmark SVG.
 */
export function GoldBrandName({ size = 24, className }: GoldBrandNameProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (part: string) => `bg-name-${uid}-${part}`
  const badgeBottom = BADGE_RECT.y + BADGE_RECT.height

  return (
    <svg
      className={[styles.root, styles.name, className].filter(Boolean).join(' ')}
      width={(size * VB_W) / VB_H}
      height={size}
      viewBox={NAME_VIEWBOX}
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-dsh-plugin="brand-gold"
      data-dsh-part="name"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* One reflection across the full lockup: left/top lit, right/bottom deep. */}
        <linearGradient id={id('base')} x1={VB_X} y1="1" x2={VB_X + 96} y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--bg-gold-0, #EFCB7C)" />
          <stop offset="0.1" stopColor="var(--bg-gold-1, #E6BC66)" />
          <stop offset="0.28" stopColor="var(--bg-gold-2, #DBAD4E)" />
          <stop offset="0.46" stopColor="var(--bg-gold-3, #D3A23C)" />
          <stop offset="0.62" stopColor="var(--bg-gold-4, #C08E2C)" />
          <stop offset="0.78" stopColor="var(--bg-gold-5, #A87728)" />
          <stop offset="0.9" stopColor="var(--bg-gold-6, #8B5D1C)" />
          <stop offset="1" stopColor="var(--bg-gold-7, #795019)" />
        </linearGradient>

        {/* Narrow softbox band: a slim, near-white core with a champagne collar. */}
        <linearGradient id={id('spec')} x1={VB_X} y1="12" x2={VB_X + 156} y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF9E8" stopOpacity="0" />
          <stop offset="0.3" stopColor="#FFF9E8" stopOpacity="0" />
          <stop offset="0.38" stopColor="#FFEFC2" stopOpacity="0.4" />
          <stop offset="0.42" stopColor="#FFF9E8" stopOpacity="0.92" />
          <stop offset="0.45" stopColor="#FAE8B1" stopOpacity="0.5" />
          <stop offset="0.56" stopColor="#FAE8B1" stopOpacity="0" />
          <stop offset="1" stopColor="#FAE8B1" stopOpacity="0" />
        </linearGradient>

        {/* Keep the band on the upper half of the strokes. */}
        <linearGradient id={id('maskFade')} x1="0" y1="1" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="0.85" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        {/* Bevel: hairline light on the top edge, warm shadow along the bottom. */}
        <linearGradient id={id('rim')} x1="0" y1="2" x2="0" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF6DC" stopOpacity="0.8" />
          <stop offset="0.35" stopColor="#FAE8B1" stopOpacity="0.35" />
          <stop offset="0.72" stopColor="#795019" stopOpacity="0.4" />
          <stop offset="1" stopColor="#4A2F0C" stopOpacity="0.55" />
        </linearGradient>

        {/* Plate: satin gold, softer than the letters, still clearly metal. */}
        <linearGradient id={id('plate')} x1={BADGE_RECT.x} y1={BADGE_RECT.y} x2={BADGE_RECT.x + 8} y2={badgeBottom} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--bg-gold-plate-0, #F6E3B2)" />
          <stop offset="0.18" stopColor="var(--bg-gold-plate-1, #EBD08C)" />
          <stop offset="0.42" stopColor="var(--bg-gold-plate-2, #DDBA63)" />
          <stop offset="0.66" stopColor="var(--bg-gold-plate-3, #CBA043)" />
          <stop offset="0.86" stopColor="var(--bg-gold-plate-4, #B07F2C)" />
          <stop offset="1" stopColor="var(--bg-gold-plate-5, #8E6120)" />
        </linearGradient>

        {/* Plate sheen: weaker than the wordmark, one soft band near the top. */}
        <linearGradient id={id('plateSheen')} x1={BADGE_RECT.x} y1={BADGE_RECT.y + 1.5} x2={BADGE_RECT.x} y2={badgeBottom} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF7DF" stopOpacity="0.85" />
          <stop offset="0.32" stopColor="#FAE8B1" stopOpacity="0.25" />
          <stop offset="0.6" stopColor="#FAE8B1" stopOpacity="0" />
          <stop offset="1" stopColor="#795019" stopOpacity="0.22" />
        </linearGradient>

        <mask id={id('mask')} maskUnits="userSpaceOnUse" x={VB_X} y="0" width={VB_W} height={VB_H}>
          <rect x={VB_X} y="0" width={VB_W} height={VB_H} fill={`url(#${id('maskFade')})`} />
        </mask>

        {/* Directional depth on the lower-right of the strokes. */}
        <linearGradient id={id('depth')} x1={VB_X} y1="1" x2={VB_X + 110} y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4A2F0C" stopOpacity="0" />
          <stop offset="0.6" stopColor="#4A2F0C" stopOpacity="0" />
          <stop offset="0.85" stopColor="#4A2F0C" stopOpacity="0.26" />
          <stop offset="1" stopColor="#3A2408" stopOpacity="0.5" />
        </linearGradient>

        <clipPath id={id('letters')}>
          {WORDMARK_PATHS.map((d, index) => (
            <path key={index} d={d} />
          ))}
        </clipPath>

        <clipPath id={id('plateClip')}>
          <rect x={BADGE_RECT.x} y={BADGE_RECT.y} width={BADGE_RECT.width} height={BADGE_RECT.height} rx={BADGE_RECT.rx} />
        </clipPath>

        {/* Original plate inset: the lettering is punched 3.5 units in from the edge. */}
        <clipPath id={id('badgeText')}>
          <rect x={BADGE_RECT.x + 3.5} y={BADGE_RECT.y} width={BADGE_RECT.width - 6} height={BADGE_RECT.height} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id('letters')})`}>
        {WORDMARK_PATHS.map((d, index) => (
          <path key={`base-${index}`} d={d} fill={`url(#${id('base')})`} />
        ))}
        <g className={styles.gloss} mask={`url(#${id('mask')})`}>
          {WORDMARK_PATHS.map((d, index) => (
            <path key={`spec-${index}`} d={d} fill={`url(#${id('spec')})`} />
          ))}
        </g>
        {WORDMARK_PATHS.map((d, index) => (
          <path key={`depth-${index}`} d={d} fill={`url(#${id('depth')})`} />
        ))}
        {WORDMARK_PATHS.map((d, index) => (
          <path key={`rim-${index}`} d={d} fill="none" stroke={`url(#${id('rim')})`} strokeWidth="0.5" />
        ))}
      </g>

      {/* HARNESS plate: rounded rectangle kept exactly, dark lettering preserved. */}
      <g clipPath={`url(#${id('plateClip')})`}>
        <rect x={BADGE_RECT.x} y={BADGE_RECT.y} width={BADGE_RECT.width} height={BADGE_RECT.height} rx={BADGE_RECT.rx} fill={`url(#${id('plate')})`} />
        <rect x={BADGE_RECT.x} y={BADGE_RECT.y} width={BADGE_RECT.width} height={BADGE_RECT.height} rx={BADGE_RECT.rx} fill={`url(#${id('plateSheen')})`} />
        <rect
          x={BADGE_RECT.x + 0.35}
          y={BADGE_RECT.y + 0.35}
          width={BADGE_RECT.width - 0.7}
          height={BADGE_RECT.height - 0.7}
          rx={Math.max(BADGE_RECT.rx - 0.35, 0)}
          fill="none"
          stroke="#FFF3D2"
          strokeOpacity="0.55"
          strokeWidth="0.5"
        />
        <rect
          x={BADGE_RECT.x + 0.4}
          y={badgeBottom - 0.9}
          width={BADGE_RECT.width - 0.8}
          height="0.6"
          rx="0.3"
          fill="#5E3D11"
          fillOpacity="0.35"
        />
      </g>

      <g clipPath={`url(#${id('badgeText')})`}>
        {BADGE_TEXT_PATHS.map((d, index) => (
          <path key={`text-${index}`} d={d} fill="var(--bg-gold-ink, #2E2008)" />
        ))}
      </g>

      <rect
        x={BADGE_RECT.x}
        y={BADGE_RECT.y}
        width={BADGE_RECT.width}
        height={BADGE_RECT.height}
        rx={BADGE_RECT.rx}
        fill="none"
        stroke="#6B4615"
        strokeOpacity="0.55"
        strokeWidth="0.4"
      />
    </svg>
  )
}
