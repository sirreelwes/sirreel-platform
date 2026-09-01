/**
 * GET/POST /api/cron/hq-escalation — the chase for HQ-booked work.
 *
 * Wes, 2026-09-01: natively-created bookings and orders "may sneak up on
 * people or get missed", because they are ~1 row in 7 on a board that is
 * otherwise Planyo's — and Planyo is what the team still watches. An
 * imported job has another system chasing it. These have only HQ.
 *
 * Runs each weekday morning. For every HQ-ORIGIN job inside 6 days of
 * pickup whose five-check readiness rollup still has blockers, it emails
 * the desk that can clear them — sales/admin for anything the client
 * owes us, Hugo + Julian for a unit that has not been assigned. Routing
 * and tiers live in src/lib/notifications/hqEscalation.ts and are tested
 * there.
 *
 * Reuses /api/jobs' own payload builder rather than re-deriving
 * readiness or origin, so the email and the rail can never disagree
 * about whether a job is ready.
 *
 * Idempotency: one AuditLog marker per Pacific day per desk, matching
 * the fleet-readiness cron. A re-run the same day short-circuits, so a
 * retry cannot double-send.
 *
 * ?dryRun=1 returns the payloads without sending or writing the marker.
 *
 * Auth: the CRON_SECRET bearer pattern its siblings use.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { jobWindow, listDays, rowState, type JobRow } from '@/lib/jobs/listRow'
import { readinessApplies } from '@/lib/jobs/readiness'
import {
  DESK_CHANNEL, DESK_LABEL, TIER_PREFIX, TIER_RANK,
  COMMITTED_ORDER_STATUSES, escalationTier, needsStaging, routeBlockers,
  withinEscalationWindow,
  type EscalationDesk, type EscalationTier,
} from '@/lib/notifications/hqEscalation'

export const dynamic = 'force-dynamic'

const MARKER_ACTION = 'cron.hq_escalation'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // dev: allow manual curl
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

/** Today in Pacific — the yard's day, matching order numbering. */
function pacificToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function daysUntil(iso: string | null, today: string): number | null {
  if (!iso) return null
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

interface Row {
  job: JobRow
  tier: EscalationTier
  days: number
  /** Job-check blockers, or the pick-list state for the staging desk. */
  blockers: string[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildHtml(desk: EscalationDesk, rows: Row[]): string {
  const line = (r: Row) => {
    const w = jobWindow(r.job)
    const when =
      r.days < 0 ? `picked up ${Math.abs(r.days)}d ago`
        : r.days === 0 ? 'PICKS UP TODAY'
          : r.days === 1 ? 'picks up tomorrow'
            : `picks up in ${r.days}d`
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;background:#ffffff;">
          <a href="https://hq.sirreel.com/jobs/${r.job.id}" style="color:#111111;font-weight:600;text-decoration:none;">
            ${esc(r.job.name || r.job.jobCode)}
          </a>
          <div style="font-size:12px;color:#555555;margin-top:2px;">
            ${esc(r.job.jobCode)} · ${esc(r.job.company?.name || 'no company')} · ${esc(w.start || '—')}
          </div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;background:#ffffff;font-size:12px;color:${r.days <= 0 ? '#b91c1c' : r.days <= 2 ? '#c2410c' : '#a16207'};font-weight:700;white-space:nowrap;">
          ${esc(when)}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;background:#ffffff;font-size:12px;color:#111111;font-weight:700;white-space:nowrap;">
          ${r.blockers.map((b) => esc(b)).join(' · ')}
        </td>
      </tr>`
  }
  // Every colour is stated against an explicit white ground. Mail
  // clients in dark mode do NOT invert author-set text, so #111 on an
  // unstated background renders black-on-black — which is exactly how
  // the first preview reached Wes: the job names and the blocker column,
  // the two things the email exists to say, were invisible.
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;background:#ffffff;color:#111111;padding:16px;">
      <h2 style="font-size:16px;margin:0 0 4px;color:#111111;">Booked in HQ — still not ready</h2>
      <p style="font-size:13px;color:#555555;margin:0 0 14px;">
        ${esc(DESK_LABEL[desk])}. These were booked in SirReel HQ, so nothing else is chasing them.
      </p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #e5e5e5;background:#ffffff;">${rows.map(line).join('')}</table>
      <p style="font-size:12px;color:#666666;margin-top:14px;">
        Filter the board yourself: <a href="https://hq.sirreel.com/jobs" style="color:#0b5cad;">HQ → Jobs → “Booked in HQ”</a>.
      </p>
    </div>`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const today = pacificToday()

  // One source of truth: the same payload /api/jobs serves the rail.
  const origin = req.nextUrl.origin
  // Forward the cron bearer, not a cookie — a cron has no session, and
  // /api/jobs answers an unauthenticated read with an empty list. Without
  // this the job would run daily and send nothing, which looks like
  // "no escalations" rather than a failure.
  const auth = req.headers.get('authorization')
  const res = await fetch(`${origin}/api/jobs`, {
    headers: auth ? { authorization: auth } : {},
    cache: 'no-store',
  })
  if (!res.ok) {
    return NextResponse.json({ error: `jobs fetch failed: ${res.status}` }, { status: 502 })
  }
  const jobs: JobRow[] = (await res.json()).jobs || []
  // An empty list here means the scope handshake failed, not that the
  // book is empty. Say so rather than reporting a clean run.
  if (jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'jobs list came back empty — CRON_SECRET handshake likely failed', today },
      { status: 502 },
    )
  }
  const { today: t, tomorrow } = listDays()

  // Jobs with at least one order the business has actually committed to.
  //
  // The rail's "Booked" band is generous — SR-JOB-0205 read Booked with
  // nothing but a QUOTE_SENT order, and escalated a missing COI and card
  // for a quote the client never approved. Chasing paperwork for an
  // unapproved quote is exactly the noise Wes objected to in the first
  // preview. Same gate the warehouse desk already used.
  const hqJobIds = jobs.filter((j) => j.origin === 'HQ').map((j) => j.id)
  const committedOrders = hqJobIds.length
    ? await prisma.order.findMany({
        where: { jobId: { in: hqJobIds }, status: { in: COMMITTED_ORDER_STATUSES as never } },
        select: {
          id: true, orderNumber: true, jobId: true, startDate: true,
          pickList: { select: { status: true } },
          lineItems: { select: { pickupDate: true }, orderBy: { pickupDate: 'asc' }, take: 1 },
        },
      })
    : []
  const committedJobIds = new Set(committedOrders.map((o) => o.jobId).filter(Boolean) as string[])

  const byDesk = new Map<EscalationDesk, Row[]>()
  for (const job of jobs) {
    // HQ-origin only. An imported job has its own workflow — chasing it
    // here is exactly the noise that would make this ignorable.
    if (job.origin !== 'HQ') continue
    // Nothing committed on this job — no order anyone has approved — so
    // there is nothing to chase paperwork for yet.
    if (!committedJobIds.has(job.id)) continue
    const state = rowState(job, t, tomorrow)
    // Readiness only means something on outbound rows; a quoted job with
    // no COI is a normal quote, not a deficiency.
    if (!readinessApplies(state)) continue
    const r = job.readiness
    if (!r || r.ready || r.blockers.length === 0) continue

    const days = daysUntil(jobWindow(job).start, today)
    const tier = escalationTier(days)
    // Same window on every desk: a mistyped year must not lead a digest.
    if (!tier || !withinEscalationWindow(days) || days === null) continue

    for (const [desk, blockers] of routeBlockers(r.blockers.map((b) => b.key))) {
      const list = byDesk.get(desk) ?? []
      list.push({ job, tier, days, blockers: blockers.map((b) => b.toUpperCase()) })
      byDesk.set(desk, list)
    }
  }

  // ── Orders going out ──────────────────────────────────────────────
  //
  // Wes: "if it's strictly related to orders that are going out, it would
  // be hugo and warehouse." That is a fact about the ORDER's pick list,
  // not one of the five job checks, so it is gathered separately and
  // joined onto the same escalation.
  const hqJobById = new Map(jobs.filter((j) => j.origin === 'HQ').map((j) => [j.id, j]))
  if (hqJobById.size > 0) {
    const orders = committedOrders
    const stagingRows: Row[] = []
    for (const o of orders) {
      if (!needsStaging(o.pickList?.status)) continue
      const pickup = o.startDate ?? o.lineItems[0]?.pickupDate ?? null
      const d = daysUntil(pickup ? pickup.toISOString() : null, today)
      const tier = escalationTier(d)
      if (!tier || !withinEscalationWindow(d) || d === null) continue
      const job = o.jobId ? hqJobById.get(o.jobId) : undefined
      if (!job) continue
      stagingRows.push({
        job, tier, days: d,
        blockers: [o.pickList?.status ? `${o.orderNumber} ${o.pickList.status}` : `${o.orderNumber} NO PICK LIST`],
      })
    }
    if (stagingRows.length > 0) byDesk.set('staging', stagingRows)
  }

  const sent: Array<Record<string, unknown>> = []
  for (const [desk, rows] of byDesk) {
    rows.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.days - b.days)
    const worst = rows[0].tier
    const to = await channelRecipients(DESK_CHANNEL[desk])
    const subject = `${TIER_PREFIX[worst]} ${rows.length} HQ job${rows.length === 1 ? '' : 's'} not ready — ${DESK_LABEL[desk]}`

    if (dryRun) {
      // The rendered HTML too. A preview that shows recipients and a
      // subject but not the email is not a preview of the email.
      sent.push({
        desk, to, subject, count: rows.length,
        html: buildHtml(desk, rows),
        jobs: rows.map((r) => ({ jobCode: r.job.jobCode, name: r.job.name, days: r.days, blockers: r.blockers })),
      })
      continue
    }
    if (to.length === 0) { sent.push({ desk, skipped: 'no recipients configured' }); continue }

    // One marker per desk per Pacific day — a retry cannot double-send.
    const markerId = `${today}:${desk}`
    const already = await prisma.auditLog.findFirst({
      where: { action: MARKER_ACTION, entityId: markerId }, select: { id: true },
    })
    if (already) { sent.push({ desk, skipped: 'already sent today' }); continue }

    const r = await sendAgreementEmail({ to, subject, html: buildHtml(desk, rows) })
    await prisma.auditLog.create({
      data: { action: MARKER_ACTION, entityId: markerId, entityType: 'HqEscalation',
              newValues: { desk, count: rows.length, worst } as never },
    })
    sent.push({ desk, to, subject, count: rows.length, ok: r.ok })
  }

  return NextResponse.json({ ok: true, dryRun, today, desks: sent })
}

export const POST = GET
