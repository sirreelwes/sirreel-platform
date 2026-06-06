/**
 * Parse a pasted (forwarded) email chain into the structured fields
 * the claim-onboarding form needs.
 *
 * Mirrors the messageExtractor pattern (lib/ai/messageExtractor.ts):
 *   - lazy client construction (don't capture process.env at module
 *     load — the May 2026 backfill incident learned that lesson)
 *   - strict JSON output, code-fence-tolerant parse
 *   - defensive try/catch so a bad LLM response collapses to nulls
 *     instead of throwing past the caller
 *
 * Money fields are in scope, so we use Sonnet (not Haiku) for
 * accuracy. The marginal cost is worth it for the deductible /
 * settlement extraction that drives the client-exposure math.
 *
 * The function returns a FALLBACK (all-nulls) when the Anthropic
 * key is missing or the parse fails — the form still works in
 * "Enter manually" mode in those cases.
 */

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2000

export interface ParsedClaim {
  clientCompanyName: string | null
  carrierName: string | null
  carrierClaimNumber: string | null
  policyNumber: string | null
  adjusterName: string | null
  adjusterEmail: string | null
  adjusterPhone: string | null
  lossDescription: string | null
  dateOfLoss: string | null // YYYY-MM-DD
  lossAmount: number | null
  acvReceived: number | null
  depreciationApplied: number | null
  deductibleAmount: number | null
  totalDemand: number | null
  amountOffered: number | null
  amountSettled: number | null
  statusGuess:
    | 'DRAFT' | 'READY_TO_SEND' | 'SUBMITTED' | 'ACKNOWLEDGED'
    | 'NEGOTIATING' | 'SETTLED' | 'DENIED' | 'ESCALATED' | 'CLOSED'
    | null
}

const FALLBACK: ParsedClaim = {
  clientCompanyName: null,
  carrierName: null,
  carrierClaimNumber: null,
  policyNumber: null,
  adjusterName: null,
  adjusterEmail: null,
  adjusterPhone: null,
  lossDescription: null,
  dateOfLoss: null,
  lossAmount: null,
  acvReceived: null,
  depreciationApplied: null,
  deductibleAmount: null,
  totalDemand: null,
  amountOffered: null,
  amountSettled: null,
  statusGuess: null,
}

const VALID_STATUSES = new Set<ParsedClaim['statusGuess']>([
  'DRAFT', 'READY_TO_SEND', 'SUBMITTED', 'ACKNOWLEDGED',
  'NEGOTIATING', 'SETTLED', 'DENIED', 'ESCALATED', 'CLOSED',
])

const PROMPT = `You are extracting fields from a pasted email correspondence chain about an insurance claim. The chain is typically a forward from SirReel's claims rep that contains earlier messages between SirReel and an insurance carrier's adjuster.

Output STRICT JSON only — no prose, no markdown fences, no commentary. The JSON must conform exactly to this shape:

{
  "clientCompanyName": string | null,
  "carrierName": string | null,
  "carrierClaimNumber": string | null,
  "policyNumber": string | null,
  "adjusterName": string | null,
  "adjusterEmail": string | null,
  "adjusterPhone": string | null,
  "lossDescription": string | null,
  "dateOfLoss": string | null,
  "lossAmount": number | null,
  "acvReceived": number | null,
  "depreciationApplied": number | null,
  "deductibleAmount": number | null,
  "totalDemand": number | null,
  "amountOffered": number | null,
  "amountSettled": number | null,
  "statusGuess": "DRAFT" | "READY_TO_SEND" | "SUBMITTED" | "ACKNOWLEDGED" | "NEGOTIATING" | "SETTLED" | "DENIED" | "ESCALATED" | "CLOSED" | null
}

Field rules:

- clientCompanyName: the RENTER company (SirReel's CLIENT). NOT SirReel itself and NOT the insurance carrier. Look for production-company names like "Acme Studios", "Lune Films", "Untitled HBO Pilot", or names referenced as "the renter" / "the client" / "the producer".

- carrierName: the insurance company filed against (e.g. "Intact Insurance", "Federated Insurance", "Travelers"). The party the renter's policy is with.

- carrierClaimNumber: the CARRIER'S own claim number — typically alphanumeric with mixed letters/digits (e.g. "0AB459860", "FED-44821-D", "CLM-998877"). Distinct from any internal SirReel reference (SR-CLM-NNNN) and from the renter's policyNumber.

- policyNumber: the renter's insurance policy number — typically more numeric / structured than the claim number (e.g. "POL-9876", "1234567890").

- adjusterName / adjusterEmail / adjusterPhone: the carrier-side adjuster handling the claim. NOT the SirReel rep. Look for signature blocks of inbound messages from a carrier domain.

- lossDescription: a SHORT (1-3 sentence) plain-English summary of what was damaged / lost / stolen. Pull from the body, not the subject line alone. Examples: "Cargo van scrape during pickup; driver-side panel damage." / "Roof panel crushed by low-clearance impact; AC unit destroyed."

- dateOfLoss: the date the incident occurred, formatted YYYY-MM-DD. NOT the date the email was sent and NOT the date the claim was filed. Only fill when an explicit date is mentioned. If only relative ("last Friday", "this morning") is mentioned, leave null.

- Money fields (lossAmount, acvReceived, depreciationApplied, deductibleAmount, totalDemand, amountOffered, amountSettled):
  - Numbers only, no currency symbol. "$12,500.00" → 12500.
  - lossAmount: the replacement-cost / loss-amount anchor (what the equipment was insured for).
  - acvReceived: the carrier's pre-negotiation valuation (Actual Cash Value).
  - depreciationApplied: dollar value of depreciation the carrier removed from loss to arrive at ACV.
  - deductibleAmount: the renter's deductible per their policy.
  - totalDemand: what SirReel demanded from the carrier.
  - amountOffered: the carrier's current standing offer.
  - amountSettled: the final settled amount IF the chain shows a closed deal. amountSettled should be GROSS (before deductible). Only set when there's explicit "settled" / "final payment" / "closed out" language. Otherwise null.

- statusGuess: where the claim sits at the END of the chain. Choose:
  - DRAFT: the chain shows nothing has been sent to the carrier yet (rare for pastes — most pastes are after submission).
  - READY_TO_SEND: SirReel has prepared the claim package but hasn't sent it.
  - SUBMITTED: SirReel sent the demand and the carrier has acknowledged receipt; no offer yet.
  - ACKNOWLEDGED: carrier has confirmed assignment of an adjuster but no offer / movement yet.
  - NEGOTIATING: carrier has made an offer; SirReel is countering, or the parties are exchanging numbers.
  - SETTLED: chain ends with a final settlement amount agreed and a closure note.
  - DENIED: carrier has rejected the claim.
  - ESCALATED: SirReel has kicked the dispute up a level (supervisor / counsel / state regulator).
  - CLOSED: chain is wrapped up administratively after settlement.
  Default to "SUBMITTED" when the chain shows back-and-forth but no clear settlement / denial / escalation language.

Critical rules:
- If a field isn't explicitly present, set it to null. Do NOT infer money figures from context. Do NOT guess dates from relative wording.
- Output ONLY the JSON object. No explanation, no preamble, no markdown.
`

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

