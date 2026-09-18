/**
 * POST /api/portal/job/dates/request — the client, on their job portal,
 * asks to move the pickup or the return.
 *
 * Wes 2026-09-18, on the L'anza job: "client said they wanted to change the
 * pickup date but couldn't figure out how to do that." They couldn't: the
 * Schedule card printed two dates and offered nothing beside them.
 *
 * Takes the ask and NOTHING else. No Order date is written, no hold moves,
 * no unit is re-stamped, no price is recalculated — the standing rule (Wes
 * 2026-09-11) is that a client's words never change a job on their own, and
 * moving dates is the single most cascading edit in the system (it
 * re-prices every line and can collide with another production). A rep
 * applies it through "Change dates…", which shows them that cascade first.
 *
 * Cookie-auth'd like every other /api/portal/job route. The ORDER comes
 * from the session, never the body — a client cannot ask against an order
 * they hold no portal for.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import {
  recordDateChangeRequest,
  DATE_CHANGE_TABLE_HINT,
} from '@/lib/portal/dateChangeRequest'
import { checkAsk, movedOnly, toDay, NOTE_MAX } from '@/lib/portal/dateChangeRules'
import { todayPacific } from '@/lib/sales/quoteUrgency'
import { sendOnJobThread } from '@/lib/email/jobThread'
import { buildDateChangeRequested } from '@/lib/email/templates/dateChangeRequested'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'

export const dynamic = 'force-dynamic'

const HQ = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      status: true,
      jobId: true,
      agent: { select: { email: true, name: true } },
      company: { select: { name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // A finished or cancelled rental has no dates left to move. Say so rather
  // than filing an ask nobody can act on.
  if (order.status === 'CANCELLED' || order.status === 'CLOSED') {
    return NextResponse.json(
      { error: 'This order is closed. Call your rep if something needs to change.' },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const asDay = (v: unknown): string | null =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''

  // A box the client did not fill is null; a box they cleared is also null.
  // Either way it means "leave this one alone" — see movedOnly().
  const ask = {
    start: asDay(body.startDate),
    end: asDay(body.endDate),
    note,
  }
  const current = { start: toDay(order.startDate), end: toDay(order.endDate) }

  const problem = checkAsk(ask, current, todayPacific())
  if (problem) return NextResponse.json({ error: problem.message, code: problem.code }, { status: 400 })

  const moved = movedOnly(ask, current)
  const contact = resolved.contact
  const askedByName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null
  const askedByEmail = contact?.email ?? null

  let request: { id: string; createdAt: Date }
  try {
    request = await recordDateChangeRequest({
      orderId: order.id,
      jobId: order.jobId,
      personId: contact?.id ?? null,
      name: askedByName,
      email: askedByEmail,
      currentStart: current.start,
      currentEnd: current.end,
      requestedStart: moved.start,
      requestedEnd: moved.end,
      note: note || null,
      source: 'JOB_PORTAL',
    })
  } catch (err) {
    // The table has not been created yet. Tell them honestly that this
    // did not reach anyone rather than showing a tick over nothing.
    if (err instanceof Error && err.message === DATE_CHANGE_TABLE_HINT) {
      console.error('[portal/dates/request]', DATE_CHANGE_TABLE_HINT)
      return NextResponse.json(
        { error: 'We could not file that just now. Please call your rep and they will move it for you.' },
        { status: 503 },
      )
    }
    throw err
  }

  // ── Tell the desk, on the job's own thread ────────────────────────────
  // The ask belongs in the job's one conversation (Phase 1/2), so it is
  // sent through sendOnJobThread with the job id. The client is NOT a
  // recipient — this is HQ's copy of their request — but Reply-To is the
  // person who asked, so answering them is one keystroke.
  const mail = buildDateChangeRequested({
    jobName: order.job?.name ?? null,
    jobCode: order.job?.jobCode ?? null,
    orderNumber: order.orderNumber,
    companyName: order.company?.name ?? null,
    askedByName,
    askedByEmail,
    currentStart: current.start,
    currentEnd: current.end,
    requestedStart: moved.start,
    requestedEnd: moved.end,
    note: note || null,
    orderUrl: `${HQ}/orders/${order.id}#date-change-request`,
  })
  const to = dedupeEmails([
    order.agent?.email,
    ...(await channelRecipients('sales-team-cc')),
  ].filter(Boolean) as string[])
  if (to.length) {
    void sendOnJobThread({
      jobId: order.jobId,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: askedByEmail ?? undefined,
      label: `date-change-request:${order.orderNumber}`,
    }).catch((e) => console.error('[portal/dates/request] notify failed:', e))
  }

  await prisma.auditLog
    .create({
      data: {
        action: 'order.date_change_requested',
        entityType: 'Order',
        entityId: order.id,
        newValues: {
          requestId: request.id,
          requestedStartDate: moved.start,
          requestedEndDate: moved.end,
          currentStartDate: current.start,
          currentEndDate: current.end,
          askedBy: askedByEmail,
          // The words are on the job's thread, not duplicated into the log.
          hasNote: !!note,
        },
      },
    })
    .catch((e) => console.error('[portal/dates/request] audit failed:', e))

  return NextResponse.json({
    ok: true,
    requestedAt: request.createdAt.toISOString(),
    requestedStartDate: moved.start,
    requestedEndDate: moved.end,
    note: note || null,
  })
}
