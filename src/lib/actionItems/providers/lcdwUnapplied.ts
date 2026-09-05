/**
 * "The client answered the waiver question — the money disagrees" (DERIVED).
 *
 * Wes, 2026-09-05, after Subplot (S260905-001): the client elected LCDW in
 * the portal and approved the quote 24 seconds later; the $96 line reached
 * the order fifty minutes on, by hand, and only because Wes happened to
 * look. "Make sure the agent is prompted to add LCDW to the quote."
 *
 * The election now applies the fee itself (lib/lcdw/applyElectionToOrders),
 * so in the ordinary case this item never appears. It is the BACKSTOP for
 * what the auto-apply could not do:
 *
 *   · the order had no dates or no eligible vehicle when the client
 *     answered, and got them later;
 *   · the order was created after the election (a second order on the
 *     same job);
 *   · an annual account's standing answer — signed on the master, never a
 *     per-job event, so nothing ever fired for it;
 *   · a rep put LCDW on the quote and the client then declined in writing.
 *
 * ── What makes an item ─────────────────────────────────────────────
 *
 * A live, money-editable order where the EFFECTIVE decision (per-job
 * election, else the annual master's standing answer — jobElection.ts
 * owns that precedence) is ACCEPTED and there is no LCDW fee line but an
 * eligible vehicle exists; or DECLINED and the fee line is still on.
 * "Unanswered" never produces an item — asking a rep to price a waiver
 * the client has not elected would be the old behaviour with a nag on it.
 *
 * ── Why it stops appearing ─────────────────────────────────────────
 *
 * It clears when the fee line matches the answer — the fix is the thing
 * that removes it. Dismissal exists for the judgement call ("this order
 * is the studio half, leave it"), per-user via the side-row.
 *
 * ESCALATE-ONLY-THE-EXCEPTION (registry ruling B): an order whose money
 * already agrees with the election never produces an item.
 */

import type { UserRole, LcdwDecision } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ACTIONABLE_ORDER_WHERE } from '@/lib/orders/actionableWhere'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { quoteLcdw, LCDW_FEE_CODE, type LcdwCandidate } from '@/lib/pricing/lcdwEligibility'
import { effectiveLcdwDecision } from '@/lib/lcdw/jobElection'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { isMoneyEditable } from '@/lib/orders/editability'

/** Sales own their quote's money; admin and managers see all of them. */
const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export interface LcdwMismatchRow {
  orderId: string
  orderNumber: string
  jobId: string | null
  who: string
  decision: LcdwDecision
  decisionSource: 'JOB' | 'ANNUAL'
  decidedAt: Date
  /** ACCEPTED-with-no-line → 'add'; DECLINED-with-line → 'remove'. */
  fix: 'add' | 'remove'
  /** Eligible vehicles, for the "add" copy. */
  covered: string[]
}

export async function findLcdwMismatches(opts?: {
  agentId?: string | null
}): Promise<LcdwMismatchRow[]> {
  const orders = await prisma.order.findMany({
    where: {
      ...ACTIONABLE_ORDER_WHERE,
      status: { in: ['DRAFT', 'QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK'] },
      ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      // Cheap pre-filter: only jobs that have an answer, or companies that
      // could carry a standing one. The precise precedence runs below.
      OR: [
        { job: { lcdwElection: { isNot: null } } },
        { company: { agreements: { some: { standingLcdwDecision: { not: null } } } } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      companyId: true,
      company: { select: { name: true } },
      job: {
        select: {
          id: true,
          name: true,
          lcdwElection: { select: { decision: true, decidedAt: true } },
        },
      },
      lineItems: {
        select: {
          id: true,
          description: true,
          department: true,
          quantity: true,
          billableDays: true,
          type: true,
          feeItem: { select: { code: true } },
          inventoryItem: { select: { code: true } },
          subRentals: { select: { id: true }, take: 1 },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  })

  // One annual lookup per company, not per order.
  const standingByCompany = new Map<string, { decision: LcdwDecision | null; since: Date | null }>()
  const rows: LcdwMismatchRow[] = []
  for (const o of orders) {
    if (!isMoneyEditable(o.status)) continue

    let standing: LcdwDecision | null = null
    let standingSince: Date | null = null
    if (o.companyId) {
      let hit = standingByCompany.get(o.companyId)
      if (!hit) {
        const cov = await findCompanyAnnualCoverage(o.companyId)
        hit = { decision: cov?.standingLcdwDecision ?? null, since: cov?.signedAt ?? null }
        standingByCompany.set(o.companyId, hit)
      }
      standing = hit.decision
      standingSince = hit.since
    }
    const effective = effectiveLcdwDecision(o.job?.lcdwElection ?? null, standing)
    if (!effective) continue

    const hasFee = o.lineItems.some((l) => l.type === 'FEE' && l.feeItem?.code === LCDW_FEE_CODE)
    const candidates: LcdwCandidate[] = o.lineItems
      .filter((l) => l.type !== 'FEE')
      .map((l) => ({
        id: l.id,
        description: l.description,
        code: l.inventoryItem?.code ?? null,
        department: l.department,
        quantity: l.quantity,
        billableDays: l.billableDays,
        isPartnerVehicle: l.subRentals.length > 0,
      }))
    const q = quoteLcdw(candidates)

    let fix: 'add' | 'remove' | null = null
    if (effective.decision === 'ACCEPTED' && !hasFee && q.eligible.length > 0 && q.vehicleDays > 0) fix = 'add'
    if (effective.decision === 'DECLINED' && hasFee) fix = 'remove'
    if (!fix) continue

    rows.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      jobId: o.job?.id ?? null,
      who: o.company?.name || o.job?.name || o.orderNumber,
      decision: effective.decision,
      decisionSource: effective.source,
      decidedAt:
        (effective.source === 'JOB' ? o.job?.lcdwElection?.decidedAt : standingSince) ?? new Date(),
      fix,
      covered: [...new Set(q.eligible.map((e) => e.description))],
    })
  }
  return rows
}

export const lcdwUnappliedProvider: ActionItemProvider = {
  id: 'lcdw-unapplied',
  kind: 'DERIVED',
  async fetch(ctx: ProviderContext): Promise<ActionItem[]> {
    if (ctx.scope === 'OWN' && !ctx.userId) return []
    const rows = await findLcdwMismatches({ agentId: ctx.scope === 'OWN' ? ctx.userId : null })

    return rows.map((r) => {
      const where = r.decisionSource === 'ANNUAL' ? 'on their annual agreement' : 'for this job'
      const subtitle =
        r.fix === 'add'
          ? `Client accepted LCDW ${where} but ${r.orderNumber} has no waiver line. Covers: ${r.covered.join(', ')}.`
          : `Client declined LCDW ${where} but ${r.orderNumber} still charges it — take the line off.`
      return {
        id: `lcdw-unapplied:${r.orderId}:${r.fix}`,
        type: 'lcdw_unapplied',
        title: `${r.fix === 'add' ? 'Add' : 'Remove'} LCDW — ${r.who}`,
        subtitle,
        ownerRole: OWNER,
        // Money on a document the client may already have approved.
        priority: 'high' as const,
        href: `/orders/${r.orderId}`,
        occurredAt: r.decidedAt,
        source: 'lcdw-unapplied',
        dismissal: { kind: 'sideRow' as const },
      }
    })
  },
}
