import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * Reference count for an inventory item — drives the drawer's delete
 * decision. Zero references => "permanently delete" is offered;
 * otherwise the item can only be archived (and we tell the user how
 * many records reference it). RateChangeLog cascades on delete, so it
 * is intentionally NOT counted as a blocking reference.
 *
 * kitPieces counts the OTHER items that include this one as an
 * accessory (the FK is Restrict, so the delete would fail at the DB
 * anyway). Kit rows where this item is the PARENT cascade, so they
 * don't block — deleting a radio should take its kit with it.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  const [orderLineItems, packageItems, subRentals, kitPieces] = await Promise.all([
    prisma.orderLineItem.count({ where: { inventoryItemId: id } }),
    prisma.packageItem.count({ where: { inventoryItemId: id } }),
    prisma.subRental.count({ where: { inventoryItemId: id } }),
    prisma.inventoryKitPiece.count({ where: { pieceItemId: id } }),
  ]);
  const total = orderLineItems + packageItems + subRentals + kitPieces;

  return NextResponse.json({
    references: { orderLineItems, packageItems, subRentals, kitPieces, total },
    canPermanentlyDelete: total === 0,
  });
}
