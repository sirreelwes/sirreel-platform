import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import type { LineItemDepartment } from '@prisma/client'
import {
  loadCatalogForSnippet,
  renderCatalogSnippet,
  validateCatalogMatch,
  fallbackMatch,
  type CatalogProduct,
  type CatalogType,
} from '@/lib/sales/catalogMatcher'
import { BILLING_RULES, computeBillableDays } from '@/lib/orders/billing'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const VALID_DEPARTMENTS: LineItemDepartment[] = [
  'VEHICLES',
  'COMMUNICATIONS',
  'STAGES',
  'PRO_SUPPLIES',
  'EXPENDABLES',
  'GE',
  'ART',
]

function buildSystemPrompt(catalogSnippet: string): string {
  return `You are a rental quote parser for SirReel Production Vehicles, a film/TV production rental company in Los Angeles.

Extract structured data from a quote request (email, spec sheet, order form, OR a multi-turn email thread) into the JSON shape below.

Return ONLY valid JSON, no markdown fences, no preamble. Omit top-level fields you cannot determine.

THREAD INPUT FORMAT

When the input begins with one or more "── <timestamp> · INBOUND|OUTBOUND · <sender>" header
lines, you're reading a full email negotiation thread (oldest turn first, most recent turn last).

In that case:
  - Identify the CURRENT ASK — what the client wants RIGHT NOW given the negotiation history.
    The most recent INBOUND turn is most informative, but earlier turns establish the real
    item list, dates, and constraints. A short final turn like "Sounds good, see you Monday"
    or "Thanks!" is small talk — extract from the substantive history, not the closer.
  - Honor counter-proposals: if the agent (OUTBOUND) suggested swapping items or adjusting
    dates and the client (INBOUND) accepted, extract the AGREED-UPON set, not the initial ask.
  - Contact and company info: use the inbound sender's domain/name, NOT the SirReel agent's.
  - Do not invent items that only appear in OUTBOUND messages unless the next INBOUND turn
    confirms them.

If the input is plain text without those header lines, treat it as a single message.

{
  "clientName": "Company name or person's company if clear",
  "contactName": "Person requesting",
  "contactEmail": "email address",
  "contactPhone": "phone if given",
  "productionName": "Show/production name if mentioned (e.g. 'Stranger Things S5')",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "pickupLocation": "Where they want to pick up",
  "dropoffLocation": "Where returning if different",
  "notes": "Any special requirements or notes",
  "items": [
    {
      "description": "Verbatim item description from the source — preserve client phrasing",
      "quantity": 1,
      "catalogProductId": "<UUID from catalog below, or null when uncertain>",
      "catalogType": "INVENTORY" | "ASSET_CATEGORY" | null,
      "department": "VEHICLES" | "COMMUNICATIONS" | "STAGES" | "PRO_SUPPLIES" | "EXPENDABLES" | "GE" | "ART",
      "qualifier": "Client modifier preserved verbatim, or null",
      "rateType": "DAILY" | "WEEKLY",
      "pickupDate": "YYYY-MM-DD",
      "returnDate": "YYYY-MM-DD",
      "billableDays": 1
    }
  ],
  "contacts": [
    {
      "name": "Full name",
      "email": "email@domain.com",
      "title": "Job title from signature, or null",
      "phone": "phone from signature, or null",
      "company": "Company from signature or domain, or null",
      "suggested_role": "PRODUCER" | "PM" | "PC" | "TRANSPO" | "ACCOUNTING" | "OTHER" | null,
      "source": "header" | "signature" | "body_mention",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

CONTACTS EXTRACTION

Extract every person who appears on the thread alongside their email. Three sources:
  - HEADER: anyone in From / To / CC of any inbound message.
    source: "header", confidence: "high".
  - SIGNATURE: name + title + phone block at the bottom of a message body
    (typical "—\n Jane Doe\n Producer\n Foo Films\n jane@foofilms.com\n
    (310) 555-1212" pattern). source: "signature",
    confidence: "high" for well-formed sig blocks, "medium" when ambiguous.
  - BODY MENTION: "loop in Sarah, our PM" / "cc Marco on TC stuff" — when
    the body references a person who isn't a header recipient yet. Only
    extract if an email address is also present in the thread, or skip.
    source: "body_mention", confidence: "low".

ROLE INFERENCE (suggested_role)
  Map from job title / context:
    Producer / Exec Producer            → PRODUCER
    Producer Manager / UPM / Line Prod  → PM
    Production Coordinator / Coord.     → PC
    Transportation Coordinator / TC     → TRANSPO
    Accountant / Accounting / AP        → ACCOUNTING
  If you can't infer, set null. Don't guess from ambiguous titles.

FILTERS (apply yourself; the server also re-checks)
  - Skip anyone with an @sirreel.com email — those are us, not contacts.
  - Skip no-reply / notifications / mailer-daemon style addresses.
  - One row per unique email across the whole thread; pick the most
    complete record (most non-null fields).

The contacts array is REQUIRED — return [] if no people are extractable,
not omitted. Always include the inbound sender.

CATALOG MATCHING (most important rule)

Below is the SirReel catalog. Each row is "<TYPE> <UUID> | <name> | aliases: a, b, c".
Use the aliases as a guide to colloquial producer-speak — "walkies" → CP200 Radio,
"sandbags" → 25 LB. SANDBAG, "cube" → Cube Truck, etc. Prefer SEMANTIC match over
literal substring match.

Return \`catalogProductId\` and \`catalogType\` ONLY when you are confident.
When uncertain, return null for both. DO NOT guess. Server-side fallback will
attempt to resolve unmatched items via a stricter scoring pass; over-eager AI
guesses defeat that fallback and put bad IDs into the database.

When you DO match, copy the UUID exactly as shown — do not invent IDs.

=== SIRREEL CATALOG (curated subset for AI matching) ===

${catalogSnippet}

=== END CATALOG ===

DEPARTMENT (always set, even when catalogProductId is null)

Use this guide on the line item's description to pick the best department:
  VEHICLES        — vans, trucks, SUVs, sprinters, vehicle-mount accessories
  COMMUNICATIONS  — radios, walkies, headsets, intercom, comtek
  STAGES          — soundstages, cyc walls, green screens, stage rentals
  PRO_SUPPLIES    — production paper goods, tape, sharpies, gaff, batteries (catch-all for furniture/operations)
  EXPENDABLES     — consumables (gels, foam core, gaff tape, etc.). Overlap with PRO_SUPPLIES is fine; pick the better fit.
  GE              — grip + electric: stands, flags, generators, distro, cable, lights, dimmers, sandbags, c-stands, apple boxes
  ART             — set dressing, props, paint, scenic

If catalogProductId IS set, the server will OVERRIDE this department with the
catalog product's department — your value here is a fallback for unmatched items.

QUALIFIERS (negative qualifiers are exclusions, NOT new line items)

Preserve client modifiers verbatim in \`qualifier\`. Negative qualifiers like
"no surveillance kits" attach to the parent item — DO NOT split into a separate
line item just because a phrase is mentioned.

Examples:
  "8 walkies, no surveillances" →
    ONE item: { description: "walkies", quantity: 8, qualifier: "no surveillance kits", ... }
  "10 sandbags with handles" →
    ONE item: { description: "sandbags", quantity: 10, qualifier: "with handles", ... }
  "2 cubes and 1 cargo van" →
    TWO items (separate items, no qualifier on either).

RATE TYPE

Default \`rateType\` to "DAILY". Flip to "WEEKLY" only on explicit weekly-rate
language ("weekly rate", "for the week", "$X/week"). Duration alone (4-day shoot)
does NOT imply weekly rate — let the human flip per-line in the UI when needed.

PER-LINE DATES + BILLABLE DAYS

For each line item, set \`pickupDate\` and \`returnDate\` to the rental window
that line covers. Default to the quote-level startDate/endDate unless the
client specifies different dates for specific items (rare). Use ISO format
YYYY-MM-DD.

\`billableDays\` is what the client is charged for. For routine rentals in
COMMUNICATIONS, PRO_SUPPLIES, ART, VEHICLES, GE, this is typically LESS
than the actual rental duration because of weekly caps. The system pre-fills
a suggested default after extraction and the human reviewer adjusts if the
deal is non-standard. You don't need to compute this — just return your
best estimate of actual rental duration in pickupDate/returnDate, and set
billableDays to the inclusive day count between those dates as a safe
starting value (the server will override with the dept-specific cap default).

GENERAL RULES

- Return ONLY the JSON object. No markdown fences, no preamble.
- If clientName is unclear, leave it empty rather than guess.
- If a date is given as a duration ("for a week"), pick a reasonable startDate
  if mentioned and compute endDate (else leave both null).`
}

