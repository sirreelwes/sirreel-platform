/**
 * GET /api/exec/sales-hygiene — Card B backing data.
 *
 * Returns four buckets of pipeline hygiene exceptions:
 *
 *   1. followUpsOverdue  — Open quotes (Order.quoteStatus='SENT' with Job
 *      not WRAPPED/LOST) whose Mode A cadence helper reports a currently-
 *      due STAGE_N. Paused orders (client replied / status advanced /
 *      legacy nudge sent) are excluded — never nudge someone who already
 *      responded.
 *   2. staleDeals — open Orders (quoteStatus SENT or DRAFT with line
 *      items) whose updatedAt is older than STALE_DEAL_BUSINESS_DAYS
 *      business days. Business-day math is computed inline; standard
 *      Mon-Fri.
 *   3. draftedUnsent — Orders in DRAFT with at least one line item whose
 *      createdAt is older than UNSENT_DRAFT_DAYS calendar days. Catches
 *      quotes that got built but never went out.
 *   4. nearingExpiry — Orders in QUOTE_SENT with expiresAt landing
 *      within QUOTE_EXPIRY_WARNING_DAYS calendar days (or already
 *      expired but not yet status-flipped).
 *
 * Role-gated via the shared coverage guard.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCoverageAccess } from '@/lib/exec/requireCoverageAccess'
import {
  STALE_DEAL_BUSINESS_DAYS,
  UNSENT_DRAFT_DAYS,
  QUOTE_EXPIRY_WARNING_DAYS,
} from '@/lib/exec/thresholds'
import {
  CADENCE_STAGES,
  computeCadenceState,
  type CadenceStage,
} from '@/lib/sales/quoteCadence'

export const dynamic = 'force-dynamic'

/**
 * Walk backwards N business days from `from`. Saturdays and Sundays
 * don't count. Returns the resulting Date (start-of-day in UTC).
 */
function subtractBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let remaining = days
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  return d
}

