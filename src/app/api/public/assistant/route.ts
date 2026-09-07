/**
 * POST /api/public/assistant — the public site's after-hours AI chat.
 *
 * The conversation, prompt, tools and security model live in
 * src/lib/assistant/runAssistant.ts (shared with the SMS webhook since
 * 2026-09-07). This route only validates the request shape and rate-limits
 * by IP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { runAssistant, MAX_MESSAGES, MAX_CHARS, type AssistantTurn } from '@/lib/assistant/runAssistant'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`assistant:${ip}`, { windowMs: 10 * 60 * 1000, max: 20 })
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: 'Too many messages — slow down a moment.' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, error: 'messages[] required' }, { status: 400 })
  }
  if (body.messages.length > MAX_MESSAGES) {
    return NextResponse.json({ ok: false, error: 'Conversation too long — refresh to start over.' }, { status: 400 })
  }

  const turns: AssistantTurn[] = []
  for (const raw of body.messages as Array<{ role?: unknown; content?: unknown }>) {
    const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null
    const content = typeof raw.content === 'string' ? raw.content.slice(0, MAX_CHARS) : null
    if (!role || !content) {
      return NextResponse.json({ ok: false, error: 'invalid message shape' }, { status: 400 })
    }
    turns.push({ role, content })
  }
  if (turns[turns.length - 1].role !== 'user') {
    return NextResponse.json({ ok: false, error: 'last message must be from the user' }, { status: 400 })
  }

  const { reply } = await runAssistant({ turns, ip, channel: 'web' })
  return NextResponse.json({ ok: true, reply })
}
