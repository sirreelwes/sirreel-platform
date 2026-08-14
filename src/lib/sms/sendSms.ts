/**
 * Minimal SMS send via Twilio's REST API using plain fetch (no SDK/dependency).
 *
 * Configured with env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 * (an SMS-capable Twilio number in E.164, e.g. +18185551234). When any of those
 * is missing, this NO-OPS and returns { ok:false, skipped:true } so callers can
 * fall back to email rather than error.
 */
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

export async function sendSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !token || !from) return { ok: false, skipped: true }

  const dest = toE164(to)
  if (!dest) return { ok: false, error: `unusable destination number: ${to.trim() || '(empty)'}` }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      // The From number is env-configured by hand too, and Twilio rejects it
      // in the same way — normalised so a dashed number in Vercel does not
      // fail every send with a message about the destination.
      body: new URLSearchParams({
        To: dest,
        From: toE164(from) ?? from.trim(),
        Body: body.slice(0, 1500),
      }).toString(),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: `Twilio ${res.status} ${t.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'sms error' }
  }
}
