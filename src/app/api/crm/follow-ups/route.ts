/**
 * GET /api/crm/follow-ups — merged list of open follow-ups across the
 * legacy Activity model AND the new OutreachActivity model. Feeds the
 * FOLLOW-UPS DUE drill-down on /crm.
 *
 * Query params:
 *   scope=mine    — limit to follow-ups created by the session user
 *                   (Activity.agentId === user OR OutreachActivity.
 *                   createdById === user). Default: all visible to the
 *                   caller (admins see all; the strip already shows
 *                   the same aggregated count so the list is the
 *                   logical drill-down).
 *
 * Returns:
 *   {
 *     rows: [{
 *       kind: 'activity' | 'outreach',
 *       id, due, notes/subject, createdBy{ id, name },
 *       person?{ id, firstName, lastName, email },
 *       company?{ id, name },
 *       type?,            // OutreachActivity only
 *       activityType?     // legacy Activity only
 *     }],
 *     counts: { activity, outreach, total }
 *   }
 *
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const scopeMine = sp.get('scope') === 'mine'
  const now = new Date()

  let userId: string | null = null
  if (scopeMine) {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    })
    userId = user?.id ?? null
  }

  const [activities, outreach] = await Promise.all([
    prisma.activity.findMany({
      where: {
        completed: false,
        dueDate: { lte: now, not: null },
        ...(userId ? { agentId: userId } : {}),
      },
      orderBy: { dueDate: 'asc' },
      take: 100,
      select: {
        id: true,
        type: true,
        subject: true,
        body: true,
        dueDate: true,
        agent: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
        company: { select: { id: true, name: true } },
      },
    }),
    prisma.outreachActivity.findMany({
      where: {
        followUpDone: false,
        followUpAt: { lte: now, not: null },
        ...(userId ? { createdById: userId } : {}),
      },
      orderBy: { followUpAt: 'asc' },
      take: 100,
      select: {
        id: true,
        type: true,
        notes: true,
        followUpAt: true,
        createdBy: { select: { id: true, name: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
        company: { select: { id: true, name: true } },
      },
    }),
  ])

  type Row = {
    kind: 'activity' | 'outreach'
    id: string
    due: Date
    notes: string
    createdBy: { id: string; name: string }
    person: { id: string; firstName: string; lastName: string; email: string } | null
    company: { id: string; name: string } | null
    type: string | null
    activityType: string | null
  }

  const rows: Row[] = [
    ...activities.map((a): Row => ({
      kind: 'activity',
      id: a.id,
      due: a.dueDate!,
      notes: a.subject ? `${a.subject}: ${a.body}` : a.body,
      createdBy: a.agent,
      person: a.person,
      company: a.company,
      type: null,
      activityType: a.type,
    })),
    ...outreach.map((o): Row => ({
      kind: 'outreach',
      id: o.id,
      due: o.followUpAt!,
      notes: o.notes,
      createdBy: o.createdBy,
      person: o.person,
      company: o.company,
      type: o.type,
      activityType: null,
    })),
  ].sort((a, b) => a.due.getTime() - b.due.getTime())

  return NextResponse.json({
    rows,
    counts: {
      activity: activities.length,
      outreach: outreach.length,
      total: activities.length + outreach.length,
    },
  })
}
