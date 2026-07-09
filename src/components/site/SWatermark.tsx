import Image from 'next/image'

/**
 * Subtle oversized S-mark watermark for the public site's dark editorial
 * bands. Purely decorative: aria-hidden, pointer-events-none, ~5% opacity,
 * bleeding off the band's right edge with a slight tilt. Reuses the existing
 * /s-logo-white.png asset (no new asset). Host section must be
 * `relative overflow-hidden`.
 */
export function SWatermark({
  size = 380,
  className = '-right-16 -bottom-20 rotate-[-8deg]',
}: {
  size?: number
  /** Position + tilt classes (replaces the default corner placement). */
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={`absolute pointer-events-none select-none opacity-[0.05] ${className}`}
      style={{ width: size, height: size * (1065 / 1118) }}
    >
      <Image src="/s-logo-white.png" alt="" width={1118} height={1065} className="w-full h-auto" />
    </div>
  )
}
