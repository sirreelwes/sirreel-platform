/**
 * Production supply-order link — the single source of truth for the
 * "/order/supplies" URL that goes into client emails (Quick Reply, Send
 * Quote fallback, follow-ups).
 *
 * This lives on its OWN domain (orders.sirreel.com), deliberately separate
 * from the portal magic-link host (PORTAL_BASE_URL → tsx.sirreel.com). The
 * two used to share PORTAL_BASE_URL; they're decoupled here so the supply
 * domain can move without touching portal links.
 *
 * Override with SUPPLY_ORDER_BASE_URL for non-prod (e.g. localhost).
 *
 * The form is served at the bare ROOT of orders.sirreel.com — the host
 * middleware rewrites "/" → the public /order/supplies form, so the client-
 * facing link is a clean `https://orders.sirreel.com` with no path. (The
 * /order/supplies path still resolves directly, so older emailed links keep
 * working.)
 *
 * ⚠️  DNS: orders.sirreel.com must resolve before real clients receive these
 *     emails. Confirm it's live (the domain is attached to the sirreel-fleet
 *     Vercel project) before the first real send.
 */
export const SUPPLY_ORDER_URL = process.env.SUPPLY_ORDER_BASE_URL || 'https://orders.sirreel.com'
