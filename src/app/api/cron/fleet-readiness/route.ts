/**
 * GET/POST /api/cron/fleet-readiness — Sprint 2A reminder cron.
 *
 * Daily early-AM (vercel.json). For CONFIRMED/ACTIVE bookings with
 * vehicle assignments departing TODAY or TOMORROW (Pacific), sends ONE
 * digest per day per channel — Slack (lib/slack) + email (canonical
 * sendAgreementEmail helper) — to lib/fleet/readinessRecipients.ts.
 * Each vehicle line links to its pre-rental inspection checkout page.
 *
 * Scope guards:
 *   - Booking.source PLANYO_BACKFILL is EXCLUDED — those rows are a
 *     stale prior-import snapshot, not live commitments (CLAUDE.md);
 *     reminders fire only for HQ-native bookings until cutover.
 *   - Assignment.status ASSIGNED only (CHECKED_OUT is already gone;
 *     RETURNED/SWAPPED are stale).
 *
 * Idempotency: one AuditLog marker row per Pacific day
 * (action=cron.fleet_readiness_digest, entityId=YYYY-MM-DD). Re-runs
 * the same day short-circuit. No new table needed (STEP 2 budget (c)
 * intentionally unused).
 *
 * ?dryRun=1 — builds and RETURNS the payloads without sending or
 * writing the marker (used by the Sprint 2A verification fixture).
 *
 * Auth: same CRON_SECRET bearer pattern as sibling cron routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { postMessage } from '@/lib/slack'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { FLEET_READINESS_EMAILS, FLEET_READINESS_SLACK_CHANNEL } from '@/lib/fleet/readinessRecipients'

export const dynamic = 'force-dynamic'

const MARKER_ACTION = 'cron.fleet_readiness_digest'
const MARKER_ENTITY = 'FleetReadinessDigest'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: allow manual curl
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

/** YYYY-MM-DD in America/Los_Angeles, offset by N days. */
function pacificYmd(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000))
}

/** BookingAssignment.startDate is @db.Date (UTC-midnight) — match on that. */
const ymdToDbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

interface DepartureLine {
  assignmentId: string
  unitName: string
  category: string
  bookingNumber: string
  jobName: string
  company: string
  deliveryTime: string | null
}

