/**
 * DELETE /api/crm/segments/[id] — remove a saved segment.
 *
 * Only the creator may delete. Shared segments are visible to everyone
 * but are not everyone's to remove: deleting one takes a working list
 * out from under whoever built it, and there is no undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const segment = await prisma.contactSegment.findUnique({
    where: { id },
    select: { id: true, createdById: true, name: true },
  })
  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (segment.createdById !== user.id) {
    return NextResponse.json(
      { error: `"${segment.name}" belongs to whoever created it — ask them to remove it.` },
      { status: 403 },
    )
  }

  await prisma.contactSegment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
