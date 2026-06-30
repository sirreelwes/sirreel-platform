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
 * ⚠️  DNS: orders.sirreel.com must resolve + serve /order/supplies before
 *     real clients receive these emails. Not yet confirmed live — verify
 *     DNS before the first real send, or set SUPPLY_ORDER_BASE_URL back to
 *     the portal host as a stopgap.
 */
const SUPPLY_ORDER_BASE = process.env.SUPPLY_ORDER_BASE_URL || 'https://orders.sirreel.com'

export const SUPPLY_ORDER_URL = `${SUPPLY_ORDER_BASE}/order/supplies`
