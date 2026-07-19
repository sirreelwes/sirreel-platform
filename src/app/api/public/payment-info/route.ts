/**
 * POST /api/public/payment-info — the "Payments made simple." request
 * flow (Wes ruled A). SENSITIVE: triggers the payment/ACH email.
 *
 * INVARIANTS (do not weaken):
 *  - The user-visible response is IDENTICAL for known and unknown
 *    addresses — same status, same body, no redirects. Enumeration of
 *    the CRM through this endpoint must be impossible.
 *  - Details are delivered by EMAIL ONLY, to the RESOLVED on-file
 *    address (resolvePersonByEmail — merge-safe, alias-aware), never
 *    to the submitted string.
 *  - KNOWN = person resolves AND sits on ≥1 Job with status QUOTED /
 *    ACTIVE / WRAPPED. NEW-status jobs and unattached CRM people do
 *    NOT qualify (the CRM is full of stale RentalWorks imports).
 *  - UNKNOWN (or details unconfigured) → agent-queue Inquiry, nothing
 *    sent.
 *  - EVERY request notifies billing@ (known = sales signal, unknown =
 *    follow-up, exception = never-vanish). The notification NEVER
 *    contains the banking details — reference only.
 *  - An internal exception still lands in the queue (Inquiry) and in
 *    billing@'s inbox; the client-facing response stays uniform.
 *  - Rate-limited per IP AND per submitted email (3/hour each).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { resolvePersonByEmail, normalizeEmail } from '@/lib/people/email'
import { buildPaymentInfoEmail } from '@/lib/email/templates/paymentInfo'
import { fetchPaymentAttachments } from '@/lib/email/paymentInfoAttachments'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { isPaymentConfigured, type PaymentDetailsRecord } from '@/lib/payments/paymentDetails'

export const dynamic = 'force-dynamic'

const BILLING_INBOX = 'billing@sirreel.com'

const UNIFORM_RESPONSE = {
  ok: true,
  message:
    "If that address is on file, we've just emailed your payment info. If not, a SirReel agent will reach out.",
}

const RATE: { windowMs: number; max: number } = { windowMs: 60 * 60 * 1000, max: 3 }

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/**
 * Billing notification — fires on EVERY path (auto-sent / queued /
 * error). Same pattern as the COI upload team email. NEVER includes
 * the banking details themselves; reference only. Failure is logged
 * and never changes the client-facing response or blocks anything.
 */
async function notifyBilling(subject: string, lines: string[]): Promise<void> {
  try {
    const html = `<p>${lines.map(escapeHtml).join('<br/>')}</p>`
    const text = lines.join('\n')
    const result = await sendAgreementEmail({
      to: [BILLING_INBOX],
      subject,
      html,
      text,
      label: 'payment-info-notify',
    })
    if (!result.ok) console.error('[payment-info] billing notify failed:', result.reason)
  } catch (err) {
    console.error('[payment-info] billing notify threw:', err)
  }
}

/**
 * Additive Action-Queue visibility — surface the request as a
 * dashboard Alert (the "⚡ Needs Attention" engine) so it doesn't live
 * only in the pipeline Inquiry + billing@ inbox. High severity: a
 * client trying to pay. No expires_at — the unmatched one MUST NOT rot;
 * it stays until an operator dismisses it. Never contains banking
 * details. Failure never blocks the response or the Inquiry write.
 */
