/**
 * AI role inference — read what a contact's mail actually says about
 * what they do, when their signature block never told us.
 *
 * Wes, 2026-08-26, on Emmett Tekstra: the role was "discernable from
 * the email chain". Emmett's case was recoverable from his own
 * signature once roleMapping.ts had a bucket for it. The harder class —
 * the one this module exists for — is the contact whose role is only
 * stated in prose, by them ("I'm the PD on this one") or by somebody
 * else on the thread ("looping in Sara, our transpo coordinator").
 * No regex reaches that.
 *
 * ── Scope ───────────────────────────────────────────────────────────
 *
 * Candidates are contacts still sitting at role=OTHER who have inbound
 * mail with a readable body. Everything cheaper runs first (see
 * scripts/backfillContactRolesAi.ts): the stored-title mapper, then
 * titles already sitting in cached `extractedData` from the Pipeline
 * extractor. Only what survives both reaches Haiku.
 *
 * ── The honesty contract ────────────────────────────────────────────
 *
 * This writes into the field the sales team segments and mails on, so
 * the bar is deliberately high:
 *
 *   - The model must return a VERBATIM quote from the supplied text as
 *     evidence. A verdict whose quote does not appear in the source is
 *     discarded as a hallucination — checked in code, not trusted.
 *   - Confidence below MIN_CONFIDENCE is discarded.
 *   - UNKNOWN is an explicitly encouraged answer. The prompt says so.
 *     "I could not tell" is a correct, cheap outcome; a wrong role is
 *     expensive and invisible.
 *   - Only roles in the PersonRole enum are accepted; anything else
 *     collapses to UNKNOWN rather than being coerced to a near-match.
 *
 * Never throws past the caller — every failure path returns UNKNOWN.
 */

