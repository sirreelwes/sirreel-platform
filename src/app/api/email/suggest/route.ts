import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { EMAIL_SUGGEST_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'

export const dynamic = 'force-dynamic'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * POST /api/email/suggest
 *
 * The button behind the blank compose box.
 *
 * Wes 2026-09-02 reversed the default: every HQ composer now opens EMPTY —
 * no seeded standard wording, and the templates no longer paste "Hi <First>,"
 * above whatever the rep writes. Pressing "Suggest with AI" is what puts
 * words on the page, and because nothing is added around them any more, the
 * suggestion has to carry its own greeting.
 *
 * What it is NOT: an autosend. The draft lands in the box, editable, and the
 * rep still presses Send. Nothing here writes, mints or dispatches.
 *
 * The hard rules below are the same ones the Quick Reply AI review enforces
 * (see /api/sales/quick-reply/ai-review): a suggested draft must never make
 * an availability or price claim on a rep's behalf. This endpoint has no
 * fleet truth in front of it, so it may not speak about the fleet at all —
 * specifics are the rep's to add, where a person is accountable for them.
 */

type Kind =
  | 'quote'
  | 'welcome'
  | 'quick-respond'
  | 'quick-reply'
  | 'card-auth'
  | 'followup-order'
  | 'followup-job'
  | 'ask-job-name'

interface Body {
  kind?: string
  /** Recipient's display name — the greeting is addressed to their first name. */
  recipientName?: string | null
  companyName?: string | null
  jobName?: string | null
  /** Follow-ups: which nudge in the cadence this is. */
  stage?: string | null
  /** Follow-ups: ISO date the quote is good through, when known. */
  validUntil?: string | null
  /** Whatever the rep has already typed — the suggestion builds on it
   *  rather than replacing a half-written thought. */
  draft?: string | null
}

/** What this email is FOR, in the rep's own terms. Drives the whole draft. */
function purposeFor(kind: Kind, stage: string | null): string {
  switch (kind) {
    case 'quote':
      return [
        'This email delivers a QUOTE the client asked for. It goes out BEFORE we have the job —',
        'it asks for the work, it does not assume it. A quote snapshot (dates, total) and a button',
        'to the client portal are rendered underneath your words automatically, so do not retype the',
        'numbers, dates or the link — point at them ("it\'s on your portal") and invite a reply if',
        'anything is off.',
      ].join(' ')
    case 'welcome':
      return [
        'This is the FIRST email this client gets from us after reaching out. Introduce SirReel',
        'warmly, say we would love to work with them on this one, and tell them their portal is where',
        'everything for the job will live. The portal button renders underneath automatically.',
      ].join(' ')
    case 'quick-respond':
    case 'quick-reply':
      return [
        'This is a fast first reply to an inbound rental inquiry. Acknowledge the request, sound glad',
        'to hear from them, and ask for whatever would let us quote it properly (production company,',
        'project name, dates, what they need). Say NOTHING about whether we have the gear.',
      ].join(' ')
    case 'ask-job-name':
      return [
        'This email asks the client what the production should be called — the job name — and,',
        'if we do not have it, which production company is booking. Nothing else. Keep it to a few',
        'sentences; a form link where they can answer is rendered underneath automatically.',
      ].join(' ')
    case 'card-auth':
      return [
        'This email asks the client to put a credit card on file so the rental can go out the door.',
        'Keep it short and matter-of-fact. A paragraph explaining that the number goes straight to the',
        'processor, the other ways to pay, and the secure button all render underneath automatically —',
        'do not write those, and NEVER ask them to send a card number by email or phone.',
      ].join(' ')
    case 'followup-order':
    case 'followup-job': {
      const s = (stage || '').toUpperCase()
      if (s === 'STAGE_2')
        return 'This is a second check-in on a quote we sent. Ask whether the dates are still on, and offer to adjust the quote or hold gear if it helps.'
      if (s === 'STAGE_3')
        return 'This is the last check-in before the quote window closes. Say the quote is good through the date given below, and ask whether they want to lock it in — offer to extend if they need more time.'
      return 'This is a first check-in on a quote we already sent. Make sure it landed, and ask whether they have questions or want anything adjusted.'
    }
  }
}

const KINDS: Kind[] = [
  'quote',
  'welcome',
  'quick-respond',
  'quick-reply',
  'card-auth',
  'followup-order',
  'followup-job',
  // Landed alongside this change (another session moved the "ask client for
  // job name" send behind the same review modal) — listed so its composer's
  // Suggest button works the day it ships.
  'ask-job-name',
]

function firstNameOf(full: string | null | undefined): string {
  const n = (full || '').trim()
  if (!n || n.includes('@')) return 'there'
  return n.split(/\s+/)[0]
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const kind = KINDS.find((k) => k === body.kind)
  if (!kind) return NextResponse.json({ ok: false, error: 'unknown email kind' }, { status: 400 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'AI service not configured' }, { status: 503 })
  }

  const recipientFirst = firstNameOf(body.recipientName)
  const agentName = (session.user.name || '').trim() || 'the SirReel team'
  const draft = (body.draft || '').trim()

  const facts = [
    `Recipient's first name: ${recipientFirst}`,
    body.companyName?.trim() ? `Their company: ${body.companyName.trim()}` : null,
    body.jobName?.trim() ? `The production/job: ${body.jobName.trim()}` : null,
    body.validUntil?.trim() ? `The quote is valid through: ${body.validUntil.trim()}` : null,
    `You are writing AS: ${agentName}, a SirReel account rep`,
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `You are drafting a client email for SirReel Studio Rentals, which rents production vehicles, trucks and gear to film and television productions in Los Angeles.

WHAT THIS EMAIL IS FOR:
${purposeFor(kind, body.stage ?? null)}

WHAT YOU KNOW (do not use anything that is not here):
${facts}

HARD RULES — a violation makes the draft unusable:
- Open with a greeting line addressed to ${recipientFirst} (e.g. "Hi ${recipientFirst},"). Nothing is added above your words.
- Do NOT write a sign-off, a signature, a name or a phone number at the end. The template adds "Thanks, ${agentName}" and the footer.
- Do NOT state or imply anything about our availability — no "we have plenty", "no problem", "we've got you covered", no unit counts, no percentages, no promises to hold anything.
- Do NOT state prices, totals, discounts or dates that are not listed above.
- Do NOT invent facts, names, crew, equipment, or history with this client.
- No placeholders or brackets of any kind ([Name], [date], TBD). If you do not know something, write around it.
- No subject line, no markdown, no bullet lists. Plain text paragraphs separated by a blank line.
- Two to four short paragraphs, greeting included. Warm, direct, human — the way a good account rep writes, not marketing copy.
${draft ? `\nTHE REP HAS ALREADY STARTED. Keep their intent, their specifics and their voice; finish and tighten it rather than replacing it:\n"""\n${draft}\n"""\n` : ''}
Return ONLY JSON, exactly: {"body": "the full plain-text email"}`

  try {
    const response = await anthropic.messages.create({
      model: EMAIL_SUGGEST_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    const textBlock = response.content.find((c) => c.type === 'text')
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    const parsed = parseAiJson(raw, { tag: 'email-suggest', stopReason: response.stop_reason }) as {
      body?: unknown
    }
    const suggestion = typeof parsed.body === 'string' ? parsed.body.trim() : ''
    if (!suggestion) {
      return NextResponse.json({ ok: false, error: 'AI returned an empty draft' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, body: suggestion })
  } catch (err) {
    console.error('[email suggest] failed:', err)
    return NextResponse.json({ ok: false, error: 'AI suggestion failed' }, { status: 502 })
  }
}
