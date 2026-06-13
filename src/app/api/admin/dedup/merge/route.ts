/**
 * POST /api/admin/dedup/merge
 *
 * Calls the proven merge primitive in its transaction. Body:
 *   {
 *     survivorId: string,
 *     loserId: string,
 *     canonicalEmail?: string,            // default survivor's lowercased
 *     fieldOverrides?: MergeFieldOverrides
 *   }
 *
 * Admin-gated. The mergedById on the audit row is the gate's User.id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDedupAccess } from '@/lib/people/dedupAccess'
import { mergePersons, type MergeFieldOverrides } from '@/lib/people/mergePersons'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => ({}))) as {
    survivorId?: unknown
    loserId?: unknown
    canonicalEmail?: unknown
    fieldOverrides?: unknown
  }
  if (typeof body.survivorId !== 'string' || typeof body.loserId !== 'string') {
    return NextResponse.json({ error: 'survivorId and loserId required' }, { status: 400 })
  }
  const canonicalEmail = typeof body.canonicalEmail === 'string' ? body.canonicalEmail : undefined
  const fieldOverrides = body.fieldOverrides && typeof body.fieldOverrides === 'object'
    ? (body.fieldOverrides as MergeFieldOverrides)
    : undefined

  try {
    const result = await mergePersons({
      survivorId: body.survivorId,
      loserId: body.loserId,
      mergedById: gate.id,
      canonicalEmail,
      fieldOverrides,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 409 for known-shape conflicts (two-User collision; bad
    // canonicalEmail pick). Anything else is a 500.
    const isConflict = /User rows|canonicalEmail/i.test(message)
    return NextResponse.json({ error: message }, { status: isConflict ? 409 : 500 })
  }
}
