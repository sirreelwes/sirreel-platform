/**
 * GET /api/admin/a2p-campaign — read the A2P 10DLC campaign as Twilio
 * actually holds it. Admin-gated, read-only, no secrets in the response.
 *
 * Why this exists: the campaign was rejected three times (2026-09-07,
 * twice on 2026-09-08) with the generic error 30909, and Twilio's Console
 * throws React #310 on the campaign edit form — so an edit may never have
 * been saved, and the rejection email always prints the ORIGINAL submitted
 * timestamp, which cannot distinguish a fresh verdict from a stale one.
 * The API is the only way to see what is actually filed and the reviewer's
 * own `errors` text (the email omits it). The credentials live in Vercel
 * Production and are marked Sensitive, so they cannot be read back out to
 * a laptop — but the production runtime has them, which is what this uses.
 *
 * The response includes `flowMatchesDoc`: whether the stored message flow
 * matches docs/sms/twilio-a2p-campaign.md. False means the Console lost the
 * edit and the fix is to re-file, not to rewrite the copy.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

const MESSAGING_SERVICE_SID = 'MGda3482bd81e2c26b45cc188de36124dc'

/** The first sentence of the flow as filed — enough to fingerprint it
 *  without shipping the whole document into the bundle. */
const DOC_FLOW_MARKERS = [
  'four paths',
  'unchecked by default',
  'sirreel.com/sms-terms/opt-in-examples',
  'OPTOUT, REVOKE',
]

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const sid = process.env.TWILIO_ACCOUNT_SID
  const keySid = process.env.TWILIO_API_KEY_SID
  const keySecret = process.env.TWILIO_API_KEY_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !((keySid && keySecret) || authToken)) {
    return NextResponse.json({ ok: false, error: 'Twilio credentials are not configured in this environment.' }, { status: 503 })
  }
  const auth = 'Basic ' + Buffer.from(keySid && keySecret ? `${keySid}:${keySecret}` : `${sid}:${authToken}`).toString('base64')

  const res = await fetch(`https://messaging.twilio.com/v1/Services/${MESSAGING_SERVICE_SID}/Compliance/Usa2p`, {
    headers: { Authorization: auth },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json({ ok: false, status: res.status, twilio: { code: body?.code, message: body?.message } }, { status: 502 })
  }

  const campaigns = (body.compliances ?? []).map((c: Record<string, unknown>) => {
    const flow = typeof c.message_flow === 'string' ? c.message_flow : ''
    return {
      sid: c.sid,
      campaignId: c.campaign_id,
      status: c.campaign_status,
      useCase: c.us_app_to_person_usecase,
      // The reviewer's own words. This is what the rejection email leaves out.
      errors: c.errors ?? null,
      rateLimits: c.rate_limits ?? null,
      description: c.description,
      messageFlow: flow,
      messageFlowLength: flow.length,
      // Did the Console actually save what we filed?
      flowMatchesDoc: DOC_FLOW_MARKERS.every((m) => flow.includes(m)),
      missingMarkers: DOC_FLOW_MARKERS.filter((m) => !flow.includes(m)),
      messageSamples: c.message_samples ?? [],
      optInKeywords: c.opt_in_keywords,
      optOutKeywords: c.opt_out_keywords,
      helpKeywords: c.help_keywords,
      optInMessage: c.opt_in_message,
      optOutMessage: c.opt_out_message,
      helpMessage: c.help_message,
      hasEmbeddedLinks: c.has_embedded_links,
      hasEmbeddedPhone: c.has_embedded_phone,
    }
  })

  return NextResponse.json({ ok: true, messagingServiceSid: MESSAGING_SERVICE_SID, campaigns })
}
