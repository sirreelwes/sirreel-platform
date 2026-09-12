/**
 * GET /api/cron/new-inquiry-sms — every 5 minutes.
 *
 * AHA texts Wes when a new incoming lands, with a link that opens it.
 * Wes 2026-09-11.
 *
 * A sweep rather than a call at each creation site: Inquiry rows are
 * created in nine different places (four public forms, AHA's after-hours
 * callback, the client agreement entry, the portal add-on, the payment-info
 * routes, the manual POST), and instrumenting nine call sites means missing
 * the tenth. Reading the queue covers every source that exists now and
 * every one added later, for a worst-case delay of five minutes.
 *
 * Three ways in:
 *   (none)      Vercel cron. Sends only inside 8am–10pm Pacific.
 *   ?preview=1  what WOULD be sent, and to whom. Sends nothing. Admin.
 *   ?test=1     a real text to Wes, right now, ignoring the window. Admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-admin'
import { composeAlert, composeNudge, inTextingWindow } from '@/lib/sales/newInquiryAlertText'
import {
  listPendingInquiries,
  listPendingNudges,
  sendNewInquirySmsTest,
  sweepNewInquiryNudges,
  sweepNewInquirySms,
  NEW_INQUIRY_SMS_RECIPIENT,
} from '@/lib/sales/notifyNewInquirySms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HQ_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com'

export async function GET(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get('preview') === '1'
  const test = req.nextUrl.searchParams.get('test') === '1'

  // The manual entrances are admin-gated; the cron entrance carries the
  // secret. A test that actually texts a person must never be reachable by
  // guessing a URL.
  if (preview || test) {
    const gate = await requireAdmin()
    if (gate instanceof NextResponse) return gate
  } else {
    const secret = process.env.CRON_SECRET
    if (secret && (req.headers.get('authorization') || '') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  if (test) {
    return NextResponse.json({ ok: true, test: await sendNewInquirySmsTest() })
  }

  if (preview) {
    const now = new Date()
    const [pending, nudges] = await Promise.all([listPendingInquiries(now), listPendingNudges(now)])
    const waited = nudges.length ? (now.getTime() - nudges[0].notifiedAt.getTime()) / 3_600_000 : 0
    return NextResponse.json({
      ok: true,
      recipient: NEW_INQUIRY_SMS_RECIPIENT,
      inTextingWindow: inTextingWindow(now),
      alert: {
        pending: pending.map((p) => ({ id: p.id, title: p.title, source: p.source, createdAt: p.createdAt })),
        wouldSend: pending.length ? composeAlert(pending, HQ_APP_URL) : null,
      },
      nudge: {
        pending: nudges.map((p) => ({ id: p.id, title: p.title, notifiedAt: p.notifiedAt })),
        wouldSend: nudges.length ? composeNudge(nudges, HQ_APP_URL, waited) : null,
      },
    })
  }

  // The alert runs first: a lead that arrives and is announced on this same
  // pass must not also be eligible to be nudged on it.
  const alert = await sweepNewInquirySms()
  const nudge = await sweepNewInquiryNudges()
  return NextResponse.json({ ok: true, alert, nudge })
}