let warnedKeyMissing = false
function warnKeyMissing(): void {
  if (warnedKeyMissing) return
  warnedKeyMissing = true
  console.error('[parse-pasted-claim] ANTHROPIC_API_KEY is missing or empty — every parse will return FALLBACK.')
}

// Coerce LLM output to the typed shape. String fields get trimmed.
// Money fields get Number()-coerced. Anything unparseable goes to null.
function coerce(raw: unknown): ParsedClaim {
  if (!raw || typeof raw !== 'object') return FALLBACK
  const r = raw as Record<string, unknown>

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown): number | null => {
    if (v == null) return null
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const cleaned = v.replace(/[$,\s]/g, '')
      const n = Number(cleaned)
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  const date = (v: unknown): string | null => {
    const s = str(v)
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    return s
  }
  const status = (v: unknown): ParsedClaim['statusGuess'] => {
    const s = str(v)?.toUpperCase()
    return s && VALID_STATUSES.has(s as ParsedClaim['statusGuess']) ? (s as ParsedClaim['statusGuess']) : null
  }

  return {
    clientCompanyName: str(r.clientCompanyName),
    carrierName: str(r.carrierName),
    carrierClaimNumber: str(r.carrierClaimNumber),
    policyNumber: str(r.policyNumber),
    adjusterName: str(r.adjusterName),
    adjusterEmail: str(r.adjusterEmail),
    adjusterPhone: str(r.adjusterPhone),
    lossDescription: str(r.lossDescription),
    dateOfLoss: date(r.dateOfLoss),
    lossAmount: num(r.lossAmount),
    acvReceived: num(r.acvReceived),
    depreciationApplied: num(r.depreciationApplied),
    deductibleAmount: num(r.deductibleAmount),
    totalDemand: num(r.totalDemand),
    amountOffered: num(r.amountOffered),
    amountSettled: num(r.amountSettled),
    statusGuess: status(r.statusGuess),
  }
}

export async function parsePastedClaim(text: string): Promise<ParsedClaim> {
  if (!process.env.ANTHROPIC_API_KEY) {
    warnKeyMissing()
    return FALLBACK
  }
  const cleaned = text.trim()
  if (cleaned.length === 0) return FALLBACK
  // Truncate at 100k chars so a paste of an entire mailbox doesn't
  // blow past the Sonnet context window. The relevant signal is
  // almost always in the first few messages of the chain.
  const truncated = cleaned.slice(0, 100_000)

  let rawOut: string
  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'user', content: `${PROMPT}\n\n--- PASTED EMAIL CHAIN ---\n\n${truncated}` },
      ],
    })
    rawOut = res.content[0]?.type === 'text' ? res.content[0].text : ''
  } catch (err) {
    console.error('[parse-pasted-claim] Anthropic call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  // Strip code fences defensively — Sonnet usually respects the
  // "no fences" instruction but we cost nothing by being safe.
  const stripped = rawOut
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    console.error('[parse-pasted-claim] JSON parse failed. Raw:', rawOut.slice(0, 500))
    return FALLBACK
  }

  return coerce(parsed)
}
