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
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  const [orderLineItems, packageItems, subRentals] = await Promise.all([
    prisma.orderLineItem.count({ where: { inventoryItemId: id } }),
    prisma.packageItem.count({ where: { inventoryItemId: id } }),
    prisma.subRental.count({ where: { inventoryItemId: id } }),
  ]);
  const total = orderLineItems + packageItems + subRentals;

  return NextResponse.json({
    references: { orderLineItems, packageItems, subRentals, total },
    canPermanentlyDelete: total === 0,
  });
}
