/**
 * POST /api/outreach/plans/[id]/enroll — put contacts on a sequence.
 *
 * Two refusals that matter more than the happy path:
 *
 *   - The plan must be ACTIVE. Enrolling into a draft schedules mail
 *     nobody has finished writing.
 *   - Nobody may hold two live enrolments on the same plan. Without
 *     that, a rep who selects an overlapping segment twice puts the same
 *     producer on two parallel sequences, and the person receives every
 *     step in duplicate with no way for us to notice.
 *
 * Contacts already on a DIFFERENT active plan are also refused, and said
 * so out loud. Two sequences running at once on one person is the same
 * failure wearing a different name.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { filterSuppressed } from '@/lib/outreach/suppression'

export const dynamic = 'force-dynamic'

const MAX_ENROLL = 500

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email }, select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: planId } = await params
  const plan = await prisma.touchPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, isActive: true, _count: { select: { steps: true } } },
  })
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  if (!plan.isActive) {
    return NextResponse.json(
      { error: `"${plan.name}" is not active yet. Activate it before enrolling anyone.` },
      { status: 409 },
    )
  }
  if (plan._count.steps === 0) {
    return NextResponse.json({ error: 'That plan has no steps.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => null)) as { personIds?: unknown } | null
  const requested = Array.isArray(body?.personIds)
    ? Array.from(new Set(body!.personIds.filter((v): v is string => typeof v === 'string' && !!v)))
    : []
  if (requested.length === 0) return NextResponse.json({ error: 'no contacts selected' }, { status: 400 })
  if (requested.length > MAX_ENROLL) {
    return NextResponse.json(
      { error: `That is ${requested.length} contacts. Enrolment is capped at ${MAX_ENROLL} at a time.` },
      { status: 400 },
    )
  }

  const people = await prisma.person.findMany({
    where: { id: { in: requested } },
    select: { id: true, email: true },
  })

  // Suppressed contacts never enter a sequence. Catching it here rather
  // than at each send means the counts a rep sees are honest from the
  // start, instead of a sequence that quietly does nothing.
  const { sendable } = await filterSuppressed(people.map((p) => p.email))
  const allowed = new Set(sendable)

  const alreadyActive = await prisma.touchPlanEnrollment.findMany({
    where: { personId: { in: people.map((p) => p.id) }, status: 'ACTIVE' },
    select: { personId: true, planId: true, plan: { select: { name: true } } },
  })
  const activeByPerson = new Map(alreadyActive.map((e) => [e.personId, e]))

  const toEnroll: string[] = []
  let suppressed = 0
  let onThisPlan = 0
  let onAnotherPlan = 0

  for (const p of people) {
    if (!allowed.has(p.email.trim().toLowerCase())) { suppressed += 1; continue }
    const existing = activeByPerson.get(p.id)
    if (existing) {
      if (existing.planId === planId) onThisPlan += 1
      else onAnotherPlan += 1
      continue
    }
    toEnroll.push(p.id)
  }

  if (toEnroll.length > 0) {
    await prisma.touchPlanEnrollment.createMany({
      data: toEnroll.map((personId) => ({ planId, personId, ownerId: user.id })),
    })
  }

  return NextResponse.json({
    ok: true,
    enrolled: toEnroll.length,
    skipped: {
      suppressed,
      alreadyOnThisPlan: onThisPlan,
      onAnotherActivePlan: onAnotherPlan,
      notFound: requested.length - people.length,
    },
  })
}
