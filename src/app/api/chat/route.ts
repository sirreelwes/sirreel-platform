import { NextResponse } from 'next/server'
import { conversationActor } from '@/lib/email/jobConversation'
import { chatInboxFor } from '@/lib/email/chatInbox'

export const dynamic = 'force-dynamic'

/**
 * GET /api/chat — every job conversation the signed-in person is IN.
 *
 * Scoped by INCLUSION, never by role (Wes 2026-09-17: "the chats shouldn't
 * be for everyone. It should be for everyone who is included in that
 * chat"). The scoping is done in chatInboxFor against the session user —
 * the request carries no user id to spoof, and there is no "all" mode.
 */
export async function GET() {
  const me = await conversationActor()
  if (!me) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  try {
    const inbox = await chatInboxFor(me)
    return NextResponse.json({ ok: true, me: { id: me.id, name: me.name, email: me.email }, ...inbox })
  } catch (err) {
    console.error('[api/chat]', err)
    return NextResponse.json({ ok: false, error: 'Could not load your chats.' }, { status: 500 })
  }
}
