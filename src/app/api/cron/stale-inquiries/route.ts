import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, calloutBox } from '@/lib/email/templates/shell'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/stale-inquiries
 *
 * Hourly safety net under the instant hq@ notification that
 * src/lib/email/notifyPublicSubmission.ts fires on every public form
 * submission. That email is the primary signal; this exists for when it
 * never lands — a bounce, a spam foldering, a Resend outage. Without it a
 * dropped notification is silent, and the Inquiry sits in the queue
 * looking exactly like one nobody has gotten to yet.
 *
 * Sweeps WEB_FORM inquiries still in NEW past the threshold and, for each,
 * ensures ONE open Alert row. The digest email lists only inquiries newly
 * alerted on this run, which is what stops it re-nagging hourly forever:
 * second pass finds the open Alert, creates nothing, emails nothing. An
 * inquiry is therefore escalated at most once until someone works it or
 * dismisses the alert.
 *
 * Idempotency matches fleet-expirations: (type, link) with an open
 * expires_at. No schema change, no new "notified" column to backfill.
 *
 * Triggered manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://hq.sirreel.com/api/cron/stale-inquiries
 */

const ALERT_TYPE = 'sales.web_inquiry_untouched'
const HQ_INBOX = process.env.HQ_NOTIFY_INBOX || 'hq@sirreel.com'
const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

/**
 * Hours a public submission may sit in NEW before it is escalated.
 * Deliberately short — the instant notification claims "an agent will
 * follow up shortly", so if that email failed we want to know inside the
 * same working stretch, not the next day.
 */
const STALE_HOURS = Number(process.env.INQUIRY_SAFETY_NET_HOURS || 3)

/** Belt and braces on a digest that emails a group. */
const MAX_LISTED = 40

interface StaleRow {
  id: string
  title: string
  createdAt: Date
  assignedTo: string | null
  ageHours: number
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() - STALE_HOURS * 3_600_000)

  const candidates = await prisma.inquiry.findMany({
    where: { source: 'WEB_FORM', status: 'NEW', createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      createdAt: true,
      assignedTo: { select: { name: true, email: true } },
    },
  })

  const newlyAlerted: StaleRow[] = []
  let alreadyOpen = 0

  for (const inq of candidates) {
    const link = `/inquiries/${inq.id}`
    const existing = await prisma.alert.findFirst({
      where: {
        type: ALERT_TYPE,
        link,
        // "Open" = no expiry, or an expiry still in the future. This cron
        // never auto-resolves; working the inquiry flips it out of NEW,
        // which drops it from the candidate set on the next pass.
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      },
      select: { id: true },
    })
    if (existing) {
      alreadyOpen++
      continue
    }

    const ageHours = Math.floor((now.getTime() - inq.createdAt.getTime()) / 3_600_000)
    const assignedTo = inq.assignedTo?.name || inq.assignedTo?.email || null

    await prisma.alert.create({
      data: {
        type: ALERT_TYPE,
        title: `Web inquiry untouched for ${ageHours}h — ${inq.title.slice(0, 80)}`,
        body: assignedTo
          ? `Submitted ${inq.createdAt.toISOString()}. Assigned to ${assignedTo} but still NEW.`
          : `Submitted ${inq.createdAt.toISOString()}. Unassigned and still NEW.`,
        severity: ageHours >= 24 ? 'high' : 'medium',
        link,
      },
    })

    newlyAlerted.push({ id: inq.id, title: inq.title, createdAt: inq.createdAt, assignedTo, ageHours })
  }

  if (newlyAlerted.length > 0) {
    await sendDigest(newlyAlerted)
  }

  return NextResponse.json({
    ok: true,
    thresholdHours: STALE_HOURS,
    candidates: candidates.length,
    newlyAlerted: newlyAlerted.length,
    alreadyOpen,
    emailed: newlyAlerted.length > 0,
  })
}

async function sendDigest(rows: StaleRow[]): Promise<void> {
  const listed = rows.slice(0, MAX_LISTED)
  const overflow = rows.length - listed.length
  const n = rows.length
  const subject = `${n} web ${n === 1 ? 'inquiry' : 'inquiries'} with no response`

  const items = listed
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #e2ddd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <a href="${HQ_APP_URL}/inquiries/${r.id}" style="font-size:15px;font-weight:700;color:#0c0c0d;text-decoration:none;">${escapeHtml(r.title)}</a>
          <div style="font-size:13px;color:#8a8272;margin-top:3px;">
            ${r.ageHours}h old · ${r.assignedTo ? `assigned to ${escapeHtml(r.assignedTo)}` : 'unassigned'}
          </div>
        </td>
      </tr>`,
    )
    .join('')

  const html = renderEmailShell({
    eyebrow: 'Safety net',
    heading: subject,
    preheader: `${n} public submission${n === 1 ? '' : 's'} still untouched after ${STALE_HOURS}h.`,
    bodyHtml: [
      calloutBox(
        `These came in through the website and are still marked <strong style="color:#0c0c0d;">NEW</strong> after ${STALE_HOURS} hours. If you never saw the original notification for one, that email may have bounced or landed in spam — worth checking.`,
      ),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 16px;">${items}</table>`,
      overflow > 0
        ? `<p style="margin:0 0 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#8a8272;">…and ${overflow} more. Open the queue to see everything.</p>`
        : '',
    ].join(''),
    cta: { label: 'Open the inquiry queue', href: `${HQ_APP_URL}/inquiries` },
    footNote: `You get this once per inquiry, not every hour — each one is escalated a single time until it's worked or the alert is dismissed.`,
  })

  const text = renderEmailText([
    subject,
    '',
    `Still NEW after ${STALE_HOURS}h:`,
    ...listed.map((r) => `- ${r.title} (${r.ageHours}h, ${r.assignedTo ?? 'unassigned'}) ${HQ_APP_URL}/inquiries/${r.id}`),
    ...(overflow > 0 ? [`…and ${overflow} more.`] : []),
  ])

  const res = await sendAgreementEmail({
    to: [HQ_INBOX],
    subject: `[SirReel] ${subject}`,
    html,
    text,
    label: 'stale-inquiry-digest',
  })
  if (!res.ok) console.error('[stale-inquiries] digest failed:', res.reason)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}
