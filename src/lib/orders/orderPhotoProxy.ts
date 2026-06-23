/**
 * URL builders for the order-document JOB_PHOTO proxy.
 *
 * Order documents live in the PRIVATE blob store (see
 * uploadOrderDocument.ts), so their raw blob URLs 403 on a direct
 * fetch. The thank-you email embeds the candid as `<img src>` for an
 * external, unauthenticated recipient — a session-gated proxy can't
 * work there — so JOB_PHOTOs are served through
 * `GET /api/orders/documents/[docId]/photo`, which is public but gated
 * by the unguessable OrderDocument.id (same posture as the old
 * public-by-URL-knowledge blob).
 *
 * - Use the RELATIVE path for same-origin `<img>` in the dashboard.
 * - Use the ABSOLUTE url for email HTML (recipient's client needs a
 *   fully-qualified src). Base matches the hardcoded asset host used by
 *   the email templates (thankYouTemplate etc.).
 */

const PUBLIC_BASE = 'https://hq.sirreel.com'

export function orderPhotoProxyPath(docId: string): string {
  return `/api/orders/documents/${docId}/photo`
}

export function orderPhotoProxyUrl(docId: string): string {
  return `${PUBLIC_BASE}${orderPhotoProxyPath(docId)}`
}
