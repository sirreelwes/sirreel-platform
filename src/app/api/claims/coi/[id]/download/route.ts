/**
 * GET /api/claims/coi/[id]/download
 *
 * Gated proxy for a `CoiCheck` blob — the COI PDF / image clients
 * upload through the portal. Same private-blob, same gate, same
 * stream-through pattern as /api/claims/documents/[id]/download.
 *
 * Distinct model (CoiCheck has its own `fileUrl` and an
 * `originalFilename` field unlike ClaimDocument) so a separate route
 * is cleaner than overloading the documents one.
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
  const coi = await prisma.coiCheck.findUnique({
    where: { id },
    select: { id: true, fileUrl: true, originalFilename: true },
  })
  if (!coi || !coi.fileUrl) {
    return NextResponse.json({ error: 'COI not found' }, { status: 404 })
  }

  return streamPrivateBlobAsResponse({
    fileUrl: coi.fileUrl,
    filename: coi.originalFilename || `coi-${coi.id}`,
  })
}
