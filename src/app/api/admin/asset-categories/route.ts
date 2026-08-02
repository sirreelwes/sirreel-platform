import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

// GET — admin list of fleet/asset categories with their editable rates and
// reference counts (units / order lines / rate-change history) used by the
// delete-guard modal. Archived categories are excluded unless
// ?includeArchived=1. Decimal rates are serialized to strings so the client
// never round-trips money through a JS float.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';

  // Fleet Pricing lists the MERGED catalog rows. It used to read
  // AssetCategory, which is frozen — with the write mirror gone it would
  // have shown pre-merge prices and hidden every later edit. The `id`
  // stays the AssetCategory id because the PATCH/image routes below are
  // still keyed on it (and it anchors BookingItem.categoryId's FK).
  const rows = await prisma.inventoryItem.findMany({
    where: {
      trackingMode: 'UNIT_TRACKED',
      legacyAssetCategoryId: { not: null },
      ...(includeArchived ? {} : { isActive: true }),
    },
    orderBy: [{ sortOrder: 'asc' }, { description: 'asc' }],
    select: {
      legacyAssetCategoryId: true,
      code: true,
      description: true,
      slug: true,
      department: true,
      qtyOwned: true,
      sortOrder: true,
      dailyRate: true,
      weeklyRate: true,
      isActive: true,
      archivedAt: true,
      imageUrl: true,
      _count: { select: { assets: true, lineItems: true, rateChanges: true } },
    },
  });

  const categories = rows.map((c) => ({
    id: c.legacyAssetCategoryId as string,
    name: c.description || c.code,
    slug: c.slug,
    department: c.department,
    totalUnits: c.qtyOwned,
    sortOrder: c.sortOrder,
    dailyRate: c.dailyRate.toString(),
    weeklyRate: c.weeklyRate != null ? c.weeklyRate.toString() : null,
    isActive: c.isActive,
    archivedAt: c.archivedAt,
    // Whether a representative image exists. The image itself loads via the
    // gated proxy GET /api/admin/asset-categories/[id]/image (private blob —
    // the raw imageUrl is never sent to the client).
    hasImage: !!c.imageUrl,
    // Reference counts for the guarded delete modal. total > 0 ⇒ archive-only.
    refs: {
      // Relation names differ on InventoryItem; the response keys the
      // delete modal reads are unchanged.
      assets: c._count.assets,
      orderLineItems: c._count.lineItems,
      rateChangeLogs: c._count.rateChanges,
      total: c._count.assets + c._count.lineItems + c._count.rateChanges,
    },
  }));

  return NextResponse.json({ categories });
}
