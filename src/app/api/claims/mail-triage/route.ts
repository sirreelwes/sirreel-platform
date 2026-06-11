/**
 * GET /api/claims/mail-triage
 *
 * Recent claims@ EmailMessage rows with their ClaimMail disposition
 * (DRAFTED / ATTACHED / NEEDS_REVIEW / IGNORED). Drives the triage
 * widget at the top of /claims.
 *
 * Default view: undismissed rows from the last 30 days, newest first.
 * Query params:
 *   ?days=N         — lookback window (defaults 30; capped at 180)
 *   ?includeDismissed=1 — show rows the rep already actioned
 *   ?disposition=NEEDS_REVIEW (one of the enum values) — filter
 *
 * Auth: getServerSession-guarded read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { ClaimMailDisposition } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_DISPOSITIONS: ClaimMailDisposition[] = [
  'DRAFTED', 'ATTACHED', 'NEEDS_REVIEW', 'IGNORED',
]

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const daysRaw = Number(sp.get('days') ?? '30')
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 180) : 30
  const includeDismissed = sp.get('includeDismissed') === '1'
  const dispParam = sp.get('disposition')
  const disposition = dispParam && (VALID_DISPOSITIONS as string[]).includes(dispParam)
    ? (dispParam as ClaimMailDisposition)
    : null

  const since = new Date(Date.now() - days * 86_400_000)

  const rows = await prisma.claimMail.findMany({
    where: {
      createdAt: { gte: since },
      ...(includeDismissed ? {} : { dismissed: false }),
      ...(disposition ? { disposition } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      disposition: true,
      parse: true,
      claimId: true,
      reason: true,
      dismissed: true,
      reviewedAt: true,
      createdAt: true,
      reviewedBy: { select: { id: true, name: true } },
      emailMessage: {
        select: {
          id: true,
          gmailMessageId: true,
          fromAddress: true,
          subject: true,
          sentAt: true,
          snippet: true,
          attachmentCount: true,
        },
      },
      claim: {
        select: {
          id: true,
          claimNumber: true,
          status: true,
          filedAgainst: true,
        },
      },
      // Phase Incidents — surface the Incident link so the widget can
      // render "View incident SR-INC-NNNN" for any row that's already
      // been opened (either via the action button OR via the DRAFTED
      // auto-create path OR via thread-level back-link from a sibling
      // row on the same Gmail thread).
      incidentId: true,
      incident: {
        select: {
          id: true,
          incidentNumber: true,
          status: true,
        },
      },
    },
  })

  return NextResponse.json({ rows })
}
