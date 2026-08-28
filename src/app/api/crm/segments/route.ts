/**
 * Saved People segments.
 *
 *   GET  /api/crm/segments — every shared segment, plus the caller's own.
 *   POST /api/crm/segments — save the current filter set under a name.
 *
 * "LA line producers we haven't quoted since January" should be a thing
 * you click, not a search you rebuild from memory. Phase 1 of the
 * outreach build; Phase 3 composes a send against one of these.
 *
 * Re-saving a name you already used UPDATES it rather than creating a
 * second identical chip — the unique key is (createdById, name), and a
 * duplicate chip is worse than no chip because you can't tell them apart
 * in the strip.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { isPeopleSegmentKey } from '@/lib/crm/peopleSegments'

export const dynamic = 'force-dynamic'

const MAX_NAME = 60

const SELECT = {
  id: true,
  name: true,
  segmentKey: true,
  roleKey: true,
  search: true,
  isShared: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const

async function requireUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const segments = await prisma.contactSegment.findMany({
    where: { OR: [{ isShared: true }, { createdById: user.id }] },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ segments })
}

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    name?: unknown
    segmentKey?: unknown
    roleKey?: unknown
    search?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const segmentKey = isPeopleSegmentKey(body.segmentKey) ? body.segmentKey : null
  const roleKey =
    typeof body.roleKey === 'string' && body.roleKey.trim() ? body.roleKey.trim() : null
  const search =
    typeof body.search === 'string' && body.search.trim() ? body.search.trim().slice(0, 200) : null

  // A segment with no filters at all is just "everyone" wearing a name,
  // which will mislead whoever clicks it later.
  if (!segmentKey && !roleKey && !search) {
    return NextResponse.json(
      { error: 'A saved segment needs at least one filter — otherwise it is just the full list.' },
      { status: 400 },
    )
  }

  const saved = await prisma.contactSegment.upsert({
    where: { createdById_name: { createdById: user.id, name } },
    create: { name, segmentKey, roleKey, search, createdById: user.id },
    update: { segmentKey, roleKey, search },
    select: SELECT,
  })
  return NextResponse.json({ segment: saved }, { status: 201 })
}
