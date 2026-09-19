/**
 * The Spectiv wordmark and icon, as inline SVG so they scale and take a
 * colour. Carries the construction Wes settled for the Utliiz mark
 * (2026-09-06, five rounds — DM Sans 900 set tight, the first letter in
 * Utah red at 1.3× on the shared baseline, lowercase never a capital, the
 * rest in ink, red only INSIDE the mark) over the new name (Wes
 * 2026-09-19: "instead of utiliiz.com we are switching … to
 * spectiv.pro"): a red lowercase s at 1.3× that reads as a capital, the
 * i dotless with a solid red square dot whose top sits on the ascender
 * line — the one-word echo of the bar that sat over the ii. The icon is
 * the red s alone on an ink square. Outlines converted to paths with a
 * scratch fontkit tool over DM Sans 900, so no font has to load for the
 * mark to render. Statics in public/: spectiv-wordmark.svg / -white.svg /
 * .png (email), spectiv-icon.svg / -light.svg + 192/512 PNG + apple-touch.
 * First draft of the Spectiv letterforms — Wes has not iterated on it yet.
 */

export const SPECTIV_RED = '#CC0000'
const INK = '#0f2a30'
const VIEWBOX = "-1.06 -78 363.66 106"
const RATIO = 3.43
const S_PATH = "M27.5 1.2Q20.4 1.2 15.25 -1.05Q10.1 -3.3 7.15 -7.2Q4.2 -11.1 3.8 -16L18.7 -16Q19.1 -14.3 20.15 -12.95Q21.2 -11.6 23.05 -10.85Q24.9 -10.1 27.2 -10.1Q29.7 -10.1 31.25 -10.75Q32.8 -11.4 33.6 -12.5Q34.4 -13.6 34.4 -14.8Q34.4 -16.7 33.25 -17.7Q32.1 -18.7 29.9 -19.35Q27.7 -20 24.6 -20.6Q21 -21.4 17.45 -22.45Q13.9 -23.5 11.15 -25.1Q8.4 -26.7 6.75 -29.25Q5.1 -31.8 5.1 -35.5Q5.1 -40 7.6 -43.65Q10.1 -47.3 14.8 -49.45Q19.5 -51.6 26.2 -51.6Q35.7 -51.6 41.1 -47.4Q46.5 -43.2 47.5 -36.1L33.5 -36.1Q32.9 -38.1 31 -39.15Q29.1 -40.2 26.2 -40.2Q22.9 -40.2 21.2 -39.1Q19.5 -38 19.5 -36.2Q19.5 -35 20.65 -34.05Q21.8 -33.1 24 -32.4Q26.2 -31.7 29.4 -31Q35.5 -29.7 39.95 -28.2Q44.4 -26.7 46.9 -23.85Q49.4 -21 49.3 -15.6Q49.4 -10.7 46.75 -6.9Q44.1 -3.1 39.2 -0.95Q34.3 1.2 27.5 1.2Z"

