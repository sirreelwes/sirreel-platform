/**
 * sendInvoice — Phase 5 commit 2, delivery side of the RW off-ramp.
 *
 * Atomic-ish flow that:
 *   1. Loads the Invoice + Order + Company + Job + ranked recipients.
 *   2. Renders the INVOICE_DELIVERY cadence template (the existing
 *      copy signed by Ana — no new template work).
 *   3. Mints/refreshes the portal magic link for the primary
 *      recipient via refreshOrIssueJobMagicLink (reuses the contract
 *      magic-link pattern verbatim).
 *   4. Fetches the invoice PDF bytes from private blob and attaches
 *      to the email.
 *   5. Sends via sendAgreementEmail (Resend).
 *   6. On send success: stamps Invoice.sentAt + status=SENT and
 *      advances Order.status RETURNED → INVOICED if eligible. Both
 *      writes inside a single tx so a half-sent invoice can't exist.
 *   7. Logs an executed CadenceEvent(INVOICE_DELIVERY) row for the
 *      cadence audit trail.
 *
 * Non-blocking on claims/L&D per the doctrine: the RETURNED → INVOICED
 * advance fires regardless of any open InsuranceClaim or LD invoice.
 *
 * Forward-only: never regresses an order already past INVOICED.
 * Already-SENT invoices are 409'd at the helper boundary so the
 * operator gets an explicit "Already sent" surface rather than a
 * silent re-send.
 *
 * READ-ONLY against Order.booked* — the booked snapshot stays
 * untouched per the spec.
 */

import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { rankRecipients } from '@/lib/email/recipients'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { renderCadenceTemplate } from '@/lib/email/templates/renderCadenceTemplate'
import { portalJobUrl, portalSignInUrl } from '@/lib/portal/portalUrl'

