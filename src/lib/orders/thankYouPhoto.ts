/**
 * Which picture goes in the thank-you email — resolved SERVER-SIDE from a
 * source name, never from a URL the browser hands us.
 *
 * It used to be a URL. The compose page posted `photoUrlOverride:
 * weeklyCandid.fileUrl` and the preview and send routes dropped it straight
 * into the email's `<img src>`. Two things were wrong with that:
 *
 *   1. It did not work. Weekly-candid blobs are written `access: 'private'`
 *      (see /api/users/me/weekly-candid, whose own header flags the gap:
 *      "the public-store fix is owed before email <img src> tags will render
 *      reliably for recipients"). The recipient's mail client fetched the raw
 *      blob, got a 403, and the candid silently never arrived — the whole
 *      point of the email. The JOB_PHOTO source had already been fixed this
 *      way, through /api/orders/documents/[docId]/photo; the candid had not.
 *   2. Any signed-in user could put ANY url in a client-facing email — a
 *      tracking pixel, an attacker's host. It was escaped, so not injection,
 *      but it was still an arbitrary outbound fetch from a client's inbox
 *      with SirReel's name on it.
 *
 * So the body now names a SOURCE and this file resolves it against the
 * database. One function, called by both the preview and the send, so the
 * iframe the rep approves is the mail the client receives.
 *
 * The candid is the ORDER AGENT'S, not the sender's: the photo sits directly
 * above a sign-off in the agent's name, and a manager sending on a rep's
 * behalf should not put their own face over the rep's signature.
 */

import { prisma } from '@/lib/prisma'
import { OrderDocType } from '@prisma/client'
import { orderPhotoProxyUrl } from '@/lib/orders/orderPhotoProxy'
import { agentPhotoEmailUrl } from '@/lib/email/repCard'

/** What the compose page's three radio options mean on the wire. */
export type ThankYouPhotoSource = 'weekly' | 'order' | 'none'

export function parsePhotoSource(v: unknown): ThankYouPhotoSource | null {
  return v === 'weekly' || v === 'order' || v === 'none' ? v : null
}

export interface ResolveThankYouPhotoArgs {
  orderId: string
  /** The agent on the order — whose candid, and whose name signs the mail. */
  agentId: string
  /** Absent means the caller did not choose: keep the historical ladder. */
  source: ThankYouPhotoSource | null
  /** A JOB_PHOTO the rep picked on the compose page. */
  photoDocumentId?: string | null
  /** The suggestion's already-pinned JOB_PHOTO. */
  pinnedDocumentId?: string | null
}

export interface ResolvedThankYouPhoto {
  /** Absolute, public, proxied. Null collapses the photo slot. */
  photoUrl: string | null
  /** Only set for the JOB_PHOTO source — what the suggestion pins on send. */
  photoDocumentId: string | null
}

const NOTHING: ResolvedThankYouPhoto = { photoUrl: null, photoDocumentId: null }

/** The agent's most recent weekly candid, as a public proxy URL. */
async function weeklyCandidUrl(agentId: string): Promise<ResolvedThankYouPhoto> {
  const candid = await prisma.agentWeeklyCandid
    .findFirst({
      where: { userId: agentId },
      orderBy: { capturedAt: 'desc' },
      select: { id: true },
    })
    .catch(() => null)
  if (!candid) return NOTHING
  // Same public route the welcome email's rep card uses, and `?v=` pins THIS
  // candid so the mail keeps its own picture after the rep uploads next
  // week's.
  return { photoUrl: agentPhotoEmailUrl(agentId, candid.id), photoDocumentId: null }
}

/**
 * A JOB_PHOTO on this order: the explicit pick, else the pinned one, else
 * the most recent. Each candidate is verified to belong to THIS order before
 * its id becomes a public URL.
 */
async function orderPhotoUrl(
  orderId: string,
  explicitId: string | null | undefined,
  pinnedId: string | null | undefined,
): Promise<ResolvedThankYouPhoto> {
  for (const candidate of [explicitId, pinnedId]) {
    if (!candidate) continue
    const doc = await prisma.orderDocument.findUnique({
      where: { id: candidate },
      select: { orderId: true, type: true },
    })
    if (doc?.orderId === orderId && doc.type === OrderDocType.JOB_PHOTO) {
      return { photoUrl: orderPhotoProxyUrl(candidate), photoDocumentId: candidate }
    }
  }

  const latest = await prisma.orderDocument.findFirst({
    where: { orderId, type: OrderDocType.JOB_PHOTO },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!latest) return NOTHING
  return { photoUrl: orderPhotoProxyUrl(latest.id), photoDocumentId: latest.id }
}

export async function resolveThankYouPhoto(
  args: ResolveThankYouPhotoArgs,
): Promise<ResolvedThankYouPhoto> {
  if (args.source === 'none') return NOTHING
  if (args.source === 'weekly') return weeklyCandidUrl(args.agentId)
  // 'order', or no choice at all — the ladder this route has always walked.
  return orderPhotoUrl(args.orderId, args.photoDocumentId, args.pinnedDocumentId)
}
