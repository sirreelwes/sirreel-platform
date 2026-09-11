/**
 * GET /api/jobs/[id]/welcome — where the job's WELCOME email stands, for
 * the job page's "Send welcome email" button.
 *
 * Reads the same two facts the /jobs tile reads (lib/jobs/welcomeReminder):
 * the newest quote sent on a live order, and the newest `job.welcome_sent`
 * audit row. Plus what the button needs to label itself: the ranked
 * recipient and whether the job has a client job page to link to.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { rankRecipients } from '@/lib/email/recipients'
import { WELCOME_SENT_ACTION, welcomeSignal } from '@/lib/jobs/welcomeReminder'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const [job, sent] = await Promise.all([
    prisma.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        orders: { select: { status: true, archivedAt: true, quoteSentAt: true, portalSlug: true } },
        jobContacts: {
          orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
          select: {
            role: true,
            isPrimary: true,
            person: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    }),
    prisma.auditLog.findFirst({
      where: { entityType: 'Job', entityId: params.id, action: WELCOME_SENT_ACTION },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, newValues: true },
    }),
  ])
  if (!job) return NextResponse.json({ ok: false, error: 'job not found' }, { status: 404 })

  const signal = welcomeSignal({ jobStatus: job.status, orders: job.orders, sentAt: sent?.createdAt ?? null })
  const to = rankRecipients({ jobContacts: job.jobContacts }, null)[0] ?? null
  const hasPortal = job.orders.some(
    (o) => o.status !== 'CANCELLED' && !o.archivedAt && !!o.portalSlug,
  )
  const sentTo =
    sent?.newValues && typeof sent.newValues === 'object' && !Array.isArray(sent.newValues)
      ? ((sent.newValues as { to?: unknown }).to as string | undefined) ?? null
      : null

  return NextResponse.json({
    ok: true,
    state: signal.state,
    quotedAt: signal.quotedAt?.toISOString() ?? null,
    sentAt: signal.sentAt?.toISOString() ?? null,
    sentTo,
    to: to ? { id: to.id, name: to.name, email: to.email } : null,
    hasPortal,
  })
}
