import { NextRequest, NextResponse } from 'next/server'
import { conversationActor, loadConversation } from '@/lib/email/jobConversation'

export const dynamic = 'force-dynamic'

/**
 * GET /api/jobs/[id]/conversation — the job's one conversation: every
 * email filed to the job (canonical copies only) merged with the internal
 * notes, oldest first, each row with who wrote it and which lane it is in;
 * plus the claim, the subject every send carries, and the job address.
 *
 * Read-only. The composer posts to /api/jobs/[id]/email (the Phase 1
 * on-thread send), notes to ./notes, the claim to ./claim.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await conversationActor()
  if (!me) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const conversation = await loadConversation(params.id)
  if (!conversation) return NextResponse.json({ ok: false, error: 'job not found' }, { status: 404 })
  return NextResponse.json({ ok: true, me: { id: me.id, name: me.name, email: me.email, role: me.role }, ...conversation })
}
