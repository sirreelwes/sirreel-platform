/**
 * The Utliiz wordmark and icon, as inline SVG so they scale and take a
 * colour. The letters are a monoline; the double i stands at the u's
 * height in the accent, its dots above (Wes 2026-09-06: "make the two
 * i's the same height as the U"). Static copies live in public/ for
 * emails and favicons.
 */

export function UtliizWordmark({ height = 28, ink = '#0B5C70', accent = '#0F7A93', className }: { height?: number; ink?: string; accent?: string; className?: string }) {
  return (
    <svg viewBox="0 0 520 180" height={height} width={(520 / 180) * height} className={className} role="img" aria-label="utliiz">
      <g fill="none" stroke={ink} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 66 V108 A36 36 0 0 0 112 108 V66" />
        <path d="M112 66 V150" />
        <path d="M170 28 V116 A34 34 0 0 0 204 150 H212" />
        <path d="M146 66 H206" />
        <path d="M250 28 V150" />
        <path d="M404 66 H480 L404 150 H480" />
      </g>
      <g fill={accent}>
        <rect x="292" y="54" width="24" height="108" rx="12" />
        <circle cx="304" cy="24" r="12" />
        <rect x="344" y="54" width="24" height="108" rx="12" />
        <circle cx="356" cy="24" r="12" />
      </g>
    </svg>
  )
}

export function UtliizIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} role="img" aria-label="Utliiz">
      <rect width="96" height="96" rx="22" fill="#0F7A93" />
      <g fill="#ffffff">
        <rect x="27" y="38" width="14" height="42" rx="7" />
        <circle cx="34" cy="20" r="7" />
        <rect x="55" y="38" width="14" height="42" rx="7" />
        <circle cx="62" cy="20" r="7" />
      </g>
    </svg>
  )
}
