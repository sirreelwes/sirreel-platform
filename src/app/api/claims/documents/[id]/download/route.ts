/**
 * GET /api/claims/documents/[id]/download
 *
 * Gated proxy for a `ClaimDocument` blob. Replaces `<a href={fileUrl}>`
 * everywhere a claim/incident document is surfaced — the raw blob URL
 * returns "Forbidden" because the blob is uploaded with
 * `access: 'private'` and `@vercel/blob` has no signed-URL API.
 *
 * Gate: requireIncidentEditAccess (canManageClaims = ADMIN role OR
 * email allowlist — today Wes / Dani / Ana). Same gate as every
 * other incident-worklist mutation; claim documents are part of the
 * same workflow.
 *
 * Behavior:
 *   - PDFs / images → Content-Disposition: inline (open in new tab)
 *   - Everything else → attachment (force-download)
 *   - Filename derived from ClaimDocument.title for the browser; the
 *     underlying blob key never leaves the server.
 *
 * 404 vs 403:
 *   - 404 when the document id doesn't exist OR the blob's gone
 *   - 403 (via the gate) when the caller isn't in the claims pod
 * We deliberately don't differentiate "exists but you can't see it"
 * vs "doesn't exist" past the gate — there's no per-document ACL
 * today (the gate IS the ACL), so the distinction has no meaning.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireIncidentEditAccess } from '@/lib/incidents/auth'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireIncidentEditAccess()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const doc = await prisma.claimDocument.findUnique({
    where: { id },
    select: { id: true, title: true, fileUrl: true, type: true },
  })
  if (!doc || !doc.fileUrl) {
    return NextResponse.json({ error: 'document not found' }, { status: 404 })
  }

  return streamPrivateBlobAsResponse({
    fileUrl: doc.fileUrl,
    filename: doc.title || `claim-document-${doc.id}`,
  })
}
