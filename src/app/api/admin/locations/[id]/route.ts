import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

// PATCH — rename, reorder, or toggle active.
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (Number.isFinite(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 });
  }

  try {
    const location = await prisma.inventoryLocation.update({ where: { id }, data });
    return NextResponse.json(location);
  } catch (e: any) {
    if (e?.code === 'P2002') return NextResponse.json({ error: 'name conflicts with existing location' }, { status: 409 });
    if (e?.code === 'P2025') return NextResponse.json({ error: 'not found' }, { status: 404 });
    throw e;
  }
}

// DELETE — hard delete only when no items reference it; otherwise instruct
// the caller to deactivate instead.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const count = await prisma.inventoryItem.count({ where: { locationId: id } });
  if (count > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${count} item(s) still reference this location. Deactivate instead.` },
      { status: 409 },
    );
  }
  try {
    await prisma.inventoryLocation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === 'P2025') return NextResponse.json({ error: 'not found' }, { status: 404 });
    throw e;
  }
}
