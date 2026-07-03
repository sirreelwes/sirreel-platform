import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  computeQuickReplyTiering,
  QUICK_REPLY_POSITIVE_MESSAGE,
  QUICK_REPLY_NONCOMMITTAL_MESSAGE,
} from '@/lib/sales/quickReply'

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
 * fleet-utilization tiering (computeQuickReplyTiering) so the model knows
 * which tier the reply must hold — e.g. the rep wrote "plenty of cube trucks"
 * on a non-committal (tight-fleet) inquiry.
 *
 * The tier framing matches the templated verbiage exactly: the generated
 * prose must never state numbers, percentages, or guarantees, and must never
 * name which categories are tight — that detail is rep-only.
 *
 * Returns BOTH:
 *   - flags:    string[]  — risks (tone, typos, and most importantly
 *                           availability-tier contradictions)
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

  // REAL fleet-utilization tiering — the ground truth the rep's claims are
  // checked against. INTERNAL ONLY: the model uses it to catch contradictions
  // but must never surface the detail in client-facing prose.
  const tiering = await computeQuickReplyTiering(body.categories || [], body.pickup ?? null, body.return ?? null)
  const tierFacts = tiering.lines.length
    ? tiering.lines
        .map((l) => `- ${l.name}: ${l.tight ? 'TIGHT (heavily booked or no active units — do not encourage)' : 'OPEN (comfortable availability)'}`)
        .join('\n')
    : '(dates or categories could not be determined — availability is unknown; treat as NON-COMMITTAL)'
  const tierInstruction =
    tiering.tier === 'positive'
      ? `POSITIVE — the fleet is comfortably open for these dates. The reply may sound encouraging about availability, in the spirit of: "${QUICK_REPLY_POSITIVE_MESSAGE}"`
      : `NON-COMMITTAL — the fleet is tight, a category has no active units, or the dates/categories are unknown. The reply must NOT suggest availability looks good; it should warmly ask for job details and defer confirmation to the team, in the spirit of: "${QUICK_REPLY_NONCOMMITTAL_MESSAGE}"`

  const prompt = `You are reviewing a sales rep's draft reply to a film/production client who asked about renting trucks and gear from SirReel.

Availability replies are TWO-TIER, chosen from live fleet utilization. The required tier for THIS reply is:
${tierInstruction}

INTERNAL per-category picture (for your contradiction check ONLY — never to be stated or hinted at in client-facing text):
${tierFacts}

HARD RULES for anything client-facing (the draft and your rewrite):
- Never state numbers, counts, percentages, or utilization figures.
- Never guarantee availability or promise specific units.
- Never name or imply WHICH categories are tight, short, or heavily booked.

THE REP'S DRAFT MESSAGE:
"""
${message}
"""

Do two things and return ONLY JSON:
1. "flags": an array of short, specific issues with the draft. Include tone problems, typos/grammar, anything unprofessional, and — MOST IMPORTANTLY — any TIER CONTRADICTION or HARD-RULE violation: on a NON-COMMITTAL reply, any claim or implication that availability looks good (e.g. "plenty", "lots", "no problem", "we've got you covered"); on ANY reply, stated numbers/percentages, guarantees, or naming which categories are tight. Quote the offending phrase. If there are no issues, return an empty array.
2. "polished": a cleaned-up rewrite of the rep's message — same intent and voice, fixed grammar/tone, matching the required tier and obeying every hard rule above. Keep it concise and warm. Do NOT add a sign-off (the email template adds one). Plain text.

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
      tiering,
    })
  } catch (err) {
    console.error('[quick-reply ai-review] failed:', err)
    return NextResponse.json({ ok: false, error: 'AI review failed' }, { status: 502 })
  }
}
