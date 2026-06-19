/**
 * Hard scope guard. Every write in the sync goes through these two
 * helpers; both fail loudly if asked to touch a non-Planyo row.
 */

import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function planyoOriginBookingOrThrow(tx: Tx, id: string): Promise<void> {
  const b = await tx.booking.findUnique({
    where: { id },
    select: { source: true, planyoCartId: true },
  })
  if (!b || b.source !== 'PLANYO_BACKFILL' || !b.planyoCartId) {
    throw new Error(
      `SCOPE_GUARD: booking ${id} is not Planyo-origin (source=${b?.source ?? 'null'}, cart=${b?.planyoCartId ?? 'null'})`,
    )
  }
}

export async function planyoOriginBookingItemOrThrow(tx: Tx, id: string): Promise<void> {
  const it = await tx.bookingItem.findUnique({
    where: { id },
    select: { booking: { select: { source: true, planyoCartId: true } } },
  })
  if (!it || it.booking.source !== 'PLANYO_BACKFILL' || !it.booking.planyoCartId) {
    throw new Error(`SCOPE_GUARD: bookingItem ${id} is not Planyo-origin`)
  }
}
