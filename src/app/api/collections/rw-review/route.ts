import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { nonCollectibleInvoiceIds, collectibleWhere } from '@/lib/collections/collectible'

/**
 * GET /api/collections/rw-review — the aging review desk's data.
 *
 * Every open, collectible RentalWorks invoice, oldest first, with whatever
 * review state exists: the human note, the AI verdict, and the emails the
 * verdict was read from. Also says whether the invoice reaches an HQ job,
 * which is the gap this desk was built to make visible — measured 2026-09-02,
 * 77 of 89 open invoices reached no job at all, carrying $117,720 of the
 * $132,653 outstanding.
 *
 * Read-only and cheap: the expensive part (three ILIKE passes over 50k emails
 * plus a model call) happened at scan time and is stored.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const excluded = await nonCollectibleInvoiceIds()
  const [invoices, reviews, links] = await Promise.all([
    prisma.rwInvoice.findMany({
      where: collectibleWhere(excluded),
      select: {
        rwInvoiceId: true,
        invoiceNumber: true,
        orderNumber: true,
        dealName: true,
        customerName: true,
        agent: true,
        invoiceTotal: true,
        remainingTotal: true,
        invoiceDate: true,
        dueDate: true,
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { invoiceDate: 'asc' }],
    }),
    prisma.rwInvoiceReview.findMany(),
    prisma.jobRwOrder.findMany({ select: { rwOrderNumber: true, jobId: true, job: { select: { jobCode: true, name: true } } } }),
  ])

  const reviewBy = new Map(reviews.map((r) => [r.rwInvoiceId, r]))
  const jobBy = new Map(links.map((l) => [l.rwOrderNumber, l]))
  const now = Date.now()

  const rows = invoices.map((i) => {
    const r = reviewBy.get(i.rwInvoiceId)
    const link = i.orderNumber ? jobBy.get(i.orderNumber) : undefined
    const dated = i.invoiceDate ? new Date(i.invoiceDate).getTime() : null
    return {
      rwInvoiceId: i.rwInvoiceId,
      invoiceNumber: i.invoiceNumber,
      orderNumber: i.orderNumber,
      dealName: i.dealName,
      customerName: i.customerName,
      agent: i.agent,
      invoiceTotal: Number(i.invoiceTotal),
      remaining: Number(i.remainingTotal),
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      ageDays: dated ? Math.floor((now - dated) / 86400000) : null,
      job: link ? { jobId: link.jobId, jobCode: link.job.jobCode, name: link.job.name } : null,
      note: r?.note ?? null,
      noteBy: r?.noteBy ?? null,
      noteAt: r?.noteAt ?? null,
      aiVerdict: r?.aiVerdict ?? null,
      aiConfidence: r?.aiConfidence ?? null,
      aiSummary: r?.aiSummary ?? null,
      evidence: (r?.evidence as unknown[] | null) ?? [],
      evidenceCount: r?.evidenceCount ?? 0,
      scannedAt: r?.scannedAt ?? null,
    }
  })

  return NextResponse.json({
    ok: true,
    rows,
    totals: {
      count: rows.length,
      remaining: rows.reduce((s, r) => s + r.remaining, 0),
      unscanned: rows.filter((r) => !r.scannedAt).length,
      noJob: rows.filter((r) => !r.job).length,
    },
  })
}
