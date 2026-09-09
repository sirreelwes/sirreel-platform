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

  // Shape check on the stored credentials. Every Twilio read returned 401
  // "actor doesn't have any assertions" on 2026-09-08 — including the plain
  // account read, which needs no scope — so the question is whether the
  // values are well-formed and whether they belong to the account the
  // campaign actually lives in. The account SID is not a secret (it is
  // printed in Twilio's own rejection emails); the key secret is never
  // echoed, only measured.
  const mask = (v: string | undefined) => (v && v.length > 10 ? `${v.slice(0, 6)}…${v.slice(-4)}` : null)
  const credentials = {
    accountSidWellFormed: /^AC[0-9a-f]{32}$/i.test(sid),
    accountSid: mask(sid),
    accountSidLength: sid.length,
    keySidWellFormed: /^SK[0-9a-f]{32}$/i.test(keySid ?? ''),
    keySid: mask(keySid),
    keySidLength: keySid?.length ?? 0,
    keySecretLength: keySecret?.length ?? 0,
    hasAuthToken: Boolean(authToken),
  }

  const call = async (url: string) => {
    const r = await fetch(url, { headers: { Authorization: auth }, cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    return { url, status: r.status, ok: r.ok, json: j as Record<string, unknown> }
  }

  const CAMPAIGN_URL = `https://messaging.twilio.com/v1/Services/${MESSAGING_SERVICE_SID}/Compliance/Usa2p`
  let res = await call(CAMPAIGN_URL)

  // Twilio answered 70051 "actor doesn't have any assertions" for a Standard
  // API key on 2026-09-08 — an IAM scope problem, not a bad credential. Probe
  // the ladder so the failure says WHICH permission is missing rather than
  // just "401": account read → messaging service → brand → campaign.
  if (!res.ok) {
    const probes = await Promise.all([
      call(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`),
      call(`https://messaging.twilio.com/v1/Services/${MESSAGING_SERVICE_SID}`),
      call('https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=5'),
    ])
    return NextResponse.json({
      ok: false,
      error: 'Twilio refused the credentials for the campaign resource.',
      credentialKind: keySid && keySecret ? 'api-key' : 'auth-token',
      credentials,
      campaign: { status: res.status, code: res.json?.code, message: res.json?.message },
      probes: probes.map((p) => ({
        resource: p.url.replace(/https:\/\/[^/]+/, '').replace(sid, '{account}').replace(MESSAGING_SERVICE_SID, '{service}'),
        status: p.status,
        code: p.json?.code ?? null,
        message: p.json?.message ?? null,
      })),
      hint: 'Every probe 401 (including the plain account read, which needs no scope) means the credential itself is not authenticating: the key was deleted, or it belongs to a different Twilio account than the one holding the campaign. Compare credentials.accountSid against the Account SID in Twilio\'s rejection email, then create a fresh Standard API key IN THAT ACCOUNT and update both Vercel Production values.',
    }, { status: 502 })
  }

  const body = res.json

  const compliances = Array.isArray(body.compliances) ? (body.compliances as Array<Record<string, unknown>>) : []
  const campaigns = compliances.map((c) => {
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
