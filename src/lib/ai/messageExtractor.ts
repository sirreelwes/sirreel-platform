import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

/**
 * Per-message AI extraction — pulls structured fields out of an inbound
 * email body so the Pipeline slider can render a Quick Read card instead
 * of a wall of text (especially useful for Cognito Forms submissions, which
 * arrive as concatenated label+value blobs with no whitespace).
 *
 * Uses Claude Haiku (claude-haiku-4-5-20251001) — extraction is cheap,
 * fast, and well within Haiku's capability ceiling. Sonnet would be 5-10x
 * the cost for negligible quality lift on this task.
 *
 * Behavior contract:
 *   - Never throws past the caller. Anthropic errors, JSON parse failures,
 *     and shape mismatches all collapse to { messageNature: 'other',
 *     summary: '(extraction failed)', confidence: 0 }.
 *   - Confidence reflects how complete the extraction is (per the prompt),
 *     not the raw model confidence. Callers should treat <0.5 as "render
 *     raw body instead of Quick Read card".
 */

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1500

const PROMPT_PREAMBLE = `Extract structured information from this inbound email. The email is from a potential or current client of a production vehicle rental company (SirReel). Output strict JSON only — no markdown fences, no preamble.

Extract:

{
  "contact": {
    "name": string | null,
    "email": string | null,
    "phone": string | null,
    "title": string | null
  },
  "company": string | null,
  "jobIntent": {
    "vehicleType": string | null,
    "equipment": string[],
    "pickupDate": string | null,
    "returnDate": string | null,
    "duration": string | null,
    "location": string | null,
    "projectName": string | null
  },
  "urgency": "asap" | "normal" | "future" | null,
  "rawNotes": string | null,
  "messageNature": "inquiry" | "reply" | "confirmation" | "question" | "rejection" | "other",
  "summary": string,
  "confidence": number
}

Rules:
- If a field isn't mentioned, set to null. Don't guess.
- For Cognito Forms submissions, the body will have labels glued to values (e.g., "NameBrandt WilleEmailbrandt@..."). Parse these by recognising common field labels: Name, Email, Phone, Company, Project, Dates, Services, Notes, Pickup, Return, Vehicle.
- pickupDate / returnDate: use ISO YYYY-MM-DD when an explicit date is mentioned; otherwise null. Don't compute relative dates (e.g. "Tuesday morning" → null) — leave that for the rep.
- equipment: short array of items mentioned (lights, dolly, generator, etc.). If only a vehicle is mentioned, leave empty.
- urgency: "asap" if the client expresses urgency; "future" if the request is for a date >30d out; "normal" otherwise.
- summary: ONE plain-English sentence describing the message ("Brandt Wille at Live Cinema Services needs a cargo van with liftgate for tomorrow morning").
- confidence: 0.0–1.0 reflecting how complete the extraction is (not just per-field accuracy).
`

export interface ExtractedContact {
  name: string | null
  email: string | null
  phone: string | null
  title: string | null
}

export interface ExtractedJobIntent {
  vehicleType: string | null
  equipment: string[]
  pickupDate: string | null
  returnDate: string | null
  duration: string | null
  location: string | null
  projectName: string | null
}

export type ExtractedMessageNature =
  | 'inquiry'
  | 'reply'
  | 'confirmation'
  | 'question'
  | 'rejection'
  | 'other'

export interface ExtractedMessage {
  contact: ExtractedContact
  company: string | null
  jobIntent: ExtractedJobIntent
  urgency: 'asap' | 'normal' | 'future' | null
  rawNotes: string | null
  messageNature: ExtractedMessageNature
  summary: string
  confidence: number
}

export interface ExtractMessageInput {
  subject: string | null
  fromAddress: string
  bodyText: string | null
  bodyHtml?: string | null
  snippet?: string | null
}

const FALLBACK: ExtractedMessage = {
  contact: { name: null, email: null, phone: null, title: null },
  company: null,
  jobIntent: {
    vehicleType: null,
    equipment: [],
    pickupDate: null,
    returnDate: null,
    duration: null,
    location: null,
    projectName: null,
  },
  urgency: null,
  rawNotes: null,
  messageNature: 'other',
  summary: '(extraction failed)',
  confidence: 0,
}

function parseFromHeader(raw: string): { name: string | null; email: string } {
  const trimmed = raw.trim()
  const m = trimmed.match(/^(.*)<\s*([^>]+)\s*>$/)
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, '').trim() || null
    return { name, email: m[2].trim().toLowerCase() }
  }
  return { name: null, email: trimmed.toLowerCase() }
}

function clampBody(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n[…truncated…]'
}

function buildUserPrompt(input: ExtractMessageInput): string {
  const from = parseFromHeader(input.fromAddress)
  const body = input.bodyText || input.snippet || input.bodyHtml || '(empty)'
  return [
    PROMPT_PREAMBLE,
    '',
    `Email subject: ${input.subject || '(no subject)'}`,
    `Email from: ${from.name || ''} <${from.email}>`,
    'Email body:',
    clampBody(body),
  ].join('\n')
}

