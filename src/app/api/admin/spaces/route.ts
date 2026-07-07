/**
 * /api/admin/spaces
 *
 *   GET  → every Space (active + archived) with its photos, for the HQ
 *          editor (/admin/spaces). Includes a `clientVisible` flag = the
 *          full public gate (active + published + has a photo).
 *   POST → create a Space (name + type required). Defaults published=false,
 *          active=true — a new space is invisible publicly until it's
 *          published AND has a photo.
 *
 * Admin-gated (requireAdmin), mirroring the vehicle-catalog editor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma, SpaceType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

const SPACE_TYPES = Object.values(SpaceType)

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const rows = await prisma.space.findMany({
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      type: true,
      description: true,
      sortOrder: true,
      published: true,
      active: true,
      photos: {
        select: { id: true, sortOrder: true, isPrimary: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })

  const spaces = rows.map((r) => ({
    ...r,
    // Real client-facing state — "published but photo-less → still hidden".
    clientVisible: r.active && r.published && r.photos.length > 0,
  }))

  return NextResponse.json({ spaces })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as {
    name?: string
    type?: string
    description?: string | null
    sortOrder?: number
  } | null

  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.type || !SPACE_TYPES.includes(body.type as SpaceType)) {
    return NextResponse.json(
      { error: `type must be one of ${SPACE_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const space = await prisma.space.create({
      data: {
        name: body.name.trim(),
        type: body.type as SpaceType,
        description: body.description?.trim() || null,
        sortOrder: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
      },
      select: {
        id: true, name: true, type: true, description: true,
        sortOrder: true, published: true, active: true,
      },
    })
    return NextResponse.json({ space: { ...space, photos: [], clientVisible: false } }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'a space of that type already has that name' },
        { status: 409 },
      )
    }
    const message = err instanceof Error ? err.message : 'create failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
