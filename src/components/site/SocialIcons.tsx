import { PUBLIC_SOCIAL } from '@/lib/site/publicNav'

/**
 * Social icons + the link row, shared by the public nav and footer so the
 * SVG paths live in one place.
 *
 * `SocialLinks` drops any profile still set to the '#' placeholder, so an
 * unconfirmed handle renders as nothing rather than a dead link. Keep that
 * behaviour if more networks are added.
 */

export function InstagramIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x={2} y={2} width={20} height={20} rx={5} />
      <circle cx={12} cy={12} r={4} />
      <path d="M17.5 6.5h.01" />
    </svg>
  )
}

export function TikTokIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.5 3c.3 2 1.6 3.6 3.5 4v2.5c-1.3 0-2.6-.4-3.6-1v6.3a5.8 5.8 0 1 1-5-5.7v2.6a3.2 3.2 0 1 0 2.4 3.1V3h2.7Z" />
    </svg>
  )
}

export function SocialLinks({
  className = '',
  size = 17,
}: {
  className?: string
  size?: number
}) {
  // The '#' guard keeps working for networks added later that are still
  // placeholders — see PUBLIC_SOCIAL on why it isn't `as const`.
  const items = [
    { href: PUBLIC_SOCIAL.instagram, label: 'SirReel on Instagram', Icon: InstagramIcon },
    { href: PUBLIC_SOCIAL.tiktok, label: 'SirReel on TikTok', Icon: TikTokIcon },
  ].filter((s) => s.href && s.href !== '#')

  if (!items.length) return null

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {items.map(({ href, label, Icon }) => (
        <a
          key={label}
          href={href}
          aria-label={label}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[#a8a294] hover:text-white transition-colors"
        >
          <Icon size={size} />
        </a>
      ))}
    </div>
  )
}
