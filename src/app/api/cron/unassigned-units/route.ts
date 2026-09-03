import { NextRequest, NextResponse } from 'next/server'
import { findUnassignedHolds, type UnassignedHoldRow } from '@/lib/actionItems/providers/holdUnassigned'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p as emailP, calloutBox } from '@/lib/email/templates/shell'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/unassigned-units — 5pm Pacific: which quotes still have
 * no truck on them?
 *
 * Wes, 2026-09-03: "Let's have the email ping for units not assigned by
 * EOD." The in-app action item shipped the same day is immediate but
 * passive — it waits for someone to load the board. This is the version
 * that reaches him when he is not in HQ, once a day, at the point where
 * "I'll do it later" has run out of later.
 *
 * Sorted by PICKUP, not by when the quote was sent. A quote from this
 * morning collecting tomorrow matters more than one from three weeks ago
 * collecting in October, and the top of this list should be the thing
 * that bites first.
 *
 * Silent when nothing is outstanding. A daily email that says "all good"
 * is a daily email nobody opens, and then the one that matters is not
 * read either.
 *
 * DST: Vercel crons are UTC only, so a fixed hour drifts an hour twice a
 * year and "5pm PT" quietly becomes 4pm. Both candidate UTC hours are
 * scheduled and the wrong one returns early — the daily-brief precedent.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://hq.sirreel.com/api/cron/unassigned-units?force=1"
 */

const TARGET_PACIFIC_HOUR = 17

/** Pickup within this many days is called out as urgent. */
const URGENT_DAYS = 3

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

function pacificHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hour12: false,
    }).format(d),
  )
}

/** Days until pickup; negative when the pickup day has already passed. */
function daysToPickup(r: UnassignedHoldRow, now: Date): number | null {
  if (!r.startDate) return null
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return Math.round((r.startDate.getTime() - today.getTime()) / 86_400_000)
}

function fmtDay(d: Date | null): string {
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
}