async function departuresOn(dbDate: Date): Promise<DepartureLine[]> {
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      status: 'ASSIGNED',
      startDate: dbDate,
      bookingItem: {
        booking: {
          status: { in: ['CONFIRMED', 'ACTIVE'] },
          source: { not: 'PLANYO_BACKFILL' },
        },
      },
    },
    select: {
      id: true,
      asset: { select: { unitName: true } },
      bookingItem: {
        select: {
          category: { select: { name: true } },
          booking: {
            select: {
              bookingNumber: true,
              jobName: true,
              deliveryTime: true,
              company: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => ({
    assignmentId: r.id,
    unitName: r.asset.unitName,
    category: r.bookingItem.category.name,
    bookingNumber: r.bookingItem.booking.bookingNumber,
    jobName: r.bookingItem.booking.jobName,
    company: r.bookingItem.booking.company.name,
    deliveryTime: r.bookingItem.booking.deliveryTime,
  }))
}

const inspectionUrl = (assignmentId: string) =>
  `${process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com'}/fleet/inspection/${assignmentId}`

function slackSection(title: string, lines: DepartureLine[]): string {
  if (!lines.length) return `*${title}*\n_none_`
  return `*${title}*\n${lines
    .map(
      (l) =>
        `• Unit ${l.unitName} (${l.category}) — ${l.jobName} / ${l.company} — ${l.bookingNumber}${l.deliveryTime ? ` — out ${l.deliveryTime}` : ''}\n   <${inspectionUrl(l.assignmentId)}|Pre-rental inspection →>`,
    )
    .join('\n')}`
}

function emailSection(title: string, lines: DepartureLine[]): string {
  if (!lines.length) return `<h3 style="margin:16px 0 6px">${title}</h3><p style="color:#666">none</p>`
  return `<h3 style="margin:16px 0 6px">${title}</h3><ul style="padding-left:18px;margin:0">${lines
    .map(
      (l) =>
        `<li style="margin-bottom:8px"><strong>Unit ${l.unitName}</strong> (${l.category}) — ${l.jobName} / ${l.company} — ${l.bookingNumber}${l.deliveryTime ? ` — out ${l.deliveryTime}` : ''}<br/><a href="${inspectionUrl(l.assignmentId)}">Pre-rental inspection →</a></li>`,
    )
    .join('')}</ul>`
}

function textSection(title: string, lines: DepartureLine[]): string {
  if (!lines.length) return `${title}\n  none`
  return `${title}\n${lines
    .map(
      (l) =>
        `  - Unit ${l.unitName} (${l.category}) — ${l.jobName} / ${l.company} — ${l.bookingNumber}${l.deliveryTime ? ` — out ${l.deliveryTime}` : ''}\n    ${inspectionUrl(l.assignmentId)}`,
    )
    .join('\n')}`
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const today = pacificYmd(0)
  const tomorrow = pacificYmd(1)

  // Idempotency marker — one digest per Pacific day.
  if (!dryRun) {
    const already = await prisma.auditLog.findFirst({
      where: { action: MARKER_ACTION, entityType: MARKER_ENTITY, entityId: today },
      select: { id: true },
    })
    if (already) {
      return NextResponse.json({ ok: true, skipped: 'digest already sent today', date: today })
    }
  }

  const [dayOf, dayBefore] = await Promise.all([
    departuresOn(ymdToDbDate(today)),
    departuresOn(ymdToDbDate(tomorrow)),
  ])

  if (!dayOf.length && !dayBefore.length) {
    return NextResponse.json({ ok: true, sent: false, reason: 'no departures today or tomorrow', date: today })
  }

  const subject = `Fleet readiness — ${dayOf.length} departing today, ${dayBefore.length} tomorrow (${today})`
  const slackText = `🚚 *Fleet readiness digest — ${today}*\n\n${slackSection(`Departing TODAY (${today})`, dayOf)}\n\n${slackSection(`Departing TOMORROW (${tomorrow})`, dayBefore)}\n\n_Complete the pre-rental inspection before each unit leaves the yard._`
  const emailHtml = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#222"><h2 style="margin:0 0 4px">🚚 Fleet readiness digest — ${today}</h2><p style="margin:0 0 12px;color:#555">Complete the pre-rental inspection before each unit leaves the yard.</p>${emailSection(`Departing TODAY (${today})`, dayOf)}${emailSection(`Departing TOMORROW (${tomorrow})`, dayBefore)}</div>`
  const emailText = `Fleet readiness digest — ${today}\n\n${textSection(`Departing TODAY (${today})`, dayOf)}\n\n${textSection(`Departing TOMORROW (${tomorrow})`, dayBefore)}`

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      date: today,
      counts: { today: dayOf.length, tomorrow: dayBefore.length },
      payloads: {
        slack: { channel: FLEET_READINESS_SLACK_CHANNEL, text: slackText },
        email: { to: FLEET_READINESS_EMAILS, subject, text: emailText, html: emailHtml },
      },
    })
  }

  // Kill switch: sends are gated on FLEET_REMINDERS_ENABLED being
  // EXACTLY "true". Anything else (unset, "1", "TRUE") keeps the cron in
  // dry-run: full selection logic runs, payloads are logged, nothing is
  // sent and no idempotency marker is written (so flipping the var on
  // later the same day still sends that day's digest).
  if (process.env.FLEET_REMINDERS_ENABLED !== 'true') {
    console.log(
      '[fleet-readiness DRY-RUN]',
      JSON.stringify({
        date: today,
        counts: { today: dayOf.length, tomorrow: dayBefore.length },
        slack: { channel: FLEET_READINESS_SLACK_CHANNEL, text: slackText },
        email: { to: FLEET_READINESS_EMAILS, subject, text: emailText },
      }),
    )
    return NextResponse.json({
      ok: true,
      sent: false,
      disabled: true,
      reason: 'FLEET_REMINDERS_ENABLED is not "true" — payloads logged, nothing sent',
      date: today,
      counts: { today: dayOf.length, tomorrow: dayBefore.length },
    })
  }

  const slackResult = await postMessage(slackText, {
    channel: FLEET_READINESS_SLACK_CHANNEL || undefined,
  })
  const emailResult = await sendAgreementEmail({
    to: FLEET_READINESS_EMAILS,
    subject,
    html: emailHtml,
    text: emailText,
    label: 'fleet-readiness-digest',
  })

  // Marker — written even on partial channel failure so a flaky channel
  // can't cause a double-send on the healthy one; failures are surfaced
  // in the response + marker payload for the health page to notice.
  await prisma.auditLog.create({
    data: {
      action: MARKER_ACTION,
      entityType: MARKER_ENTITY,
      entityId: today,
      newValues: {
        today: dayOf.length,
        tomorrow: dayBefore.length,
        slackOk: slackResult.ok,
        slackReason: slackResult.reason ?? null,
        emailOk: emailResult.ok,
        emailReason: ('reason' in emailResult ? emailResult.reason : null) ?? null,
      },
    },
  })

  return NextResponse.json({
    ok: true,
    sent: true,
    date: today,
    counts: { today: dayOf.length, tomorrow: dayBefore.length },
    slack: slackResult,
    email: emailResult,
  })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
