/**
 * Notification fan-out for the four public forms (supply order, contact,
 * space inquiry, agent intake).
 *
 * WHY: every one of those routes used to write an Inquiry(WEB_FORM, NEW)
 * and return, with no email to anyone. The supply form even told the
 * client "your SirReel agent will follow up shortly" while nothing
 * notified an agent — the promise rode entirely on someone opening the
 * triage queue. At zero public traffic that was survivable; at go-live it
 * is a dropped stage inquiry.
 *
 * Two sends per submission:
 *   1. INTERNAL → HQ_NOTIFY_INBOX (hq@sirreel.com). replyTo is the
 *      client, so an agent can answer straight from the notification.
 *   2. CLIENT → an acknowledgement with the reference number, so the
 *      submission exists in writing on their side too.
 *
 * FIRE AND FORGET. Callers must NOT await this. A Resend outage, a bad
 * address, or a slow API must never fail or delay the client's submit —
 * the Inquiry row is already written and is the real system of record.
 * Failures are logged and swallowed.
 *
 * CRM CAPTURE CAVEAT: hq@sirreel.com is NOT in SALES_CAPTURE_INBOXES
 * (info@/jose@/oliver@ only — src/lib/crm/captureConstants.ts). A reply
 * sent FROM hq@ will not be auto-captured into the CRM. Agents should
 * reply from their own address, or hq@ needs adding to that set.
 */

import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import {
  renderEmailShell,
  renderEmailText,
  p,
  detailTable,
  calloutBox,
} from '@/lib/email/templates/shell'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/** Override per-environment so staging never mails the real team. */
const HQ_INBOX = process.env.HQ_NOTIFY_INBOX || 'hq@sirreel.com'

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

export type PublicFormKind = 'supply-order' | 'contact' | 'space-inquiry' | 'intake'

interface KindCopy {
  /** Internal subject prefix. */
  internal: string
  /** Client subject. */
  clientSubject: string
  /** Client heading. */
  clientHeading: string
  /** Client lead paragraph. */
  clientLead: string
}

const COPY: Record<PublicFormKind, KindCopy> = {
  'supply-order': {
    internal: 'New supply order',
    clientSubject: 'We received your SirReel order',
    clientHeading: "We've got your order",
    clientLead:
      'Thanks for the order — it is in front of our team now. An agent will confirm pricing and availability with you shortly.',
  },
  contact: {
    internal: 'New contact request',
    clientSubject: 'We received your message',
    clientHeading: 'Thanks for reaching out',
    clientLead:
      'Your message is with our team. An agent will get back to you shortly.',
  },
  'space-inquiry': {
    internal: 'New stage / space inquiry',
    clientSubject: 'We received your stage inquiry',
    clientHeading: 'Thanks for your inquiry',
    clientLead:
      'Thanks for your interest in our stages. An agent will follow up shortly with availability and pricing.',
  },
  intake: {
    internal: 'New intake submission',
    clientSubject: 'We received your details',
    clientHeading: "Thanks — we've got your details",
    clientLead: 'Your details are with our team. An agent will follow up shortly.',
  },
}

export interface PublicSubmission {
  kind: PublicFormKind
  /** Inquiry row id — used to deep-link the internal email into HQ. */
  inquiryId: string
  /** Client-facing reference (supply orders); shown in both emails. */
  reference?: string | null
  contact: {
    name?: string | null
    email?: string | null
    phone?: string | null
    role?: string | null
  }
  /** Short one-line description for the subject (job/company/space). */
  subjectHint?: string | null
  /** Label/value rows shown in BOTH emails. Keep client-safe. */
  details: Array<{ label: string; value: string }>
  /** Rows shown ONLY internally (IP, cart dumps, agent slug, totals). */
  internalOnlyDetails?: Array<{ label: string; value: string }>
}

function looksLikeEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

function rowsToText(rows: Array<{ label: string; value: string }>): string[] {
  return rows.map((r) => `${r.label}: ${r.value}`)
}

/**
 * Fire-and-forget. Do NOT await — see the file header.
 */
export function notifyPublicSubmission(sub: PublicSubmission): void {
  void sendInternal(sub).catch((err) =>
    console.error(`[notify:${sub.kind}] internal notify threw:`, err),
  )
  void sendClientAck(sub).catch((err) =>
    console.error(`[notify:${sub.kind}] client ack threw:`, err),
  )
}

