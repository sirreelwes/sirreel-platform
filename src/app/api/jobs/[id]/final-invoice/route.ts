import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeFilenameSegment } from '@/lib/claims/uploadClaimDocument'
import { sendFinalInvoicePaymentOptions } from '@/lib/payments/sendFinalInvoiceEmail'
import { resolveRwInvoiceId } from '@/lib/rentalworks/finalInvoiceLink'

export const dynamic = 'force-dynamic'

/**
 * Final invoice for a job — the number the agent lands on after the back and
 * forth with the client. Uploading it here is the handoff into collections.
 *
 * GET  → the job's final invoices, newest first.
 * POST → multipart: file (PDF, optional) + amount + optional invoiceNumber,
 *        rwInvoiceId, note. Creates a READY row that surfaces on /collections.
 *
 * `rwInvoiceId` is RESOLVED, never trusted as sent: the panel may post an id
 * the operator picked off this job's RW invoices, or only a typed number, and
 * either way lib/rentalworks/finalInvoiceLink decides whether it really names
 * an invoice on an RW order linked to this job. Unresolved stays null.
 *
 * Any signed-in staff member may finalize — this is sales work, and gating it
 * to the collections allowlist would stop the person who negotiated the number
 * from recording it. Taking the MONEY is separately gated; recording an agreed
 * figure is not the sensitive half.
 *
 * PDF goes to a PRIVATE blob, same as COI and collections uploads: it names a
 * client and an amount.
 */

const MAX_BYTES = 15 * 1024 * 1024
const MAX_AMOUNT = 1_000_000

async function requireStaff() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email?.toLowerCase()
  if (!email) return null
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isActive: true },
  })
  return user?.isActive ? user : null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const finalInvoices = await prisma.jobFinalInvoice.findMany({
    where: { jobId: params.id },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      status: true,
      pdfUrl: true,
      note: true,
      uploadedAt: true,
      // The paperwork tile on the job page needs to say whether the client
      // has actually been told how to pay, and whether this settles an RW
      // invoice or was uploaded here. Both were already stored; the select
      // just never returned them.
      emailedAt: true,
      emailedTo: true,
      rwInvoiceId: true,
      // The client's answer from the email's buttons — the tile says
      // "approved to charge" / "paying by bank" instead of just "Sent".
      clientAnswer: true,
      clientAnsweredAt: true,
      clientAnswerCardLast4: true,
    },
  })

  return NextResponse.json({
    ok: true,
    finalInvoices: finalInvoices.map((f) => ({ ...f, amount: Number(f.amount) })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!job) return NextResponse.json({ ok: false, error: 'job not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ ok: false, error: 'form data required' }, { status: 400 })

  const amount = Number(form.get('amount'))
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return NextResponse.json({ ok: false, error: 'invalid amount' }, { status: 400 })
  }

  const str = (k: string, max: number) => {
    const v = form.get(k)
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  }

  // PDF is optional — the number may be agreed before the document exists,
  // and blocking on the file would push people back to email.
  let pdfUrl: string | null = null
  let pdfKey: string | null = null
  const file = form.get('file')
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'file too large' }, { status: 400 })
    }
    if (file.type && file.type !== 'application/pdf') {
      return NextResponse.json({ ok: false, error: 'PDF only' }, { status: 400 })
    }
    const now = new Date()
    const key = `final-invoices/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}-${safeFilenameSegment(file.name || 'final-invoice.pdf')}`
    try {
      const blob = await put(key, file, { access: 'private' as 'public' })
      pdfUrl = blob.url
      pdfKey = key
    } catch (err) {
      console.error('[final-invoice] upload failed:', err)
      return NextResponse.json({ ok: false, error: 'upload failed' }, { status: 500 })
    }
  }

  const invoiceNumber = str('invoiceNumber', 60)
  // Link to the RW mirror row this settles, if it demonstrably is one. Drives
  // the "from RW" reading on the job tile and, in collections, the mirror
  // balance and the cross-surface double-charge guard.
  const rwInvoiceId = await resolveRwInvoiceId(
    job.id,
    str('rwInvoiceId', 120),
    invoiceNumber,
  )

  const created = await prisma.jobFinalInvoice.create({
    data: {
      jobId: job.id,
      amount,
      invoiceNumber,
      rwInvoiceId,
      note: str('note', 1000),
      pdfUrl,
      pdfKey,
      uploadedById: user.id,
    },
    select: { id: true, amount: true, status: true, invoiceNumber: true },
  })

  // Payment-options email, immediately — recording the number IS the moment
  // the client should hear how to pay it. Never blocks the upload: the row is
  // already queued for collections, and the queue shows unsent state so a
  // failed send is a visible follow-up, not a silent gap.
  const emailed = await sendFinalInvoicePaymentOptions(created.id).catch((err) => {
    console.error('[final-invoice] payment-options email threw:', err)
    return { ok: false as const, reason: 'send_failed' as const, detail: 'unexpected error' }
  })

  const message = emailed.ok
    ? `Final invoice recorded and payment options emailed to ${emailed.to}. It is queued on the Collections page.`
    : emailed.reason === 'no_recipient'
      ? 'Final invoice recorded and queued on Collections — NOT emailed: no job contact has an email address. Add one and resend from Collections.'
      : emailed.reason === 'not_configured'
        ? 'Final invoice recorded and queued on Collections — NOT emailed: payment details are not configured in Admin.'
        : 'Final invoice recorded and queued on Collections — the payment-options email failed to send. Resend it from the Collections page.'

  return NextResponse.json({
    ok: true,
    finalInvoice: { ...created, amount: Number(created.amount) },
    emailed: emailed.ok ? { to: emailed.to } : { failed: emailed.reason },
    message,
  })
}
