import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * RentalWorks invoice status → AR meaning. Single source of truth so every
 * surface counts money the same way.
 *
 * RW leaves a VOID (cancelled) invoice's RemainingTotal at full face value
 * because nothing was ever received against it — so a naive `remaining > 0`
 * counts cancelled invoices as outstanding. That inflated "outstanding" by
 * ~$1.86M. Statuses seen in the mirror: CLOSED (paid/settled, remaining 0),
 * VOID (cancelled), NEW + PROCESSED (genuinely open).
 */
export const RW_VOID = 'VOID'
export const RW_PAID = 'CLOSED'

/** Genuinely owed: has a balance AND isn't cancelled. */
export const OPEN_WHERE: Prisma.RwInvoiceWhereInput = {
  remainingTotal: { gt: 0 },
  status: { not: RW_VOID },
}

export function isVoid(status: string | null | undefined): boolean {
  return (status ?? '').toUpperCase() === RW_VOID
}

/** True if this invoice is real outstanding AR (owed, not cancelled). */
export function isOpen(inv: { remainingTotal: number | { toString(): string }; status: string | null }): boolean {
  return !isVoid(inv.status) && Number(inv.remainingTotal ?? 0) > 0.005
}

/** rwInvoiceIds staff have manually marked paid in HQ (RW lagging reality). */
export async function getHqPaidInvoiceIds(): Promise<string[]> {
  const marks = await prisma.rwInvoicePaidMark.findMany({ select: { rwInvoiceId: true } })
  return marks.map((m) => m.rwInvoiceId)
}