async function sendInternal(sub: PublicSubmission): Promise<void> {
  const copy = COPY[sub.kind]
  const who = sub.contact.name?.trim() || sub.contact.email?.trim() || 'unknown contact'
  const hint = sub.subjectHint?.trim()
  const subject = `${copy.internal} — ${who}${hint ? ` · ${hint}` : ''}`

  const allRows = [
    ...sub.details,
    ...(sub.internalOnlyDetails ?? []),
    ...(sub.reference ? [{ label: 'Reference', value: sub.reference }] : []),
  ]
  const link = `${HQ_APP_URL}/inquiries/${sub.inquiryId}`

  const contactRows = [
    { label: 'Name', value: sub.contact.name?.trim() || '—' },
    { label: 'Email', value: sub.contact.email?.trim() || '—' },
    { label: 'Phone', value: sub.contact.phone?.trim() || '—' },
    ...(sub.contact.role?.trim() ? [{ label: 'Role', value: sub.contact.role.trim() }] : []),
  ]

  const html = renderEmailShell({
    eyebrow: 'New submission',
    heading: copy.internal,
    preheader: `${who}${hint ? ` · ${hint}` : ''}`,
    bodyHtml: [
      detailTable(contactRows),
      allRows.length ? detailTable(allRows) : '',
      calloutBox('Open it in HQ to assign an owner and reply. Replying to this email goes straight to the client.'),
    ].join(''),
    cta: { label: 'Open in HQ', href: link },
  })

  const text = renderEmailText([
    subject,
    '',
    ...rowsToText(contactRows),
    '',
    ...rowsToText(allRows),
    '',
    `Open in HQ: ${link}`,
  ])

  const res = await sendAgreementEmail({
    to: [HQ_INBOX],
    subject,
    html,
    text,
    // Lets an agent answer the client directly from the notification.
    replyTo: looksLikeEmail(sub.contact.email) ? sub.contact.email.trim() : undefined,
    label: `public-submission:${sub.kind}:${sub.inquiryId.slice(0, 8)}`,
  })
  if (!res.ok) console.error(`[notify:${sub.kind}] internal notify failed:`, res.reason)
}

async function sendClientAck(sub: PublicSubmission): Promise<void> {
  if (!looksLikeEmail(sub.contact.email)) return
  const copy = COPY[sub.kind]
  const first = sub.contact.name?.trim().split(/\s+/)[0]

  const html = renderEmailShell({
    eyebrow: 'Received',
    heading: copy.clientHeading,
    preheader: copy.clientLead,
    bodyHtml: [
      p(first ? `Hi ${first},` : 'Hi,'),
      p(copy.clientLead),
      sub.reference
        ? calloutBox(
            `<strong style="color:#0c0c0d;">Your reference:</strong> <span style="font-family:monospace;font-size:15px;">${sub.reference}</span><br>Quote this if you call or email us about it.`,
          )
        : '',
      sub.details.length
        ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#8a8272;margin:22px 0 8px;">What we received</div>${detailTable(sub.details)}`
        : '',
    ].join(''),
    footNote: `Need to change something or add to this? Call us at <a href="${PUBLIC_CONTACT.phoneHref}" style="color:#c39a3f;text-decoration:none;font-weight:600;">${PUBLIC_CONTACT.phone}</a> — we answer 24/7. Nothing is confirmed until an agent has been in touch.`,
  })

  const text = renderEmailText([
    first ? `Hi ${first},` : 'Hi,',
    '',
    copy.clientLead,
    ...(sub.reference ? ['', `Your reference: ${sub.reference}`] : []),
    ...(sub.details.length ? ['', 'What we received:', ...rowsToText(sub.details)] : []),
    '',
    `Questions? Call ${PUBLIC_CONTACT.phone} — we answer 24/7.`,
    'Nothing is confirmed until an agent has been in touch.',
  ])

  const res = await sendAgreementEmail({
    to: [sub.contact.email.trim()],
    subject: copy.clientSubject,
    html,
    text,
    label: `public-ack:${sub.kind}:${sub.inquiryId.slice(0, 8)}`,
  })
  if (!res.ok) console.error(`[notify:${sub.kind}] client ack failed:`, res.reason)
}
