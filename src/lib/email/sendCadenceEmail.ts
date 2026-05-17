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
 * Failure modes:
 *   - Missing template (eventType has no entry in CADENCE_TEMPLATES) → ok:false
 *   - RESEND_API_KEY unset → ok:false
 *   - Resend throws or returns error → ok:false with reason
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

  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: 'RESEND_API_KEY not set', rendered }
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
      to: input.to,
      cc: input.cc,
      replyTo: input.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
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
