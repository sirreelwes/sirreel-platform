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
 * until the team works out of it. Runs each WEEKDAY at 20:00 UTC (early
 * afternoon Pacific), finds the pickups between tomorrow and the next
 * working day inclusive — so Friday's run carries Saturday, Sunday AND
 * Monday (Wes: "stuff for Monday should go out on Friday") — and emails
 * the 'pickup-picklists' channel (admin-managed at /admin/notifications):
 *
 *   · READY jobs — all five readiness checks pass (gear · COI ·
 *     agreement · card · driver, the same computeReadiness the /jobs
 *     board renders) — each with a "Print pick list" link straight to
 *     the order's PDF.
 *   · NOT-READY pickups ride along with their blockers named, so the
 *     desk chases the right thing with a day in hand.
 *
 * No email when nothing picks up in the window. Stateless and idempotent
 * by design — one scheduled run per weekday, and consecutive windows tile
 * exactly (no gap, no repeat); a manual re-run just re-sends the same
 * digest.
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

/** Today as a Pacific-calendar YYYY-MM-DD (dates store UTC midnight). */
function pacificTodayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

const isWeekday = (iso: string): boolean => {
  const dow = new Date(`${iso}T00:00:00.000Z`).getUTCDay()
  return dow >= 1 && dow <= 5
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The pickup dates this run must cover: tomorrow through the next
 * WORKING day (Wes 2026-08-31: "stuff for Monday should go out on
 * Friday").
 *
 * Nobody reads this in the warehouse on a Saturday, so a Friday digest
 * that stopped at Saturday would leave Monday's pickups unannounced
 * until Monday morning — too late to chase a blocker. Friday therefore
 * covers Sat + Sun + Mon; Mon–Thu cover just tomorrow. Consecutive
 * runs tile exactly: no gap, no repeat.
 *
 * Deliberately weekday-only, NOT holiday-aware — a holiday calendar is
 * state nobody maintains, and the failure mode (a holiday-Monday
 * digest arriving on Friday as usual) is harmless.
 */
function coverageWindow(todayISO: string): { start: string; end: string; days: string[] } {
  const start = addDays(todayISO, 1)
  let end = start
  while (!isWeekday(end)) end = addDays(end, 1)
  const days: string[] = []
  for (let d = start; ; d = addDays(d, 1)) {
    days.push(d)
    if (d === end) break
  }
  return { start, end, days }
}

/** "Tuesday, September 1" — UTC because these are calendar dates. */
function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
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

  const todayISO = pacificTodayISO()
  const { start, end, days } = coverageWindow(todayISO)
  const windowSet = new Set(days)

  const jobs = await prisma.job.findMany({
    where: {
      status: { not: 'LOST' },
      archivedAt: null,
      orders: {
        some: {
          startDate: {
            gte: new Date(`${start}T00:00:00.000Z`),
            lte: new Date(`${end}T00:00:00.000Z`),
          },
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
    /** Earliest covered pickup date on this job — sorts and labels the row. */
    pickupDate: string
    orders: { id: string; orderNumber: string; description: string | null }[]
    blockers: string[]
  }
  const ready: DigestRow[] = []
  const notReady: DigestRow[] = []

  for (const j of jobs) {
    // Outbound orders inside the coverage window that actually have
    // something to pick.
    const pickingOrders = j.orders.filter(
      (o) =>
        o.startDate &&
        windowSet.has(o.startDate.toISOString().slice(0, 10)) &&
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
      pickupDate: pickingOrders
        .map((o) => o.startDate!.toISOString().slice(0, 10))
        .sort()[0],
      orders: pickingOrders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, description: o.description })),
      blockers: readiness.blockers.map((b) => b.label),
    }
    if (readiness.ready) ready.push(row)
    else notReady.push(row)
  }

  if (ready.length === 0 && notReady.length === 0) {
    return NextResponse.json({ ok: true, window: { start, end }, ready: 0, notReady: 0, sent: false })
  }

  const to = await channelRecipients('pickup-picklists')
  if (to.length === 0) {
    return NextResponse.json({ ok: true, window: { start, end }, ready: ready.length, notReady: notReady.length, sent: false, reason: 'channel silenced' })
  }

  // Sort by the day each job goes out — a Friday digest reads Sat → Mon.
  const byDate = (a: DigestRow, b: DigestRow) => a.pickupDate.localeCompare(b.pickupDate)
  ready.sort(byDate)
  notReady.sort(byDate)

  // Multi-day runs (Friday's) name the day on every row; a one-day run
  // says "tomorrow" once in the heading and never repeats itself.
  const multiDay = days.length > 1
  const dateLabel = multiDay ? `${dayLabel(start)} – ${dayLabel(end)}` : dayLabel(start)
  const whenChip = (iso: string) =>
    multiDay ? ` <span style="color:#888;">· ${esc(dayLabel(iso))}</span>` : ''

  const readyHtml = ready
    .map((r) => {
      const orderLinks = r.orders
        .map(
          (o) =>
            `<a href="${HQ_APP_URL}/api/orders/${o.id}/pick-list-pdf" style="font-weight:700;">Print pick list — ${esc(o.orderNumber)}</a>`,
        )
        .join(' · ')
      return p(
        `<strong>${esc(r.jobName)}</strong> — ${esc(r.companyName)} <span style="color:#888;">(${esc(r.jobCode)})</span>${whenChip(r.pickupDate)}<br/>` +
          `All paperwork &amp; approvals ✓ &nbsp; ${orderLinks} &nbsp;·&nbsp; <a href="${HQ_APP_URL}/jobs/${r.jobId}">Open job</a>`,
      )
    })
    .join('')

  const notReadyHtml = notReady.length
    ? calloutBox(
        `<strong>Picking up ${multiDay ? 'before the next working day' : 'tomorrow'} but NOT ready yet:</strong><br/>` +
          notReady
            .map(
              (r) =>
                `${esc(r.jobName)} — ${esc(r.companyName)}${whenChip(r.pickupDate)} · missing: ${esc(r.blockers.join(', '))} · <a href="${HQ_APP_URL}/jobs/${r.jobId}">open job</a>`,
            )
            .join('<br/>'),
      )
    : ''

  const when = multiDay ? `through ${dayLabel(end)}` : 'tomorrow'
  const heading =
    ready.length > 0
      ? `${ready.length} job${ready.length === 1 ? ' is' : 's are'} picking up ${when} — print the pick lists?`
      : `Pickups ${when} need attention`

  const html = renderEmailShell({
    heading,
    eyebrow: `Pickups · ${dateLabel}`,
    preheader: `${ready.length} ready · ${notReady.length} not ready`,
    bodyHtml:
      (ready.length > 0
        ? p(
            `These jobs pick up ${when} with all paperwork and approvals in place. ` +
              `Each link prints the warehouse pick list (sign-in required).` +
              (multiDay
                ? ` It's the last working day before them — Monday's pickups are included here.`
                : ''),
          ) + readyHtml
        : '') + notReadyHtml,
    footNote:
      'Daily day-before digest — recipients are managed at HQ → Admin → Notifications (Pick-up pick lists). This email is a bridge until picking is fully digital.',
  })
  const text = renderEmailText([
    `Pickups for ${dateLabel}`,
    '',
    ...ready.flatMap((r) => [
      `READY: ${r.jobName} — ${r.companyName} (${r.jobCode})${multiDay ? ` · ${dayLabel(r.pickupDate)}` : ''}`,
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
        ? `Picking up ${when}: ${ready.length} ready for pick lists${notReady.length ? ` · ${notReady.length} not ready` : ''}`
        : `Picking up ${when}: ${notReady.length} job${notReady.length === 1 ? '' : 's'} not ready`,
    html,
    text,
    label: 'cron/pickup-picklist',
  })

  return NextResponse.json({
    ok: result.ok,
    window: { start, end, days },
    ready: ready.length,
    notReady: notReady.length,
    sent: result.ok,
    recipients: to,
  })
}
