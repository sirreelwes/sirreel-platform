import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireReadSession } from '@/lib/scheduling/requireReadSession'

export const dynamic = 'force-dynamic'

/**
 * GET /api/scheduling/stage-areas — the areas a stage hold can name.
 *
 * `?picker=quickreply` returns the short list an agent picks from when
 * holding the complex (Wes 2026-08-25): Hospital, Police/Jail, Morgue,
 * LED/Volume Stage, Black Box. That's the bookable footprint — the
 * offices, green rooms and parking are attached later on the job, not
 * chosen while answering an availability email.
 *
 * The rule is "a set inside a stage, or a stage in its own right":
 * parentStage set (a room within Standing Sets) OR kind=STAGE. Anything
 * complex-wide and incidental (offices, green rooms, parking) is
 * excluded. Without a filter the full active list is returned.
 */
export async function GET(req: Request) {
  const denied = await requireReadSession()
  if (denied) return denied

  const picker = new URL(req.url).searchParams.get('picker')
  const areas = await prisma.stageArea.findMany({
    where: {
      isActive: true,
      ...(picker === 'quickreply'
        ? { OR: [{ parentStage: { not: null } }, { kind: 'STAGE' }] }
        : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, kind: true, parentStage: true },
  })
  return NextResponse.json({ areas })
}
