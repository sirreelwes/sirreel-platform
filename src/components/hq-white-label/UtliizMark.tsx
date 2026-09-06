/**
 * The Utliiz wordmark and icon, as inline SVG so they scale and take a
 * colour. Wes 2026-09-06: direction "F" — DM Sans 900 set tight, the u
 * in Utah red (#CC0000), the t back in ink, and one solid red bar over
 * both (dotless) i's. The letters are the typeface's outlines converted
 * to paths (scratch tool: fontkit over DM Sans 900), so no font has to
 * load for the mark to render. Static copies in public/ for email and
 * favicons: utliiz-wordmark.svg / -white.svg / .png, utliiz-icon.svg +
 * PNG sizes.
 */

export const UTLIIZ_RED = '#CC0000'
const INK = '#0f2a30'
const VIEWBOX = '-6 -105.2 228.4 142.2'
const RATIO = 1.6062

export function UtliizWordmark({ height = 28, ink = INK, red = UTLIIZ_RED, className }: { height?: number; ink?: string; red?: string; className?: string }) {
  return (
    <svg viewBox={VIEWBOX} height={height} width={RATIO * height} className={className} role="img" aria-label="utliiz">
      <g>
        <path d="M25.5 1.2Q19.2 1.2 14.85 -1.4Q10.5 -4 8.25 -9.05Q6 -14.1 6 -21.4L6 -50.4L21 -50.4L21 -22.9Q21 -17.3 23.3 -14.35Q25.6 -11.4 30.7 -11.4Q33.8 -11.4 36.25 -12.8Q38.7 -14.2 40.05 -16.9Q41.4 -19.6 41.4 -23.5L41.4 -50.4L56.4 -50.4L56.4 0L43.3 0L42.1 -8L42.1 -8Q39.9 -3.9 35.7 -1.35Q31.5 1.2 25.5 1.2Z" fill={red} />
        <path d="M88 0Q82.5 0 78.3 -1.75Q74.1 -3.5 71.8 -7.5Q69.5 -11.5 69.5 -18.4L69.5 -37.9L60.9 -37.9L60.9 -50.4L69.5 -50.4L71.1 -64.6L84.5 -64.6L84.5 -50.4L97.4 -50.4L97.4 -37.9L84.5 -37.9L84.5 -18.2Q84.5 -15.2 85.85 -13.95Q87.2 -12.7 90.5 -12.7L97.4 -12.7L97.4 0Z" fill={ink} />
        <path d="M103.9 0L103.9 -72L118.9 -72L118.9 0Z" fill={ink} />
        <path d="M126.9 0L126.9 -50.4L141.9 -50.4L141.9 0Z" fill={ink} />
        <path d="M149.9 0L149.9 -50.4L164.9 -50.4L164.9 0Z" fill={ink} />
        <path d="M169.6 0L169.6 -12L194.3 -38L169.9 -38L169.9 -50.4L211.5 -50.4L211.5 -38.4L186.6 -12.4L212 -12.4L212 0Z" fill={ink} />
      </g>
      <rect x="126.9" y="-72.0" width="38.0" height="11.0" fill={red} />
    </svg>
  )
}

export function UtliizIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} role="img" aria-label="Utliiz">
      <rect width="96" height="96" rx="20" fill={INK} />
      <rect x="30" y="42" width="14" height="36" fill="#ffffff" />
      <rect x="52" y="42" width="14" height="36" fill="#ffffff" />
      <rect x="30" y="22" width="36" height="10" fill={UTLIIZ_RED} />
    </svg>
  )
}
