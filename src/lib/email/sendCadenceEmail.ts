import { Resend } from 'resend'
import type { CadenceEventType } from '@prisma/client'
import {
  renderCadenceTemplate,
  renderCadenceTemplateString,
  type RenderedCadenceEmail,
} from '@/lib/email/templates/renderCadenceTemplate'
import type {
  CadenceTemplate,
  CadenceTemplateContext,
} from '@/lib/email/templates/cadenceTemplates'
import type { EmailResult } from '@/lib/email/sendAgreementEmail'

export type { EmailResult } from '@/lib/email/sendAgreementEmail'

const DEFAULT_FROM = 'SirReel HQ <notifications@sirreel.com>'

export interface CadenceFrom {
  /** Display name, e.g. "Jose Pacheco". Optional — falls back to "SirReel HQ". */
  name?: string
  /** Sending address. Must live on a Resend-verified domain. */
  email: string
}

export interface SendCadenceEmailInput {
  /**
   * Sender identity. When omitted, defaults to `SirReel HQ
   * <notifications@sirreel.com>` so the helper still works before per-rep
   * domain verification is in place. Cadence emails that are signed by the
   * rep in the template body SHOULD set `from` to the rep's address (once
   * sirreel.com DKIM is up) so the From line matches the sign-off.
   */
  from?: CadenceFrom
  to: string[]
  cc?: string[]
  replyTo?: string
  attachments?: { filename: string; content: Buffer }[]
  /**
   * Either an event type (looks up the locked template) or an explicit
   * template object (used by callers outside the cadence enum, e.g. the
   * multi-contact authorization ask).
   */
  eventType?: CadenceEventType
  template?: CadenceTemplate
  context: CadenceTemplateContext
  /** Log label so failures can be traced back to the calling event. */
  label?: string
}

export type SendCadenceEmailResult = EmailResult & { rendered: RenderedCadenceEmail | null }

/**
 * Render-and-send wrapper for cadence emails. Always returns a structured
 * result — never throws past the caller. The rendered body is included in
 * the result so the cadence runner can log or persist a copy alongside the
 * CadenceEvent row.
 *
 * Failure modes (return ok:false with reason):
 *   - Missing template (eventType has no entry in CADENCE_TEMPLATES)
 *   - CADENCE_SENDING_ENABLED is not "true" (master safety switch — see below)
 *   - RESEND_API_KEY unset
 *   - Resend throws or returns error
 *
 * SAFETY (added after Phase 2.3 + 4.1 shipped real cadence email handlers):
 *
 *   CADENCE_SENDING_ENABLED — master switch. Defaults to OFF: when this
 *     env var is anything other than the literal string "true", every
 *     sendCadenceEmail() call short-circuits before reaching Resend.
 *     The cadence runner converts this into a skipped CadenceEvent with
 *     skipReason "send-disabled-globally", so the queue isn't drained.
 *     Flip to "true" in Vercel only when you're ready for live sends.
 *
 *   CADENCE_TEST_OVERRIDE_EMAIL — test redirect. When set, the `to`
 *     address is rewritten to this single recipient and `cc` is dropped.
 *     A "Test redirect" banner is prepended to both the html and text
 *     bodies so the recipient knows the original `to` was overridden.
 *     Use this for end-to-end cadence testing against a developer
 *     mailbox without spamming real clients.
 *
 * Both flags are read at call time (not module load) so a config change
 * takes effect on the very next cadence-runner tick.
 */
export async function sendCadenceEmail(
  input: SendCadenceEmailInput,
): Promise<SendCadenceEmailResult> {
  let rendered: RenderedCadenceEmail | null = null
  if (input.template) {
    rendered = renderCadenceTemplateString(input.template, input.context)
  } else if (input.eventType) {
    rendered = renderCadenceTemplate(input.eventType, input.context)
  }
  if (!rendered) {
    return {
      ok: false,
      reason: `No template registered for ${input.eventType || 'request'}`,
      rendered: null,
    }
  }

  // ── Safety gate 1: master switch ──────────────────────────────────
  if (process.env.CADENCE_SENDING_ENABLED !== 'true') {
    console.log(
      `[cadence-email] BLOCKED — CADENCE_SENDING_ENABLED is not "true". ${input.label || input.eventType || ''} would have gone to ${input.to.join(', ')}`,
    )
    return { ok: false, reason: 'send-disabled-globally', rendered }
  }

  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: 'RESEND_API_KEY not set', rendered }
  }

  // ── Safety gate 2: test override ──────────────────────────────────
  let actualTo = input.to
  let actualCc = input.cc
  let actualHtml = rendered.html
  let actualText = rendered.text
  const override = process.env.CADENCE_TEST_OVERRIDE_EMAIL?.trim()
  if (override) {
    const origTo = input.to.join(', ')
    const origCc = (input.cc || []).join(', ')
    actualTo = [override]
    actualCc = undefined
    const bannerNote = `Test redirect — original recipients were ${origTo}${origCc ? ` (cc ${origCc})` : ''}. This send was rewritten by CADENCE_TEST_OVERRIDE_EMAIL.`
    actualHtml = `<div style="margin:0 0 16px;padding:12px 16px;border-radius:6px;background-color:#fff4e5;border:1px solid #f5c08a;color:#7a3e00;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;">
  <strong>⚠ Test redirect.</strong> Original recipients: ${origTo}${origCc ? ` (cc ${origCc})` : ''}. CADENCE_TEST_OVERRIDE_EMAIL routed this here.
</div>` + actualHtml
    actualText = `[${bannerNote}]\n\n${actualText}`
    console.log(`[cadence-email] OVERRIDE — ${input.label || input.eventType || ''} routed to ${override} instead of ${origTo}`)
  }

  const fromHeader = input.from
    ? input.from.name
      ? `${input.from.name} <${input.from.email}>`
      : input.from.email
    : DEFAULT_FROM
  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const result = await resend.emails.send({
      from: fromHeader,
      to: actualTo,
      cc: actualCc,
      replyTo: input.replyTo,
      subject: rendered.subject,
      html: actualHtml,
      text: actualText,
      attachments: input.attachments,
    })
    if ((result as any)?.error) {
      const reason = (result as any).error?.message || JSON.stringify((result as any).error)
      console.error(`[cadence-email] ${input.label || input.eventType || ''} returned error:`, reason)
      return { ok: false, reason, rendered }
    }
    return { ok: true, id: (result as any)?.data?.id ?? null, rendered }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[cadence-email] ${input.label || input.eventType || ''} threw:`, reason)
    return { ok: false, reason, rendered }
  }
}
