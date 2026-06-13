/**
 * POST /api/admin/dedup/reverse
 *
 * One-click reversal of a PersonMerge. Calls the proven reverse
 * primitive in its transaction. Body: { mergeId: string }
 *
 * Admin-gated; reversal failure surfaces the underlying error from
 * the primitive (which has already stamped PersonMerge.reversalErrors
 * for triage).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDedupAccess } from '@/lib/people/dedupAccess'
import { reverseMerge } from '@/lib/people/reverseMerge'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireDedupAccess()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => ({}))) as { mergeId?: unknown }
  if (typeof body.mergeId !== 'string') {
    return NextResponse.json({ error: 'mergeId required' }, { status: 400 })
  }

  try {
    const result = await reverseMerge({ mergeId: body.mergeId, reversedById: gate.id })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
