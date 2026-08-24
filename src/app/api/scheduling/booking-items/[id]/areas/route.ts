import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * Stage AREAS on a hold — which rooms and lots this stage rental is using.
 *
 * Wes 2026-08-24: a studio sells three ways (Standing Sets, LED/Volume
 * Stage, Black Box); everything else — the sets, offices, green rooms, and
 * parking lots — is an area you attach to the hold. Areas never consume
 * capacity: six rooms on a Standing Sets hold is still one stage.
 *
 * GET  → the full active area list + which ones this item has selected.
 * POST → replace the selection ({ areaIds: string[] }). Full-set replace
 *        keeps the client simple and makes the write idempotent.
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Which stage is this hold on? Areas that live INSIDE a specific stage
  // (Hospital / Police-Jail / Morgue are sets within Standing Sets) are
  // only offered when that stage is the one assigned. Complex-wide areas
  // — green rooms, offices, parking — always apply. An unassigned hold
  // sees everything, since the stage isn't chosen yet.
  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: { assignments: { where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } }, select: { asset: { select: { unitName: true } } }, take: 1 } },
  })
  const stageName = item?.assignments[0]?.asset.unitName ?? null

  const [areas, selected] = await Promise.all([
    prisma.stageArea.findMany({
      where: {
        isActive: true,
        ...(stageName ? { OR: [{ parentStage: null }, { parentStage: stageName }] } : {}),
      },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, name: true, kind: true, parentStage: true },
    }),
    prisma.bookingItemStageArea.findMany({
      where: { bookingItemId: params.id },
      select: { stageAreaId: true },
    }),
  ])
  return NextResponse.json({ areas, selectedIds: selected.map((s) => s.stageAreaId), stageName })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  })
  // Same gate as the rest of reservation control (holds, dates, status).
  if (!actor || !can(actor.role, 'canCreateBooking')) {
    return NextResponse.json(
      { error: 'forbidden', reason: 'changing a reservation is a sales action' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => null)) as { areaIds?: unknown } | null
  const areaIds = Array.isArray(body?.areaIds)
    ? (body!.areaIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : null
  if (!areaIds) return NextResponse.json({ error: 'areaIds array required' }, { status: 400 })

  const item = await prisma.bookingItem.findUnique({
    where: { id: params.id },
    select: { id: true, category: { select: { department: true } } },
  })
  if (!item) return NextResponse.json({ error: 'booking item not found' }, { status: 404 })
  if (item.category?.department !== 'STAGES') {
    return NextResponse.json(
      { error: 'not a stage hold', reason: 'areas only apply to STAGES-department items' },
      { status: 400 },
    )
  }

  // Ignore unknown/retired ids rather than failing the whole save.
  const valid = await prisma.stageArea.findMany({
    where: { id: { in: areaIds }, isActive: true },
    select: { id: true },
  })

  await prisma.$transaction([
    prisma.bookingItemStageArea.deleteMany({ where: { bookingItemId: params.id } }),
    ...(valid.length
      ? [
          prisma.bookingItemStageArea.createMany({
            data: valid.map((a) => ({ bookingItemId: params.id, stageAreaId: a.id })),
          }),
        ]
      : []),
  ])

  return NextResponse.json({ ok: true, saved: valid.length })
}
