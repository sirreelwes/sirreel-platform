/**
 * GET /api/hr/mail-triage
 *
 * Recent NEEDS_REVIEW HrMail rows. Drives the triage strip at the
 * top of /hr. Allowlist-gated.
 *
 * Query params:
 *   ?days=N            — lookback window (default 30, cap 180)
 *   ?includeDismissed=1 — show rows the rep already actioned
 *   ?disposition=...   — filter (default NEEDS_REVIEW)
 */

import { NextRequest, NextResponse } from 'next/server'
import type { HrDisposition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireHrAccess } from '@/lib/hr/allowlist'

export const dynamic = 'force-dynamic'

const VALID: HrDisposition[] = ['FILED', 'NEEDS_REVIEW', 'IGNORED']

export async function GET(req: NextRequest) {
  const gate = await requireHrAccess()
  if (gate instanceof NextResponse) return gate

  const sp = new URL(req.url).searchParams
  const daysRaw = Number(sp.get('days') ?? '30')
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 180) : 30
  const includeDismissed = sp.get('includeDismissed') === '1'
  const dParam = sp.get('disposition')
  const disposition = dParam && (VALID as string[]).includes(dParam)
    ? (dParam as HrDisposition)
    : ('NEEDS_REVIEW' as HrDisposition)

  const since = new Date(Date.now() - days * 86_400_000)

  const rows = await prisma.hrMail.findMany({
    where: {
      createdAt: { gte: since },
      disposition,
      ...(includeDismissed ? {} : { dismissed: false }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, category: true, disposition: true,
      parse: true, reason: true, dismissed: true,
      reviewedAt: true, createdAt: true,
      employee: { select: { id: true, fullName: true } },
      hrEmail: {
        select: {
          id: true, fromAddress: true, subject: true, sentAt: true,
          attachmentCount: true,
        },
      },
    },
  })

  return NextResponse.json({ rows })
}
