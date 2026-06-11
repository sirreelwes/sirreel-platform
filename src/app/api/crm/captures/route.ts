/**
 * GET /api/crm/captures — list capture rows for the review widget.
 *
 * Query params:
 *   verdict   — NEEDS_REVIEW (default) | AUTO_CAPTURED | SKIPPED | ALL
 *   days      — lookback window in days, default 14 (cap 180)
 *   includeResolved — '1' to include resolved NEEDS_REVIEW rows
 *
 * Always returns counts: `{ rows, counts: { capturedThisWeek,
 * needsReview, skippedThisWeek } }` so the widget header doesn't have
 * to do a second round-trip.
 *
 * Auth: getServerSession. /crm page already gates access; the route
 * matches the existing claim-mail-triage pattern (session-only) since
 * sales perms apply to every CRM user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { CaptureVerdict } from '@prisma/client'

export const dynamic = 'force-dynamic'

const WEEK_MS = 7 * 86_400_000

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const verdictParam = (sp.get('verdict') ?? 'NEEDS_REVIEW').toUpperCase()
  const daysRaw = Number(sp.get('days') ?? '14')
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 180) : 14
  const includeResolved = sp.get('includeResolved') === '1'
  const cutoff = new Date(Date.now() - days * 86_400_000)

  const verdictFilter: { in: CaptureVerdict[] } | undefined =
    verdictParam === 'ALL'
      ? undefined
      : verdictParam === 'AUTO_CAPTURED'
        ? { in: [CaptureVerdict.AUTO_CAPTURED] }
        : verdictParam === 'SKIPPED'
          ? { in: [CaptureVerdict.SKIPPED] }
          : { in: [CaptureVerdict.NEEDS_REVIEW] }

  const rows = await prisma.inquiryCapture.findMany({
    where: {
      createdAt: { gte: cutoff },
      ...(verdictFilter ? { verdict: verdictFilter } : {}),
      ...(verdictParam === 'NEEDS_REVIEW' && !includeResolved
        ? { resolution: 'PENDING' }
        : {}),
      // Parent rows only — children of a pending dedup attach to
      // their parent and are surfaced inside the thread viewer.
      attachedToCaptureId: null,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      verdict: true,
      resolution: true,
      verdictReason: true,
      signals: true,
      inbox: true,
      parsedName: true,
      parsedEmail: true,
      parsedPhone: true,
      parsedTitle: true,
      parsedCompanyString: true,
      parsedProject: true,
      personId: true,
      companyId: true,
      enrichmentLog: true,
      createdAt: true,
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
      company: { select: { id: true, name: true } },
      emailMessage: {
        select: { id: true, subject: true, fromAddress: true, sentAt: true },
      },
      // +N more on this thread badge.
      _count: { select: { attachedChildren: true } },
    },
  })

  const weekCutoff = new Date(Date.now() - WEEK_MS)
  const [capturedThisWeek, needsReview, skippedThisWeek] = await Promise.all([
    prisma.inquiryCapture.count({
      where: { verdict: CaptureVerdict.AUTO_CAPTURED, createdAt: { gte: weekCutoff } },
    }),
    prisma.inquiryCapture.count({
      where: { verdict: CaptureVerdict.NEEDS_REVIEW, resolution: 'PENDING' },
    }),
    prisma.inquiryCapture.count({
      where: { verdict: CaptureVerdict.SKIPPED, createdAt: { gte: weekCutoff } },
    }),
  ])

  return NextResponse.json({
    rows,
    counts: { capturedThisWeek, needsReview, skippedThisWeek },
  })
}