import Anthropic from '@anthropic-ai/sdk'
import { MESSAGE_EXTRACTION_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import { PERSON_ROLE_VALUES, type PersonRoleValue } from '@/lib/crm/roleMapping'

/**
 * Verdicts below this are discarded.
 *
 * Raised 0.75 → 0.90 on 2026-08-26 after reading the first full run.
 * The 0.95+ band was clean — literal titles in signature blocks. The
 * 0.85 band was roughly half wrong, and wrong in a consistent way: it
 * mistook someone REFERRING to a department for someone IN it
 * ("Adding in accounting to advise on payment status" → accountant),
 * and inferred from the vehicle requested ("Following up on the art
 * cube truck" → art coordinator) despite a prompt rule against it.
 * Rule 7 below now names both traps; the threshold is the backstop.
 */
export const MIN_CONFIDENCE = 0.90

/** Per-excerpt character cap — signatures live at the end, so we keep
 *  the tail as well as the head of anything longer. */
const EXCERPT_CHARS = 1400
const MAX_EXCERPTS = 4

export interface RoleInferenceInput {
  name: string
  email: string
  /** Message bodies from or involving this contact, newest first. */
  excerpts: string[]
}

export interface RoleInferenceResult {
  role: PersonRoleValue | 'UNKNOWN'
  /** Verbatim job title if the text stated one, for Person.rawTitle. */
  title: string | null
  confidence: number
  /** Verbatim quote the verdict rests on. Verified to exist in input. */
  evidence: string | null
  /** Set when a verdict was thrown away, so the run can report why. */
  rejectedReason?: 'low-confidence' | 'unverifiable-quote' | 'bad-role' | 'error'
}

const ROLE_MENU = PERSON_ROLE_VALUES.filter((r) => r !== 'OTHER').join(' | ')

const SYSTEM_PROMPT = `You identify what job someone does on a film/TV/commercial production, from their email.

SirReel rents production vehicles (cube trucks, cargo vans, stakebeds, water trucks) to productions. The people who write to us work ON productions.

You will be given excerpts of email involving ONE person. Decide THAT person's role. Do not describe anyone else on the thread.

Return strict JSON only, no markdown fences:

{
  "role": ${ROLE_MENU} | "UNKNOWN",
  "title": string | null,
  "confidence": number,
  "evidence": string
}

Rules:

1) "evidence" MUST be a VERBATIM span copied from the excerpts — the exact characters, not a paraphrase. It is checked. If you cannot copy a real span that supports your answer, return UNKNOWN.

2) UNKNOWN is a GOOD answer. Most people do not state their job. Returning UNKNOWN costs nothing; a wrong role puts someone into a sales campaign meant for a different department. When the text does not say, return UNKNOWN with confidence 0.

3) Evidence can be the person describing themselves ("I'm the PD", a signature block) OR someone else on the thread describing them ("copying Sara, our transpo coordinator"). Both count — but it must be about THIS person, identified by their name or email.

4) Do not infer role from the company name, the vehicle requested, the dates, or the fact that they emailed at all. A producer and a PA send the same rental request.

5) "title" is the verbatim title text if one appears (e.g. "Production Designer | Art Director"). Null if none appears. This is separate from "role" — you may return a title and still be UNKNOWN on role.

7) A person MENTIONING a department is not a member of it. "Adding accounting to this thread", "James will submit these to accounting", "our producer will confirm", "looping in the art department" all tell you about SOMEONE ELSE. The writer of those sentences is UNKNOWN unless something else identifies them. Likewise a person asking about the "art truck" or the "grip package" is ordering equipment, not declaring a department — that is the request, not their job.

8) Role guidance:
   - GRIP and GAFFER_ELECTRIC are SEPARATE departments. Grip rigs and supports; electric/gaffer lights. A bare "best boy" with no department stated is UNKNOWN.
   - ART_DIRECTOR covers the art department: art director, production designer, set decorator, set designer, prop stylist.
   - ART_COORDINATOR is only for someone explicitly called an art coordinator.
   - PRODUCTION_MANAGER for production manager / head of production. UPM only when "UPM" or "unit production manager" is stated.
   - A film DIRECTOR, a photographer, or a brand-side marketing person is not a production role we track — return UNKNOWN.
   - Someone at another rental house, an insurance broker, or a vendor selling to us is UNKNOWN.`

/**
 * Trim one body to a budget, keeping BOTH ends. Signature blocks — the
 * highest-value text here — sit at the bottom, so a naive head-truncate
 * throws away exactly what we came for.
 */
export function condenseExcerpt(body: string, budget: number = EXCERPT_CHARS): string {
  const clean = body.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (clean.length <= budget) return clean
  const head = Math.floor(budget * 0.55)
  const tail = budget - head
  return `${clean.slice(0, head)}\n…\n${clean.slice(-tail)}`
}

/**
 * Normalize whitespace for quote verification. The model reliably
 * reproduces the words but not always the exact line wrapping of a
 * signature block, and rejecting on that alone would throw away good
 * verdicts.
 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function buildUserPrompt(input: RoleInferenceInput): string {
  const excerpts = input.excerpts
    .slice(0, MAX_EXCERPTS)
    .map((e, i) => `--- excerpt ${i + 1} ---\n${condenseExcerpt(e)}`)
    .join('\n\n')
  return `Person: ${input.name} <${input.email}>\n\n${excerpts}`
}

export async function inferRoleFromMail(
  input: RoleInferenceInput,
  client: Anthropic,
): Promise<RoleInferenceResult> {
  const unknown = (reason: RoleInferenceResult['rejectedReason']): RoleInferenceResult => ({
    role: 'UNKNOWN', title: null, confidence: 0, evidence: null, rejectedReason: reason,
  })

  if (input.excerpts.length === 0) return unknown('error')

  let raw: string
  let stopReason: string | null = null
  try {
    const res = await client.messages.create({
      model: MESSAGE_EXTRACTION_MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    })
    const block = res.content.find((c) => c.type === 'text')
    raw = block && block.type === 'text' ? block.text : ''
    stopReason = res.stop_reason ?? null
  } catch {
    return unknown('error')
  }

  let parsed: { role?: unknown; title?: unknown; confidence?: unknown; evidence?: unknown }
  try {
    parsed = parseAiJson<typeof parsed>(raw, { tag: 'inferRoleFromMail', stopReason })
  } catch {
    return unknown('error')
  }

  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : null
  const roleRaw = typeof parsed.role === 'string' ? parsed.role.trim().toUpperCase() : 'UNKNOWN'
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
  const evidence = typeof parsed.evidence === 'string' ? parsed.evidence.trim() : ''

  if (roleRaw === 'UNKNOWN') {
    return { role: 'UNKNOWN', title, confidence, evidence: evidence || null }
  }
  if (!(PERSON_ROLE_VALUES as readonly string[]).includes(roleRaw) || roleRaw === 'OTHER') {
    return { ...unknown('bad-role'), title }
  }
  if (confidence < MIN_CONFIDENCE) {
    return { ...unknown('low-confidence'), title, confidence }
  }

  // Hallucination guard: the quote must actually exist in what we sent.
  const haystack = normalizeForMatch(input.excerpts.join('\n'))
  if (!evidence || !haystack.includes(normalizeForMatch(evidence))) {
    return { ...unknown('unverifiable-quote'), title, confidence }
  }

  return { role: roleRaw as PersonRoleValue, title, confidence, evidence }
}
