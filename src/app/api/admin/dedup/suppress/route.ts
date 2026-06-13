/**
 * POST /api/admin/dedup/suppress
 *
 * Marks every member of a cluster as "not a dupe — shared office line"
 * by stamping Person.dedupSuppressedAt. The cluster builder filters
 * out flagged rows so the cluster doesn't reappear in the default
 * queue.
 *
 * Body: { personIds: string[] }  (every member of the cluster)
 *
 * Reversible by hand if a reviewer changes their mind: clear
 * Person.dedupSuppressedAt to null. (No reversal endpoint for now —
 * extremely low frequency.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDedupAccess } from '@/lib/people/dedupAccess'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => ({}))) as { personIds?: unknown }
  if (!Array.isArray(body.personIds) || body.personIds.length < 2) {
    return NextResponse.json({ error: 'personIds[] (≥ 2) required' }, { status: 400 })
  }
  const ids = (body.personIds as unknown[]).filter((s): s is string => typeof s === 'string')
  if (ids.length < 2) {
    return NextResponse.json({ error: 'personIds[] (≥ 2 strings) required' }, { status: 400 })
  }

  const result = await prisma.person.updateMany({
    where: { id: { in: ids }, dedupSuppressedAt: null },
    data: { dedupSuppressedAt: new Date() },
  })

  return NextResponse.json({ ok: true, suppressed: result.count })
}
