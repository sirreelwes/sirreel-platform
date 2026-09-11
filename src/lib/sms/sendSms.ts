/**
 * Minimal SMS send via Twilio's REST API using plain fetch (no SDK/dependency).
 *
 * Two credential styles, because Twilio issues different ones depending on
 * when and how the account was made:
 *
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN            (classic)
 *   TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID
 *                      + TWILIO_API_KEY_SECRET        (API key / "client secret")
 *
 * TWILIO_ACCOUNT_SID is required either way and must be the ACCOUNT SID —
 * the one starting with "AC", from Console → Account Info. It is not
 * interchangeable with an API key SID: it goes in the REQUEST PATH, and an
 * "SK" value there 404s no matter how valid the secret is. That failure would
 * read as "Twilio is broken" rather than "wrong SID", so it is checked up
 * front and named.
 *
 * API keys are the better of the two — individually revocable, and rotating
 * one does not invalidate every other integration on the account.
 *
 * TWILIO_FROM_NUMBER is an SMS-capable Twilio number. When credentials are
 * missing this NO-OPS and returns { ok:false, skipped:true } so callers fall
 * back to email rather than error.
 *
 * TWILIO_MESSAGING_SERVICE_SID (MG…) is the registered path. The A2P 10DLC
 * campaign was approved 2026-09-10 against Messaging Service
 * MGda3482bd81e2c26b45cc188de36124dc, and carriers treat traffic as
 * registered only when it goes out THROUGH that service — sending with a
 * bare From number that happens to be in the service works, but sending
 * from a number that was never added to it is filtered as unregistered
 * (error 30034) with no error at send time. So when the service SID is set
 * the request carries MessagingServiceSid and no From: the service picks
 * its sender, and a number that is not in the service cannot be picked,
 * which turns "silently filtered" into "failed at send time". The From
 * number stays the fallback for an environment with no service configured.
 */

export interface TwilioConfig {
  accountSid: string
  /** HTTP Basic username — API key SID when present, else the account SID. */
  user: string
  /** HTTP Basic password — API key secret when present, else the auth token. */
  pass: string
  /** Bare sender; used only when no messaging service is configured. */
  from: string | null
  /** MG… SID. When set, sends go through the service and From is omitted. */
  messagingServiceSid: string | null
}

/**
 * Resolve credentials, preferring an API key when one is configured.
 * Returns a reason string instead of a config when unusable, so the caller
 * can report WHY rather than silently sending nothing.
 */
export function resolveTwilioConfig(
  env: NodeJS.ProcessEnv = process.env,
): { config: TwilioConfig } | { config: null; reason: string | null } {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim()
  const keySid = env.TWILIO_API_KEY_SID?.trim()
  const keySecret = env.TWILIO_API_KEY_SECRET?.trim()
  const authToken = env.TWILIO_AUTH_TOKEN?.trim()
  const from = env.TWILIO_FROM_NUMBER?.trim() || null
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null

  // Nothing configured at all is the normal "SMS is off" state, not an error.
  if (!accountSid && !keySid && !authToken && !from && !messagingServiceSid) return { config: null, reason: null }

  if (!accountSid) {
    return { config: null, reason: 'TWILIO_ACCOUNT_SID is not set (the AC… value from Console → Account Info).' }
  }
  if (!accountSid.startsWith('AC')) {
    return {
      config: null,
      reason: `TWILIO_ACCOUNT_SID must be the Account SID starting with "AC" — got "${accountSid.slice(0, 2)}…". An API key SID (SK…) belongs in TWILIO_API_KEY_SID.`,
    }
  }
  if (messagingServiceSid && !messagingServiceSid.startsWith('MG')) {
    return {
      config: null,
      reason: `TWILIO_MESSAGING_SERVICE_SID must be the Messaging Service SID starting with "MG" — got "${messagingServiceSid.slice(0, 2)}…".`,
    }
  }
  if (!from && !messagingServiceSid) {
    return { config: null, reason: 'Neither TWILIO_MESSAGING_SERVICE_SID nor TWILIO_FROM_NUMBER is set.' }
  }

  const sender = { from, messagingServiceSid }
  if (keySid && keySecret) return { config: { accountSid, user: keySid, pass: keySecret, ...sender } }
  if (keySid && !keySecret) {
    return { config: null, reason: 'TWILIO_API_KEY_SID is set but TWILIO_API_KEY_SECRET is missing.' }
  }
  if (authToken) return { config: { accountSid, user: accountSid, pass: authToken, ...sender } }
  return {
    config: null,
    reason: 'No Twilio credential: set TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET, or TWILIO_AUTH_TOKEN.',
  }
}
/**
 * Normalise a phone number to E.164, which is the only format Twilio accepts.
 *
 * Numbers are typed into /admin/assistant by hand and stored as people write
 * them — "818-515-2389", "(760) 672-5522". Passing those through verbatim
 * gets a Twilio 400 and no text, which would have surfaced as an on-call
 * alert that silently failed at 1am rather than as a configuration error
 * anyone could see.
 *
 * US default is deliberate: SirReel is in Sun Valley and every number on file
 * is domestic. Anything already in +E.164 is passed through untouched, so an
 * international on-call number still works if one is ever added. Anything
 * that cannot be resolved returns null rather than a guess — a wrong number
 * texts a stranger, and reports success while doing it.
 */
export function toE164(raw: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/**
 * The form body for one outbound message. Pure, so the test can pin the one
 * fact that matters: with a messaging service configured, the request names
 * the service and carries NO From — Twilio rejects a From that is not in the
 * service, which is the loud failure we want over a silently filtered send.
 */
export function buildMessageParams(
  config: Pick<TwilioConfig, 'from' | 'messagingServiceSid'>,
  args: { to: string; body: string; statusCallback?: string },
): URLSearchParams {
  const params = new URLSearchParams({ To: args.to, Body: args.body.slice(0, 1500) })
  if (config.messagingServiceSid) params.set('MessagingServiceSid', config.messagingServiceSid)
  // The From number is env-configured by hand too, and Twilio rejects it in
  // the same way as a bad destination — normalised so a dashed number in
  // Vercel does not fail every send with a message about the destination.
  else if (config.from) params.set('From', toE164(config.from) ?? config.from.trim())
  if (args.statusCallback) params.set('StatusCallback', args.statusCallback)
  return params
}

export async function sendSms(
  to: string,
  body: string,
  opts: {
    /** Twilio posts delivery status here (see /api/public/sms/status). */
    statusCallback?: string
  } = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string; sid?: string }> {
  const resolved = resolveTwilioConfig()
  if (!resolved.config) {
    // A misconfiguration is reported; an absent configuration is skipped.
    // Collapsing the two is how a typo'd SID would look identical to "SMS
    // is deliberately off".
    return resolved.reason
      ? { ok: false, error: resolved.reason }
      : { ok: false, skipped: true }
  }
  const { accountSid, user, pass } = resolved.config

  const dest = toE164(to)
  if (!dest) return { ok: false, error: `unusable destination number: ${to.trim() || '(empty)'}` }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildMessageParams(resolved.config, { to: dest, body, statusCallback: opts.statusCallback }).toString(),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `Twilio ${res.status} ${t.slice(0, 200)}` }
    }
    const j = (await res.json().catch(() => ({}))) as { sid?: string }
    return { ok: true, sid: typeof j.sid === 'string' ? j.sid : undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'sms error' }
  }
}
