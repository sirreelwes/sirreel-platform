/**
 * /admin/improvements — the to-do list of everything anyone has reported.
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
import { BugStatsRail } from '@/components/admin/BugStatsRail'
import { SEVERITY_RANK } from '@/lib/bugs/vocab'
import { bugStats, EMPTY_STATS } from '@/lib/bugs/stats'

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
  // Computed alongside the list rather than inside BugBoard: the board is a
  // client component, and shipping a second copy of every row to the browser
  // just to count them would be silly.
  const stats = await bugStats()
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
        context: (r.context as BoardReport['context']) ?? null,
        missingContext: r.missingContext,
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

  return (
    <div className="max-w-[1180px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-lt-fg">Improvements</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[74ch]">
          Everything staff have reported from HQ Help — broken mechanics, confusing screens,
          colours nobody can read — sorted by an agent that reads each one as it lands: how bad,
          whether the system is genuinely wrong or the screen is just wrong about it, and whether
          it needed Wes. Repeats fold into the report they repeat.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_230px] lg:items-start">
        <div className="min-w-0">
          <BugBoard reports={reports} setupNeeded={setupNeeded} />
        </div>
        <BugStatsRail stats={setupNeeded ? EMPTY_STATS : stats} />
      </div>
    </div>
  )
}