export type SendInvoiceResult =
  | {
      ok: true
      invoiceId: string
      invoiceNumber: string
      sentTo: string
      cc: string[]
      orderAdvancedToInvoiced: boolean
    }
  | {
      ok: false
      status: number
      error: string
    }

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export async function sendInvoice(args: {
  invoiceId: string
  /** Optional override of CC recipients. When omitted, all non-primary
   *  ranked JobContacts are CC'd. Pass [] to send to primary only. */
  cc?: string[] | null
  /** Person.id for an explicit recipient override (rare — when the
   *  operator wants to send to a non-primary contact). Must be present
   *  on the order's contact roster. */
  overrideContactId?: string | null
}): Promise<SendInvoiceResult> {
  const { invoiceId, cc: ccOverride = null, overrideContactId = null } = args

  // ── Load everything in one query ────────────────────────────────
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      total: true,
      dueDate: true,
      pdfBlobKey: true,
      sentAt: true,
      orderId: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          portalSlug: true,
          company: { select: { id: true, name: true } },
          agent: { select: { name: true, email: true, phone: true } },
          jobContact: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          job: {
            select: {
              id: true,
              name: true,
              jobContacts: {
                select: {
                  role: true,
                  isPrimary: true,
                  person: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!invoice) {
    return { ok: false, status: 404, error: 'invoice not found' }
  }
  if (!invoice.pdfBlobKey) {
    return { ok: false, status: 409, error: 'invoice has no PDF — regenerate first' }
  }
  if (invoice.status === 'SENT' || invoice.status === 'PARTIAL' || invoice.status === 'PAID') {
    return { ok: false, status: 409, error: `invoice already ${invoice.status.toLowerCase()}` }
  }
  if (invoice.status === 'VOID') {
    return { ok: false, status: 409, error: 'cannot send a voided invoice' }
  }

  // ── Resolve recipients ──────────────────────────────────────────
  const ranked = rankRecipients(invoice.order.job, invoice.order.jobContact)
  if (ranked.length === 0) {
    return { ok: false, status: 409, error: 'no recipients on this order — add a job contact first' }
  }
  let primary = ranked[0]
  if (overrideContactId) {
    const match = ranked.find((r) => r.id === overrideContactId)
    if (!match) {
      return { ok: false, status: 400, error: 'overrideContactId is not on this order' }
    }
    primary = match
  }
  const others = ccOverride
    ? ranked.filter((r) => r.email !== primary.email && ccOverride.includes(r.email))
    : ranked.filter((r) => r.email !== primary.email)

  // ── Magic link (reuse the contract pattern) ─────────────────────
  let portalUrl: string | null = null
  if (invoice.order.portalSlug) {
    try {
      const link = await refreshOrIssueJobMagicLink({
        orderId: invoice.order.id,
        contactId: primary.id,
      })
      portalUrl = portalJobUrl(invoice.order.portalSlug!, link.token)
    } catch (err) {
      console.warn('[sendInvoice] portal-link mint failed:', err)
    }
  }

  // ── Render INVOICE_DELIVERY template ────────────────────────────
  const firstName = primary.name.split(' ')[0] || primary.name
  const rendered = renderCadenceTemplate('INVOICE_DELIVERY', {
    firstName,
    companyName: invoice.order.company.name,
    jobName: invoice.order.job?.name ?? invoice.order.orderNumber,
    invoiceAmount: fmtUsd(Number(invoice.total)),
    invoiceDueDate: fmtDate(invoice.dueDate),
    portalLink: portalUrl ?? portalSignInUrl(),
    repName: 'Ana DeAngelis',
    repPhone: '888.477.7335',
    repEmail: 'ana@sirreel.com',
  })
  if (!rendered) {
    return { ok: false, status: 500, error: 'INVOICE_DELIVERY template missing — runner config drift' }
  }

  // ── Fetch PDF bytes from blob ───────────────────────────────────
  let pdfBuffer: Buffer
  try {
    const blob = await getBlob(invoice.pdfBlobKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return { ok: false, status: 500, error: 'invoice PDF blob not retrievable' }
    }
    const chunks: Buffer[] = []
    const reader = blob.stream.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }
    pdfBuffer = Buffer.concat(chunks)
  } catch (err) {
    console.error('[sendInvoice] blob fetch failed:', err)
    return { ok: false, status: 500, error: 'failed to fetch invoice PDF' }
  }

  // ── Dispatch ────────────────────────────────────────────────────
  const filename = `Invoice-${invoice.invoiceNumber}.pdf`
  const result = await sendAgreementEmail({
    to: [primary.email],
    cc: others.length > 0 ? others.map((o) => o.email) : undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [{ filename, content: pdfBuffer }],
    label: `send-invoice:${invoice.invoiceNumber}`,
  })
  if (!result.ok) {
    return { ok: false, status: 502, error: `Email send failed: ${result.reason}` }
  }

  // Delivery audit so the order detail surface (and a future
  // invoice-detail surface) can show sent → delivered / bounced from
  // Resend's webhook events. Best-effort — failure here doesn't undo
  // the send.
  if (result.id) {
    await recordEmailDelivery({
      resendMessageId: result.id,
      toAddress: primary.email,
      ccAddresses: others.map((o) => o.email),
      subject: rendered.subject,
      label: `send-invoice:${invoice.invoiceNumber}`,
      orderId: invoice.order.id,
      invoiceId: invoice.id,
    })
  }

  // ── Stamp Invoice + advance Order in one tx ─────────────────────
  // RETURNED → INVOICED is the natural advance on send. Forward-only —
  // never regress past INVOICED. The advance is NON-BLOCKING on any
  // open InsuranceClaim or LD invoice per the doctrine.
  const sentAt = new Date()
  let orderAdvancedToInvoiced = false
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'SENT',
        sentAt,
      },
    })
    if (invoice.type === 'RENTAL' && invoice.order.status === 'RETURNED') {
      await tx.order.update({
        where: { id: invoice.order.id },
        data: { status: 'INVOICED' },
      })
      orderAdvancedToInvoiced = true
      await tx.auditLog.create({
        data: {
          action: 'order.invoiced',
          entityType: 'Order',
          entityId: invoice.order.id,
          oldValues: { status: 'RETURNED' },
          newValues: {
            status: 'INVOICED',
            triggeredBy: 'invoice.sent',
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          },
        },
      })
    }
    // Cadence audit: write an executed INVOICE_DELIVERY row pointing
    // at the EmailMessage. Lets the cadence dashboard surface this
    // touchpoint without re-sending. Idempotent on (orderId, eventType,
    // executedAt) via the row being newly minted here.
    await tx.cadenceEvent.create({
      data: {
        orderId: invoice.order.id,
        eventType: 'INVOICE_DELIVERY',
        scheduledFor: sentAt,
        executedAt: sentAt,
        emailId: result.id ?? null,
      },
    })
  })

  return {
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    sentTo: primary.email,
    cc: others.map((o) => o.email),
    orderAdvancedToInvoiced,
  }
}
