import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/collections/final-invoices — the collections tracker.
 *
 * Grew from "the collect queue" into the page's whole data spine (Wes,
 * 2026-08-18: track what needs collecting, what's been collected, who was
 * contacted, who responded, and how the operator is doing). One fetch, four
 * sections:
 *
 *   queue      READY rows, oldest first, each carrying its full story:
 *              uploaded → emailed(to) → replied → prior charges, plus an
 *              rwPaid hint when the RW mirror says the linked invoice has a
 *              zero balance (money that arrived at the bank shows up in RW
 *              before anyone tells HQ).
 *   collected  Last 60 days of COLLECTED rows — when, how, by whom.
 *   stats      Queue health + money collected this week/month + days-to-
 *              collect. Derived from stamped rows only; no vibes.
 *   operators  Per-operator activity (charges + marked-collected), so
 *              "how's Ana doing" is a number, not a feeling.
 *
 * REPLY DETECTION is deliberately conservative: an inbound EmailMessage from
 * the exact address we emailed, received after we emailed it. That
 * undercounts (AP depts reply from colleagues' addresses) and never
 * overcounts — a "replied" badge that lies is worse than none. Surviving
 * copy only (duplicateOfId null) so cross-inbox dedup doesn't double-badge.
 */

const COLLECTED_WINDOW_DAYS = 60

export async function GET() {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const since = new Date(Date.now() - COLLECTED_WINDOW_DAYS * 86_400_000)
  const [ready, collected] = await Promise.all([
    prisma.jobFinalInvoice.findMany({
      where: { status: 'READY' },
      orderBy: { uploadedAt: 'asc' },
      take: 200,
      select: selectShape(),
    }),
    prisma.jobFinalInvoice.findMany({
      // Null collectedAt = collected before stamping existed (pre-2026-08-18,
      // no RW linkage to backfill from). Shown with no date rather than
      // hidden — three real collections vanishing reads as data loss.
      where: {
        status: 'COLLECTED',
        OR: [{ collectedAt: { gte: since } }, { collectedAt: null }],
      },
      orderBy: [{ collectedAt: { sort: 'desc', nulls: 'last' } }],
      take: 200,
      select: selectShape(),
    }),
  ])
  const rows = [...ready, ...collected]

  // Prior card charges against the same RW invoices (double-charge guard).
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

  // RW mirror balances for queued rows — a zero remaining on a READY invoice
  // means the money likely already arrived at the bank.
  const readyRwIds = ready.map((r) => r.rwInvoiceId).filter((v): v is string => !!v)
  const mirror = readyRwIds.length
    ? await prisma.rwInvoice.findMany({
        where: { rwInvoiceId: { in: readyRwIds } },
        select: { rwInvoiceId: true, remainingTotal: true },
      })
    : []
  const remaining = new Map(mirror.map((m) => [m.rwInvoiceId, Number(m.remainingTotal)]))

  // Reply detection for emailed queue rows.
  const emailedRows = ready.filter((r) => r.emailedAt && r.emailedTo)
  const replies =
    emailedRows.length > 0
      ? await prisma.emailMessage.findMany({
          where: {
            direction: 'inbound',
            duplicateOfId: null,
            OR: emailedRows.map((r) => ({
              fromAddress: r.emailedTo!,
              sentAt: { gt: r.emailedAt! },
            })),
          },
          orderBy: { sentAt: 'asc' },
          select: { fromAddress: true, sentAt: true, subject: true },
        })
      : []
  const firstReply = new Map<string, { at: Date; subject: string }>()
  for (const m of replies) {
    const addr = m.fromAddress.toLowerCase()
    if (!firstReply.has(addr)) firstReply.set(addr, { at: m.sentAt, subject: m.subject })
  }

  // Names for collected-by attribution.
  const byIds = [...new Set(rows.map((r) => r.collectedById).filter((v): v is string => !!v))]
  const users = byIds.length
    ? await prisma.user.findMany({ where: { id: { in: byIds } }, select: { id: true, name: true } })
    : []
  const names = new Map(users.map((u) => [u.id, u.name]))

  const shape = (r: (typeof rows)[number]) => {
    const reply = r.emailedTo ? firstReply.get(r.emailedTo.toLowerCase()) : undefined
    // A reply only counts for this row if it postdates this row's send.
    const replied = reply && r.emailedAt && reply.at > r.emailedAt ? reply : undefined
    return {
      id: r.id,
      rwInvoiceId: r.rwInvoiceId,
      invoiceNumber: r.invoiceNumber,
      amount: Number(r.amount),
      pdfUrl: r.pdfUrl,
      note: r.note,
      uploadedAt: r.uploadedAt,
      emailedAt: r.emailedAt,
      emailedTo: r.emailedTo,
      repliedAt: replied?.at ?? null,
      replySubject: replied?.subject ?? null,
      status: r.status,
      collectedAt: r.collectedAt,
      collectedVia: r.collectedVia,
      collectedBy: r.collectedById ? (names.get(r.collectedById) ?? null) : null,
      rwRemaining: r.rwInvoiceId ? (remaining.get(r.rwInvoiceId) ?? null) : null,
      ageDays: Math.floor((Date.now() - r.uploadedAt.getTime()) / 86_400_000),
      jobId: r.job.id,
      jobName: r.job.name,
      jobCode: r.job.jobCode,
      companyName: r.job.company?.name ?? null,
      alreadyCharged: r.rwInvoiceId ? (charged.get(r.rwInvoiceId) ?? 0) : 0,
    }
  }

  // ── Stats — stamped rows only ─────────────────────────────────────
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // The real receivable: every RW invoice with a balance, minus the ones
  // already marked paid in HQ — the SAME definition the browse list uses, so
  // the tile always equals what the list sums. The agent-curated queue is a
  // subset; leading with it made "Outstanding" read $0 while RW showed money
  // owed everywhere (Wes, 2026-08-18).
  const paidMarked = (
    await prisma.rwInvoicePaidMark.findMany({ select: { rwInvoiceId: true } })
  ).map((m) => m.rwInvoiceId)
  const rwOpenAgg = await prisma.rwInvoice.aggregate({
    // NOT VOID: RW keeps remainingTotal populated on voided invoices — 1,197
    // of them carried $2.0M and made the receivable read 15x reality.
    where: { remainingTotal: { gt: 0 }, rwInvoiceId: { notIn: paidMarked }, NOT: { status: 'VOID' } },
    _sum: { remainingTotal: true },
    _count: true,
  })
  const rwSyncedAt = (
    await prisma.rwInvoice.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } })
  )?.syncedAt

  const [chargesWeek, collectedMonthAgg, collectedWeek] = await Promise.all([
    prisma.rwCollectionCharge.findMany({
      where: { chargedAt: { gte: weekAgo } },
      select: { status: true, amount: true, chargedById: true },
    }),
    prisma.jobFinalInvoice.aggregate({
      where: { status: 'COLLECTED', collectedAt: { gte: monthStart } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.jobFinalInvoice.findMany({
      where: { status: 'COLLECTED', collectedAt: { gte: weekAgo } },
      select: { amount: true, collectedById: true, collectedVia: true },
    }),
  ])

  const daysToCollect = collected
    .filter((r) => r.collectedAt)
    .map((r) => (r.collectedAt!.getTime() - r.uploadedAt.getTime()) / 86_400_000)
  const queueTotal = ready.reduce((s, r) => s + Number(r.amount), 0)

  // Per-operator this week: charges attempted/approved and rows collected.
  const opIds = [
    ...new Set(
      [
        ...chargesWeek.map((c) => c.chargedById),
        ...collectedWeek.map((c) => c.collectedById),
      ].filter((v): v is string => !!v),
    ),
  ]
  const opUsers = opIds.length
    ? await prisma.user.findMany({ where: { id: { in: opIds } }, select: { id: true, name: true } })
    : []
  const opName = new Map(opUsers.map((u) => [u.id, u.name]))
  const operators = opIds.map((id) => {
    const mine = chargesWeek.filter((c) => c.chargedById === id)
    const approved = mine.filter((c) => c.status === 'APPROVED')
    const collectedMine = collectedWeek.filter((c) => c.collectedById === id)
    return {
      name: opName.get(id) ?? 'Unknown',
      chargesAttempted: mine.length,
      chargesApproved: approved.length,
      chargedTotal: approved.reduce((s, c) => s + Number(c.amount), 0),
      invoicesCollected: collectedMine.length,
      collectedTotal: collectedMine.reduce((s, c) => s + Number(c.amount), 0),
    }
  })

  return NextResponse.json({
    ok: true,
    finalInvoices: ready.map(shape),
    collected: collected.map(shape),
    stats: {
      rwOpenTotal: Number(rwOpenAgg._sum.remainingTotal ?? 0),
      rwOpenCount: rwOpenAgg._count,
      rwSyncedAt: rwSyncedAt ?? null,
      queueCount: ready.length,
      queueTotal,
      queueOldestDays: ready.length
        ? Math.max(...ready.map((r) => Math.floor((Date.now() - r.uploadedAt.getTime()) / 86_400_000)))
        : 0,
      queueEmailed: ready.filter((r) => r.emailedAt).length,
      collectedMonthCount: collectedMonthAgg._count,
      collectedMonthTotal: Number(collectedMonthAgg._sum.amount ?? 0),
      avgDaysToCollect: daysToCollect.length
        ? Math.round((daysToCollect.reduce((s, d) => s + d, 0) / daysToCollect.length) * 10) / 10
        : null,
      operators,
    },
  })
}

function selectShape() {
  return {
    id: true,
    rwInvoiceId: true,
    invoiceNumber: true,
    amount: true,
    pdfUrl: true,
    note: true,
    uploadedAt: true,
    emailedAt: true,
    emailedTo: true,
    status: true,
    collectedAt: true,
    collectedVia: true,
    collectedById: true,
    job: {
      select: {
        id: true,
        name: true,
        jobCode: true,
        company: { select: { name: true } },
      },
    },
  } as const
}
