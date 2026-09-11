/**
 * POST /api/admin/assistant/ask — AHA for a signed-in HQ user.
 *
 * The same assistant the public chat and the text number run, with the
 * caller's identity taken from their HQ session instead of a phone number.
 * The level follows the HQ role (src/lib/assistant/access.ts): an ADMIN gets
 * the platform memory and recent-activity tools here, which is the
 * continuity path Wes asked for on 2026-09-11 — whoever steps in signs in
 * and asks AHA to explain what has been going on. An admin whose email is
 * on AHA_OWNER_EMAILS also gets the owners' notes (docs/owners/).
 *
 * Session-authenticated, so this is the STRONGER of the two ways to reach
 * the admin tools (a text is only as good as possession of the phone).
 * Every tool use is audited under the user's id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAssistantAccess } from '@/lib/assistant/requireAssistantAccess'
import { runAssistant, MAX_MESSAGES, MAX_CHARS, type AssistantTurn } from '@/lib/assistant/runAssistant'
import { identityForUser } from '@/lib/assistant/senderIdentity'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await requireAssistantAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null
  const raw = Array.isArray(body?.messages) ? body.messages : []
  const turns: AssistantTurn[] = raw
    .filter((m): m is { role: string; content: string } => Boolean(m) && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string')
    .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES)
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'say something first' }, { status: 400 })
  }

  const sender = identityForUser({ id: user.id, name: user.name, role: String(user.role), email: user.email })
  const { reply, toolsUsed } = await runAssistant({ turns, ip: `hq:${user.id}`, channel: 'hq', sender, firstName: sender.firstName })
  if (toolsUsed.length) {
    await prisma.auditLog
      .create({
        data: { userId: user.id, action: 'hq.assistant_tools', entityType: 'User', entityId: user.id, newValues: { tools: toolsUsed, level: sender.level } },
      })
      .catch(() => {})
  }
  return NextResponse.json({ reply, level: sender.level })
}