interface AiItem {
  description: string
  quantity: number
  catalogProductId: string | null
  catalogType: CatalogType | null
  department: LineItemDepartment
  qualifier: string | null
  rateType: 'DAILY' | 'WEEKLY'
  pickupDate?: string | null
  returnDate?: string | null
  billableDays: number
}

// What the AI returns per contact (raw, pre-enrichment).
interface AiContact {
  name: string
  email: string
  title: string | null
  phone: string | null
  company: string | null
  suggested_role: 'PRODUCER' | 'PM' | 'PC' | 'TRANSPO' | 'ACCOUNTING' | 'OTHER' | null
  source: 'header' | 'signature' | 'body_mention'
  confidence: 'high' | 'medium' | 'low'
}

// What we return to the UI after dedup + Person table enrichment.
export interface ResolvedContact extends AiContact {
  match_status: 'existing' | 'new' | 'possible_match'
  existing_person_id: string | null
  candidate_person_id: string | null
}

interface ResolvedItem {
  description: string
  quantity: number
  catalogProductId: string | null
  catalogType: CatalogType | null
  department: LineItemDepartment
  qualifier: string | null
  rateType: 'DAILY' | 'WEEKLY'
  pickupDate: string  // ISO date
  returnDate: string  // ISO date
  billableDays: number
  rate: number
  matchedProduct: { id: string; type: CatalogType; name: string } | null
  matchSource: 'AI' | 'ALIAS_FALLBACK' | null
  warnings: string[]
}

