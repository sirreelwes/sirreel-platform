import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMoney } from "@/lib/pricing/resolveRate";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

// Trim then collapse to null when empty so a cleared field actually
// clears in the DB instead of saving an empty string.
function nullableTrim(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

const INCLUDE = {
  category: { select: { id: true, name: true } },
  locationRef: { select: { id: true, name: true, code: true } },
  preferredVendor: { select: { id: true, name: true, website: true, isActive: true } },
} as const;

export async function PUT(req: NextRequest, { params }: Params) {
  // Auth: any authenticated user (inventory is a daily-touch ops
  // surface — Hugo and Julian maintain rates/qty/photos too, not
  // just admins).
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const {
    dailyRate,
    weeklyRate,
    qtyOwned,
    replacementCost,
    description,
    imageUrl,
    locationId,
    categoryId,
    preferredVendorId,
    vendorItemUrl,
    isActive,
    aliases,
  } = body;

  const data: Record<string, unknown> = {};
  // Client-facing search aliases (informal synonyms — "walkies", "earpiece").
  // Normalize to trimmed, lowercased, de-duped tokens so the order-form
  // search (which lowercases the query) matches consistently.
  if (aliases !== undefined) {
    data.aliases = Array.isArray(aliases)
      ? [...new Set(aliases.map((a: unknown) => String(a).trim().toLowerCase()).filter(Boolean))]
      : [];
  }
  // Decimal-safe money writes (audit §7) — no parseFloat into Decimal
  // columns; parseMoney cent-rounds via Prisma.Decimal.
  if (dailyRate !== undefined) data.dailyRate = parseMoney(dailyRate) ?? new Prisma.Decimal(0);
  if (weeklyRate !== undefined) data.weeklyRate = parseMoney(weeklyRate) ?? new Prisma.Decimal(0);
  if (qtyOwned !== undefined) data.qtyOwned = parseInt(qtyOwned) || 0;
  if (replacementCost !== undefined) data.replacementCost = replacementCost ? parseMoney(replacementCost) : null;
  if (description !== undefined) data.description = description;
  if (imageUrl !== undefined) data.imageUrl = imageUrl || null;
  if (locationId !== undefined) data.locationId = locationId || null;
  if (categoryId !== undefined) data.categoryId = categoryId || null;

  // Archive / restore via isActive. Archiving stamps archivedAt;
  // restoring clears it. (The list/catalog/pickers already exclude
  // isActive=false.)
  if (isActive !== undefined) {
    data.isActive = !!isActive;
    data.archivedAt = isActive ? null : new Date();
  }

  // Preferred vendor — accept string or null. When non-null, validate
  // the vendor exists AND is active so the picker can't be bypassed
  // with a hand-crafted body that points at an archived row.
  if (preferredVendorId !== undefined) {
    if (preferredVendorId === null || preferredVendorId === '') {
      data.preferredVendorId = null;
    } else if (typeof preferredVendorId !== 'string') {
      return NextResponse.json(
        { error: 'preferredVendorId must be a string or null' },
        { status: 400 },
      );
    } else {
      const vendor = await prisma.vendor.findUnique({
        where: { id: preferredVendorId },
        select: { id: true, isActive: true },
      });
      if (!vendor) {
        return NextResponse.json({ error: 'vendor not found' }, { status: 404 });
      }
      if (!vendor.isActive) {
        return NextResponse.json(
          { error: 'vendor is archived — pick an active vendor' },
          { status: 400 },
        );
      }
      data.preferredVendorId = vendor.id;
    }
  }

  // Per-item product link — overrides Vendor.website for the row's
  // effective reorder URL when both are present.
  const vItemUrl = nullableTrim(vendorItemUrl);
  if (vItemUrl !== undefined) data.vendorItemUrl = vItemUrl;

  // Snapshot the current rates so we can audit a MANUAL rate change.
  const before = await prisma.inventoryItem.findUnique({
    where: { id },
    select: { dailyRate: true, weeklyRate: true },
  });
  if (!before) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  const newDaily = data.dailyRate !== undefined ? (data.dailyRate as Prisma.Decimal) : before.dailyRate;
  const newWeekly = data.weeklyRate !== undefined ? (data.weeklyRate as Prisma.Decimal) : before.weeklyRate;
  const rateChanged =
    !before.dailyRate.equals(newDaily) || !before.weeklyRate.equals(newWeekly);

  // Resolve the acting user for the audit row (best-effort; the log is
  // non-fatal if the user lookup misses).
  const appliedBy = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });

  try {
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data,
        include: INCLUDE,
      });
      // Price propagation contract: InventoryItem is the live catalog
      // (catalog/search reads it). Existing OrderLineItems snapshot their
      // own rate, so they are untouched. We only AUDIT the change here;
      // future quotes pull the new rate from the item itself.
      if (rateChanged) {
        await tx.rateChangeLog.create({
          data: {
            inventoryItemId: id,
            oldDailyRate: before.dailyRate,
            newDailyRate: newDaily,
            oldWeeklyRate: before.weeklyRate,
            newWeeklyRate: newWeekly,
            source: "MANUAL",
            appliedById: appliedBy?.id ?? null,
          },
        });
      }
      return updated;
    });
    return NextResponse.json(item);
  } catch (err) {
    console.error('[inventory PUT] update failed:', err);
    const message = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE — guarded permanent delete. Only allowed when the item is
 * referenced by ZERO order line items / package items / sub-rentals;
 * otherwise the caller must archive instead (we return 409 with the
 * counts). RateChangeLog cascades, so it isn't counted as a blocker.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
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
  if (total > 0) {
    return NextResponse.json(
      {
        error: "referenced",
        references: { orderLineItems, packageItems, subRentals, total },
      },
      { status: 409 },
    );
  }

  try {
    await prisma.inventoryItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[inventory DELETE] failed:', err);
    const message = err instanceof Error ? err.message : 'Delete failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
