/**
 * Which order lines a CLIENT document leaves out.
 *
 * An included accessory whose kit piece is marked not client-visible
 * (`InventoryKitPiece.clientVisible`, the toggle in the kit editor) is
 * packed, pulled and checked back in like any other line, and never
 * printed for the client. The flag was stored since 2026-08-24 and read by
 * nothing, so every free battery and charger showed on the client's quote.
 *
 * Wes, 2026-09-15, on walkies: "from client side — only Motorola CP200."
 * The walkie kit (CP200 Battery, 6-Bank Charger) is the first kit set to
 * hidden; the warehouse surfaces (pick list, check-in/out sheets) are not
 * client documents and keep every line.
 *
 * Only a $0 line can be hidden. A charged accessory left off a document
 * whose totals still include it would be an unexplained charge, so a
 * CHARGED piece always prints whatever its flag says.
 */

import { Prisma } from '@prisma/client'

/** Spread into a lineItems `select`/`include` that feeds a client render. */
export const CLIENT_KIT_VISIBILITY = {
  autoKitPiece: { select: { clientVisible: true } },
} as const

export interface ClientLineInput {
  autoKitPiece?: { clientVisible: boolean } | null
  lineTotal: Prisma.Decimal | number | string
}

export function hiddenFromClient(line: ClientLineInput): boolean {
  return !!line.autoKitPiece && line.autoKitPiece.clientVisible === false && Number(line.lineTotal) === 0
}
