/**
 * Minimal SMS send via Twilio's REST API using plain fetch (no SDK/dependency).
 *
 * Configured with env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 * (an SMS-capable Twilio number in E.164, e.g. +18185551234). When any of those
 * is missing, this NO-OPS and returns { ok:false, skipped:true } so callers can
 * fall back to email rather than error.
 */
export async function sendSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !token || !from) return { ok: false, skipped: true }

  const dest = to.trim()
  if (!dest) return { ok: false, error: 'empty destination' }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: dest, From: from, Body: body.slice(0, 1500) }).toString(),
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
