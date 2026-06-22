import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  } = body;

  const data: Record<string, unknown> = {};
  if (dailyRate !== undefined) data.dailyRate = parseFloat(dailyRate) || 0;
  if (weeklyRate !== undefined) data.weeklyRate = parseFloat(weeklyRate) || 0;
  if (qtyOwned !== undefined) data.qtyOwned = parseInt(qtyOwned) || 0;
  if (replacementCost !== undefined) data.replacementCost = replacementCost ? parseFloat(replacementCost) : null;
  if (description !== undefined) data.description = description;
  if (imageUrl !== undefined) data.imageUrl = imageUrl || null;
  if (locationId !== undefined) data.locationId = locationId || null;
  if (categoryId !== undefined) data.categoryId = categoryId || null;

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

  try {
    const item = await prisma.inventoryItem.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true } },
        locationRef: { select: { id: true, name: true, code: true } },
        preferredVendor: { select: { id: true, name: true, website: true, isActive: true } },
      },
    });
    return NextResponse.json(item);
  } catch (err) {
    console.error('[inventory PUT] update failed:', err);
    const message = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
