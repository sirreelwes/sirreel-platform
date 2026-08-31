import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import {
  renderEmailShell,
  renderEmailText,
  detailTable,
  calloutBox,
} from '@/lib/email/templates/shell'

/**
 * hq@ notification carrying the actual PDF, for the two documents the
 * team still works out of their inbox: a signed RENTAL AGREEMENT and a
 * client-submitted COI.
 *
 * WHY (Wes, 2026-08-30): the paperwork now lands in HQ — the signed
 * agreement renders to blob storage, the certificate files as a
 * CoiCheck — and several of those paths emailed NOBODY. The native job
 * portal is the live client surface, and both of its submissions
 * (/api/portal/job/agreement/sign, /api/portal/job/coi) were silent:
 * the document existed only for whoever thought to open the job page.
 * This is an explicit BRIDGE while the team moves off inbox-as-filing-
 * cabinet — retire it once the job page is where they look first.
 *
 * Deliberately a copy, not a handoff: HQ remains the system of record.
 * The email is a notification that happens to carry the document.
 *
 * FIRE AND FORGET — callers must NOT await. The document is already
 * stored and the client's submit has already succeeded; a Resend outage
 * must never fail or delay it. Failures log and are swallowed.
 *
 * hq@sirreel.com is an OUTBOUND-ONLY distribution group (wes/jose/
 * oliver); replies compose from each member's own address. Same inbox
 * and same reasoning as src/lib/email/notifyPublicSubmission.ts.
 */

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

/**
 * Resend caps a send at 40 MB and base64 inflates the payload by ~4/3,
 * so a big certificate can bounce the whole notification. Past this the
 * email still goes — WITHOUT the attachment, saying so, with the HQ
 * link. A notification minus its PDF beats no notification. (The COI
 * drop route accepts up to 25 MB, so this is reachable.)
 */
const MAX_ATTACH_BYTES = 12 * 1024 * 1024

export type HqDocumentKind = 'rental-agreement' | 'coi'

const KIND: Record<HqDocumentKind, { label: string; eyebrow: string; noun: string }> = {
  'rental-agreement': {
    label: 'Rental agreement signed',
    eyebrow: 'Client paperwork',
    noun: 'signed rental agreement',
  },
  coi: {
    label: 'COI submitted',
    eyebrow: 'Client paperwork',
    noun: 'certificate of insurance',
  },
}

export interface HqDocumentEvent {
  kind: HqDocumentKind
  /** Subject line context, in Cognito's pipe shape after the label. */
  companyName?: string | null
  jobName?: string | null
  /** Label/value rows under the heading (signer, file, dates…). */
  rows?: Array<{ label: string; value: string }>
  /** The document itself. Null when the caller couldn't produce bytes. */
  document?: { filename: string; content: Buffer } | null
  /** Deep link into HQ — job page where the paperwork is retrieved. */
  href?: string | null
  /** Client address, so Reply answers them (same rule as the other notifies). */
  replyTo?: string | null
  /** Red-flagged line — e.g. the named-insured mismatch. */
  warning?: string | null
  /** Logging tag suffix. */
  label?: string
}

export function notifyHqDocument(ev: HqDocumentEvent): void {
  void send(ev).catch((err) =>
    console.error(`[notify:hq-doc:${ev.kind}] threw (submission unaffected):`, err),
  )
}

async function send(ev: HqDocumentEvent): Promise<void> {
  const kind = KIND[ev.kind]
  const company = ev.companyName?.trim() || null
  const job = ev.jobName?.trim() || null

  // "Rental agreement signed | Miniac Films | Etsy Summer" — the pipe
  // shape the team's eyes and inbox filters already run on.
  const subject = [kind.label, company, job].filter(Boolean).join(' | ')

  const oversize = !!ev.document && ev.document.content.byteLength > MAX_ATTACH_BYTES
  const attach = ev.document && !oversize ? ev.document : null
  const href = ev.href || `${HQ_APP_URL}/jobs`

  const rows = ev.rows ?? []
  const bodyHtml = [
    detailTable(rows),
    ev.warning ? calloutBox(`<b style="color:#b91c1c">Check this:</b> ${esc(ev.warning)}`) : '',
    calloutBox(
      attach
        ? `The ${kind.noun} is attached. It is also filed in HQ on the job page — replying to this email goes straight to the client.`
        : oversize
          ? `The ${kind.noun} was too large to attach (${mb(ev.document!.content.byteLength)} MB). Open it on the job page in HQ.`
          : `The ${kind.noun} is filed in HQ on the job page.`,
    ),
  ].join('')

  const html = renderEmailShell({
    eyebrow: kind.eyebrow,
    heading: kind.label,
    preheader: [company, job].filter(Boolean).join(' · ') || kind.label,
    bodyHtml,
    cta: { label: 'Open in HQ', href },
  })
  const text = renderEmailText([
    subject,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(ev.warning ? ['', `CHECK THIS: ${ev.warning}`] : []),
    '',
    attach ? `${cap(kind.noun)} attached.` : `${cap(kind.noun)} is filed in HQ.`,
    href,
  ])

  const replyTo = ev.replyTo?.trim()
  await sendAgreementEmail({
    to: await channelRecipients('hq-documents'),
    subject,
    html,
    text,
    replyTo: replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) ? replyTo : undefined,
    attachments: attach
      ? [{ filename: safeFilename(attach.filename), content: attach.content }]
      : undefined,
    label: `hq-doc:${ev.kind}${ev.label ? `:${ev.label}` : ''}`,
  })
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

/** Client-supplied filenames reach this; keep them boring. */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(0, 120)
  return cleaned || 'document.pdf'
}
