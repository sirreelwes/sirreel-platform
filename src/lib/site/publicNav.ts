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
 *                   authorization links out to the Cognito form as an
 *                   INTERIM until CardPointe production credentials land —
 *                   the vendor holds the card data; SirReel still never
 *                   collects, stores or serves it.
 *
 * SIGN & AUTHORIZE — signable forms, all hosted by Cognito for now, all
 * linked via OUR paths (/rentalagreement, /annualrentalagreement,
 * /creditcardauthorization) so go-live is a change to legacyRedirects
 * rather than a hunt for hardcoded vendor URLs.
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

export const PUBLIC_NAV: NavEntry[] = [
  { label: 'Home', href: '/home' },

  {
    label: 'Studios',
    groups: [
      {
        items: [
          { label: 'Stages', href: '/stages', mode: 'link' },
          { label: 'Standing Sets', href: '/standing-sets', mode: 'link' },
          { label: 'LED / Volume Stage', href: '/stages/led-volume-stage', mode: 'link' },
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
          // Interactive review page (rendered from stageContractClauses.ts) with
          // its own source-matched "Download PDF" — replaced the static-PDF link.
          { label: 'Studio Contract', href: '/stage-contract', mode: 'link' },
        ],
      },
      {
        // Live, signable forms — distinct from the Downloads group above,
        // which is read-and-review only. A client who needs to SIGN was
        // landing on the review page and finding no way to do it.
        heading: 'Sign & Authorize',
        items: [
          {
            label: 'Sign Rental Agreement',
            href: '/rentalagreement',
            mode: 'link',
            external: true,
          },
          {
            label: 'Sign Annual Rental Agreement',
            href: '/annualrentalagreement',
            mode: 'link',
            external: true,
          },
          {
            label: 'Sign Studio Contract',
            href: '/studiocontract',
            mode: 'link',
            external: true,
          },
          {
            label: 'Credit Card Authorization',
            href: '/creditcardauthorization',
            mode: 'link',
            external: true,
          },
        ],
      },
      {
        heading: 'Billing',
        items: [
          // SENSITIVE — request-only, never a public file link.
          { label: 'Payment Info & ACH', href: '/payment-info', mode: 'request' },

        ],
      },
    ],
  },

  { label: 'Contact', href: '/contact' },
  { label: 'Help', href: '/help' },
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
  phone: '(888) 477-7335',
  phoneHref: 'tel:+18884777335',
  email: 'info@sirreel.com',
  emailHref: 'mailto:info@sirreel.com',
  address: '8500 Lankershim Blvd, Sun Valley, CA 91352',
  entity: 'SirReel Studio Services',
} as const

/**
 * Social links for the utility row. Both profiles are @sirreelstudios.
 *
 * The nav hides any icon still set to '#', so an unconfirmed handle never
 * renders as a dead link — keep that convention if more are added.
 */
export const SIRREEL_SOCIAL_HANDLE = 'sirreelstudios'

// Deliberately NOT `as const`: literal types would let TS prove the
// '#' placeholder check can never fire, and reject it at every call site.
export const PUBLIC_SOCIAL: Record<'instagram' | 'tiktok', string> = {
  instagram: `https://www.instagram.com/${SIRREEL_SOCIAL_HANDLE}/`,
  // TikTok profile URLs carry the @ in the path; Instagram's do not.
  tiktok: `https://www.tiktok.com/@${SIRREEL_SOCIAL_HANDLE}`,
}
