import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * The aging review — Ana's triage of the aged receivable, kept inside HQ
 * (Wes, 2026-08-19: no emailed reports; decisions should be rows, not
 * comments).
 *
 * GET  → open, un-paid-marked, non-VOID invoices past 60 days, oldest first,
 *        each with its current triage decision; plus the write-off ledger
 *        (every WRITE_OFF ever decided, grouped by year) — that list, with
 *        its dates and amounts, is what goes to the CPA for the bad-debt
 *        claim.
 * POST → record a decision { rwInvoiceId, decision, note? }. Upsert — the
 *        latest ruling stands. CLEAR removes the row (a decision made in
 *        error should vanish, not linger as history).
 *
 * PAID is deliberately NOT a decision here — that is what RwInvoicePaidMark
 * is for, via the existing mark-paid flow, and two ways of saying "paid"
 * would disagree eventually.
 */

const DECISIONS = ['STILL_OWED', 'DISPUTE', 'WRITE_OFF', 'CLEAR'] as const
const MIN_AGE_DAYS = 60

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const paidMarked = (
    await prisma.rwInvoicePaidMark.findMany({ select: { rwInvoiceId: true } })
  ).map((m) => m.rwInvoiceId)

  const open = await prisma.rwInvoice.findMany({
    where: {
      remainingTotal: { gt: 0 },
      rwInvoiceId: { notIn: paidMarked },
      NOT: { status: 'VOID' },
    },
    select: {
      rwInvoiceId: true,
      invoiceNumber: true,
      customerName: true,
      dealName: true,
      orderNumber: true,
      agent: true,
      invoiceDate: true,
      dueDate: true,
      invoiceTotal: true,
      receivedTotal: true,
      remainingTotal: true,
    },
  })

  const now = Date.now()
  const aged = open
    .map((r) => {
      const basis = r.dueDate ?? r.invoiceDate
      return {
        ...r,
        invoiceTotal: Number(r.invoiceTotal),
        receivedTotal: Number(r.receivedTotal),
        remainingTotal: Number(r.remainingTotal),
        ageDays: basis ? Math.floor((now - basis.getTime()) / 86_400_000) : null,
      }
    })
    .filter((r) => r.ageDays !== null && r.ageDays > MIN_AGE_DAYS)
    .sort((a, b) => b.ageDays! - a.ageDays! || b.remainingTotal - a.remainingTotal)

  const triage = await prisma.rwInvoiceTriage.findMany({
    select: {
      rwInvoiceId: true,
      decision: true,
      note: true,
      decidedAt: true,
      decidedById: true,
      invoiceNumber: true,
      customerName: true,
      amount: true,
    },
  })
  const byInvoice = new Map(triage.map((t) => [t.rwInvoiceId, t]))
  const deciderIds = [...new Set(triage.map((t) => t.decidedById).filter((v): v is string => !!v))]
  const users = deciderIds.length
    ? await prisma.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } })
    : []
  const names = new Map(users.map((u) => [u.id, u.name]))

  // The write-off ledger — every WRITE_OFF ever, including invoices that have
  // since left the mirror. Grouped by decision year for the tax claim.
  const writeOffs = triage
    .filter((t) => t.decision === 'WRITE_OFF')
    .map((t) => ({
      rwInvoiceId: t.rwInvoiceId,
      invoiceNumber: t.invoiceNumber,
      customerName: t.customerName,
      amount: Number(t.amount),
      note: t.note,
      decidedAt: t.decidedAt,
      decidedBy: t.decidedById ? (names.get(t.decidedById) ?? null) : null,
    }))
    .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())

  return NextResponse.json({
    ok: true,
    rows: aged.map((r) => {
      const t = byInvoice.get(r.rwInvoiceId)
      return {
        ...r,
        invoiceDate: r.invoiceDate?.toISOString() ?? null,
        dueDate: r.dueDate?.toISOString() ?? null,
        triage: t
          ? {
              decision: t.decision,
              note: t.note,
              decidedAt: t.decidedAt,
              decidedBy: t.decidedById ? (names.get(t.decidedById) ?? null) : null,
            }
          : null,
      }
    }),
    writeOffs,
  })
}

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    rwInvoiceId?: unknown
    decision?: unknown
    note?: unknown
  }
  const rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId.trim() : ''
  const decision = typeof body.decision === 'string' ? body.decision.toUpperCase() : ''
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null

  if (!rwInvoiceId) return NextResponse.json({ ok: false, error: 'rwInvoiceId required' }, { status: 400 })
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    return NextResponse.json(
      { ok: false, error: `decision must be one of ${DECISIONS.join(', ')}` },
      { status: 400 },
    )
  }

  if (decision === 'CLEAR') {
    await prisma.rwInvoiceTriage.deleteMany({ where: { rwInvoiceId } })
    return NextResponse.json({ ok: true, cleared: true })
  }

  // Snapshot from the mirror at decision time — the triage row must outlive
  // the mirror row it describes.
  const inv = await prisma.rwInvoice.findUnique({
    where: { rwInvoiceId },
    select: { invoiceNumber: true, customerName: true, remainingTotal: true },
  })
  if (!inv) return NextResponse.json({ ok: false, error: 'invoice not in the mirror' }, { status: 404 })

  const saved = await prisma.rwInvoiceTriage.upsert({
    where: { rwInvoiceId },
    create: {
      rwInvoiceId,
      decision,
      note,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customerName,
      amount: Number(inv.remainingTotal),
      decidedById: user.id,
    },
    update: {
      decision,
      note,
      invoiceNumber: inv.invoiceNumber,
      customerName: inv.customerName,
      amount: Number(inv.remainingTotal),
      decidedById: user.id,
      decidedAt: new Date(),
    },
    select: { decision: true, decidedAt: true },
  })

  return NextResponse.json({ ok: true, triage: saved })
}
