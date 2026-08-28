/**
 * GET  /api/outreach/plans — every plan with live enrolment counts.
 * POST /api/outreach/plans — create a plan and its steps.
 *
 * A plan is created INACTIVE. A sequence that could enrol people the
 * moment it saves is one that mails somebody while a rep is still
 * drafting step three.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const plans = await prisma.touchPlan.findMany({
    select: {
      id: true, name: true, description: true, isActive: true, createdAt: true,
      steps: { select: { id: true, dayOffset: true, subject: true }, orderBy: { dayOffset: 'asc' } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const counts = await prisma.touchPlanEnrollment.groupBy({
    by: ['planId', 'status'],
    _count: { _all: true },
  })
  const byPlan = new Map<string, Record<string, number>>()
  for (const c of counts) {
    const b = byPlan.get(c.planId) ?? {}
    b[c.status] = c._count._all
    byPlan.set(c.planId, b)
  }

  return NextResponse.json({
    plans: plans.map((p) => ({ ...p, enrollmentCounts: byPlan.get(p.id) ?? {} })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email }, select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    name?: string
    description?: string
    steps?: { dayOffset?: number; subject?: string; bodyTemplate?: string }[]
  } | null
  const name = (body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const steps = (body?.steps ?? []).filter(
    (s) => typeof s.dayOffset === 'number' && s.subject?.trim() && s.bodyTemplate?.trim(),
  )
  if (steps.length === 0) {
    return NextResponse.json({ error: 'a plan needs at least one step' }, { status: 400 })
  }
  const offsets = new Set(steps.map((s) => s.dayOffset))
  if (offsets.size !== steps.length) {
    return NextResponse.json(
      { error: 'Two steps share a day offset. Each step needs its own day, or they would land together.' },
      { status: 400 },
    )
  }

  try {
    const plan = await prisma.touchPlan.create({
      data: {
        name,
        description: body?.description?.trim() || null,
        createdById: user.id,
        steps: {
          create: steps.map((s) => ({
            dayOffset: s.dayOffset as number,
            subject: (s.subject as string).trim(),
            bodyTemplate: (s.bodyTemplate as string).trim(),
          })),
        },
      },
      select: { id: true, isActive: true },
    })
    return NextResponse.json({ ...plan, note: 'Created inactive. Activate it before it can enrol anyone.' }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: `A plan called "${name}" already exists.` }, { status: 409 })
    }
    throw err
  }
}
