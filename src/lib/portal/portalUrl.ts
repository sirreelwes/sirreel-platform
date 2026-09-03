/**
 * Centralized portal URL builders.
 *
 * Every client-facing portal URL (magic links in quote / agreement /
 * invoice / welcome emails, the "share link" mailto on the portal
 * itself, multi-contact authorization URLs, the resend-link path,
 * etc.) should go through one of these functions. Hardcoding
 * `https://hq.sirreel.com/portal/...` is a bug — the portal is
 * served from a separate host now and old hardcodes don't move.
 *
 * Env: `PORTAL_BASE_URL` overrides the default. Set in Vercel
 * production env to `https://tsx.sirreel.com`. Unset → falls back
 * to the prod default below (also `https://tsx.sirreel.com`) so the
 * code is safe even if the env var is missing.
 *
 * Local dev: there is no public hostname for the portal in dev.
 * You have two choices:
 *
 *   1. Local-with-hq host. Set
 *        PORTAL_BASE_URL=http://localhost:3000
 *      in .env.local. The portal is served on the same port as the
 *      staff app; the host-routing middleware passes localhost
 *      through unchanged, so /portal/* serves the portal pages and
 *      everything works against the same dev server. Simplest, but
 *      doesn't exercise the host split.
 *
 *   2. Two-host spoof. Add to /etc/hosts:
 *        127.0.0.1   tsx.local
 *        127.0.0.1   hq.local
 *      Set PORTAL_BASE_URL=http://tsx.local:3000 in .env.local.
 *      In the middleware, the dev hostname check below allows
 *      these to pass through. Visit
 *        http://tsx.local:3000/portal/...
 *      to exercise the tsx-only path; visit
 *        http://hq.local:3000/dashboard
 *      for the staff side. The 308 redirect from hq → tsx is
 *      simulated only in production hostnames, so /portal/* on
 *      hq.local still serves directly.
 */

const PROD_BASE = 'https://tsx.sirreel.com'

export function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL || PROD_BASE
}

/**
 * Magic-link landing for the job portal. `?token=` carries the
 * 256-bit PortalAccess.magicLinkToken. The client clicks this URL
 * in the quote / agreement / invoice / welcome emails.
 */
export function portalJobUrl(slug: string, token?: string): string {
  const t = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${portalBaseUrl()}/portal/job/${slug}${t}`
}

/**
 * After-hours pickup / drop-off instructions for a job —
 * `/portal/job/<slug>/after-hours`. Deep-linked from the release email so
 * a coordinator forwarding it to a driver at 11pm lands on the codes
 * rather than on the portal home with something to find.
 *
 * Carries `?token=` for the same reason the landing URL does: the page
 * performs its own token-to-cookie handshake, so the link works for a
 * recipient who has never opened the portal on this device.
 */
export function portalJobAfterHoursUrl(slug: string, token?: string): string {
  const t = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${portalBaseUrl()}/portal/job/${slug}/after-hours${t}`
}

/**
 * Legacy single-token portal entry (`/portal/[token]`). Kept for
 * backward compat with old PortalAccess emails that addressed the
 * token directly in the path.
 */
export function portalTokenUrl(token: string): string {
  return `${portalBaseUrl()}/portal/${encodeURIComponent(token)}`
}

/**
 * Multi-contact "approve / decline" link. Used by the
 * /api/portal/authorize/[token] handler when a coordinator forwards
 * an agreement to a PM for sign-off.
 */
export function portalAuthorizeUrl(token: string, action?: 'approve' | 'decline'): string {
  const q = action ? `?action=${action}` : ''
  return `${portalBaseUrl()}/api/portal/authorize/${encodeURIComponent(token)}${q}`
}

/**
 * Passwordless sign-in for the Person account flow. Returned by
 * /api/portal/auth/request and shown to the user when they request
 * a magic link.
 */
/**
 * Unsubscribe link for an outreach email footer.
 *
 * Built on the CLIENT host, not hq.sirreel.com: the recipient is a
 * stranger, the page takes no session, and pointing marketing mail at
 * the staff hostname invites both confusion and a login wall.
 *
 * The token is a stateless HMAC (src/lib/outreach/unsubscribeToken.ts),
 * so the link keeps working indefinitely — people unsubscribe from mail
 * they find much later, and a link that has quietly expired is a
 * compliance failure, not a tidy-up.
 */
export function outreachUnsubscribeUrl(parts: { e: string; t: string }): string {
  const q = new URLSearchParams({ e: parts.e, t: parts.t })
  return `${portalBaseUrl()}/unsubscribe?${q.toString()}`
}

export function portalSignInUrl(): string {
  return `${portalBaseUrl()}/portal/auth/sign-in`
}

/**
 * Person-session magic-link verify URL. Emailed by
 * /api/portal/auth/request to the person who requested access; the
 * link sets the `sr_person_session` cookie on the tsx host.
 */
export function portalAuthVerifyUrl(token: string): string {
  return `${portalBaseUrl()}/api/portal/auth/verify?token=${encodeURIComponent(token)}`
}

/**
 * Resend-link path used by the public "I lost the link" flow on the
 * job portal. Returns the canonical landing URL for a slug.
 */
export function portalResendLandingUrl(slug: string): string {
  return `${portalBaseUrl()}/portal/job/${slug}`
}

/**
 * No-login client COI upload — `/coi/[token]`. On the portal host
 * allowlist (see middleware), so it routes through the same base as every
 * other client-facing link rather than an ad-hoc request origin.
 */
export function coiUploadUrl(token: string): string {
  return `${portalBaseUrl()}/coi/${encodeURIComponent(token)}`
}

/**
 * The v2 paperwork portal — `/portal/v2/[token]`, keyed by a
 * PaperworkRequest token. This is where the client authorizes a card,
 * signs, and drops their COI. Routed through the portal base like every
 * other client-facing link: the card-authorization email used to build
 * this URL from the request origin, which put `hq.sirreel.com` in front
 * of a client link.
 */
export function portalV2Url(token: string): string {
  return `${portalBaseUrl()}/portal/v2/${encodeURIComponent(token)}`
}

/**
 * Legacy `/client/[token]` route — sibling to `/portal/[token]`,
 * sent in some older booking emails. Kept here so that prefix is
 * also routed through the centralized base URL.
 */
export function clientTokenUrl(token: string): string {
  return `${portalBaseUrl()}/client/${encodeURIComponent(token)}`
}
