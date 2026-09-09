import { NextRequest, NextResponse } from 'next/server'
import {
  ROTATE_AFTER_DAYS,
  isRotationDue,
  pingRwToken,
  readRwToken,
  recordVerify,
  rotateRwToken,
  rwCredentialStatus,
} from '@/lib/rentalworks/credential'
import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p as emailP, calloutBox } from '@/lib/email/templates/shell'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/rw-token-check — the RentalWorks credential check, HOURLY.
 *
 * The flow Wes specified (2026-09-02):
 *
 *   verify → if it fails, try ONE automatic rotation through /jwt
 *          → if that fails too, go red and tell someone.
 *
 * Plus a proactive renewal at 45 days, so the yellow band is a safety net
 * rather than a routine state — the token is replaced before it can lapse.
 *
 * ── Why hourly, and why the DST twins are gone (2026-09-09) ────────
 *
 * This ran once a day at 06:00 Pacific, which meant the check could only
 * ever catch a token that had already been dead for up to 24 hours. On
 * 2026-09-09 it passed at 13:00 UTC, the token died around 13:30, and
 * every RW mirror stayed dark until somebody looked. Hourly caps that
 * exposure at an hour.
 *
 * rwFetch now rotates on a live 401 as well (see rwClient), so in
 * practice a mid-day expiry is repaired within seconds by whichever sync
 * hits it first. This route is the BACKSTOP: it covers the stretches
 * when no sync happens to run, and it is the only thing that renews a
 * token proactively before it lapses at all.
 *
 * The DST twin-hours trick went with the daily schedule — running every
 * hour means there is no target hour to drift off. `force` is kept
 * because the runbook and the /collections card both reference it, and
 * it now simply has nothing to skip.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://hq.sirreel.com/api/cron/rw-token-check?force=1"
 */

/**
 * Hourly checking must not mean hourly mail. A credential stays red
 * until a human fixes it, and 24 identical "connection is down" emails a
 * day is how a real alert gets filtered into a folder nobody opens — the
 * same reasoning as the per-day dedupe in syncAlert.ts, whose Alert row
 * doubles as the record of what has already been said.
 *
 * Calendar day on the server clock (UTC on Vercel), matching syncAlert.
 */
const NOTICE_TYPE = 'rw_token_check'

async function alreadyNotifiedToday(): Promise<boolean> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const existing = await prisma.alert.findFirst({
    where: { type: NOTICE_TYPE, created_at: { gte: since } },
    select: { id: true },
  })
  return !!existing
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

async function notify(subject: string, heading: string, lines: string[]) {
  const to = await channelRecipients('rw-token')
  if (to.length === 0) return { sent: false, reason: 'no recipients on the rw-token channel' }
  const bodyHtml =
    calloutBox(lines.map((l) => `<div>${l}</div>`).join('')) +
    emailP(
      'Invoice imports from RentalWorks are stopped while this is red — nothing falls back to another source. ' +
        'Fix it on the RentalWorks card on <a href="https://hq.sirreel.com/collections">Collections</a>.',
    )
  const sent = await sendAgreementEmail({
    to,
    subject,
    label: 'rw-token-check',
    html: renderEmailShell({ eyebrow: 'Integrations', heading, preheader: subject, bodyHtml }),
    text: renderEmailText([
      heading.toUpperCase(),
      '',
      ...lines,
      '',
      'Invoice imports from RentalWorks are stopped while this is red.',
      'Fix it on the RentalWorks card: https://hq.sirreel.com/collections',
    ]),
  })
  return { sent: sent.ok, reason: sent.ok ? undefined : sent.reason }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const steps: string[] = []

  // 1. Does the token we hold still work?
  const token = await readRwToken()
  let healthy = false
  if (!token) {
    steps.push('no token stored')
    await recordVerify('ERROR')
  } else {
    const ping = await pingRwToken(token)
    healthy = ping.ok
    await recordVerify(ping.ok ? 'OK' : ping.httpStatus === 401 || ping.httpStatus === 403 ? 'EXPIRED' : 'ERROR')
    steps.push(ping.ok ? 'verify ok' : `verify failed (HTTP ${ping.httpStatus})`)
  }

  // 2. Rotate when it failed, or proactively at 45 days so yellow is rare.
  //    rotateRwToken() is the same call rwFetch makes on a live 401, so
  //    the scheduled remedy and the on-demand one cannot drift apart.
  const dueForRotation = healthy && (await isRotationDue())
  if (!healthy || dueForRotation) {
    steps.push(dueForRotation ? `proactive rotation (${ROTATE_AFTER_DAYS}d)` : 'attempting rotation')
    const rotated = await rotateRwToken()
    if (rotated.ok) {
      healthy = true
      steps.push('rotated and verified')
    } else {
      steps.push(rotated.reason)
    }
  }

  const status = await rwCredentialStatus()

  // 3. Tell someone, but only when there is something to do. A green check
  //    that emails every morning is a green check nobody reads.
  let notified: { sent: boolean; reason?: string } | null = null
  if (status.health !== 'green') {
    const heading =
      status.health === 'red'
        ? 'RentalWorks connection is down'
        : 'RentalWorks token is due for renewal'
    if (await alreadyNotifiedToday()) {
      notified = { sent: false, reason: 'already notified today' }
    } else {
      // The Alert row is both the Action-Queue surface and the record
      // that stops the next 23 runs re-sending this. Written FIRST, so a
      // send that throws still suppresses the repeat.
      await prisma.alert
        .create({
          data: {
            type: NOTICE_TYPE,
            title: heading,
            body: [...steps.map((s) => `• ${s}`), '', 'Fix it on the RentalWorks card on Collections.'].join('\n'),
            severity: status.health === 'red' ? 'high' : 'medium',
            link: '/collections',
          },
        })
        .catch((err) => console.error('[rw-token-check] could not record the notice:', err))
      notified = await notify(heading, heading, steps.map((s) => `• ${s}`))
    }
  }

  return NextResponse.json({
    ok: true,
    health: status.health,
    steps,
    notified,
    lastVerifiedAt: status.lastVerifiedAt,
    lastRotatedAt: status.lastRotatedAt,
  })
}
