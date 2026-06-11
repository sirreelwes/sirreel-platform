/**
 * PATCH /api/crm/outreach/[id] — update an OutreachActivity.
 *
 * Body (any subset):
 *   { notes?, followUpAt?, followUpDone?, type?, occurredAt? }
 *
 * Used by the FOLLOW-UPS DUE drill-down to flip `followUpDone` with
 * one tap. Authored row owners (createdById === session user) may
 * edit; ADMIN / MANAGER may edit anyone's.
 *
 * DELETE /api/crm/outreach/[id] — remove an OutreachActivity. Same
 * authorship gate as PATCH.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { OutreachType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const ELEVATED_ROLES = new Set(['ADMIN', 'MANAGER'])
const TYPE_VALUES = new Set<string>(Object.values(OutreachType))

async function authorize(id: string, sessionEmail: string) {
  const user = await prisma.user.findUnique({
    where: { email: sessionEmail },
    select: { id: true, role: true },
  })
  if (!user) return { ok: false as const, status: 401 }
  const row = await prisma.outreachActivity.findUnique({
    where: { id },
    select: { id: true, createdById: true },
  })
  if (!row) return { ok: false as const, status: 404 }
  if (row.createdById !== user.id && !ELEVATED_ROLES.has(user.role)) {
    return { ok: false as const, status: 403 }
  }
  return { ok: true as const, user, row }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const auth = await authorize(id, session.user.email)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 404 ? 'not found' : 'forbidden' }, { status: auth.status })

  const body = await req.json().catch(() => null) as {
    notes?: string
    followUpAt?: string | null
    followUpDone?: boolean
    type?: string
    occurredAt?: string
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (body.notes !== undefined) {
    if (!body.notes.trim()) return NextResponse.json({ error: 'notes cannot be empty' }, { status: 400 })
    data.notes = body.notes.trim()
  }
  if (body.followUpAt !== undefined) {
    if (body.followUpAt === null) data.followUpAt = null
    else {
      const d = new Date(body.followUpAt)
      if (!Number.isFinite(d.getTime())) return NextResponse.json({ error: 'invalid followUpAt' }, { status: 400 })
      data.followUpAt = d
    }
  }
  if (body.followUpDone !== undefined) data.followUpDone = !!body.followUpDone
  if (body.type !== undefined) {
    if (!TYPE_VALUES.has(body.type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    data.type = body.type as OutreachType
  }
  if (body.occurredAt !== undefined) {
    const d = new Date(body.occurredAt)
    if (!Number.isFinite(d.getTime())) return NextResponse.json({ error: 'invalid occurredAt' }, { status: 400 })
    data.occurredAt = d
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const updated = await prisma.outreachActivity.update({
    where: { id },
    data,
    include: {
      createdBy: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
      company: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const auth = await authorize(id, session.user.email)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 404 ? 'not found' : 'forbidden' }, { status: auth.status })

  await prisma.outreachActivity.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
