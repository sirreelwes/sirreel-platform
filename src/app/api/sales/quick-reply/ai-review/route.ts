import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeQuickReplyAvailability } from '@/lib/sales/quickReply'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface Body {
  message?: string
  categories?: { id: string; name: string; quantity: number }[]
  pickup?: string | null
  return?: string | null
  jobName?: string | null
}

/**
 * POST /api/sales/quick-reply/ai-review
 *
 * AI pass over the rep's CUSTOM Quick Reply message. Reuses the same
 * server-side Anthropic pattern as the quote parser. We RECOMPUTE the real
 * availability (getCategoryAvailability via computeQuickReplyAvailability) so
 * the model sees the TRUE numbers and can catch a contradiction — e.g. the rep
 * wrote "plenty of cube trucks" but only 1 is available.
 *
 * Returns BOTH:
 *   - flags:    string[]  — risks (tone, typos, missing supply link, and most
 *                           importantly availability contradictions)
 *   - polished: string    — a cleaned-up rewrite the rep MAY accept (nothing
 *                           auto-applies; the rep stays in control)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const message = (body.message || '').trim()
  if (!message) return NextResponse.json({ ok: false, error: 'message required' }, { status: 400 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'AI service not configured' }, { status: 503 })
  }

  // REAL availability — the ground truth the rep's claims are checked against.
  const lines = await computeQuickReplyAvailability(body.categories || [], body.pickup ?? null, body.return ?? null)
  const availabilityFacts = lines.length
    ? lines
        .map((l) => `- ${l.name}: requested ${l.requested}, ${l.availableToHold} of ${l.serviceableCount} available for these dates → ${l.status.toUpperCase()}`)
        .join('\n')
    : '(no specific categories requested — availability not yet known)'

  const prompt = `You are reviewing a sales rep's draft reply to a film/production client who asked about renting trucks and gear from SirReel.

GROUND-TRUTH AVAILABILITY (the real numbers — the rep's message must not contradict these):
${availabilityFacts}

THE REP'S DRAFT MESSAGE:
"""
${message}
"""

Do two things and return ONLY JSON:
1. "flags": an array of short, specific issues with the draft. Include tone problems, typos/grammar, anything unprofessional, and — MOST IMPORTANTLY — any AVAILABILITY CONTRADICTION where the draft claims or implies availability that conflicts with the ground-truth above (e.g. saying "plenty" / "lots" / "no problem" about a category that is TIGHT or SHORT). Quote the offending phrase. If there are no issues, return an empty array.
2. "polished": a cleaned-up rewrite of the rep's message — same intent and voice, fixed grammar/tone, and NOT contradicting the real availability. Keep it concise and warm. Do NOT add an availability list or a sign-off (the email template already adds those). Plain text.

Return exactly: {"flags": ["..."], "polished": "..."}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content.find((c) => c.type === 'text')?.type === 'text'
      ? (response.content.find((c) => c.type === 'text') as { text: string }).text
      : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { flags: [], polished: message }
    return NextResponse.json({
      ok: true,
      flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
      polished: typeof parsed.polished === 'string' ? parsed.polished : message,
      availability: lines,
    })
  } catch (err) {
    console.error('[quick-reply ai-review] failed:', err)
    return NextResponse.json({ ok: false, error: 'AI review failed' }, { status: 502 })
  }
}