export async function GET() {
  const guard = await requireCoverageAccess()
  if (!guard.ok) return guard.response

  const now = new Date()
  const staleCutoff = subtractBusinessDays(now, STALE_DEAL_BUSINESS_DAYS)
  const unsentCutoff = new Date(now.getTime() - UNSENT_DRAFT_DAYS * 86_400_000)
  const expiryCutoff = new Date(now.getTime() + QUOTE_EXPIRY_WARNING_DAYS * 86_400_000)

  // ── 1. Follow-ups overdue (Mode A) ────────────────────────────────
  // Pull every open QUOTE_SENT order on a non-terminal Job, compute
  // cadence state per order, keep the ones with a currentDueStage.
  // Set is small (open SENT quotes), so an in-process compute is fine.
  const openSent = await prisma.order.findMany({
    where: {
      quoteStatus: 'SENT',
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
    },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      quoteSentAt: true,
      expiresAt: true,
      quoteExpDays: true,
      status: true,
      companyId: true,
      company: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
      followUps: { select: { stage: true, status: true } },
    },
  })

  // Resolve thread-last-inbound for the gating step. One Promise.all
  // keyed by companyId (orders for the same client share thread state).
  const companyIds = Array.from(new Set(openSent.map((o) => o.companyId).filter((id): id is string => !!id)))
  const lastInboundByCompany = new Map<string, Date>()
  if (companyIds.length > 0) {
    const lastInbounds = await prisma.emailMessage.groupBy({
      by: ['companyId'],
      where: { companyId: { in: companyIds }, direction: 'inbound' },
      _max: { sentAt: true },
    })
    for (const row of lastInbounds) {
      if (row.companyId && row._max.sentAt) lastInboundByCompany.set(row.companyId, row._max.sentAt)
    }
  }

  const followUpsOverdue: Array<{
    orderId: string
    orderNumber: string
    total: number
    quoteSentAt: Date | null
    dueStage: CadenceStage
    company: { id: string; name: string } | null
    agent: { id: string; name: string } | null
    job: { id: string; jobCode: string; name: string } | null
  }> = []

  for (const o of openSent) {
    const stagesSent: CadenceStage[] = o.followUps
      .filter((f) => f.status === 'SENT' && CADENCE_STAGES.includes(f.stage as CadenceStage))
      .map((f) => f.stage as CadenceStage)
    const legacySentExists = o.followUps.some(
      (f) => f.status === 'SENT' && (f.stage === 'DAY_0' || f.stage === 'DAY_1' || f.stage === 'DAY_3'),
    )
    const threadLastInboundAt = o.companyId ? lastInboundByCompany.get(o.companyId) ?? null : null

    const state = computeCadenceState({
      quoteSentAt: o.quoteSentAt,
      expiresAt: o.expiresAt,
      quoteExpDays: o.quoteExpDays,
      status: o.status,
      threadLastInboundAt,
      stagesSent,
      legacySentExists,
      now,
    })

    if (state.paused || !state.currentDueStage) continue
    followUpsOverdue.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      total: Number(o.total),
      quoteSentAt: o.quoteSentAt,
      dueStage: state.currentDueStage,
      company: o.company,
      agent: o.agent,
      job: o.job,
    })
  }

  // Oldest quote first (longest awaiting a nudge).
  followUpsOverdue.sort((a, b) => {
    const at = a.quoteSentAt?.getTime() ?? 0
    const bt = b.quoteSentAt?.getTime() ?? 0
    return at - bt
  })

  // ── 2. Stale deals ────────────────────────────────────────────────
  // Open Orders (any DRAFT/SENT, Job not terminal) untouched for N
  // business days. Use updatedAt as the "last touch" signal — every
  // line-item edit / status flip / note bumps it.
  const staleDeals = await prisma.order.findMany({
    where: {
      quoteStatus: { in: ['DRAFT', 'SENT'] },
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
      updatedAt: { lt: staleCutoff },
    },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      quoteStatus: true,
      total: true,
      updatedAt: true,
      company: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
    },
  })

  // ── 3. Drafted but never sent ────────────────────────────────────
  // DRAFT quoteStatus AND at least one line item AND createdAt older
  // than UNSENT_DRAFT_DAYS. Job-status guard same as elsewhere.
  const draftedUnsent = await prisma.order.findMany({
    where: {
      quoteStatus: 'DRAFT',
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
      createdAt: { lt: unsentCutoff },
      lineItems: { some: {} },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      createdAt: true,
      company: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
    },
  })

  // ── 4. Nearing expiry ────────────────────────────────────────────
  // QUOTE_SENT with expiresAt within the warning window. Already-expired
  // rows (expiresAt < now) surface here too as long as quoteStatus is
  // still SENT — the auto-expiry sweep hasn't flipped them yet.
  const nearingExpiry = await prisma.order.findMany({
    where: {
      quoteStatus: 'SENT',
      job: { status: { notIn: ['WRAPPED', 'LOST'] } },
      expiresAt: { not: null, lte: expiryCutoff },
    },
    orderBy: { expiresAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      sentAt: true,
      expiresAt: true,
      company: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      job: { select: { id: true, jobCode: true, name: true } },
    },
  })

  const totalCount =
    followUpsOverdue.length + staleDeals.length + draftedUnsent.length + nearingExpiry.length

  return NextResponse.json({
    now: now.toISOString(),
    thresholds: {
      staleDealBusinessDays: STALE_DEAL_BUSINESS_DAYS,
      unsentDraftDays: UNSENT_DRAFT_DAYS,
      quoteExpiryWarningDays: QUOTE_EXPIRY_WARNING_DAYS,
    },
    totalCount,
    followUpsOverdue: { count: followUpsOverdue.length, items: followUpsOverdue },
    staleDeals: {
      count: staleDeals.length,
      items: staleDeals.map((o) => ({ ...o, total: Number(o.total) })),
    },
    draftedUnsent: {
      count: draftedUnsent.length,
      items: draftedUnsent.map((o) => ({ ...o, total: Number(o.total) })),
    },
    nearingExpiry: {
      count: nearingExpiry.length,
      items: nearingExpiry.map((o) => ({ ...o, total: Number(o.total) })),
    },
  })
}
