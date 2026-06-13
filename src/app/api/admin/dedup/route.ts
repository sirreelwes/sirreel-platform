/**
 * GET /api/admin/dedup
 *
 * Returns the clustered dedup queue. Admin-gated via
 * src/lib/people/dedupAccess.ts (Wes + Dani hardcoded allowlist with
 * env override — same shape as HR's allowlist).
 *
 * Query:
 *   ?includeSuppressed=1  → also returns clusters previously marked
 *                          "shared office line" (Person.dedupSuppressedAt
 *                          set on every member). Off by default.
 *
 * Response:
 *   {
 *     clusters: ClusterWithRefs[],       // sorted: EMAIL first, then by review-queue order
 *     counts: { likelyDupe, uncertain, officeMainline, suppressed, totalOpen }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDedupAccess } from '@/lib/people/dedupAccess'
import { buildClusters } from '@/lib/people/buildClusters'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate

  const includeSuppressed = req.nextUrl.searchParams.get('includeSuppressed') === '1'
  const [open, suppressedSet] = await Promise.all([
    buildClusters({ includeSuppressed }),
    includeSuppressed
      ? Promise.resolve(null)
      : buildClusters({ includeSuppressed: true }),
  ])

  const counts = {
    likelyDupe: open.filter((c) => c.classification === 'LIKELY_DUPE').length,
    uncertain: open.filter((c) => c.classification === 'UNCERTAIN').length,
    officeMainline: open.filter((c) => c.classification === 'LIKELY_OFFICE_MAINLINE').length,
    // Suppressed = clusters where at least one member is dedupSuppressedAt
    // AND the cluster wouldn't otherwise appear in the open queue. Cheap
    // proxy: count rows with the flag set.
    suppressed: await prisma.person.count({ where: { dedupSuppressedAt: { not: null } } }),
    totalOpen: open.length,
  }
  // suppressedSet only used if we're hiding them — to compute the
  // "N suppressed" header count from the diff. Left here for clarity.
  void suppressedSet

  return NextResponse.json({ clusters: open, counts })
}