async function emitPaymentInfoAlert(input: {
  kind: 'sent' | 'unmatched'
  title: string
  body: string
  link: string | null
}): Promise<void> {
  try {
    await prisma.alert.create({
      data: {
        type: 'payment_info_request',
        title: input.title,
        body: input.body,
        severity: 'high',
        link: input.link,
        // expires_at intentionally null — must not auto-vanish.
      },
    })
  } catch (err) {
    console.error('[payment-info] action-queue alert failed:', err)
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  const body = (await req.json().catch(() => null)) as {
    email?: unknown
    website?: unknown
  } | null

  // Honeypot — bots get the uniform response, nothing happens (no
  // billing notify either; bot noise doesn't belong in the inbox).
  if (body && typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json(UNIFORM_RESPONSE)
  }

  const submitted = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 320) : ''
  if (!submitted || !isEmail(submitted)) {
    return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 })
  }

  // Per-IP and per-email limits — this endpoint can trigger outbound
  // mail; it must not be usable as a spam cannon against an on-file
  // address or as a probe loop.
  const ipRl = checkRateLimit(`payment-info:ip:${ip}`, RATE)
  const emailRl = checkRateLimit(`payment-info:email:${normalizeEmail(submitted)}`, RATE)
  if (!ipRl.ok || !emailRl.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests — try again later.' },
      { status: 429 },
    )
  }

  try {
    const person = (await resolvePersonByEmail(submitted, {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        jobContacts: {
          select: {
            job: {
              select: {
                id: true,
                status: true,
                jobCode: true,
                name: true,
                company: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    })) as
      | {
          id: string
          email: string
          firstName: string | null
          lastName: string | null
          jobContacts: Array<{
            job: { id: string; status: string; jobCode: string; name: string; company: { id: string; name: string } | null }
          }>
        }
      | null

    const qualifyingJobs = person
      ? person.jobContacts
          .map((jc) => jc.job)
          .filter((j) => ['QUOTED', 'ACTIVE', 'WRAPPED'].includes(j.status))
      : []
    const qualifies = qualifyingJobs.length > 0

    const settings = await prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: {
        paymentPayeeName: true,
        paymentBankName: true,
        paymentAccountType: true,
        paymentAccountNumber: true,
        paymentRoutingAch: true,
        paymentRoutingWire: true,
        paymentRemittanceEmail: true,
        paymentBankAddress: true,
        paymentInstructions: true,
        paymentAchFormKey: true,
        paymentAchFormFilename: true,
        paymentBankInfoKey: true,
        paymentBankInfoFilename: true,
      },
    })
    const paymentRecord: PaymentDetailsRecord = {
      payeeName: settings?.paymentPayeeName ?? null,
      bankName: settings?.paymentBankName ?? null,
      accountType: settings?.paymentAccountType ?? null,
      accountNumber: settings?.paymentAccountNumber ?? null,
      routingAch: settings?.paymentRoutingAch ?? null,
      routingWire: settings?.paymentRoutingWire ?? null,
      remittanceEmail: settings?.paymentRemittanceEmail ?? null,
      bankAddress: settings?.paymentBankAddress ?? null,
      instructions: settings?.paymentInstructions ?? null,
    }
    const details = isPaymentConfigured(paymentRecord) ? paymentRecord : null

    if (qualifies && person && details) {
      // KNOWN — send to the RESOLVED on-file address, never the
      // submitted string (they can differ via aliases/merges).
      const email = buildPaymentInfoEmail({
        firstName: person.firstName,
        details,
      })
      // Private-Blob PDF attachments — a fetch failure NEVER blocks the
      // email; dropped slots are recorded in the audit row below (the
      // auto-sent path no longer notifies billing@ — Wes ruled B).
      const { attachments, dropped } = await fetchPaymentAttachments({
        achFormKey: settings?.paymentAchFormKey ?? null,
        achFormFilename: settings?.paymentAchFormFilename ?? null,
        bankInfoKey: settings?.paymentBankInfoKey ?? null,
        bankInfoFilename: settings?.paymentBankInfoFilename ?? null,
      })
      const sent = await sendAgreementEmail({
        to: [person.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: attachments.length > 0 ? attachments : undefined,
        label: 'payment-info',
      })
      await prisma.auditLog.create({
        data: {
          userId: null,
          ipAddress: ip,
          action: 'public.payment_info_sent',
          entityType: 'Person',
          entityId: person.id,
          oldValues: { submittedEmail: submitted },
          // Counts/filenames only — never the details or file contents.
          newValues: {
            sentTo: person.email,
            sendOk: sent.ok,
            attachmentsSent: attachments.length,
            attachmentsDropped: dropped.length,
            at: new Date().toISOString(),
          },
        },
      })
      if (!sent.ok) {
        console.error('[payment-info] send failed for person', person.id, sent)
      }
      const personName = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || 'name unknown'
      const j = qualifyingJobs[0]
      // NO billing@ notification on the auto-sent path (Wes ruled B,
      // 2026-07-19): the system already handled this — it's a sales
      // FYI, not billing work — so pinging billing@ here only dilutes
      // their signal. billing@ fires ONLY on the unmatched/no-match
      // and internal-exception paths below. A failed delivery here is
      // still surfaced (console.error + the Action-Queue alert body
      // flags it), just not to billing@.
      // Action-Queue item — send happened; the action is a light-touch
      // confirm, not a re-send.
      const clientLabel = j.company?.name || personName
      await emitPaymentInfoAlert({
        kind: 'sent',
        title: `Payment info sent to ${clientLabel} — confirm received / follow up`,
        body: `Requested by ${submitted} · job ${j.jobCode} · ${new Date().toLocaleString('en-US')}${sent.ok ? '' : ' · ⚠ email delivery FAILED, follow up manually'}`,
        link: j.id ? `/jobs/${j.id}` : j.company?.id ? `/crm/${j.company.id}` : null,
      })
    } else {
      // UNKNOWN (or details unconfigured) — agent queue, send NOTHING.
      const inquiry = await prisma.inquiry.create({
        data: {
          source: 'WEB_FORM',
          status: 'NEW',
          title: 'Payment info request',
          description: `Payment info / ACH request from the public site.\n\nSubmitted email: ${submitted}\nOn file: ${person ? `person ${person.id} (no qualifying job)` : 'no match'}${details ? '' : '\nNOTE: payment details are not configured in /admin/payment-info — nothing can auto-send until they are.'}\n\nVerify the requester and send payment details manually.`,
          ...(person ? { personId: person.id } : {}),
        },
        select: { id: true },
      })
      await prisma.auditLog.create({
        data: {
          userId: null,
          ipAddress: ip,
          action: 'public.payment_info_request_unknown',
          entityType: 'Person',
          entityId: person?.id ?? 'unmatched',
          oldValues: { submittedEmail: submitted },
          newValues: { queued: true, at: new Date().toISOString() },
        },
      })
      await notifyBilling(`Payment info requested — ${submitted} (routed to pipeline)`, [
        `Payment info requested by ${submitted} — ${person ? 'on file but no qualifying job' : 'no match'}, routed to the pipeline for follow-up.`,
        details ? 'Nothing was auto-sent.' : 'Nothing was auto-sent — payment details are NOT configured in /admin/payment-info.',
      ])
      // Action-Queue item — nothing sent; this is the one that must not
      // rot. Links to the pipeline Inquiry detail.
      await emitPaymentInfoAlert({
        kind: 'unmatched',
        title: `Payment info requested by ${submitted} — no match, needs manual follow-up`,
        body: `Nothing was sent · ${person ? 'on file but no qualifying job' : 'no CRM match'} · ${new Date().toLocaleString('en-US')}`,
        link: `/inquiries/${inquiry.id}`,
      })
    }
  } catch (err) {
    // NEVER-VANISH path: even on internal failure the request must
    // land in the queue AND in billing@'s inbox. The client-facing
    // response stays uniform regardless; each recovery step is
    // independently guarded so one failure can't suppress the others.
    console.error('[payment-info] request handling failed:', err)
    let errorInquiryId: string | null = null
    try {
      const inq = await prisma.inquiry.create({
        data: {
          source: 'WEB_FORM',
          status: 'NEW',
          title: 'Payment info request',
          description: `Payment info / ACH request from the public site — INTERNAL ERROR during processing; nothing was auto-sent.\n\nSubmitted email: ${submitted}\nError: ${err instanceof Error ? err.message : String(err)}\n\nVerify the requester and send payment details manually.`,
        },
        select: { id: true },
      })
      errorInquiryId = inq.id
    } catch (inqErr) {
      console.error('[payment-info] error-path inquiry create failed:', inqErr)
    }
    await notifyBilling(`Payment info request ERROR — ${submitted}`, [
      `Payment info requested by ${submitted}, but processing hit an internal error and nothing was auto-sent.`,
      `An inquiry was filed in the pipeline; verify the requester and follow up manually.`,
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    ])
    // Action-Queue item — a failed request must never vanish.
    await emitPaymentInfoAlert({
      kind: 'unmatched',
      title: `Payment info requested by ${submitted} — no match, needs manual follow-up`,
      body: `Internal error during processing · nothing was sent · ${new Date().toLocaleString('en-US')}`,
      link: errorInquiryId ? `/inquiries/${errorInquiryId}` : null,
    })
  }

  return NextResponse.json(UNIFORM_RESPONSE)
}
