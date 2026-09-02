import { prisma } from '@/lib/prisma'

/**
 * "What is actually collectible" — one definition, shared.
 *
 * Three exclusions, each of which cost something to learn:
 *
 *   VOID          RentalWorks keeps `remainingTotal` populated on a voided
 *                 invoice. Found 2026-08-18: 1,197 voided invoices carried
 *                 $2.0M of remaining balance, so `remainingTotal > 0` alone
 *                 was offering Ana cancelled obligations to charge cards
 *                 against.
 *   Paid-marked   Someone confirmed payment landed before the mirror caught up.
 *   Written off   A triage decision that this money is not coming.
 *
 * Extracted 2026-09-02 when the end-of-day report needed an open-AR figure.
 * Computing it independently produced $2,323,193.96 across 1,337 invoices —
 * a number that would have gone out to Dani and Wes every evening, roughly
 * double the truth, differing from the list on the same screen. Two places
 * deciding separately what "open" means is how that happens, so now there is
 * one.
 */

/** Ids excluded from the collectible set: paid-marked and written-off. */
export async function nonCollectibleInvoiceIds(): Promise<string[]> {
  const [paidMarks, writtenOff] = await Promise.all([
    prisma.rwInvoicePaidMark.findMany({ select: { rwInvoiceId: true } }),
    prisma.rwInvoiceTriage.findMany({
      where: { decision: 'WRITE_OFF' },
      select: { rwInvoiceId: true },
    }),
  ])
  return [...paidMarks.map((m) => m.rwInvoiceId), ...writtenOff.map((t) => t.rwInvoiceId)]
}

/** The Prisma `where` for open, collectible RentalWorks invoices. */
export function collectibleWhere(excludedIds: string[]) {
  return {
    remainingTotal: { gt: 0 },
    rwInvoiceId: { notIn: excludedIds },
    NOT: { status: 'VOID' },
  }
}

/** Open AR right now: total still owed and how many invoices carry it. */
export async function openArTotal(): Promise<{ total: number; count: number }> {
  const excluded = await nonCollectibleInvoiceIds()
  const agg = await prisma.rwInvoice.aggregate({
    where: collectibleWhere(excluded),
    _sum: { remainingTotal: true },
    _count: true,
  })
  return {
    total: Math.round(Number(agg._sum.remainingTotal ?? 0) * 100) / 100,
    count: agg._count,
  }
}
