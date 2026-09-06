/**
 * The Utliiz wordmark and icon, as inline SVG so they scale and take a
 * colour. The letters are a monoline; the double i is the utilization
 * gauge — two bars stepping up, their dots stepping with them. Static
 * copies live in public/ for emails and favicons.
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
        <rect x="292" y="96" width="24" height="66" rx="12" />
        <circle cx="304" cy="66" r="12" />
        <rect x="344" y="62" width="24" height="100" rx="12" />
        <circle cx="356" cy="32" r="12" />
      </g>
    </svg>
  )
}

export function UtliizIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} role="img" aria-label="Utliiz">
      <rect width="96" height="96" rx="22" fill="#0F7A93" />
      <g fill="#ffffff">
        <rect x="26" y="50" width="14" height="30" rx="7" />
        <circle cx="33" cy="36" r="7" />
        <rect x="56" y="30" width="14" height="50" rx="7" />
        <circle cx="63" cy="16" r="7" />
      </g>
    </svg>
  )
}