export function SpectivWordmark({ height = 28, ink = INK, red = SPECTIV_RED, className }: { height?: number; ink?: string; red?: string; className?: string }) {
  return (
    <svg viewBox={VIEWBOX} height={height} width={RATIO * height} className={className} role="img" aria-label="spectiv">
      <g>
        <path d="M35.75 1.56Q26.52 1.56 19.83 -1.36Q13.13 -4.29 9.3 -9.36Q5.46 -14.43 4.94 -20.8L24.31 -20.8Q24.83 -18.59 26.2 -16.83Q27.56 -15.08 29.97 -14.1Q32.37 -13.13 35.36 -13.13Q38.61 -13.13 40.63 -13.97Q42.64 -14.82 43.68 -16.25Q44.72 -17.68 44.72 -19.24Q44.72 -21.71 43.23 -23.01Q41.73 -24.31 38.87 -25.15Q36.01 -26 31.98 -26.78Q27.3 -27.82 22.69 -29.18Q18.07 -30.55 14.5 -32.63Q10.92 -34.71 8.78 -38.02Q6.63 -41.34 6.63 -46.15Q6.63 -52 9.88 -56.74Q13.13 -61.49 19.24 -64.28Q25.35 -67.08 34.06 -67.08Q46.41 -67.08 53.43 -61.62Q60.45 -56.16 61.75 -46.93L43.55 -46.93Q42.77 -49.53 40.3 -50.89Q37.83 -52.26 34.06 -52.26Q29.77 -52.26 27.56 -50.83Q25.35 -49.4 25.35 -47.06Q25.35 -45.5 26.85 -44.26Q28.34 -43.03 31.2 -42.12Q34.06 -41.21 38.22 -40.3Q46.15 -38.61 51.94 -36.66Q57.72 -34.71 60.97 -31.01Q64.22 -27.3 64.09 -20.28Q64.22 -13.91 60.78 -8.97Q57.33 -4.03 50.96 -1.24Q44.59 1.56 35.75 1.56Z" fill={red} />
        <path d="M70.2 22L70.2 -50.4L83.5 -50.4L85.2 -43.8L85.2 -43.8Q86.8 -45.9 88.9 -47.7Q91 -49.5 93.95 -50.55Q96.9 -51.6 100.9 -51.6Q107.9 -51.6 113.25 -48.1Q118.6 -44.6 121.8 -38.65Q125 -32.7 125 -25.1Q125 -17.5 121.75 -11.55Q118.5 -5.6 113.1 -2.2Q107.7 1.2 101 1.2Q95.6 1.2 91.7 -0.7Q87.8 -2.6 85.2 -6L85.2 22ZM97.2 -11.9Q100.8 -11.9 103.65 -13.55Q106.5 -15.2 108.1 -18.2Q109.7 -21.2 109.7 -25.1Q109.7 -29 108.1 -32Q106.5 -35 103.65 -36.75Q100.8 -38.5 97.2 -38.5Q93.5 -38.5 90.65 -36.75Q87.8 -35 86.2 -32Q84.6 -29 84.6 -25.2Q84.6 -21.3 86.2 -18.25Q87.8 -15.2 90.65 -13.55Q93.5 -11.9 97.2 -11.9Z" fill={ink} />
        <path d="M156.3 1.2Q148.5 1.2 142.6 -2.05Q136.7 -5.3 133.35 -11.15Q130 -17 130 -24.6Q130 -32.4 133.3 -38.5Q136.6 -44.6 142.5 -48.1Q148.4 -51.6 156.2 -51.6Q163.8 -51.6 169.5 -48.3Q175.2 -45 178.45 -39.35Q181.7 -33.7 181.7 -26.3Q181.7 -25.3 181.65 -24.05Q181.6 -22.8 181.4 -21.5L140.7 -21.5L140.7 -30.2L166.4 -30.2Q166.2 -34.4 163.35 -36.95Q160.5 -39.5 156.3 -39.5Q153.1 -39.5 150.5 -38Q147.9 -36.5 146.35 -33.5Q144.8 -30.5 144.8 -25.9L144.8 -22.9Q144.8 -19.4 146.15 -16.7Q147.5 -14 150.05 -12.5Q152.6 -11 156.1 -11Q159.4 -11 161.55 -12.35Q163.7 -13.7 164.9 -15.8L180.2 -15.8Q178.8 -11 175.4 -7.15Q172 -3.3 167.1 -1.05Q162.2 1.2 156.3 1.2Z" fill={ink} />
        <path d="M212.6 1.2Q204.8 1.2 198.85 -2.2Q192.9 -5.6 189.55 -11.5Q186.2 -17.4 186.2 -25Q186.2 -32.8 189.55 -38.75Q192.9 -44.7 198.85 -48.15Q204.8 -51.6 212.6 -51.6Q222.5 -51.6 229.25 -46.4Q236 -41.2 237.8 -31.9L221.9 -31.9Q221 -35.1 218.5 -36.9Q216 -38.7 212.5 -38.7Q209.2 -38.7 206.75 -37.05Q204.3 -35.4 202.9 -32.35Q201.5 -29.3 201.5 -25.2Q201.5 -22.1 202.3 -19.6Q203.1 -17.1 204.55 -15.3Q206 -13.5 208 -12.55Q210 -11.6 212.5 -11.6Q214.9 -11.6 216.75 -12.4Q218.6 -13.2 219.95 -14.7Q221.3 -16.2 221.9 -18.4L237.8 -18.4Q236 -9.4 229.2 -4.1Q222.4 1.2 212.6 1.2Z" fill={ink} />
        <path d="M268 0Q262.5 0 258.3 -1.75Q254.1 -3.5 251.8 -7.5Q249.5 -11.5 249.5 -18.4L249.5 -37.9L240.9 -37.9L240.9 -50.4L249.5 -50.4L251.1 -64.6L264.5 -64.6L264.5 -50.4L277.4 -50.4L277.4 -37.9L264.5 -37.9L264.5 -18.2Q264.5 -15.2 265.85 -13.95Q267.2 -12.7 270.5 -12.7L277.4 -12.7L277.4 0Z" fill={ink} />
        <path d="M283.9 0L283.9 -50.4L298.9 -50.4L298.9 0Z" fill={ink} />
        <path d="M320.1 0L301.8 -50.4L317.6 -50.4L329.3 -14.1L329.3 -14.1L341 -50.4L356.6 -50.4L338.4 0Z" fill={ink} />
      </g>
      <rect x="283.9" y="-72" width="15" height="13" fill={red} />
    </svg>
  )
}

/** The red s alone. `light` puts it on white instead of ink. */
export function SpectivIcon({ size = 32, light = false, className }: { size?: number; light?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} role="img" aria-label="Spectiv">
      <rect width="96" height="96" rx="20" fill={light ? '#ffffff' : INK} />
      <path d={S_PATH} fill={SPECTIV_RED} transform="translate(18.53 75.97) scale(1.11)" />
    </svg>
  )
}
