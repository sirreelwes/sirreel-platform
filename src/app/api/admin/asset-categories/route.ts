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

  const rows = await prisma.assetCategory.findMany({
    where: includeArchived ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      department: true,
      totalUnits: true,
      sortOrder: true,
      dailyRate: true,
      weeklyRate: true,
      isActive: true,
      archivedAt: true,
      _count: { select: { assets: true, orderLineItems: true, rateChangeLogs: true } },
    },
  });

  const categories = rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    department: c.department,
    totalUnits: c.totalUnits,
    sortOrder: c.sortOrder,
    dailyRate: c.dailyRate.toString(),
    weeklyRate: c.weeklyRate != null ? c.weeklyRate.toString() : null,
    isActive: c.isActive,
    archivedAt: c.archivedAt,
    // Reference counts for the guarded delete modal. total > 0 ⇒ archive-only.
    refs: {
      assets: c._count.assets,
      orderLineItems: c._count.orderLineItems,
      rateChangeLogs: c._count.rateChangeLogs,
      total: c._count.assets + c._count.orderLineItems + c._count.rateChangeLogs,
    },
  }));

  return NextResponse.json({ categories });
}
