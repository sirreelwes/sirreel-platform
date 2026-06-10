/**
 * Parse an inbound hr@ email body into a structured snapshot the
 * triage UI consumes. Sonnet — same pattern as parsePastedClaim:
 *
 *   - Lazy Anthropic client (don't capture env at module load).
 *   - Strict JSON output, code-fence-tolerant parse.
 *   - Defensive try/catch — bad LLM response collapses to FALLBACK
 *     rather than throwing past the caller.
 *
 * Returns category, a short one-line summary, an employee name guess
 * (matched downstream against the Employee table), and a confidence
 * score. Money / medical specifics are NOT extracted — the structured
 * fields are intentionally limited; the body lives on HrEmail and
 * Wes/Dani open it directly when they need detail. Less structured
 * extraction = smaller blast radius if the parse is wrong on a
 * medical or discipline case.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { HrCategory } from '@prisma/client'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 800

export interface ParsedHrEmail {
  employeeNameGuess: string | null
  category: HrCategory | null
  summary: string | null
  confidence: number
  reasoning: string | null
}

const FALLBACK: ParsedHrEmail = {
  employeeNameGuess: null,
  category: null,
  summary: null,
  confidence: 0,
  reasoning: null,
}

const VALID_CATEGORIES: HrCategory[] = [
  'TIMESHEET', 'PTO_LEAVE', 'MEDICAL', 'PAYROLL', 'BENEFITS',
  'DISCIPLINE', 'COMPLAINT', 'ONBOARDING', 'RESIGNATION', 'OTHER',
]
const VALID_SET = new Set<string>(VALID_CATEGORIES)

const PROMPT = `You are categorizing an HR email at SirReel Production Vehicles. Output STRICT JSON only — no prose, no markdown fences.

{
  "employeeNameGuess": string | null,
  "category": "TIMESHEET" | "PTO_LEAVE" | "MEDICAL" | "PAYROLL" | "BENEFITS" | "DISCIPLINE" | "COMPLAINT" | "ONBOARDING" | "RESIGNATION" | "OTHER",
  "summary": string,
  "confidence": number,
  "reasoning": string
}

Rules:

- employeeNameGuess: the SirReel employee the message is about (NOT the sender if the sender is e.g. a payroll provider; the human being discussed). Null when no specific employee is identifiable.

- category — pick exactly one:
  TIMESHEET    timesheet submission, missed punch, time-tracking question.
  PTO_LEAVE    vacation request, sick day, FMLA, jury duty, bereavement.
  MEDICAL      doctor's note, workers' comp injury, return-to-work clearance, health insurance claim about a specific employee.
  PAYROLL      paycheck question, direct deposit, W-2/1099, garnishment, ADP/Gusto/etc. notification about an employee's pay.
  BENEFITS     401k, health insurance enrollment / open enrollment, retirement, COBRA.
  DISCIPLINE   write-up, performance improvement plan, warning, termination notice.
  COMPLAINT    employee-to-employee complaint, harassment, hostile environment, EEOC.
  ONBOARDING   new hire paperwork, I-9, offer letter signed, first day logistics.
  RESIGNATION  two-weeks notice, voluntary departure.
  OTHER        none of the above clearly applies.

- summary: ONE short sentence (max 120 chars). Plain English, no PII beyond the employee's first name when needed.

- confidence: 0..1. < 0.5 means "I'm guessing — needs human review."

- reasoning: ONE short sentence on the strongest signal you used.

Critical: output ONLY the JSON object. No code fences, no preamble, no explanation outside the JSON.
`

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

let warnedKeyMissing = false
function warnKeyMissing(): void {
  if (warnedKeyMissing) return
  warnedKeyMissing = true
  console.error('[hr/parseHrEmail] ANTHROPIC_API_KEY missing — every parse will return FALLBACK.')
}

function coerce(raw: unknown): ParsedHrEmail {
  if (!raw || typeof raw !== 'object') return FALLBACK
  const r = raw as Record<string, unknown>
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t.length === 0 ? null : t.slice(0, max)
  }
  const cat = typeof r.category === 'string' && VALID_SET.has(r.category)
    ? (r.category as HrCategory) : null
  let conf = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence)
  if (!Number.isFinite(conf)) conf = 0
  conf = Math.max(0, Math.min(1, conf))
  return {
    employeeNameGuess: str(r.employeeNameGuess, 120),
    category: cat,
    summary: str(r.summary, 240),
    confidence: conf,
    reasoning: str(r.reasoning, 300),
  }
}

export async function parseHrEmail(text: string): Promise<ParsedHrEmail> {
  if (!process.env.ANTHROPIC_API_KEY) {
    warnKeyMissing()
    return FALLBACK
  }
  const cleaned = text.trim()
  if (cleaned.length === 0) return FALLBACK
  const truncated = cleaned.slice(0, 100_000)

  let raw: string
  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'user', content: `${PROMPT}\n\n--- HR EMAIL BODY ---\n\n${truncated}` },
      ],
    })
    raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
  } catch (err) {
    console.error('[hr/parseHrEmail] Anthropic call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    return coerce(JSON.parse(stripped))
  } catch {
    console.error('[hr/parseHrEmail] JSON parse failed. Raw (first 400):', raw.slice(0, 400))
    return FALLBACK
  }
}
