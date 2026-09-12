/**
 * The partner's own mark, addressed for EMAIL.
 *
 * Their logo lives in a private blob (Vendor.logoUrl) and, when it arrived as
 * a vector, inline on the row (Vendor.logoSvg). Neither is reachable from an
 * inbox: the staff route is session-gated and the account route wants the
 * partner's login token, which is exactly the thing the introduction mail
 * deliberately does not carry.
 *
 * So partner mail points at `/api/public/partner-logo/[id]` — a partner's own
 * wordmark, sent to that partner, on a route that serves nothing else.
 *
 * RASTER ONLY. Gmail strips `<img>` SVG outright and Outlook's Word engine
 * cannot render one either, so a vector-only mark returns null here and the
 * masthead falls back to their name in type. Better a name than a broken
 * image icon in a first-contact email.
 */
import { PUBLIC_SITE_URL } from '@/lib/site/publicNav'

export function partnerLogoEmailUrl(v: {
  id: string
  logoUrl: string | null
  logoSvg?: string | null
}): string | null {
  if (!v.logoUrl) return null
  if (v.logoSvg) return null
  // An SVG too large to inline still lands in logoUrl with logoSvg null.
  if (/\.svgz?(\?|#|$)/i.test(v.logoUrl)) return null
  return `${PUBLIC_SITE_URL}/api/public/partner-logo/${v.id}`
}
