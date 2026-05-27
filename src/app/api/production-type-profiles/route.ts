/**
 * GET /api/production-type-profiles
 *
 * List active ProductionTypeProfile rows for the agent-facing picker
 * UI on the new-quote new-Job sub-form and the /jobs/[id] detail
 * page. Session-gated (agent surfaces, not public).
 *
 * Returns the eight seeded rows sorted by sortOrder. Inactive rows
 * are excluded — admins can deactivate a profile to take it out of
 * rotation without deleting historical refs (the FK uses
 * ON DELETE SET NULL so historical Jobs preserve their cache even
 * if a row is hard-deleted later, but soft-deactivation is the
 * recommended path).
 *
 * Eight rows × small payload — no pagination, no filtering.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const profiles = await prisma.productionTypeProfile.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      tier: true,
      upsellPropensity: true,
      priceSensitivity: true,
      salesMode: true,
    },
  })

  return NextResponse.json({ profiles })
}
