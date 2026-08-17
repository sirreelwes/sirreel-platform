/**
 * Making a failed RentalWorks sync visible.
 *
 * The sync ran nightly and failed for over two weeks with no symptom anyone
 * would notice: it logged console.error and returned 502 to Vercel's cron, and
 * nobody reads cron logs. Meanwhile Collections, Receivables and Reconcile all
 * served balances from a mirror frozen on 2026-07-27, and an operator quoting
 * one to a client on the phone had no way to know.
 *
 * A silent failure that corrupts a number someone reads aloud to a client is
 * worse than a loud one. So: an Action-Queue alert AND an email, every time.
 *
 * De-duplicated per calendar day. A nightly job that fails for a month should
 * produce thirty reminders, not one that everybody scrolls past — but it must
 * not produce thirty on a single retry loop either.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

const HQ_INBOX = process.env.HQ_NOTIFY_INBOX || 'hq@sirreel.com'
const ALERT_TYPE = 'rw_sync_failure'

async function alreadyAlertedToday(type: string): Promise<boolean> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const existing = await prisma.alert.findFirst({
    where: { type, created_at: { gte: since } },
    select: { id: true },
  })
  return !!existing
}

/**
 * Sync could not run. `reason` is shown verbatim to staff, so it must say what
 * to DO — "token expired, get a new one from RentalWorks" rather than "401".
 */
export async function reportRwSyncFailure(reason: string): Promise<void> {
  try {
    const latest = await prisma.rwInvoice.aggregate({ _max: { syncedAt: true } })
    const syncedAt = latest._max.syncedAt
    const ageDays = syncedAt
      ? Math.floor((Date.now() - syncedAt.getTime()) / 86_400_000)
      : null

    const staleness =
      ageDays == null
        ? 'The invoice mirror has never been populated.'
        : `Invoice balances in Collections, Receivables and Reconcile are ${ageDays} day${ageDays === 1 ? '' : 's'} old (last synced ${syncedAt!.toISOString().slice(0, 10)}).`

    if (await alreadyAlertedToday(ALERT_TYPE)) return

    await prisma.alert.create({
      data: {
        type: ALERT_TYPE,
        title: 'RentalWorks invoice sync is failing — balances are stale',
        body: `${reason}\n\n${staleness}\n\nUntil this is fixed, treat every RW balance in HQ as out of date.`,
        severity: 'high',
        link: '/admin/rw-invoice-sync',
      },
    })

    await sendAgreementEmail({
      to: [HQ_INBOX],
      subject: 'SirReel HQ — RentalWorks invoice sync is failing',
      text: failureText(reason, staleness),
      // Internal ops mail, so plain <pre> rather than the client-facing
      // branded shell — legibility over presentation.
      html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(failureText(reason, staleness))}</pre>`,
      label: 'rw-sync-failure',
    })
  } catch (err) {
    // Never let alerting break the caller: the sync already failed, and
    // throwing here would replace a reported problem with an unreported one.
    console.error('[rw-sync-alert] could not raise the failure alert:', err)
  }
}

/*
 * reportRwTokenExpiring() and RW_TOKEN_WARN_DAYS lived here until 2026-08-17.
 *
 * They warned when the token had RW_TOKEN_WARN_DAYS or fewer left, read from
 * the JWT `exp` claim. RentalWorks stamps every token with a 300-second `exp`
 * and then honours it for weeks, so "days left" was negative within five
 * minutes of any rotation — the warning could never fire in its intended
 * window, and the same claim drove a pre-flight guard that blocked the invoice
 * sync entirely for 21 days.
 *
 * There is no honest early warning to give: nothing observable predicts when
 * RW will stop accepting a token. What is left is reportRwSyncFailure() above,
 * fired on an actual 401, plus the ~50-day calendar cadence in
 * docs/runbooks/rentalworks-token-rotation.md.
 *
 * Do not reintroduce a countdown from `exp`.
 */

function failureText(reason: string, staleness: string): string {
  return [
    'The nightly RentalWorks invoice sync could not run.',
    '',
    reason,
    '',
    staleness,
    '',
    'Every RW balance shown in HQ — Collections, Receivables (RW), Reconcile RW —',
    'is from the last successful sync and should not be quoted to a client',
    'until this is resolved.',
  ].join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
