import { NextRequest, NextResponse } from 'next/server'
import { requireCollectionsUser } from '@/lib/collections/access'
import { sendFinalInvoicePaymentOptions } from '@/lib/payments/sendFinalInvoiceEmail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/final-invoices/[id]/send — (re)send the
 * payment-options email for a queued final invoice.
 *
 * Same code path as the automatic send on upload, so a resend is a fresh
 * copy of the same message — current details, current card-on-file state —
 * not a replay of the original. Collections-gated: this emails a client
 * about money, which is Ana's lane even though recording the invoice is not.
 *
 * READY rows only (enforced in the helper): a COLLECTED or VOID invoice has
 * no business receiving "here's how to pay".
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const result = await sendFinalInvoicePaymentOptions(params.id)
  if (result.ok) {
    return NextResponse.json({ ok: true, to: result.to, pdfAttached: result.pdfAttached })
  }

  const status = result.reason === 'not_found' ? 404 : 400
  const error =
    result.reason === 'not_found'
      ? 'final invoice not found'
      : result.reason === 'not_ready'
        ? 'that invoice is no longer awaiting collection'
        : result.reason === 'no_recipient'
          ? 'no job contact has an email address — add one on the job page first'
          : result.reason === 'not_configured'
            ? 'payment details are not configured in Admin'
            : `send failed: ${'detail' in result ? result.detail : 'unknown'}`
  return NextResponse.json({ ok: false, error }, { status })
}
