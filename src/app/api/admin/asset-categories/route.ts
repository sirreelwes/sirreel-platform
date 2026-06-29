import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

// GET — admin list of fleet/asset categories with their editable rates.
// Decimal rates are serialized to strings so the client never round-trips
// money through a JS float.
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const rows = await prisma.assetCategory.findMany({
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
    },
  });

  const categories = rows.map((c) => ({
    ...c,
    dailyRate: c.dailyRate.toString(),
    weeklyRate: c.weeklyRate != null ? c.weeklyRate.toString() : null,
  }));

  return NextResponse.json({ categories });
}
