import { prisma } from '@/lib/prisma'
import { RW_VOID } from '@/lib/rentalworks/arStatus'

/**
 * Which RentalWorks invoice, if any, a final invoice settles.
 *
 * `JobFinalInvoice.rwInvoiceId` was never written from the UI. The job
 * panel's "RW invoice #" field appended `invoiceNumber` and nothing else, so
 * the column stayed null on every row an agent ever created — which made the
 * job page's Final Invoice tile say "uploaded" on numbers lifted straight off
 * an RW invoice, and cost collections the two things that key on it: the
 * mirror-balance hint ("RW already shows this at zero, the money probably
 * landed") and the double-charge guard, which is SHARED with the RW-invoice
 * list. A charge anchored to the `final:<uuid>` fallback is invisible to
 * anyone working the same invoice from the RW side.
 *
 * Resolution is deliberately narrow, because getting it wrong anchors a card
 * charge to the wrong invoice:
 *
 *   - Only invoices on an RW ORDER already linked to this job are eligible.
 *     `RwInvoice.invoiceNumber` is NOT unique — only `rwInvoiceId` is — so a
 *     lookup by number across the whole mirror could land on another
 *     client's invoice. Linking an order is the step where a human already
 *     confirms the job↔RW attribution; this rides on that decision rather
 *     than inventing a second, weaker one.
 *   - A number matching more than one invoice on those orders resolves to
 *     null. Ambiguous is not a link.
 *   - VOID is excluded, matching what the picker offers and what collections
 *     treats as collectible. A cancelled obligation is not what was agreed.
 *
 * Anything unresolved returns null — exactly the state every existing row is
 * already in, so nothing regresses when the match fails.
 */
export async function resolveRwInvoiceId(
  jobId: string,
  rwInvoiceId: string | null,
  invoiceNumber: string | null,
): Promise<string | null> {
  if (!rwInvoiceId && !invoiceNumber) return null

  const linked = await prisma.jobRwOrder.findMany({
    where: { jobId },
    select: { rwOrderNumber: true },
  })
  const orderNumbers = linked.map((l) => l.rwOrderNumber)
  if (orderNumbers.length === 0) return null

  // An id from the picker is still verified against the mirror. It arrives as
  // a client-supplied string, and persisting an unverified one would key a
  // charge to an invoice that does not exist.
  if (rwInvoiceId) {
    const hit = await prisma.rwInvoice.findFirst({
      where: { rwInvoiceId, orderNumber: { in: orderNumbers }, status: { not: RW_VOID } },
      select: { rwInvoiceId: true },
    })
    if (hit) return hit.rwInvoiceId
  }

  if (!invoiceNumber) return null

  // take:2 is the ambiguity check — one match links, two or more do not.
  const matches = await prisma.rwInvoice.findMany({
    where: { invoiceNumber, orderNumber: { in: orderNumbers }, status: { not: RW_VOID } },
    select: { rwInvoiceId: true },
    take: 2,
  })
  return matches.length === 1 ? matches[0].rwInvoiceId : null
}