function coerceExtracted(raw: unknown): ExtractedMessage {
  if (!raw || typeof raw !== 'object') return FALLBACK
  const r = raw as Record<string, unknown>
  const contact = r.contact && typeof r.contact === 'object' ? (r.contact as Record<string, unknown>) : {}
  const job = r.jobIntent && typeof r.jobIntent === 'object' ? (r.jobIntent as Record<string, unknown>) : {}

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const validUrgency = (v: unknown): ExtractedMessage['urgency'] =>
    v === 'asap' || v === 'normal' || v === 'future' ? v : null
  const validNature = (v: unknown): ExtractedMessageNature => {
    if (v === 'inquiry' || v === 'reply' || v === 'confirmation' || v === 'question' || v === 'rejection' || v === 'other') return v
    return 'other'
  }
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence)
    ? Math.max(0, Math.min(1, r.confidence))
    : 0
  const summary = str(r.summary) || ''

  return {
    contact: {
      name: str(contact.name),
      email: str(contact.email),
      phone: str(contact.phone),
      title: str(contact.title),
    },
    company: str(r.company),
    jobIntent: {
      vehicleType: str(job.vehicleType),
      equipment: Array.isArray(job.equipment) ? job.equipment.filter((x) => typeof x === 'string').map((x) => (x as string).trim()).filter(Boolean) : [],
      pickupDate: str(job.pickupDate),
      returnDate: str(job.returnDate),
      duration: str(job.duration),
      location: str(job.location),
      projectName: str(job.projectName),
    },
    urgency: validUrgency(r.urgency),
    rawNotes: str(r.rawNotes),
    messageNature: validNature(r.messageNature),
    summary,
    confidence,
  }
}

// Lazy client construction — do NOT capture process.env at module-load
// time. In tsx-run scripts, ESM hoists imports above any env-loader code
// the script runs at top level, so a module-level `new Anthropic({ apiKey:
// process.env.ANTHROPIC_API_KEY })` would capture undefined and every call
// would silently FALLBACK. The May 2026 backfill incident wrote 5,628
// FALLBACK rows to production before this bug was caught. Constructing
// per-call is cheap and eliminates the failure mode.
function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// Log the missing-key short-circuit exactly once per process so a
// misconfigured ANTHROPIC_API_KEY (or an empty-string value in Vercel
// env, which has happened in this codebase) is visible in function logs
// instead of silently collapsing every extraction to FALLBACK.
let warnedKeyMissing = false
function warnKeyMissing() {
  if (warnedKeyMissing) return
  warnedKeyMissing = true
  console.error('[message-extractor] ANTHROPIC_API_KEY is missing or empty — every extractMessageData call will return FALLBACK. Set the key in Vercel env (Production scope) to enable.')
}

export async function extractMessageData(input: ExtractMessageInput): Promise<ExtractedMessage> {
  if (!process.env.ANTHROPIC_API_KEY) {
    warnKeyMissing()
    return FALLBACK
  }
  const client = getClient()
  // Don't burn an API call on completely empty bodies.
  if (!input.bodyText && !input.snippet && !input.bodyHtml) return FALLBACK

  let raw: string
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    })
    raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
  } catch (err) {
    console.error('[message-extractor] Anthropic call failed:', err instanceof Error ? err.message : err)
    return FALLBACK
  }

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error('[message-extractor] JSON parse failed. Raw:', raw.slice(0, 500))
    return FALLBACK
  }
  return coerceExtracted(parsed)
}

/**
 * Convenience wrapper used by the ingestion paths (pubsub/fetch/sync) and
 * the catch-up cron. Loads the EmailMessage, runs extraction, persists the
 * result + run timestamp + confidence. Returns true on persist success.
 *
 * Skip rules:
 *   - outbound messages → skip
 *   - duplicate copies (duplicateOfId set) → skip
 *   - already-extracted (extractionRunAt set) → skip
 *   - no body content at all → still mark extractionRunAt so the UI stops
 *     showing "Extracting…" forever
 */
export async function runMessageExtractionForId(emailMessageId: string): Promise<boolean> {
  const email = await prisma.emailMessage.findUnique({
    where: { id: emailMessageId },
    select: {
      id: true,
      subject: true,
      fromAddress: true,
      bodyText: true,
      bodyHtml: true,
      snippet: true,
      direction: true,
      duplicateOfId: true,
      extractionRunAt: true,
    },
  })
  if (!email) return false
  if (email.direction !== 'inbound') return false
  if (email.duplicateOfId) return false
  if (email.extractionRunAt) return false

  const extracted = await extractMessageData({
    subject: email.subject,
    fromAddress: email.fromAddress,
    bodyText: email.bodyText,
    bodyHtml: email.bodyHtml,
    snippet: email.snippet,
  })

  await prisma.emailMessage.update({
    where: { id: email.id },
    data: {
      extractedData: extracted as unknown as object,
      extractionRunAt: new Date(),
      extractionConfidence: extracted.confidence,
    },
  })
  return true
}
