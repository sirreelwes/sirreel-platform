import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-admin';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

// Validate + canonicalize a money input WITHOUT going through a JS float.
// Accepts "125", "125.5", "125.50"; rejects negatives, junk, and >2
// decimals (the column is Decimal(10,2)). Returns the canonical 2-decimal
// string for storage, or null when the input is invalid.
function parseMoney(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return `${whole}.${(frac + '00').slice(0, 2)}`;
}

// PATCH — edit a fleet/asset CATEGORY's daily / weekly rate. Mirrors the
// catalog inventory rate edit: money stays Decimal end-to-end, and a rate
// change writes a RateChangeLog audit row (source MANUAL) in the same
// transaction. Editing the category rate changes the DEFAULT for FUTURE
// order lines only — existing OrderLineItems snapshot their own `rate` at
// creation, so past quotes/invoices are untouched.
export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};

  if (body.dailyRate !== undefined) {
    const d = parseMoney(body.dailyRate);
    if (d === null) {
      return NextResponse.json({ error: 'dailyRate must be a non-negative amount with up to 2 decimals' }, { status: 400 });
    }
    data.dailyRate = d;
  }

  // weeklyRate is nullable on the model — an empty value clears it.
  if (body.weeklyRate !== undefined) {
    if (body.weeklyRate === null || String(body.weeklyRate).trim() === '') {
      data.weeklyRate = null;
    } else {
      const w = parseMoney(body.weeklyRate);
      if (w === null) {
        return NextResponse.json({ error: 'weeklyRate must be a non-negative amount with up to 2 decimals' }, { status: 400 });
      }
      data.weeklyRate = w;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no editable fields provided' }, { status: 400 });
  }

  const before = await prisma.assetCategory.findUnique({
    where: { id },
    select: { dailyRate: true, weeklyRate: true },
  });
  if (!before) {
    return NextResponse.json({ error: 'category not found' }, { status: 404 });
  }

  // Change detection only — comparison via Number is exact for money in the
  // Decimal(10,2) range; the value persisted is the validated string above.
  const dailyChanged = data.dailyRate !== undefined && Number(before.dailyRate) !== Number(data.dailyRate);
  const beforeWeekly = before.weeklyRate != null ? Number(before.weeklyRate) : 0;
  const afterWeekly = data.weeklyRate !== undefined ? (data.weeklyRate != null ? Number(data.weeklyRate) : 0) : beforeWeekly;
  const weeklyChanged = data.weeklyRate !== undefined && beforeWeekly !== afterWeekly;
  const rateChanged = dailyChanged || weeklyChanged;

  // RateChangeLog requires non-null Decimals; weeklyRate may be null on the
  // category, so coerce null → "0" for the audit snapshot (matches the
  // catalog log, where weeklyRate defaults to 0).
  const oldWeekly = before.weeklyRate != null ? before.weeklyRate : '0';
  const newWeekly =
    data.weeklyRate !== undefined ? (data.weeklyRate != null ? (data.weeklyRate as string) : '0') : oldWeekly;
  const newDaily = data.dailyRate !== undefined ? (data.dailyRate as string) : before.dailyRate;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.assetCategory.update({
        where: { id },
        data,
        select: {
          id: true, name: true, slug: true, department: true,
          totalUnits: true, sortOrder: true, dailyRate: true, weeklyRate: true,
        },
      });
      if (rateChanged) {
        await tx.rateChangeLog.create({
          data: {
            assetCategoryId: id,
            oldDailyRate: before.dailyRate,
            newDailyRate: newDaily,
            oldWeeklyRate: oldWeekly,
            newWeeklyRate: newWeekly,
            source: 'MANUAL',
            appliedById: gate.user.id,
          },
        });
      }
      return u;
    });

    return NextResponse.json({
      ...updated,
      dailyRate: updated.dailyRate.toString(),
      weeklyRate: updated.weeklyRate != null ? updated.weeklyRate.toString() : null,
    });
  } catch (e: any) {
    if (e?.code === 'P2025') return NextResponse.json({ error: 'not found' }, { status: 404 });
    console.error('[asset-category PATCH] update failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Update failed' }, { status: 400 });
  }
}
