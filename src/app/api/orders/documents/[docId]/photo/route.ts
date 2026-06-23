/**
 * GET /api/orders/documents/[docId]/photo
 *
 * Public-by-uuid proxy for order JOB_PHOTO candids. The blobs live in
 * the PRIVATE store (uploadOrderDocument.ts), so their raw URLs 403 on
 * direct fetch. This route streams the blob via the shared
 * `streamPrivateBlobAsResponse` helper.
 *
 * Intentionally UNAUTHENTICATED: the thank-you email embeds the photo
 * as `<img src>` for an external recipient who has no HQ session, so a
 * session gate would 403 in their inbox. Access is gated instead by the
 * unguessable `OrderDocument.id` (a uuid) — the same "URL knowledge =
 * access" posture the candids had when they were public blobs. Scoped
 * to `type = JOB_PHOTO` so only client-facing candids are reachable
 * this way; any other order-doc type would need a session-gated route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { OrderDocType } from '@prisma/client'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ docId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { docId } = await params
  const doc = await prisma.orderDocument.findUnique({
    where: { id: docId },
    select: { fileUrl: true, type: true, title: true, mimeType: true },
  })
  if (!doc || doc.type !== OrderDocType.JOB_PHOTO) {
    return NextResponse.json({ error: 'photo not found' }, { status: 404 })
  }
  return streamPrivateBlobAsResponse({ fileUrl: doc.fileUrl, filename: doc.title || 'photo' })
}