function inclusiveDayCount(startISO?: string | null, endISO?: string | null): number | null {
  if (!startISO || !endISO) return null
  const start = new Date(startISO)
  const end = new Date(endISO)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const diffMs = end.getTime() - start.getTime()
  if (diffMs < 0) return null
  return Math.max(1, Math.floor(diffMs / 86400000) + 1)
}

function pickRate(product: CatalogProduct, rateType: 'DAILY' | 'WEEKLY'): number {
  // Catalog data isn't always populated on both fields — most InventoryItem
  // rows have only weeklyRate set (dailyRate=0). Derive the missing one
  // using a 5-day work-week assumption so the user gets a sensible
  // pre-filled rate instead of $0.
  if (rateType === 'WEEKLY') {
    return product.weeklyRate > 0 ? product.weeklyRate : product.dailyRate * 5
  }
  return product.dailyRate > 0 ? product.dailyRate : product.weeklyRate / 5
}

async function resolveItem(
  raw: AiItem,
  parsedRange: { startDate?: string; endDate?: string }
): Promise<ResolvedItem> {
  const warnings: string[] = []
  let matchedProduct: CatalogProduct | null = null
  let matchSource: 'AI' | 'ALIAS_FALLBACK' | null = null

  // Step 1: validate AI's claimed match.
  if (raw.catalogProductId && raw.catalogType) {
    const p = await validateCatalogMatch(raw.catalogProductId, raw.catalogType)
    if (p) {
      matchedProduct = p
      matchSource = 'AI'
    } else {
      warnings.push(
        `AI returned unknown ${raw.catalogType} id ${raw.catalogProductId} — discarded`
      )
    }
  }

  // Step 2: fallback match for unresolved items.
  if (!matchedProduct) {
    const fb = await fallbackMatch(raw.description)
    if (fb) {
      matchedProduct = fb
      matchSource = 'ALIAS_FALLBACK'
    }
  }

  // Step 3: department — catalog wins when matched; otherwise trust the AI's
  // pick (or PRO_SUPPLIES as a final fallback if AI returned something invalid).
  let department: LineItemDepartment = matchedProduct
    ? matchedProduct.department
    : VALID_DEPARTMENTS.includes(raw.department)
      ? raw.department
      : 'PRO_SUPPLIES'

  // Step 4: rate from catalog when matched; else 0 for the user to fill in.
  const rateType = raw.rateType === 'WEEKLY' ? 'WEEKLY' : 'DAILY'
  const rate = matchedProduct ? pickRate(matchedProduct, rateType) : 0

  // Step 5: dates — prefer per-line; fall back to quote-level; default to today + 1d.
  const isoDate = (d: Date): string => d.toISOString().slice(0, 10)
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 86400000)
  const pickupDate =
    raw.pickupDate || parsedRange.startDate || isoDate(today)
  const returnDate =
    raw.returnDate || parsedRange.endDate || isoDate(tomorrow)

  // Step 6: billableDays — pre-fill the dept-aware suggested default.
  // Cap-per-week depts get the cap math as a starting point; STAGES gets
  // the calendar duration; EXPENDABLES gets 1 (vestigial).
  // The rep can override this freely in the UI.
  const actualDays = inclusiveDayCount(pickupDate, returnDate) ?? 1
  const rules = BILLING_RULES[department]
  let suggestedDays = 1
  if (rules.model === 'CAP_PER_WEEK') {
    suggestedDays = computeBillableDays(actualDays, rules.cap)
  } else if (rules.model === 'PERCENT_DISCOUNT') {
    suggestedDays = actualDays
  }
  // If the AI provided a sensible billableDays we still respect it; otherwise
  // hand back the suggested default.
  const aiDays = Number.isFinite(raw.billableDays) && raw.billableDays > 0
    ? Math.floor(raw.billableDays)
    : null
  // Heuristic: trust the AI's value only if it matches actualDays (the AI
  // doesn't compute caps). If the AI just echoed the calendar duration on
  // a cap-per-week dept, replace with the cap-suggested default.
  let billableDays = suggestedDays
  if (aiDays != null) {
    if (rules.model === 'PERCENT_DISCOUNT' || rules.model === 'PURCHASE') {
      billableDays = aiDays
    } else {
      // CAP_PER_WEEK: prefer the cap default unless AI gave a smaller value
      // (rare, but signals a manual deal-specific override surfaced by the AI).
      billableDays = Math.min(aiDays, suggestedDays)
    }
  }

  return {
    description: raw.description,
    quantity: Math.max(1, Math.floor(raw.quantity || 1)),
    catalogProductId: matchedProduct?.id ?? null,
    catalogType: matchedProduct?.type ?? null,
    department,
    qualifier: raw.qualifier?.trim() || null,
    rateType,
    pickupDate,
    returnDate,
    billableDays,
    rate,
    matchedProduct: matchedProduct
      ? { id: matchedProduct.id, type: matchedProduct.type, name: matchedProduct.name }
      : null,
    matchSource,
    warnings,
  }
}

