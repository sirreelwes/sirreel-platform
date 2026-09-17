import { NextRequest, NextResponse } from 'next/server'
import { addNote, conversationActor } from '@/lib/email/jobConversation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/conversation/notes — an internal note in the job's
 * conversation. Never sent anywhere: the client cannot see it, no email
 * goes out. `@Name` in the body records a mention (matched against HQ
 * users); `anchoredEmailMessageId` hangs the note under one message.
 * `urgent: true` reaches every tagged person right now — a text to the
 * mobile on file, else an email — and is refused when nobody is tagged.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await conversationActor()
  if (!me) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const payload = (await req.json().catch(() => ({}))) as { body?: unknown; anchoredEmailMessageId?: unknown; urgent?: unknown }
  const r = await addNote({
    jobId: params.id,
    actor: me,
    body: payload.body,
    anchoredEmailMessageId: typeof payload.anchoredEmailMessageId === 'string' ? payload.anchoredEmailMessageId : null,
    urgent: payload.urgent === true,
  })
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, note: r.note })
}
