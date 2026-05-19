import { Resend } from 'resend'

export type EmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: string }

export interface EmailPayload {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  /** Plain-text alternative. Email clients with HTML disabled (and some
   * filtering rules) show this instead. Improves deliverability. */
  text?: string
  attachments?: { filename: string; content: Buffer }[]
  /** Logging tag — surfaces in console error lines so it's obvious which touchpoint failed. */
  label?: string
}

/**
 * Wraps Resend's `emails.send` so every agreement-related email returns a
 * structured success/failure result instead of throwing past the caller.
 *
 * Why this exists: the SirReel Resend account has had `sirreel.com` sitting
 * unverified since March, which causes every send to fail with "domain not
 * verified" — but our earlier helpers swallowed those errors in a try/catch
 * + console.error, so the failures were invisible to the calling routes and
 * to the admin UI. Returning a result here lets the route bubble the failure
 * into the API response payload (`emailResult` field) where the UI / function
 * logs can actually surface it.
 *
 * Behaviour:
 *  - Missing `RESEND_API_KEY` → `{ ok: false, reason: 'RESEND_API_KEY not set' }`
 *  - Resend throws (network, auth, domain unverified, …) → `{ ok: false, reason: <message> }`
 *  - Resend returns an error object → `{ ok: false, reason: <message> }`
 *  - Success → `{ ok: true, id }`
 */
export async function sendAgreementEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: 'RESEND_API_KEY not set' }
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const result = await resend.emails.send({
      from: 'SirReel HQ <notifications@sirreel.com>',
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments,
    })
    if ((result as any)?.error) {
      const errMessage = (result as any).error?.message || JSON.stringify((result as any).error)
      console.error(
        `[email] ${payload.label || 'send'} returned error:`,
        errMessage,
      )
      return { ok: false, reason: errMessage }
    }
    const id = (result as any)?.data?.id ?? null
    return { ok: true, id }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[email] ${payload.label || 'send'} threw:`, reason)
    return { ok: false, reason }
  }
}