// Sirreel agent inboxes — anything @sirreel.com is us, not a client
// contact. Defensive belt-and-suspenders to the AI prompt's own filter.
const SIRREEL_DOMAIN = '@sirreel.com'
const NOREPLY_RE = /(^|[^a-z])(no-?reply|notifications?|mailer-daemon|do-?not-?reply|postmaster|bounce[s]?)([^a-z]|$)/i

function shouldDropContact(email: string): boolean {
  const e = email.toLowerCase().trim()
  if (!e || !e.includes('@')) return true
  if (e.endsWith(SIRREEL_DOMAIN)) return true
  if (NOREPLY_RE.test(e)) return true
  return false
}

// Pick the "most complete" record when the AI returned more than one
// row for the same email — count non-null fields, ties broken by
// highest source confidence.
function completenessScore(c: AiContact): number {
  let s = 0
  if (c.name) s++
  if (c.title) s++
  if (c.phone) s++
  if (c.company) s++
  if (c.suggested_role) s++
  if (c.confidence === 'high') s += 2
  else if (c.confidence === 'medium') s += 1
  return s
}

function dedupContacts(raw: AiContact[]): AiContact[] {
  const byEmail = new Map<string, AiContact>()
  for (const c of raw) {
    if (!c || typeof c.email !== 'string') continue
    if (shouldDropContact(c.email)) continue
    const key = c.email.toLowerCase().trim()
    const existing = byEmail.get(key)
    if (!existing || completenessScore(c) > completenessScore(existing)) {
      byEmail.set(key, { ...c, email: key })
    }
  }
  return Array.from(byEmail.values())
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

// Server enrichment: for each contact, look up the Person table by
// email. If we miss but find a same-name candidate, surface that for
// human review as 'possible_match' instead of silently creating a
// duplicate.
async function enrichContacts(contacts: AiContact[]): Promise<ResolvedContact[]> {
  if (contacts.length === 0) return []
  const emails = contacts.map((c) => c.email)
  const exact = await prisma.person.findMany({
    where: { email: { in: emails, mode: 'insensitive' } },
    select: { id: true, email: true, firstName: true, lastName: true },
  })
  const byEmail = new Map(exact.map((p) => [p.email.toLowerCase(), p]))

  const out: ResolvedContact[] = []
  for (const c of contacts) {
    const match = byEmail.get(c.email)
    if (match) {
      out.push({ ...c, match_status: 'existing', existing_person_id: match.id, candidate_person_id: null })
      continue
    }
    // Possible match — same first+last name, different email. pg_trgm
    // isn't installed in this DB, so exact-name match is the floor.
    const { firstName, lastName } = splitName(c.name)
    let candidateId: string | null = null
    if (firstName && lastName) {
      const candidates = await prisma.person.findMany({
        where: {
          firstName: { equals: firstName, mode: 'insensitive' },
          lastName: { equals: lastName, mode: 'insensitive' },
        },
        select: { id: true },
        take: 2,
      })
      if (candidates.length === 1) candidateId = candidates[0].id
    }
    out.push({
      ...c,
      match_status: candidateId ? 'possible_match' : 'new',
      existing_person_id: null,
      candidate_person_id: candidateId,
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text } = body

    if (!text) {
      return NextResponse.json({ error: 'text required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })
    }

    const catalog = await loadCatalogForSnippet()
    const snippet = renderCatalogSnippet(catalog)
    const SYSTEM_PROMPT = buildSystemPrompt(snippet)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Quote request:\n\n${text.slice(0, 15000)}`,
        },
      ],
    })

    const aiText = response.content[0].type === 'text' ? response.content[0].text : ''
    let parsed: {
      clientName?: string
      contactName?: string
      contactEmail?: string
      contactPhone?: string
      productionName?: string
      startDate?: string
      endDate?: string
      pickupLocation?: string
      dropoffLocation?: string
      notes?: string
      items?: AiItem[]
      contacts?: AiContact[]
    }
    try {
      const cleaned = aiText.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error('[parse-quote] JSON parse failed. Raw output:', aiText.slice(0, 1000))
      return NextResponse.json(
        { error: 'AI response was not valid JSON', raw: aiText.slice(0, 800) },
        { status: 500 }
      )
    }

    const rawItems: AiItem[] = Array.isArray(parsed.items) ? parsed.items : []
    const items: ResolvedItem[] = await Promise.all(
      rawItems.map((it) =>
        resolveItem(it, { startDate: parsed.startDate, endDate: parsed.endDate })
      )
    )

    // Contacts: dedupe + filter at the gateway, then enrich with Person
    // table match status. The AI is asked to filter @sirreel/noreply too
    // but we re-check on the server — never trust the model alone.
    const rawContacts: AiContact[] = Array.isArray(parsed.contacts) ? parsed.contacts : []
    const dedupedContacts = dedupContacts(rawContacts)
    const contacts = await enrichContacts(dedupedContacts)

    // Client matching — same fuzzy strategy as before, just kept inline.
    let clientMatch: { id: string; name: string; tier: string; coiOnFile: boolean; defaultAgentId: string | null }[] = []
    if (parsed.clientName) {
      const stripSuffixes = (s: string) =>
        s
          .toLowerCase()
          .replace(/[,.]/g, ' ')
          .replace(
            /\b(llc|inc|llp|ltd|corp|co|corporation|company|productions?|films?|studios?|media|entertainment|group|pictures)\b/g,
            ''
          )
          .replace(/\s+/g, ' ')
          .trim()
      const stripped = stripSuffixes(parsed.clientName)
      const words = stripped.split(' ').filter((w) => w.length >= 3)

      let companies = await prisma.company.findMany({
        where: { name: { contains: parsed.clientName, mode: 'insensitive' } },
        select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
        take: 10,
      })
      if (companies.length === 0 && stripped) {
        companies = await prisma.company.findMany({
          where: { name: { contains: stripped, mode: 'insensitive' } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
          take: 10,
        })
      }
      if (companies.length === 0 && words.length > 0) {
        companies = await prisma.company.findMany({
          where: { name: { contains: words[0], mode: 'insensitive' } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
          take: 10,
        })
      }
      clientMatch = companies
    }

    return NextResponse.json({
      parsed,
      items,
      clientMatch,
      contacts,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[parse-quote] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
