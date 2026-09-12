/**
 * The fleet categories a HOLD can be taken against, as the plain
 * {id, name, aliases} the email matcher scores.
 *
 * Same gate the gantt's "+ New Hold" picker uses: active, and flagged
 * reservable by an operator. A category the picker won't offer must not
 * be something an inbound email can preload either — the desk would open
 * the reservation window on a row it can't hold.
 *
 * Split from emailVehicleMatch.ts so that module stays prisma-free and
 * testable offline.
 */

import { prisma } from '@/lib/prisma'
import type { MatchableCategory } from '@/lib/sales/emailVehicleMatch'

export async function loadReservableCategories(): Promise<MatchableCategory[]> {
  return prisma.assetCategory.findMany({
    where: { isActive: true, reservableOnGantt: true },
    select: { id: true, name: true, aliases: true },
  })
}