function lineFor(r: UnassignedHoldRow, now: Date): string {
  const dtp = daysToPickup(r, now)
  const when =
    dtp == null
      ? 'no dates'
      : dtp < 0
        ? `PICKUP WAS ${fmtDay(r.startDate)} — ${-dtp}d ago`
        : dtp === 0
          ? `PICKS UP TODAY`
          : dtp === 1
            ? `picks up TOMORROW (${fmtDay(r.startDate)})`
            : `picks up ${fmtDay(r.startDate)} (${dtp}d)`
  const parts = [`${r.who} · ${r.orderNumber} — ${when}`]
  if (r.unheld.length) parts.push(`    NOT HELD AT ALL: ${r.unheld.join(', ')}`)
  if (r.outstanding > 0) parts.push(`    still to pick: ${r.shortCategories.join(', ')}`)
  return parts.join('\n')
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const now = new Date()
  if (!force && pacificHour(now) !== TARGET_PACIFIC_HOUR) {
    return NextResponse.json({
      ok: true,
      skipped: 'wrong Pacific hour — the other DST twin will run',
      pacificHour: pacificHour(now),
    })
  }

  const rows = await findUnassignedHolds()
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, outstanding: 0, sent: false, reason: 'nothing outstanding' })
  }

  // Soonest pickup first; anything undated falls to the bottom rather
  // than sorting as the epoch and pretending to be overdue.
  const sorted = [...rows].sort((a, b) => {
    if (!a.startDate) return 1
    if (!b.startDate) return -1
    return a.startDate.getTime() - b.startDate.getTime()
  })
  const urgent = sorted.filter((r) => {
    const d = daysToPickup(r, now)
    return d != null && d <= URGENT_DAYS
  })
  const unheldAnywhere = sorted.filter((r) => r.unheld.length > 0)

  const to = await channelRecipients('eod-unassigned-units')
  if (to.length === 0) {
    return NextResponse.json({
      ok: true,
      outstanding: rows.length,
      sent: false,
      reason: 'no recipients on the eod-unassigned-units channel',
    })
  }

  const heading = `${rows.length} quote${rows.length === 1 ? '' : 's'} still without units`
  const subject =
    urgent.length > 0
      ? `SirReel HQ — ${urgent.length} picking up within ${URGENT_DAYS} days, no unit assigned`
      : `SirReel HQ — ${heading}`

  const textLines = [
    heading.toUpperCase(),
    '',
    ...(urgent.length
      ? [`${urgent.length} picking up within ${URGENT_DAYS} days:`, ...urgent.map((r) => lineFor(r, now)), '']
      : []),
    ...(unheldAnywhere.length
      ? [
          `${unheldAnywhere.length} quote${unheldAnywhere.length === 1 ? ' carries a line' : 's carry lines'} that reserve NOTHING (no catalog match) — a hold does not exist for these at any grain:`,
          ...unheldAnywhere.map((r) => `  ${r.who} · ${r.orderNumber}: ${r.unheld.join(', ')}`),
          '',
        ]
      : []),
    'Everything outstanding, soonest pickup first:',
    ...sorted.map((r) => lineFor(r, now)),
    '',
    'Assign units on the job page: https://hq.sirreel.com/jobs',
  ]

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const rowHtml = (r: UnassignedHoldRow) => {
    const dtp = daysToPickup(r, now)
    const soon = dtp != null && dtp <= URGENT_DAYS
    const href = r.jobId ? `https://hq.sirreel.com/jobs/${r.jobId}#reservations` : `https://hq.sirreel.com/orders/${r.orderId}`
    return (
      `<div style="padding:8px 0;border-bottom:1px solid #eee">` +
      `<a href="${href}" style="font-weight:600;text-decoration:none">${esc(r.who)}</a> ` +
      `<span style="color:#6b7280">· ${esc(r.orderNumber)}</span><br>` +
      `<span style="${soon ? 'color:#b45309;font-weight:600' : 'color:#6b7280'}">${esc(
        dtp == null
          ? 'no dates'
          : dtp < 0
            ? `pickup was ${fmtDay(r.startDate)} — ${-dtp}d ago`
            : dtp === 0
              ? 'picks up today'
              : dtp === 1
                ? `picks up tomorrow (${fmtDay(r.startDate)})`
                : `picks up ${fmtDay(r.startDate)} (${dtp}d)`,
      )}</span>` +
      (r.unheld.length
        ? `<br><span style="color:#b91c1c">not held at all: ${esc(r.unheld.join(', '))}</span>`
        : '') +
      (r.outstanding > 0
        ? `<br><span style="color:#374151">still to pick: ${esc(r.shortCategories.join(', '))}</span>`
        : '') +
      `</div>`
    )
  }

  const bodyHtml =
    (urgent.length
      ? calloutBox(
          `<div style="font-weight:600;margin-bottom:6px">Picking up within ${URGENT_DAYS} days</div>` +
            urgent.map(rowHtml).join(''),
        )
      : '') +
    emailP(
      'A quote reserves a <strong>category</strong>, not a truck. Until someone picks the unit it sits on no row of the board, and the same vehicle can go out twice.',
    ) +
    `<div style="margin-top:8px">${sorted.map(rowHtml).join('')}</div>` +
    emailP('Assign units from the job page — <a href="https://hq.sirreel.com/jobs">hq.sirreel.com/jobs</a>.')

  const sent = await sendAgreementEmail({
    to,
    subject,
    label: 'eod-unassigned-units',
    html: renderEmailShell({ eyebrow: 'End of day', heading, preheader: subject, bodyHtml }),
    text: renderEmailText(textLines),
  })

  return NextResponse.json({
    ok: true,
    outstanding: rows.length,
    urgent: urgent.length,
    unheld: unheldAnywhere.length,
    sent: sent.ok,
    reason: sent.ok ? undefined : sent.reason,
  })
}
