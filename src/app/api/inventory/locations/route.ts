import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Public list — used to populate the inventory edit dropdown.
export async function GET() {
  const locations = await prisma.inventoryLocation.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, code: true, sortOrder: true },
  });
  return NextResponse.json({ locations });
}
