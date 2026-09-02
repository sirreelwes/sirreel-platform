import { NextRequest, NextResponse } from 'next/server'
import {
  ROTATE_AFTER_DAYS,
  isRotationDue,
  mintRwToken,
  pingRwToken,
  readRwToken,
  recordVerify,
  rwCredentialStatus,
  writeRwToken,
} from '@/lib/rentalworks/credential'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p as emailP, calloutBox } from '@/lib/email/templates/shell'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/rw-token-check — the daily RentalWorks credential check,
 * 06:00 Pacific.
 *
 * The flow Wes specified (2026-09-02):
 *
 *   verify → if it fails, try ONE automatic rotation through /jwt
 *          → if that fails too, go red and tell someone.
 *
 * Plus a proactive renewal at 45 days, so the yellow band is a safety net
 * rather than a routine state — the token is replaced before it can lapse.
 *
 * DST: Vercel crons are UTC only, so a fixed hour drifts an hour twice a
 * year and "06:00 PT" quietly becomes 05:00. Both candidate UTC hours are
 * scheduled and the wrong one returns early — the daily-brief precedent.
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://hq.sirreel.com/api/cron/rw-token-check?force=1"
 */

const TARGET_PACIFIC_HOUR = 6

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
  const force = req.nextUrl.searchParams.get('force') === '1'
  const now = new Date()
  if (!force && pacificHour(now) !== TARGET_PACIFIC_HOUR) {
    return NextResponse.json({
      ok: true,
      skipped: 'wrong Pacific hour — the other DST twin will run',
      pacificHour: pacificHour(now),
    })
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
  const dueForRotation = healthy && (await isRotationDue())
  if (!healthy || dueForRotation) {
    steps.push(dueForRotation ? `proactive rotation (${ROTATE_AFTER_DAYS}d)` : 'attempting rotation')
    const mint = await mintRwToken()
    if (mint.ok) {
      const ping = await pingRwToken(mint.token)
      if (ping.ok) {
        await writeRwToken({ token: mint.token, updatedBy: 'system' })
        await recordVerify('OK')
        healthy = true
        steps.push('rotated and verified')
      } else {
        // Minted but not accepted — do NOT store it over a token that may
        // still be the better of the two.
        await recordVerify('EXPIRED')
        steps.push(`minted token rejected (HTTP ${ping.httpStatus}) — not stored`)
      }
    } else {
      steps.push(`rotation failed: ${mint.reason}`)
    }
  }

  const status = await rwCredentialStatus()

  // 3. Tell someone, but only when there is something to do. A green check
  //    that emails every morning is a green check nobody reads.
  let notified: { sent: boolean; reason?: string } | null = null
  if (status.health !== 'green') {
    notified = await notify(
      status.health === 'red'
        ? 'RentalWorks connection is down'
        : 'RentalWorks token is due for renewal',
      status.health === 'red'
        ? 'RentalWorks connection is down'
        : 'RentalWorks token is due for renewal',
      steps.map((s) => `• ${s}`),
    )
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
