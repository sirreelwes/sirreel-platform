/**
 * The Utliiz wordmark and icon, as inline SVG so they scale and take a
 * colour. Wes 2026-09-06 (final, after "make the U larger, not a
 * capital, and utilize the u in the logo mark alone"): DM Sans 900 set
 * tight, the u in Utah red (#CC0000) at 1.3× on the shared baseline, the
 * rest in ink, one solid red bar over both dotless i's with its top on
 * the ascender line. The icon is the red u alone on an ink square. The
 * letters are the typeface's outlines converted to paths (scratch
 * fontkit tool over DM Sans 900), so no font has to load for the mark
 * to render. Statics in public/: utliiz-wordmark.svg / -white.svg / .png
 * (email), utliiz-icon.svg / -light.svg + 192/512 PNG + apple-touch.
 */

export const UTLIIZ_RED = '#CC0000'
const INK = '#0f2a30'
const VIEWBOX = '-6 -105.2 247.3 142.2'
const RATIO = 1.7389
const U_PATH = 'M25.5 1.2Q19.2 1.2 14.85 -1.4Q10.5 -4 8.25 -9.05Q6 -14.1 6 -21.4L6 -50.4L21 -50.4L21 -22.9Q21 -17.3 23.3 -14.35Q25.6 -11.4 30.7 -11.4Q33.8 -11.4 36.25 -12.8Q38.7 -14.2 40.05 -16.9Q41.4 -19.6 41.4 -23.5L41.4 -50.4L56.4 -50.4L56.4 0L43.3 0L42.1 -8L42.1 -8Q39.9 -3.9 35.7 -1.35Q31.5 1.2 25.5 1.2Z'

export function UtliizWordmark({ height = 28, ink = INK, red = UTLIIZ_RED, className }: { height?: number; ink?: string; red?: string; className?: string }) {
  return (
    <svg viewBox={VIEWBOX} height={height} width={RATIO * height} className={className} role="img" aria-label="utliiz">
      <g>
        <path d="M33.15 1.56Q24.96 1.56 19.31 -1.82Q13.65 -5.2 10.73 -11.76Q7.8 -18.33 7.8 -27.82L7.8 -65.52L27.3 -65.52L27.3 -29.77Q27.3 -22.49 30.29 -18.65Q33.28 -14.82 39.91 -14.82Q43.94 -14.82 47.13 -16.64Q50.31 -18.46 52.07 -21.97Q53.82 -25.48 53.82 -30.55L53.82 -65.52L73.32 -65.52L73.32 0L56.29 0L54.73 -10.4L54.73 -10.4Q51.87 -5.07 46.41 -1.75Q40.95 1.56 33.15 1.56Z" fill={red} />
        <path d="M106.87 0Q101.37 0 97.17 -1.75Q92.97 -3.5 90.67 -7.5Q88.37 -11.5 88.37 -18.4L88.37 -37.9L79.77 -37.9L79.77 -50.4L88.37 -50.4L89.97 -64.6L103.37 -64.6L103.37 -50.4L116.27 -50.4L116.27 -37.9L103.37 -37.9L103.37 -18.2Q103.37 -15.2 104.72 -13.95Q106.07 -12.7 109.37 -12.7L116.27 -12.7L116.27 0Z" fill={ink} />
        <path d="M122.77 0L122.77 -72L137.77 -72L137.77 0Z" fill={ink} />
        <path d="M145.77 0L145.77 -50.4L160.77 -50.4L160.77 0Z" fill={ink} />
        <path d="M168.77 0L168.77 -50.4L183.77 -50.4L183.77 0Z" fill={ink} />
        <path d="M188.47 0L188.47 -12L213.17 -38L188.77 -38L188.77 -50.4L230.37 -50.4L230.37 -38.4L205.47 -12.4L230.87 -12.4L230.87 0Z" fill={ink} />
      </g>
      <rect x="145.8" y="-72.0" width="38.0" height="11.0" fill={red} />
    </svg>
  )
}

/** The red u alone. `light` puts it on white instead of ink. */
export function UtliizIcon({ size = 32, light = false, className }: { size?: number; light?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} role="img" aria-label="Utliiz">
      <rect width="96" height="96" rx="20" fill={light ? '#ffffff' : INK} />
      <path d={U_PATH} fill={UTLIIZ_RED} transform="translate(11.72 76.60) scale(1.1628)" />
    </svg>
  )
}
