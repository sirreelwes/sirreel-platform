/**
 * GET /api/orders/thank-yous — queue feed for the dashboard widget.
 *
 * Returns every SUGGESTED ThankYouSuggestion plus the surrounding
 * context the rep needs to triage at a glance:
 *   - client + order + job
 *   - agent (sales rep on this order — also the reply-to on send)
 *   - photo status (any OrderDocument.JOB_PHOTO on the order, or the
 *     pinned suggestion.photoDocumentId)
 *   - wrap date (Order.endDate) + age days
 *   - warn flags: open Incident on the order, unresolved L&D
 *
 * Query params:
 *   scope=mine  — limit to suggestions on orders where the session
 *                 user is the agent. Default: all visible.
 *   status     — SUGGESTED (default) | SENT | DISMISSED | ALL
 *
 * Visual expiry (>14 days old) is computed client-side off createdAt;
 * the server does not filter expired rows — letting the rep see the
 * graveyard is the point of the audit lane.
 *
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { OrderDocType, ThankYouStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_STATUS = new Set<string>(Object.values(ThankYouStatus))

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const scope = sp.get('scope')
  const statusParam = sp.get('status')?.toUpperCase() ?? 'SUGGESTED'
  const statusFilter =
    statusParam === 'ALL'
      ? undefined
      : VALID_STATUS.has(statusParam) ? (statusParam as ThankYouStatus) : ThankYouStatus.SUGGESTED

  const rows = await prisma.thankYouSuggestion.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(scope === 'mine' ? { order: { agentId: user.id } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      photoDocumentId: true,
      personalNote: true,
      sentAt: true,
      sentToEmail: true,
      dismissedReason: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          startDate: true,
          endDate: true,
          status: true,
          company: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true, email: true, displayTitle: true } },
          jobContact: { select: { id: true, firstName: true, lastName: true, email: true } },
          job: { select: { id: true, jobCode: true, name: true } },
          // Open incidents (anything not RESOLVED / WRITTEN_OFF).
          // Open Incident is the proxy for "unresolved L&D" — every
          // damage stream flows through Incident now (per the STEP 1
          // Incident-hub work), and an open Incident means at least
          // one downstream branch (claim / bill / write-off) is still
          // in flight.
          incidents: {
            select: {
              id: true,
              incidentNumber: true,
              status: true,
              damageItems: { select: { id: true } },
            },
            where: { status: { notIn: ['RESOLVED', 'WRITTEN_OFF'] } },
          },
          // All JOB_PHOTOs uploaded to this order — surfaces "no
          // photo yet" vs "photo uploaded" in the widget.
          documents: {
            where: { type: OrderDocType.JOB_PHOTO },
            select: { id: true, fileUrl: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      },
      photoDocument: {
        select: { id: true, fileUrl: true, title: true, createdAt: true },
      },
    },
  })

  const items = rows.map((r) => {
    const ageDays = Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000)
    const wrapDays = r.order.endDate
      ? Math.floor((Date.now() - r.order.endDate.getTime()) / 86_400_000)
      : null
    return {
      id: r.id,
      status: r.status,
      photoDocumentId: r.photoDocumentId,
      photoDocument: r.photoDocument,
      personalNote: r.personalNote,
      sentAt: r.sentAt,
      sentToEmail: r.sentToEmail,
      dismissedReason: r.dismissedReason,
      createdAt: r.createdAt,
      ageDays,
      expired: ageDays > 14,
      orderId: r.order.id,
      orderNumber: r.order.orderNumber,
      orderStatus: r.order.status,
      wrapDate: r.order.endDate,
      wrapDays,
      company: r.order.company,
      agent: r.order.agent,
      jobContact: r.order.jobContact,
      job: r.order.job,
      jobPhotos: r.order.documents,
      hasPhoto: r.photoDocumentId !== null || r.order.documents.length > 0,
      flags: {
        openIncident: r.order.incidents.length > 0,
        incidents: r.order.incidents.map((i) => ({
          id: i.id,
          incidentNumber: i.incidentNumber,
          status: i.status,
          damageItemCount: i.damageItems.length,
        })),
        unresolvedLd: r.order.incidents.some((i) => i.damageItems.length > 0),
      },
    }
  })

  const counts = await prisma.thankYouSuggestion.groupBy({
    by: ['status'],
    _count: { _all: true },
  })

  return NextResponse.json({
    items,
    counts: counts.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = c._count._all
      return acc
    }, {}),
  })
}
