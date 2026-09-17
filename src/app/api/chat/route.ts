import { NextRequest, NextResponse } from 'next/server'
import { conversationActor } from '@/lib/email/jobConversation'
import { chatInboxFor, searchJobsForChat } from '@/lib/email/chatInbox'

export const dynamic = 'force-dynamic'

/**
 * GET /api/chat — every job conversation the signed-in person is IN.
 *
 * Scoped by INCLUSION, never by role (Wes 2026-09-17: "the chats shouldn't
 * be for everyone. It should be for everyone who is included in that
 * chat"). The scoping is done in chatInboxFor against the session user —
 * the request carries no user id to spoof, and there is no "all" mode.
 *
 * `?q=` adds `found`: jobs matching the search that are NOT already in your
 * list, so a conversation can be started from here on a job you are not in
 * yet. Those are scoped like the /jobs list, not by inclusion — you cannot
 * search for what you may not open anyway.
 */
export async function GET(req: NextRequest) {
  const me = await conversationActor()
  if (!me) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const inbox = await chatInboxFor(me)
    const q = (req.nextUrl.searchParams.get('q') || '').trim()
    const found = q
      ? await searchJobsForChat({ q, excludeJobIds: inbox.rows.map((r) => r.jobId) })
      : []
    return NextResponse.json({ ok: true, me: { id: me.id, name: me.name, email: me.email }, found, ...inbox })
  } catch (err) {
    console.error('[api/chat]', err)
    return NextResponse.json({ ok: false, error: 'Could not load your chats.' }, { status: 500 })
  }
}
