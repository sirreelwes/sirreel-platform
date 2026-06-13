/**
 * GET /api/admin/dedup/recent
 *
 * Returns recent un-reversed merges so the UI can offer one-click
 * undo. Defaults to the last 24h; pass `?days=N` to widen.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDedupAccess } from '@/lib/people/dedupAccess'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate

  const daysRaw = req.nextUrl.searchParams.get('days')
  const days = daysRaw && Number.isFinite(Number(daysRaw)) ? Math.max(1, Math.min(30, Number(daysRaw))) : 1
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const rows = await prisma.personMerge.findMany({
    where: { reversedAt: null, mergedAt: { gte: since } },
    orderBy: { mergedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      survivorId: true,
      mergedAt: true,
      mergedById: true,
      loserSnapshot: true,
      survivorEmailBeforeMerge: true,
      aliasIds: true,
      survivor: { select: { firstName: true, lastName: true, email: true } },
      mergedBy: { select: { name: true, email: true } },
    },
  })

  // Surface a compact row shape for the UI — collapse the JSON snapshot
  // to just the loser's name + email so the reviewer can confirm which
  // merge they're undoing without opening the raw blob.
  const merges = rows.map((r) => {
    const snap = r.loserSnapshot as { firstName?: string; lastName?: string; email?: string; id?: string }
    return {
      id: r.id,
      mergedAt: r.mergedAt.toISOString(),
      mergedBy: { name: r.mergedBy.name, email: r.mergedBy.email },
      survivor: {
        id: r.survivorId,
        name: `${r.survivor.firstName} ${r.survivor.lastName}`.trim(),
        email: r.survivor.email,
      },
      loser: {
        id: snap.id ?? '',
        name: `${snap.firstName ?? ''} ${snap.lastName ?? ''}`.trim(),
        email: snap.email ?? '',
      },
      aliasCount: r.aliasIds.length,
    }
  })

  return NextResponse.json({ merges, days })
}
