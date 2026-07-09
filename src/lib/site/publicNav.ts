/**
 * Public site navigation registry — the single source of truth for the
 * SirReel public marketing nav (sirreel.com / orders.sirreel.com).
 *
 * Cinelease-structure header (2026-07-06): the SirReel wordmark sits
 * centered in the utility row; the nav row below it carries plain links
 * and dropdown menus. Dropdown items that aren't built yet render as
 * non-clickable "coming soon" placeholders (no dead links / 404s).
 *
 * MODE AWARENESS — the Equipment and Forms menus deliberately split by
 * how a client transacts:
 *   - self-serve  → links to the public order form (/order/supplies)
 *   - agent-quote → routes to the contact intake with a prefilled
 *                   subject (agent follows up; NOT a cart item)
 *   - public doc  → downloads a PDF via the forms proxy
 *   - sensitive   → request-only via the contact intake; NEVER a file
 *                   link. Payment info / ACH is request-only. Credit-card
 *                   authorization is intentionally ABSENT — it lives in
 *                   CardPointe (future); SirReel never stores card data.
 */

const ORDER_FORM_HREF = '/order/supplies'

/** Contact-intake prefill link — lands on the /contact band with the
 *  message pre-seeded so the agent sees exactly what was requested.
 *  (Contact moved off Home when Home became the diagonal service-nav.) */
export function contactPrefillHref(subject: string): string {
  return `/contact?prefill=${encodeURIComponent(subject)}`
}

export type NavLeafMode = 'link' | 'order' | 'quote' | 'download' | 'request' | 'coming-soon'

export interface NavLeaf {
  label: string
  /** Resolved href for link/order/quote/download/request; omitted for coming-soon. */
  href?: string
  mode: NavLeafMode
  /** download/request open in a new tab / are plain <a> (not client nav). */
  external?: boolean
}

export interface NavGroup {
  /** Optional group heading shown inside the dropdown. */
  heading?: string
  items: NavLeaf[]
}

export interface NavEntry {
  label: string
  /** Plain top-level link when set (no dropdown). */
  href?: string
  /** Dropdown groups when set (no href). */
  groups?: NavGroup[]
}

const comingSoon = (label: string): NavLeaf => ({ label, mode: 'coming-soon' })

export const PUBLIC_NAV: NavEntry[] = [
  { label: 'Home', href: '/home' },

  {
    label: 'Studios',
    groups: [
      {
        // Stage pages are a future build — structure ready to link later.
        items: [
          comingSoon('Lankershim Stage'),
          comingSoon('Standing Sets'),
          comingSoon('LED Wall'),
        ],
      },
    ],
  },

  { label: 'Vehicles', href: '/vehicles' },

  {
    label: 'Equipment',
    groups: [
      {
        heading: 'Order online →',
        items: [
          // Self-serve → the order form. "Production Supplies" opens the
          // full catalog (the form's own header IS "Production Supplies");
          // "Walkies & Communications" deep-links to the Radios & WiFi
          // section via ?category (see publicSupplySections sectionSlug).
          { label: 'Production Supplies', href: ORDER_FORM_HREF, mode: 'order' },
          { label: 'Walkies & Communications', href: `${ORDER_FORM_HREF}?category=radios-wifi`, mode: 'order' },
        ],
      },
      {
        heading: 'Request a quote →',
        items: [
          { label: 'Lighting & Electric', href: contactPrefillHref('Equipment quote: Lighting & Electric'), mode: 'quote' },
          { label: 'Grip Package — 1 Ton', href: contactPrefillHref('Equipment quote: Grip Package (1 Ton)'), mode: 'quote' },
          { label: 'Grip Package — 3 Ton', href: contactPrefillHref('Equipment quote: Grip Package (3 Ton)'), mode: 'quote' },
          { label: 'Grip Package — 5 Ton', href: contactPrefillHref('Equipment quote: Grip Package (5 Ton)'), mode: 'quote' },
        ],
      },
    ],
  },

  {
    label: 'Forms',
    groups: [
      {
        heading: 'Downloads',
        items: [
          { label: 'Sample COI', href: '/api/public/forms/coi', mode: 'download', external: true },
          { label: 'W-9', href: '/api/public/forms/w9', mode: 'download', external: true },
          // Interactive review page (rendered from contractClauses.ts) with its
          // own source-matched "Download PDF" — replaced the static-PDF link.
          { label: 'Rental Agreement', href: '/rental-agreement', mode: 'link' },
          { label: 'Studio Contract', href: '/api/public/forms/studio-contract', mode: 'download', external: true },
        ],
      },
      {
        heading: 'Billing',
        items: [
          // SENSITIVE — request-only, never a public file link.
          { label: 'Payment Info & ACH', href: contactPrefillHref('Payment info request'), mode: 'request' },
          // NOTE: Credit-Card Authorization is intentionally NOT listed.
          // Card authorization is handled in CardPointe (future integration);
          // SirReel never collects, stores, or serves card data.
        ],
      },
    ],
  },

  { label: 'Contact', href: '/contact' },
]

/**
 * The ORDER call-to-action — the gold "ORDER →" button in the utility
 * row (upper-right). Always live; routes to the public order form.
 */
export const PUBLIC_ORDER_CTA = { label: 'ORDER', href: ORDER_FORM_HREF }

/** Home target for SAME-HOST public links (nav, footer, tiles). Relative
 *  so it stays correct on whichever public host serves it (hq / orders /
 *  future sirreel.com) — and inherently safe across the DNS cutover. */
export const PUBLIC_HOME_HREF = '/home'

/**
 * Absolute origin of the public marketing site. Use PUBLIC_HOME_URL for
 * CROSS-HOST links that must reach the public Home from a host that does
 * NOT serve it — notably the order form, which the host-routing middleware
 * serves on the PORTAL host (tsx.sirreel.com) after an hq → tsx redirect,
 * where a relative `/home` resolves to tsx and 404s.
 *
 * Same env+default shape as portalUrl.ts. DNS cutover to sirreel.com is a
 * ONE-LINE change: set NEXT_PUBLIC_SITE_URL in Vercel (or edit the default
 * here) — every absolute public-home link updates at once.
 */
export const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://hq.sirreel.com'
export const PUBLIC_HOME_URL = `${PUBLIC_SITE_URL}/home`

/**
 * Canonical public contact values — mirrors the footer copy the site has
 * always shown. Kept here so the utility bar, footer, and contact band
 * read from one place instead of triplicating the strings.
 */
export const PUBLIC_CONTACT = {
  phone: '888.477.7335',
  phoneHref: 'tel:+18884777335',
  email: 'info@sirreel.com',
  emailHref: 'mailto:info@sirreel.com',
  address: '8500 Lankershim Blvd, Sun Valley, CA 91352',
  entity: 'SirReel Studio Services',
} as const

/**
 * Social links for the utility row. URLs are CONFIGURABLE and currently
 * UNSET — '#' placeholders render the icons without a live destination.
 * Fill these in when the handles are confirmed (or lift to SiteSetting /
 * env later if they need to change without a deploy).
 */
export const PUBLIC_SOCIAL = {
  instagram: '#', // TODO: set SirReel Instagram URL
  tiktok: '#', // TODO: set SirReel TikTok URL
} as const
