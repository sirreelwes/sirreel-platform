import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

// GET — full admin list, including inactive, with item counts.
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const locations = await prisma.inventoryLocation.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, code: true, sortOrder: true, isActive: true,
      _count: { select: { items: true } },
    },
  });
  return NextResponse.json({ locations });
}

// POST — create a new location. Auto-derives `code` from name if not provided.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const code = (body.code ? String(body.code) : name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!code) return NextResponse.json({ error: 'invalid code' }, { status: 400 });

  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100;

  try {
    const location = await prisma.inventoryLocation.create({
      data: { name, code, sortOrder, isActive: body.isActive !== false },
    });
    return NextResponse.json(location, { status: 201 });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'name or code already exists' }, { status: 409 });
    }
    throw e;
  }
}
