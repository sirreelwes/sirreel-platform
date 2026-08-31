import { NextRequest, NextResponse } from 'next/server'
import type { AgreementStatus, ContractType, ReviewDecision } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p, calloutBox } from '@/lib/email/templates/shell'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { computeReadiness } from '@/lib/jobs/readiness'
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/pickup-picklist — the day-before pick-list prompt
 * (Wes 2026-08-31: "If we have jobs with all paperwork and approvals,
 * an email should go out to say 'This job is picking up tomorrow,
 * shall I generate the picklist for the warehouse?'").
 *
 * A SHORT-TERM BRIDGE, explicitly: the digital picking floor
 * (/warehouse/pick) is the destination, and this email exists only
 * until the team works out of it. Runs daily at 20:00 UTC (early
 * afternoon Pacific), finds tomorrow's pickups, and emails the
 * 'pickup-picklists' channel (admin-managed at /admin/notifications):
 *
 *   · READY jobs — all five readiness checks pass (gear · COI ·
 *     agreement · card · driver, the same computeReadiness the /jobs
 *     board renders) — each with a "Print pick list" link straight to
 *     the order's PDF.
 *   · NOT-READY pickups ride along with their blockers named, so the
 *     desk chases the right thing with a day in hand.
 *
 * No email when nothing picks up tomorrow. Stateless and idempotent by
 * design — one scheduled run per day; a manual re-run just re-sends
 * the same digest.
 *
 * Trigger manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://hq.sirreel.com/api/cron/pickup-picklist
 */

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

// Orders that count as "approved and going out": the client said yes
// (or beyond). QUOTE_SENT is a maybe; CANCELLED and the post-return
// states have nothing to pick.
const OUTBOUND_ORDER_STATUSES = ['APPROVED', 'BOOKED', 'LOADED_READY'] as const

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Tomorrow as a Pacific-calendar YYYY-MM-DD (dates store UTC midnight). */
function pacificTomorrowISO(): string {
  const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const t = new Date(`${todayPacific}T00:00:00.000Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

// Mini agreement rollup — the cron needs only SIGNED-or-not. Mirrors
// the /api/jobs rollupAgreementState semantics (a row papered by a
// sibling order counts via coveredByAgreementId) without importing
// from a route file, which may only export handlers.
function agreementState(
  rows: { status: AgreementStatus; coveredByAgreementId: string | null }[],
  liveOrderCount: number,
): 'SIGNED' | 'NONE' {
  if (rows.length === 0) return 'NONE'
  const signed = rows.filter((r) => isSignedAgreementStatus(r.status) || !!r.coveredByAgreementId).length
  return signed === rows.length && rows.length >= liveOrderCount ? 'SIGNED' : 'NONE'
}

// Mirrors /api/jobs rollupCoiState — VERIFIED is the only state
// readiness accepts, so the rest collapse to PENDING here.
function coiState(coi: {
  humanDecision: ReviewDecision
  policyExpiryDate: Date | null
  coverageVerified: boolean
} | null): 'VERIFIED' | 'PENDING' | 'NONE' {
  if (!coi) return 'NONE'
  const expired = coi.policyExpiryDate ? coi.policyExpiryDate.getTime() < Date.now() : false
  if (!expired && coi.humanDecision === 'APPROVED' && coi.coverageVerified) return 'VERIFIED'
  return 'PENDING'
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const tomorrowISO = pacificTomorrowISO()
  const tomorrow = new Date(`${tomorrowISO}T00:00:00.000Z`)

  const jobs = await prisma.job.findMany({
    where: {
      status: { not: 'LOST' },
      archivedAt: null,
      orders: {
        some: {
          startDate: tomorrow,
          status: { in: [...OUTBOUND_ORDER_STATUSES] },
          archivedAt: null,
        },
      },
    },
    select: {
      id: true,
      jobCode: true,
      name: true,
      company: { select: { name: true } },
      coiChecks: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { humanDecision: true, policyExpiryDate: true, coverageVerified: true },
      },
      orders: {
        where: { status: { not: 'CANCELLED' }, archivedAt: null },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          startDate: true,
          description: true,
          lineItems: { select: { type: true } },
          signedAgreements: {
            select: { contractType: true, status: true, coveredByAgreementId: true },
          },
        },
      },
      bookings: {
        where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: {
          paperworkRequests: { select: { id: true } },
          items: {
            select: {
              status: true,
              assignments: {
                select: { status: true, _count: { select: { driverAssignments: true } } },
              },
            },
          },
        },
      },
    },
  })

  interface DigestRow {
    jobCode: string
    jobName: string
    companyName: string
    jobId: string
    orders: { id: string; orderNumber: string; description: string | null }[]
    blockers: string[]
  }
  const ready: DigestRow[] = []
  const notReady: DigestRow[] = []

  for (const j of jobs) {
    // Tomorrow's outbound orders that actually have something to pick.
    const pickingOrders = j.orders.filter(
      (o) =>
        o.startDate &&
        o.startDate.toISOString().slice(0, 10) === tomorrowISO &&
        (OUTBOUND_ORDER_STATUSES as readonly string[]).includes(o.status) &&
        o.lineItems.some((li) => li.type !== 'FEE' && li.type !== 'DISCOUNT' && li.type !== 'LABOR'),
    )
    if (pickingOrders.length === 0) continue

    const liveOrders = j.orders
    const allAgreements = liveOrders.flatMap((o) => o.signedAgreements)
    const rentalRows = allAgreements.filter((a) => a.contractType === ('RENTAL_AGREEMENT' as ContractType))
    const stageRows = allAgreements.filter((a) => a.contractType === ('STAGE_CONTRACT' as ContractType))
    const liveItems = j.bookings.flatMap((b) =>
      b.items.filter((it) => it.status === 'REQUESTED' || it.status === 'ASSIGNED'),
    )
    const activeAssignments = liveItems.flatMap((it) =>
      it.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT'),
    )

    const readiness = computeReadiness({
      coi: coiState(j.coiChecks[0] ?? null),
      rental: agreementState(rentalRows, liveOrders.length),
      stage: stageRows.length > 0 ? agreementState(stageRows, liveOrders.length) : null,
      cardOnFile: j.bookings.some((b) => b.paperworkRequests.length > 0),
      gear: {
        total: liveItems.length,
        assigned: liveItems.filter((it) => it.status === 'ASSIGNED').length,
      },
      drivers: {
        units: activeAssignments.length,
        named: activeAssignments.filter((a) => a._count.driverAssignments > 0).length,
      },
    })

    const row: DigestRow = {
      jobCode: j.jobCode,
      jobName: j.name,
      companyName: j.company?.name ?? '',
      jobId: j.id,
      orders: pickingOrders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, description: o.description })),
      blockers: readiness.blockers.map((b) => b.label),
    }
    if (readiness.ready) ready.push(row)
    else notReady.push(row)
  }

  if (ready.length === 0 && notReady.length === 0) {
    return NextResponse.json({ ok: true, tomorrow: tomorrowISO, ready: 0, notReady: 0, sent: false })
  }

  const to = await channelRecipients('pickup-picklists')
  if (to.length === 0) {
    return NextResponse.json({ ok: true, tomorrow: tomorrowISO, ready: ready.length, notReady: notReady.length, sent: false, reason: 'channel silenced' })
  }

  const dateLabel = new Date(`${tomorrowISO}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })

  const readyHtml = ready
    .map((r) => {
      const orderLinks = r.orders
        .map(
          (o) =>
            `<a href="${HQ_APP_URL}/api/orders/${o.id}/pick-list-pdf" style="font-weight:700;">Print pick list — ${esc(o.orderNumber)}</a>`,
        )
        .join(' · ')
      return p(
        `<strong>${esc(r.jobName)}</strong> — ${esc(r.companyName)} <span style="color:#888;">(${esc(r.jobCode)})</span><br/>` +
          `All paperwork &amp; approvals ✓ &nbsp; ${orderLinks} &nbsp;·&nbsp; <a href="${HQ_APP_URL}/jobs/${r.jobId}">Open job</a>`,
      )
    })
    .join('')

  const notReadyHtml = notReady.length
    ? calloutBox(
        `<strong>Picking up tomorrow but NOT ready yet:</strong><br/>` +
          notReady
            .map(
              (r) =>
                `${esc(r.jobName)} — ${esc(r.companyName)} · missing: ${esc(r.blockers.join(', '))} · <a href="${HQ_APP_URL}/jobs/${r.jobId}">open job</a>`,
            )
            .join('<br/>'),
      )
    : ''

  const heading =
    ready.length > 0
      ? `${ready.length} job${ready.length === 1 ? ' is' : 's are'} picking up tomorrow — print the pick lists?`
      : `Tomorrow's pickups need attention`

  const html = renderEmailShell({
    heading,
    eyebrow: `Pickups · ${dateLabel}`,
    preheader: `${ready.length} ready · ${notReady.length} not ready`,
    bodyHtml:
      (ready.length > 0
        ? p(
            `These jobs pick up tomorrow with all paperwork and approvals in place. ` +
              `Each link prints the warehouse pick list (sign-in required).`,
          ) + readyHtml
        : '') + notReadyHtml,
    footNote:
      'Daily day-before digest — recipients are managed at HQ → Admin → Notifications (Pick-up pick lists). This email is a bridge until picking is fully digital.',
  })
  const text = renderEmailText([
    `Pickups for ${dateLabel}`,
    '',
    ...ready.flatMap((r) => [
      `READY: ${r.jobName} — ${r.companyName} (${r.jobCode})`,
      ...r.orders.map((o) => `  Pick list: ${HQ_APP_URL}/api/orders/${o.id}/pick-list-pdf`),
    ]),
    ...(notReady.length
      ? ['', 'NOT READY:', ...notReady.map((r) => `  ${r.jobName} — ${r.companyName} · missing: ${r.blockers.join(', ')} · ${HQ_APP_URL}/jobs/${r.jobId}`)]
      : []),
  ])

  const result = await sendAgreementEmail({
    to,
    subject:
      ready.length > 0
        ? `Picking up tomorrow: ${ready.length} ready for pick lists${notReady.length ? ` · ${notReady.length} not ready` : ''}`
        : `Picking up tomorrow: ${notReady.length} job${notReady.length === 1 ? '' : 's'} not ready`,
    html,
    text,
    label: 'cron/pickup-picklist',
  })

  return NextResponse.json({
    ok: result.ok,
    tomorrow: tomorrowISO,
    ready: ready.length,
    notReady: notReady.length,
    sent: result.ok,
    recipients: to,
  })
}
