import Anthropic from '@anthropic-ai/sdk'
import type { CadenceState, ReplyClassification } from '@prisma/client'
import { REPLY_CLASSIFIER_MODEL } from '@/lib/ai/models'

/**
 * AI reply classifier — categorises an inbound email reply on an existing
 * quote thread so the cadence engine can decide whether to pause, advance,
 * or escalate. Prompt + confidence handling come from CRH brief §4 and §13.
 *
 * Behavior contract (matches brief §13 §4 §3):
 *   - Always returns a ReplyClassification; never throws past the caller.
 *     A model failure or JSON parse error yields { classification:
 *     'UNCLEAR', confidence: 0, reasoning: '...' } so downstream cadence
 *     logic can fall back safely.
 *   - Confidence < 0.75 → caller-side, treat as ACTIVE_DISCUSSION (cadence
 *     pauses). This module surfaces both the original model classification
 *     and a `effectiveClassification` field that has the 0.75 floor applied,
 *     so consumers can choose which to act on.
 *   - confidence 0.75–0.85 → applied as-is; the brief calls this a "flag
 *     for rep review" band but flagging is a UI/wiring concern, not a
 *     classifier concern.
 */

const MODEL = REPLY_CLASSIFIER_MODEL
const MAX_TOKENS = 600

const SYSTEM_PROMPT = `You are classifying an inbound email reply from a client in the context of an active quote. The client received a quote and has now replied.

Classify into ONE of:

PURE_ACKNOWLEDGMENT — Client acknowledges receipt without booking or asking questions. Examples: "Thanks", "Got it, will review", "Appreciate it, will be in touch", "Let me check with my team."

ACTIVE_DISCUSSION — Client has questions, change requests, or substantive back-and-forth. Examples: "Can you swap the box truck for a cube?", "What about insurance coverage?", "What if we extend by 2 days?"

BOOKING_SIGNAL — Client signals intent to book. Examples: "Looks great, let's go", "Send the contract", "How do we sign?", "We're in."

EXPLICIT_REJECTION — Client declines or chooses another vendor. Examples: "Going with another vendor", "Project got cancelled", "Not for us, thanks anyway."

UNCLEAR — Reply is ambiguous, mixed signals, or doesn't fit cleanly.

Respond with ONLY a JSON object (no markdown fences, no preamble):

{
  "classification": "PURE_ACKNOWLEDGMENT" | "ACTIVE_DISCUSSION" | "BOOKING_SIGNAL" | "EXPLICIT_REJECTION" | "UNCLEAR",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<one short sentence>"
}`

export interface ClassifyReplyInput {
  jobName?: string | null
  quoteSentAt?: Date | null
  /** Order's current cadence state at the time of the reply. */
  currentState?: CadenceState | null
  subject: string
  bodyText: string
}

export interface ClassifyReplyResult {
  /** The classification the model returned (no confidence-floor adjustment). */
  classification: ReplyClassification
  /** confidence < 0.75 collapses to ACTIVE_DISCUSSION per brief §13. */
  effectiveClassification: ReplyClassification
  confidence: number
  reasoning: string
}

const VALID: ReplyClassification[] = [
  'PURE_ACKNOWLEDGMENT',
  'ACTIVE_DISCUSSION',
  'BOOKING_SIGNAL',
  'EXPLICIT_REJECTION',
  'UNCLEAR',
]

function clampBody(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[…truncated…]'
}

function buildUserPrompt(input: ClassifyReplyInput): string {
  const lines: string[] = []
  lines.push('Quote context:')
  lines.push(`- Job: ${input.jobName || '(unknown)'}`)
  if (input.quoteSentAt) lines.push(`- Quote sent: ${input.quoteSentAt.toISOString()}`)
  if (input.currentState) lines.push(`- Current state: ${input.currentState}`)
  lines.push('')
  lines.push(`Subject: ${input.subject || '(no subject)'}`)
  lines.push('')
  lines.push('Client reply content:')
  lines.push(clampBody(input.bodyText || '(empty)'))
  lines.push('')
  lines.push('Respond in JSON.')
  return lines.join('\n')
}

function fallback(reason: string): ClassifyReplyResult {
  return {
    classification: 'UNCLEAR',
    effectiveClassification: 'ACTIVE_DISCUSSION',
    confidence: 0,
    reasoning: reason,
  }
}

// Lazy client — same rationale as messageExtractor.ts (avoids the
// module-load env-capture bug that bit tsx-run scripts).
function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export async function classifyReply(input: ClassifyReplyInput): Promise<ClassifyReplyResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallback('ANTHROPIC_API_KEY not set')
  }
  const client = getClient()
  let raw: string
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    })
    raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[reply-classifier] Anthropic call failed:', reason)
    return fallback(`Anthropic error: ${reason}`)
  }

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let parsed: { classification?: unknown; confidence?: unknown; reasoning?: unknown }
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.error('[reply-classifier] JSON parse failed. Raw:', raw)
    return fallback('JSON parse failed')
  }

  const classification = typeof parsed.classification === 'string' && (VALID as string[]).includes(parsed.classification)
    ? (parsed.classification as ReplyClassification)
    : 'UNCLEAR'
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : ''

  // CRH brief §13: confidence < 0.75 → never auto-transition; treat as
  // ACTIVE_DISCUSSION so cadence pauses and the rep handles it.
  const effectiveClassification: ReplyClassification = confidence < 0.75 ? 'ACTIVE_DISCUSSION' : classification

  return { classification, effectiveClassification, confidence, reasoning }
}
