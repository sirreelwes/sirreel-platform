import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/final-invoices — the collect queue.
 *
 * Final invoices an agent has recorded from the job page and that nobody has
 * collected yet. This is the list Ana works: every row is a number somebody
 * already agreed with the client, as opposed to the raw RW invoice list where
 * "open balance" says nothing about whether the figure is settled.
 *
 * Carries any charges already taken against the same RW invoice so two people
 * working the queue can't double-charge — the RW mirror won't show a payment
 * taken here until the next sync.
 */

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const rows = await prisma.jobFinalInvoice.findMany({
    where: { status: 'READY' },
    orderBy: { uploadedAt: 'asc' },
    take: 200,
    select: {
      id: true,
      rwInvoiceId: true,
      invoiceNumber: true,
      amount: true,
      pdfUrl: true,
      note: true,
      uploadedAt: true,
      emailedAt: true,
      emailedTo: true,
      job: {
        select: {
          id: true,
          name: true,
          jobCode: true,
          company: { select: { name: true } },
        },
      },
    },
  })

  const rwIds = rows.map((r) => r.rwInvoiceId).filter((v): v is string => !!v)
  const prior = rwIds.length
    ? await prisma.rwCollectionCharge.findMany({
        where: { rwInvoiceId: { in: rwIds }, status: 'APPROVED' },
        select: { rwInvoiceId: true, amount: true },
      })
    : []
  const charged = new Map<string, number>()
  for (const c of prior) {
    charged.set(c.rwInvoiceId, (charged.get(c.rwInvoiceId) ?? 0) + Number(c.amount))
  }

  return NextResponse.json({
    ok: true,
    finalInvoices: rows.map((r) => ({
      id: r.id,
      rwInvoiceId: r.rwInvoiceId,
      invoiceNumber: r.invoiceNumber,
      amount: Number(r.amount),
      pdfUrl: r.pdfUrl,
      note: r.note,
      uploadedAt: r.uploadedAt,
      emailedAt: r.emailedAt,
      emailedTo: r.emailedTo,
      jobId: r.job.id,
      jobName: r.job.name,
      jobCode: r.job.jobCode,
      companyName: r.job.company?.name ?? null,
      alreadyCharged: r.rwInvoiceId ? (charged.get(r.rwInvoiceId) ?? 0) : 0,
    })),
  })
}
