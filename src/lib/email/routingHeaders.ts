/**
 * Routing-header extraction for inbound mail. Captures every header the
 * Gmail forward chain can use to reveal a message's ORIGINAL recipient —
 * critical for classifying claims@ → ana@ forwards by their true address
 * instead of just the inbox they landed in.
 *
 * The shape is intentionally narrow + lower-cased so Prisma's JSON path
 * filters (`routingHeaders.path(["deliveredTo"])`) can do case-insensitive
 * equality checks without server-side normalization.
 *
 * Returns null when every header is empty — so a missing column means
 * "ingest never captured these", not "every field was empty".
 */

// Index signature lets the object satisfy Prisma's InputJsonObject without
// per-call-site casts. Keys are still typed via the explicit fields below.
export interface RoutingHeaders {
  [k: string]: string | null
  to: string | null
  cc: string | null
  deliveredTo: string | null
  xOriginalTo: string | null
  xForwardedFor: string | null
  xForwardedTo: string | null
}

export const ROUTING_HEADER_NAMES = [
  'To',
  'Cc',
  'Delivered-To',
  'X-Original-To',
  'X-Forwarded-For',
  'X-Forwarded-To',
] as const

type HeaderLike = { name?: string | null; value?: string | null }

export function extractRoutingHeaders(headers: HeaderLike[] | null | undefined): RoutingHeaders | null {
  if (!headers || headers.length === 0) return null
  const get = (name: string): string | null => {
    const target = name.toLowerCase()
    const h = headers.find((x) => x.name?.toLowerCase() === target)
    const v = h?.value?.trim()
    return v ? v.toLowerCase() : null
  }
  const out: RoutingHeaders = {
    to: get('To'),
    cc: get('Cc'),
    deliveredTo: get('Delivered-To'),
    xOriginalTo: get('X-Original-To'),
    xForwardedFor: get('X-Forwarded-For'),
    xForwardedTo: get('X-Forwarded-To'),
  }
  // All empty → return null so the column reflects "no signal", not noise.
  const anySet = Object.values(out).some((v) => v !== null)
  return anySet ? out : null
}

/**
 * True if any routing header on the message contains the target address.
 * Use the original mixed-case address; we normalize internally.
 */
export function routingHeadersContain(
  rh: RoutingHeaders | null | undefined,
  address: string,
): boolean {
  if (!rh) return false
  const needle = address.toLowerCase()
  return (
    (rh.to?.includes(needle) ?? false) ||
    (rh.cc?.includes(needle) ?? false) ||
    (rh.deliveredTo?.includes(needle) ?? false) ||
    (rh.xOriginalTo?.includes(needle) ?? false) ||
    (rh.xForwardedFor?.includes(needle) ?? false) ||
    (rh.xForwardedTo?.includes(needle) ?? false)
  )
}
