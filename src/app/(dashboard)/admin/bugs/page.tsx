/**
 * /admin/bugs — the to-do list of everything anyone has reported.
 *
 * Wes 2026-09-18: "make a to-do list of all the issues that have come
 * through from every person interacting with the site."
 *
 * A list, not an inbox. The difference is `duplicateOfId`: repeats fold
 * into the report they repeat, so one broken button is one row with a
 * "3 people" count rather than three rows nobody dares close. Order is
 * severity first — the agent's blockers sit at the top and the cosmetic
 * ones sink — and anything the agent could not sort (a model outage) is
 * pulled up near the top too, because an unsorted report is the one most
 * likely to be quietly lost.
 *
 * ADMIN and MANAGER. Reporters see their own rows on HQ Help instead.
 */

import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BugBoard, type BoardReport } from '@/components/admin/BugBoard'
import { SEVERITY_RANK } from '@/lib/bugs/vocab'

export const dynamic = 'force-dynamic'

export default async function BugBoardPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/login')
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  })
  if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') redirect('/guides')

  let reports: BoardReport[] = []
  let setupNeeded = false
  try {
    const rows = await prisma.bugReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        _count: { select: { duplicates: true } },
        duplicates: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, reportedByName: true, body: true, createdAt: true },
        },
      },
    })
    reports = rows
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        body: r.body,
        title: r.title,
        area: r.area,
        severity: r.severity,
        kind: r.kind,
        routing: r.routing,
        status: r.status,
        reasoning: r.reasoning,
        response: r.response,
        suspects: r.suspects,
        reportedByName: r.reportedByName,
        reportedByEmail: r.reportedByEmail,
        reportedByRole: r.reportedByRole,
        pagePath: r.pagePath,
        triagedAt: r.triagedAt?.toISOString() ?? null,
        triageError: r.triageError,
        escalatedAt: r.escalatedAt?.toISOString() ?? null,
        duplicateOfId: r.duplicateOfId,
        duplicateCount: r._count.duplicates,
        alsoReportedBy: r.duplicates.map((d) => ({
          id: d.id,
          name: d.reportedByName,
          body: d.body,
          createdAt: d.createdAt.toISOString(),
        })),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedByEmail: r.resolvedByEmail,
        resolutionNote: r.resolutionNote,
      }))
      // Worst first, then the most-reported, then oldest — an issue three
      // people have hit outranks a newer one of the same severity.
      .sort((a, b) => {
        const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        if (rank !== 0) return rank
        if (a.duplicateCount !== b.duplicateCount) return b.duplicateCount - a.duplicateCount
        return a.createdAt.localeCompare(b.createdAt)
      })
  } catch {
    setupNeeded = true
  }

  return <BugBoard reports={reports} setupNeeded={setupNeeded} />
}
