/**
 * /api/admin/who-we-are/[id] — edit or remove a team member. requireAdmin.
 *  PATCH  → { name?, title?, published?, sortOrder? }
 *  DELETE → remove the member (+ best-effort blob cleanup)
 */
import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as
    | { name?: string; title?: string; published?: boolean; sortOrder?: number }
    | null
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const data: { name?: string; title?: string; published?: boolean; sortOrder?: number } = {}
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 120)
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120)
  if (typeof body.published === 'boolean') data.published = body.published
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

  await prisma.teamMember.update({ where: { id: params.id }, data })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const m = await prisma.teamMember.findUnique({ where: { id: params.id }, select: { photoUrl: true } })
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await prisma.teamMember.delete({ where: { id: params.id } })
  if (m.photoUrl) {
    try {
      await del(m.photoUrl)
    } catch (err) {
      console.error('[who-we-are] blob delete failed:', err instanceof Error ? err.message : err)
    }
  }
  return NextResponse.json({ ok: true })
}
