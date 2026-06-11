/**
 * POST /api/crm/outreach — log an OutreachActivity.
 *
 * Body:
 *   {
 *     type: OutreachType,
 *     personId?: string,
 *     companyId?: string,
 *     notes: string,
 *     occurredAt?: ISO string (default: now),
 *     followUpAt?: ISO string | null,
 *   }
 *
 * At least one of personId / companyId is required (app-layer; the
 * DB schema permits both null because the row could survive a
 * SetNull cascade if either reference is later deleted).
 *
 * GET /api/crm/outreach — list outreach activities for a target or a rep.
 *
 * Query params:
 *   personId, companyId        — filter to one target
 *   createdById                — filter to one rep ("My outreach")
 *   pendingFollowUpsOnly=1     — only rows where followUpDone=false AND followUpAt<=now
 *   includeDone=1              — when in followUps mode, include followUpDone=true
 *   take                       — page size (default 50, cap 200)
 *
 * Auth: getServerSession on both. POST resolves to a User so
 * createdById is stamped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { OutreachType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const TYPE_VALUES = new Set<string>(Object.values(OutreachType))

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    type?: string
    personId?: string | null
    companyId?: string | null
    notes?: string
    occurredAt?: string
    followUpAt?: string | null
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  if (!body.type || !TYPE_VALUES.has(body.type)) {
    return NextResponse.json({ error: 'invalid or missing type' }, { status: 400 })
  }
  if (!body.notes || !body.notes.trim()) {
    return NextResponse.json({ error: 'notes required' }, { status: 400 })
  }
  if (!body.personId && !body.companyId) {
    return NextResponse.json(
      { error: 'at least one of personId / companyId required' },
      { status: 400 },
    )
  }

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date()
  if (!Number.isFinite(occurredAt.getTime())) {
    return NextResponse.json({ error: 'invalid occurredAt' }, { status: 400 })
  }
  const followUpAt = body.followUpAt ? new Date(body.followUpAt) : null
  if (followUpAt && !Number.isFinite(followUpAt.getTime())) {
    return NextResponse.json({ error: 'invalid followUpAt' }, { status: 400 })
  }

  const row = await prisma.outreachActivity.create({
    data: {
      type: body.type as OutreachType,
      personId: body.personId ?? null,
      companyId: body.companyId ?? null,
      notes: body.notes.trim(),
      occurredAt,
      followUpAt,
      createdById: user.id,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true } },
      company: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json(row, { status: 201 })
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sp = new URL(req.url).searchParams
  const personId = sp.get('personId')
  const companyId = sp.get('companyId')
  const createdById = sp.get('createdById')
  const pendingFollowUpsOnly = sp.get('pendingFollowUpsOnly') === '1'
  const includeDone = sp.get('includeDone') === '1'
  const take = Math.max(1, Math.min(200, Number(sp.get('take') ?? '50')))

  const where: Record<string, unknown> = {}
  if (personId) where.personId = personId
  if (companyId) where.companyId = companyId
  if (createdById) where.createdById = createdById
  if (pendingFollowUpsOnly) {
    where.followUpAt = { not: null, lte: new Date() }
    if (!includeDone) where.followUpDone = false
  }

  const rows = await prisma.outreachActivity.findMany({
    where,
    orderBy: pendingFollowUpsOnly ? { followUpAt: 'asc' } : { occurredAt: 'desc' },
    take,
    include: {
      createdBy: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
      company: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ rows })
}
