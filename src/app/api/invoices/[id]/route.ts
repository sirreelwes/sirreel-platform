import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { put, del } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'
import { planInvoiceEdit, dueDateInputValue } from '@/lib/invoices/invoiceEdits'
import { renderStoredInvoice } from '@/lib/invoices/renderStoredInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * PATCH /api/invoices/[id] — change the facts that live on the invoice
 * itself: its DUE DATE and the NOTE that prints on it.
 *
 * Ana, 2026-09-17: "how do I update an invoice from my side?"
 *
 * There were already two ways to correct an invoice, and both of them go
 * through the ORDER: regenerate (rewrite the figures, keep the number) and
 * void + re-cut. That is right for anything the order can say — a rate, a
 * line, a discount. It could not reach the two things the order never says:
 *
 *   · the due date. SirReel bills due-on-receipt so the generator stamps the
 *     issue date, and there was no way to record terms a client negotiated
 *     or an extension granted on the phone. That date is what every aging
 *     figure and every "30d late" chip in HQ counts from, so the only way to
 *     honour an extension was to let the invoice read as delinquent.
 *   · the printed note — a PO number the client's A/P needs on the face of
 *     the document, a remit instruction, "corrected 9/17 per Ana".
 *
 * The figures are NOT editable here, on purpose. An invoice total that can
 * be typed over reconciles to nothing; if the money is wrong the order is
 * wrong, and "Update figures from the order" or a void is the answer.
 *
 * The PDF follows. An edit that moved the row but left the client
 * downloading a document with the old due date on it would be worse than no
 * edit at all, so the stored blob is re-rendered from the invoice's OWN
 * snapshot — never from the live order, which would drag in unrelated line
 * edits nobody asked to publish. Replace-on-regenerate: the superseded blob
 * is deleted once the row points at the new one. A PAID invoice is already
 * rendered on demand (the PAID stamp), so its blob is left alone.
 *
 * Billing-gated like voiding, regenerating and reopening a closed order, and
 * always audit-logged with both values — "who moved a due date and when" is
 * exactly what an aging dispute asks.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, role: true },
  })
  if (!actor || !can(actor.role, 'billing')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'Editing an invoice is a billing action.' },
      { status: 403 },
    )
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      dueDate: true,
      notes: true,
      sentAt: true,
      pdfBlobKey: true,
      lineSnapshot: true,
    },
  })
  if (!invoice) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    dueDate?: unknown
    notes?: unknown
  }

  const snapshot = invoice.lineSnapshot as unknown
  const planned = planInvoiceEdit(
    {
      status: invoice.status,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      hasSnapshot: Array.isArray(snapshot) && snapshot.length > 0,
    },
    { ...(('dueDate' in body) ? { dueDate: body.dueDate } : {}), ...(('notes' in body) ? { notes: body.notes } : {}) },
  )
  if (!planned.ok) {
    return NextResponse.json(
      { ok: false, error: planned.reason, reason: planned.reason },
      { status: planned.status },
    )
  }
  const { plan } = planned

  // Write the row FIRST — renderStoredInvoice reads the invoice back, so the
  // new due date and note are what land on the page.
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      ...(plan.dueDate !== undefined ? { dueDate: plan.dueDate } : {}),
      ...(plan.notes !== undefined ? { notes: plan.notes } : {}),
    },
  })

  // Refresh the document the client downloads. A render failure is NOT
  // fatal and is NOT silent: the edit stands, and the caller is told the PDF
  // still shows the old header so it can be regenerated deliberately.
  let pdfRefreshed = false
  let pdfWarning: string | null = null
  if (plan.needsRerender) {
    const bytes = await renderStoredInvoice(invoice.id)
    if (!bytes) {
      pdfWarning =
        'Saved, but the PDF could not be re-rendered — it still shows the previous due date and note. ' +
        'Use "Update figures from the order" to cut a fresh one.'
    } else {
      const now = new Date()
      const key = `invoices/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}-${invoice.invoiceNumber}.pdf`
      try {
        const blob = await put(key, bytes, {
          access: 'private' as 'public', // @vercel/blob types only expose 'public' — private bucket accepts the same call
          contentType: 'application/pdf',
        })
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { pdfBlobKey: key, pdfUrl: blob.url, pdfGeneratedAt: now },
        })
        pdfRefreshed = true
        // The superseded blob, once the row points at the new one. An
        // orphaned blob is litter; a failed request over it is a real
        // problem, so this is best-effort.
        if (invoice.pdfBlobKey && invoice.pdfBlobKey !== key) {
          try {
            await del(invoice.pdfBlobKey)
          } catch (err) {
            console.error('[invoices PATCH] stale blob delete failed:', err)
          }
        }
      } catch (err) {
        console.error('[invoices PATCH] blob upload failed:', err)
        pdfWarning =
          'Saved, but the new PDF could not be stored — the document still shows the previous due date and note.'
      }
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: actor.id,
      action: 'invoice.edited',
      entityType: 'Invoice',
      entityId: invoice.id,
      oldValues: {
        dueDate: dueDateInputValue(invoice.dueDate) || null,
        notes: invoice.notes,
      },
      newValues: {
        invoiceNumber: invoice.invoiceNumber,
        ...(plan.dueDate !== undefined ? { dueDate: dueDateInputValue(plan.dueDate) || null } : {}),
        ...(plan.notes !== undefined ? { notes: plan.notes } : {}),
        summary: plan.summary,
        pdfRefreshed,
      },
    },
  })

  return NextResponse.json({
    ok: true,
    invoiceNumber: invoice.invoiceNumber,
    summary: plan.summary,
    pdfRefreshed,
    warning: pdfWarning,
    // The caller decides how loudly to say "the client has the old copy".
    wasSent: !!invoice.sentAt,
  })
}
