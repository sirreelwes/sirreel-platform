import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { CANONICAL_CLAUSES } from '@/lib/contracts/contractClauses'
import { loadNegotiationPlaybook } from '@/lib/contracts/reviewPrompt'
import { clauseMatches, type MarkupManifest } from '@/lib/contracts/annotationManifest'
import { REVIEW_MODEL } from '@/lib/ai/models'

// Native fetch for the same reason as runReview.ts — the SDK 0.39
// node-fetch shim read-ETIMEDOUTs on large uploads.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: globalThis.fetch as any })

/**
 * Delimiter the assistant is instructed to wrap OPERATIVE draft clause
 * text in. The UI parses these blocks and renders an explicit
 * "Apply as Counter text" button — nothing is ever applied
 * automatically, and nothing in a Discuss thread reaches the client.
 */
export const COUNTER_DRAFT_OPEN = '<counter-draft>'
export const COUNTER_DRAFT_CLOSE = '</counter-draft>'

const DISCUSS_SYSTEM_PROMPT = `You are SirReel Studio Rentals' contract-negotiation assistant, discussing ONE clause of a client-redlined rental agreement with a SirReel operator. The operator asks questions, tests negotiation positions, and requests draft counter language. Nothing you write is sent to the client — a human reviews and applies text explicitly.

Ground rules:
- Be direct and concrete. Cite the playbook (below) when it covers the clause; say so when it doesn't.
- SirReel's Non-Negotiable Hard Limits are absolute (third-party-only indemnity, liability-cap weakening, insurance minimums, LA/JAMS arbitration, California law). Never draft language that concedes one, and warn the operator if they ask for it.
- When you provide DRAFT COUNTER CLAUSE TEXT — complete, operative legal language intended for the counter-PDF — wrap EXACTLY that text (and nothing else) in ${COUNTER_DRAFT_OPEN}...${COUNTER_DRAFT_CLOSE} tags. Use the tags ONLY for complete clause text in the baseline's legal voice; never for commentary, options, fragments, or questions. At most one draft block per reply unless the operator asks for alternatives.
- Keep replies tight: a few sentences of analysis, then the draft block when one was requested.`

export interface DiscussClauseInput {
  reviewId: string
  /** Thread key — the AI change's clause ref, or "#<changeIndex>" fallback. */
  clauseKey: string
  /** Index of the change in aiResponse.changes, for context lookup. */
  changeIndex: number
  message: string
  userId: string
}

export type DiscussClauseResult =
  | { ok: true; userMessage: PersistedMessage; assistantMessage: PersistedMessage }
  | { ok: false; error: string; status: number }

export interface PersistedMessage {
  id: string
  clauseKey: string
  role: string
  content: string
  createdAt: Date
  createdBy: { id: string; name: string } | null
}

const MESSAGE_SELECT = {
  id: true,
  clauseKey: true,
  role: true,
  content: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const

/**
 * One Discuss turn: persist the operator's message, call Claude with
 * full clause context (canonical baseline, markup ground truth for the
 * clause, the AI change record, playbook, prior thread), persist and
 * return the reply. The user message is kept even if the model call
 * fails — the operator can retry without retyping.
 */
export async function discussClause(input: DiscussClauseInput): Promise<DiscussClauseResult> {
  const { reviewId, clauseKey, changeIndex, userId } = input
  const message = input.message.trim()
  if (!message) return { ok: false, error: 'message required', status: 400 }
  if (message.length > 4000) return { ok: false, error: 'message too long (4000 char max)', status: 400 }

  const review = await prisma.contractReview.findFirst({
    where: { id: reviewId, deletedAt: null },
    select: {
      id: true,
      aiResponse: true,
      annotationManifest: true,
      company: { select: { name: true } },
    },
  })
  if (!review) return { ok: false, error: 'Not found', status: 404 }

  const changes = Array.isArray((review.aiResponse as any)?.changes)
    ? ((review.aiResponse as any).changes as any[])
    : []
  const change = changes[changeIndex] ?? null

  const priorThread = await prisma.reviewClauseMessage.findMany({
    where: { reviewId, clauseKey },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
    take: 40,
  })

  const userMessage = await prisma.reviewClauseMessage.create({
    data: { reviewId, clauseKey, role: 'user', content: message, createdById: userId },
    select: MESSAGE_SELECT,
  })

  // ── clause context ──
  const clauseRef = change ? String(change.clause ?? '').trim() : clauseKey.replace(/^#/, '')
  const canonical = CANONICAL_CLAUSES.find((c) => c.ref === clauseRef)
  const manifest = review.annotationManifest as unknown as MarkupManifest | null
  const struck = manifest?.struck?.filter((s) => clauseMatches(s.clauseGuess, clauseRef)) ?? []
  const inserted = manifest?.inserted?.filter((n) => clauseMatches(n.clauseGuess, clauseRef)) ?? []
  const playbook = await loadNegotiationPlaybook()

  const contextParts: string[] = [
    `CLAUSE UNDER DISCUSSION: ${clauseRef || clauseKey}${review.company?.name ? ` — client: ${review.company.name}` : ''}`,
  ]
  if (canonical) {
    contextParts.push(`CANONICAL BASELINE §${canonical.ref} (${canonical.title}):\n${canonical.body}`)
  }
  if (struck.length > 0) {
    contextParts.push(
      'MARKUP GROUND TRUTH — client physically struck (deterministic PDF annotation extraction):\n' +
        struck.map((s) => `- p${s.page}: "${s.text}"`).join('\n'),
    )
  }
  if (inserted.length > 0) {
    contextParts.push(
      'MARKUP GROUND TRUTH — client inserted notes:\n' +
        inserted.map((n) => `- p${n.page}: "${n.text}"`).join('\n'),
    )
  }
  if (change) {
    contextParts.push(
      `AI REVIEW RECORD FOR THIS CHANGE:\n` +
        `- type: ${change.type}\n` +
        `- description: ${change.description ?? ''}\n` +
        `- client proposed (AI-transcribed): ${change.proposed ?? ''}\n` +
        `- reasoning: ${change.reasoning ?? ''}\n` +
        `- suggested counter: ${change.suggestedCounter ?? ''}\n` +
        `- counter reasoning: ${change.counterReasoning ?? ''}`,
    )
  }
  if (playbook) {
    contextParts.push(`SIRREEL NEGOTIATION PLAYBOOK (authoritative for positions):\n${playbook}`)
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user' as const, content: `Context for this discussion (reference material, not a question):\n\n${contextParts.join('\n\n')}` },
    { role: 'assistant' as const, content: 'Understood — I have the clause context. What would you like to discuss?' },
    ...priorThread.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    })),
    { role: 'user' as const, content: message },
  ]

  let replyText = ''
  try {
    const response = await client.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 2000,
      system: DISCUSS_SYSTEM_PROMPT,
      messages,
    })
    replyText = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  } catch (err) {
    console.error('[contract-review][discuss] model call failed:', err)
    return { ok: false, error: 'Assistant call failed — your message was saved, try again.', status: 502 }
  }
  if (!replyText) {
    return { ok: false, error: 'Assistant returned no text — your message was saved, try again.', status: 502 }
  }

  const assistantMessage = await prisma.reviewClauseMessage.create({
    data: { reviewId, clauseKey, role: 'assistant', content: replyText },
    select: MESSAGE_SELECT,
  })

  return { ok: true, userMessage, assistantMessage }
}
