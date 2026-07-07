/**
 * PATCH /api/admin/spaces/[id]
 *
 * Edits a Space or toggles its `published` / `active` (archive) state.
 * Only fields present in the body are written. Archive is soft-delete via
 * active=false (parallels VehicleCategory) — rows are never hard-deleted,
 * so a future SubRental/booking reference could stay valid.
 *
 *   name, type, description, sortOrder, published, active
 *
 * Admin-gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma, SpaceType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const SPACE_TYPES = Object.values(SpaceType)

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    type?: string
    description?: string | null
    sortOrder?: number
    published?: boolean
    active?: boolean
  }

  const data: Prisma.SpaceUpdateInput = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.type !== undefined) {
    if (!SPACE_TYPES.includes(body.type as SpaceType)) {
      return NextResponse.json({ error: `type must be one of ${SPACE_TYPES.join(', ')}` }, { status: 400 })
    }
    data.type = body.type as SpaceType
  }
  if (body.description !== undefined) {
    data.description = body.description?.trim() || null
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isInteger(body.sortOrder)) {
      return NextResponse.json({ error: 'sortOrder must be an integer' }, { status: 400 })
    }
    data.sortOrder = body.sortOrder
  }
  if (typeof body.published === 'boolean') data.published = body.published
  if (typeof body.active === 'boolean') data.active = body.active

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  try {
    const space = await prisma.space.update({
      where: { id },
      data,
      select: {
        id: true, name: true, type: true, description: true,
        sortOrder: true, published: true, active: true,
        photos: {
          select: { id: true, sortOrder: true, isPrimary: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
    return NextResponse.json({
      space: { ...space, clientVisible: space.active && space.published && space.photos.length > 0 },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return NextResponse.json({ error: 'a space of that type already has that name' }, { status: 409 })
      if (err.code === 'P2025') return NextResponse.json({ error: 'space not found' }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'update failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
