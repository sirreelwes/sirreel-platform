import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { checkRwMirrorFreshness, describeMirror } from '@/lib/rentalworks/mirrorFreshness'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p as emailP, calloutBox } from '@/lib/email/templates/shell'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/rw-mirror-freshness — is RentalWorks data still moving?
 *
 * The backstop the other alerts cannot be. Every RW outage so far went
 * unnoticed because the thing meant to report it was the thing that
 * died: the quote sync was killed mid-await so its catch never ran, and
 * the order scan had no schedule at all, so nothing existed to fail.
 * A sync that dies has nothing to say about itself.
 *
 * Mirror AGE survives all of that. It needs nobody alive to report it
 * and it is true whatever the cause — expired token, blown time budget,
 * a cron someone forgot to add, RW changing an endpoint. Had this
 * existed on 2026-08-22 it would have fired on the 23rd instead of the
 * problem being found by hand twelve days later.
 *
 * Runs after the day's syncs have had their chance. Silent when
 * everything is current — a daily green email is a daily unread email.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://hq.sirreel.com/api/cron/rw-mirror-freshness?force=1"
 */

const ALERT_TYPE = 'rw_mirror_stale'

function viaCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!viaCron(req)) {
    const session = await getServerSession()
    if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const health = await checkRwMirrorFreshness()
  const stale = health.filter((h) => h.stale)

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, stale: 0, health })
  }

  const lines = health.map(describeMirror)
  const names = stale.map((s) => s.label).join(', ')
  const heading =
    stale.length === health.length
      ? 'RentalWorks data has stopped updating'
      : `RentalWorks: ${names} ${stale.length === 1 ? 'is' : 'are'} stale`

  // In-app alert, deduped per day, so it is visible without email too.
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const alerted = await prisma.alert.findFirst({
    where: { type: ALERT_TYPE, created_at: { gte: since } },
    select: { id: true },
  })
  if (!alerted) {
    await prisma.alert.create({
      data: {
        type: ALERT_TYPE,
        title: heading,
        body: `${lines.join('\n')}\n\nA mirror stops updating when its sync fails, when it has no schedule, or when the RentalWorks token has lapsed. Check the RentalWorks card on Collections first.`,
        severity: 'high',
        link: '/collections',
      },
    })
  }

  let notified: { sent: boolean; reason?: string } | null = null
  const to = await channelRecipients('rw-token')
  if (to.length === 0) {
    notified = { sent: false, reason: 'no recipients on the rw-token channel' }
  } else if (!alerted) {
    // Same dedupe as the alert: one email per day, not one per run.
    const bodyHtml =
      calloutBox(lines.map((l) => `<div style="white-space:pre-wrap">${l}</div>`).join('<br>')) +
      emailP(
        'A mirror stops updating when its sync fails, when it has no schedule at all, or when the RentalWorks token has lapsed. ' +
          'Start at the RentalWorks card on <a href="https://hq.sirreel.com/collections">Collections</a>.',
      )
    const sent = await sendAgreementEmail({
      to,
      subject: `SirReel HQ — ${heading}`,
      label: 'rw-mirror-freshness',
      html: renderEmailShell({ eyebrow: 'Integrations', heading, preheader: heading, bodyHtml }),
      text: renderEmailText([heading.toUpperCase(), '', ...lines, '', 'https://hq.sirreel.com/collections']),
    })
    notified = { sent: sent.ok, reason: sent.ok ? undefined : sent.reason }
  }

  return NextResponse.json({ ok: true, stale: stale.length, health, notified })
}
