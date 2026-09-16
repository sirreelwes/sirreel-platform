/**
 * /api/admin/who-we-are/[id] — edit or remove a team member. requireAdmin.
 *  PATCH  → { name?, title?, published?, sortOrder?, userId? }
 *
 * userId links the roster row to an HQ login, which is what lets client
 * email reach this photo (src/lib/email/repCard.ts). null unlinks.
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
    | {
        name?: string
        title?: string
        published?: boolean
        sortOrder?: number
        userId?: string | null
      }
    | null
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })

  const data: {
    name?: string
    title?: string
    published?: boolean
    sortOrder?: number
    userId?: string | null
  } = {}
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 120)
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120)
  if (typeof body.published === 'boolean') data.published = body.published
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

  if ('userId' in body) {
    if (body.userId === null || body.userId === '') {
      data.userId = null
    } else if (typeof body.userId === 'string') {
      const user = await prisma.user.findFirst({
        where: { id: body.userId, isActive: true },
        select: { id: true },
      })
      if (!user) return NextResponse.json({ error: 'No active HQ user with that id' }, { status: 400 })
      data.userId = user.id
    }
  }

  try {
    await prisma.teamMember.update({ where: { id: params.id }, data })
  } catch (err) {
    const code = (err as { code?: string })?.code
    // One login is one roster row.
    if (code === 'P2002') {
      return NextResponse.json(
        { error: 'That HQ login is already linked to another team member.' },
        { status: 409 },
      )
    }
    // The column has not been added to the live DB yet.
    if (code === 'P2022') {
      return NextResponse.json(
        { error: 'Run scripts/add-team-member-user-column.ts before linking HQ logins.' },
        { status: 409 },
      )
    }
    throw err
  }
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
