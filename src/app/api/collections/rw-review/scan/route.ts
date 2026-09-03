import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { nonCollectibleInvoiceIds, collectibleWhere } from '@/lib/collections/collectible'
import { scanInvoice, saveScan } from '@/lib/collections/invoiceReviewScan'

/**
 * POST /api/collections/rw-review/scan — read the email trail for invoices and
 * record what the AI makes of it.
 *
 * Batched on purpose. One invoice costs three ILIKE passes over ~50,000
 * messages plus a model call, so scanning all 89 in one request would blow the
 * function timeout well before it finished. The desk asks for a few at a time
 * and shows progress; `unscanned` in the response tells the UI whether to ask
 * again.
 *
 * Body: { rwInvoiceId } for one, or { limit } for the next N unscanned
 * (default 5, max 10). Re-scanning an already-scanned invoice is allowed —
 * pass its id explicitly — because new email arrives.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const one = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId : null
  const limit = one
    ? 1
    : Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))

  const excluded = await nonCollectibleInvoiceIds()
  const select = {
    rwInvoiceId: true,
    invoiceNumber: true,
    orderNumber: true,
    dealName: true,
    customerName: true,
    remainingTotal: true,
    invoiceDate: true,
  } as const

  let targets
  if (one) {
    const inv = await prisma.rwInvoice.findUnique({ where: { rwInvoiceId: one }, select })
    targets = inv ? [inv] : []
  } else {
    // Only invoices with no review row yet — the "scan the rest" path.
    const done = new Set((await prisma.rwInvoiceReview.findMany({ select: { rwInvoiceId: true } })).map((r) => r.rwInvoiceId))
    const all = await prisma.rwInvoice.findMany({
      where: collectibleWhere(excluded),
      select,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { invoiceDate: 'asc' }],
    })
    targets = all.filter((i) => !done.has(i.rwInvoiceId)).slice(0, limit)
  }

  const scanned: { invoiceNumber: string | null; verdict: string }[] = []
  for (const t of targets) {
    const result = await scanInvoice({ ...t, remainingTotal: Number(t.remainingTotal) })
    await saveScan(result)
    scanned.push({ invoiceNumber: t.invoiceNumber, verdict: result.verdict })
  }

  // How many are still waiting, so the UI knows whether to offer another pass.
  const doneAfter = new Set((await prisma.rwInvoiceReview.findMany({ select: { rwInvoiceId: true } })).map((r) => r.rwInvoiceId))
  const openCount = await prisma.rwInvoice.count({ where: collectibleWhere(excluded) })
  const openIds = await prisma.rwInvoice.findMany({ where: collectibleWhere(excluded), select: { rwInvoiceId: true } })
  const unscanned = openIds.filter((i) => !doneAfter.has(i.rwInvoiceId)).length

  return NextResponse.json({ ok: true, scanned, total: openCount, unscanned })
}
