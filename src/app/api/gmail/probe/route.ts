/**
 * GET /api/gmail/probe?email=name@sirreel.com
 *
 * Read-only DWD impersonation check. Tries `gmail.users.getProfile`
 * via the service-account JWT path. Reports back whether the
 * mailbox is a real Workspace USER (impersonatable) or a GROUP /
 * ALIAS (which throws — groups can't be DWD-impersonated).
 *
 * Used as a STEP-0 confirmation before adding a new address to
 * the centralized WATCHED_INBOXES list. NO state changes; safe to
 * call repeatedly. Restricted to *@sirreel.com to avoid probing
 * arbitrary domains.
 */
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const email = new URL(req.url).searchParams.get('email')?.trim().toLowerCase()
  if (!email || !/^[a-z0-9._+-]+@sirreel\.com$/i.test(email)) {
    return NextResponse.json(
      { ok: false, reason: 'email query param required (@sirreel.com only)' },
      { status: 400 },
    )
  }

  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  let credentials: { client_email?: string; private_key?: string }
  try {
    credentials = JSON.parse(rawKey)
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: `GOOGLE_SERVICE_ACCOUNT_KEY parse failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
  if (!credentials.client_email || !credentials.private_key) {
    return NextResponse.json({ ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_KEY incomplete' }, { status: 500 })
  }

  try {
    const auth = new google.auth.JWT(
      credentials.client_email, undefined, credentials.private_key,
      ['https://www.googleapis.com/auth/gmail.readonly'],
      email,
    )
    const gmail = google.gmail({ version: 'v1', auth })
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return NextResponse.json({
      ok: true,
      email,
      address: profile.data.emailAddress,
      historyId: profile.data.historyId,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, email, reason }, { status: 200 })
  }
}
