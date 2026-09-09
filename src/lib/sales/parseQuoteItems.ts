/**
 * The quote-line parser: pasted text in, catalog-resolved order lines out.
 *
 * Extracted from /api/orders/parse-quote on 2026-09-08 so a SECOND caller
 * could reuse it — Oliver, after talking it through: "when I go to edit an
 * existing order I'd like a button that opens up that AI email parser box,
 * where I can copy and paste this supply list... big supply orders that
 * come a day after we make their vehicle quote."
 *
 * It lives here rather than being duplicated because the value is not the
 * AI call, it is everything wrapped around it: the catalog snippet, the
 * qualifier rules, the walkie/radio accessory bundling, kit-piece
 * expansion and the section cadence pass. A second copy of that prompt
 * would drift from this one within a week, and the two screens would then
 * price the same pasted list differently.
 *
 * The route keeps what is specific to STARTING a quote — contacts and
 * client matching. This module only ever reads; nothing here writes.
 */

import { correctImpossibleYear } from '@/lib/orders/parsedDateYear'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import type { LineItemType } from '@prisma/client'
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
import { deriveWalkieKit } from '@/lib/sales/walkieKit'
import { deriveKitPieceLines } from '@/lib/inventory/kitPieces'
import { PARSING_MODEL } from '@/lib/ai/models'
import { parseAiJson, AiJsonError } from '@/lib/ai/extractJson'

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Structured extraction over a long thread can run long — give the
// function headroom beyond the plan default.
const VALID_DEPARTMENTS: LineItemDepartment[] = [
  'VEHICLES',
  'COMMUNICATIONS',
  'STAGES',
  'PRO_SUPPLIES',
  'EXPENDABLES',
  'GE',
  'ART',
  'WARDROBE_MAKEUP',
]

export function buildSystemPrompt(catalogSnippet: string): string {
  // The date the model is reading this. Without it, "Sept 4" or "9/17"
  // has no year and the model supplies one from its own prior — which is
  // how JUST PONDS was quoted for 2024 and Hulu Chad Powers for 2025,
  // both created in HQ days apart and both sent to the client with a
  // rental date in the past.
  const todayPacific = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  return `You are a rental quote parser for SirReel Production Vehicles, a film/TV production rental company in Los Angeles.

TODAY IS ${todayPacific} (America/Los_Angeles). Every date you return must be
consistent with that:
- A date written without a year ("Sept 4", "9/17", "the 22nd") means the NEXT
  occurrence on or after today. Never return a date in a past year.
- Only return a past date if the source explicitly states a past year.

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
      "department": "VEHICLES" | "COMMUNICATIONS" | "STAGES" | "PRO_SUPPLIES" | "EXPENDABLES" | "GE" | "ART" | "WARDROBE_MAKEUP",
      "qualifier": "Client modifier preserved verbatim, or null",
      "rateType": "DAILY" | "WEEKLY",
      "pickupDate": "YYYY-MM-DD",
      "returnDate": "YYYY-MM-DD",
      "billableDays": 1,
      "daysPerWeek": null
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

A qualifier is a PREFERENCE. A word that picks out WHICH catalog item they
mean is part of the item — leave it in \`description\`, not \`qualifier\`:
sizes and capacities ("6' tables", "100 qt cooler", "3000w generator") and
variant words ("analog walkies", "tall director's chairs"). Split those off
into \`qualifier\` and the server matches on what's left, which is every
size of table at once. "Walkies for the DP" — that's a qualifier.

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

RADIO ACCESSORY BUNDLING (positive "w/" attaches DO split into paired lines)

Industry context: in film/TV rentals, radio accessories are SEPARATE inventory
items that pair 1:1 with the base radio. SirReel currently stocks two
accessory SKUs:

  - "walkie" / "walkies"                                = Motorola CP200d UHF Radio (Digital) — see below
  - "surveillance kit" / "surveillances" / "earpiece"   = Surveillance Kit (discreet earpiece + lapel mic)
  - "hand mic" / "handset" / "shoulder mic" / "speaker mic"
                                                        = Hand Mics (remote speaker/microphone accessory)

SirReel stocks both digital and analog CP200s at the same rate. Unqualified
"walkies" means the DIGITAL radio — that is the house default and what goes
out unless the client asks otherwise. Match the analog row ONLY when the
request actually says analog; when it does, keep the word "analog" in the
line's \`description\` (it identifies the radio, it isn't a preference).

The canonical SirReel names are "Surveillance Kit" and "Hand Mics" — but
the AI should use the spelling the client wrote in the description field
("handset" / "shoulder mic" / etc. — preserving producer-speak); the
catalog matcher resolves to the right SKU.

When a request says "N walkies w/ <accessory>" or "N walkies with <accessory>"
(POSITIVE attach, not "no"), emit TWO line items at the same quantity — one
for the radios and one for the accessory.

Exception: "chargers" ship for free with radios — do NOT split a "w/ chargers"
phrase into a separate item.

Examples:
  "6 walkies w/ surveillance kits" →
    TWO items: { description: "walkies", quantity: 6 }
               { description: "surveillance kits", quantity: 6 }
  "8 walkies w/ handsets" →
    TWO items: { description: "walkies", quantity: 8 }
               { description: "hand mics", quantity: 8 }
  "10 walkies w/ surveillance kits and 4 hand mics" →
    THREE items: { description: "walkies", quantity: 10 }
                 { description: "surveillance kits", quantity: 10 }
                 { description: "hand mics", quantity: 4 }
  "5 walkies"                          → ONE item (radios only).
  "8 walkies w/ chargers"              → ONE item (chargers ship free).
  "8 walkies, no surveillances"        → ONE item with negative qualifier (see above).

Bundling is RADIO-SPECIFIC. "with handles" on sandbags etc. still stays a
qualifier on one item. The trigger is the combination of (walkies/radios) +
(surveillance kit OR hand mic / handset / shoulder mic / speaker mic /
earpiece).

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

WEEK CADENCE (daysPerWeek)

Set \`daysPerWeek\` ONLY when the client explicitly states how many days per
week they will use the item — phrasing like "2 days a week", "we only shoot
Tuesdays and Thursdays" (= 2), "3 shoot days per week for a month". Return
the integer 1–7. This is a pricing concession signal, so DO NOT infer it:
total duration ("a 4-day shoot"), vague usage ("occasionally"), or your own
guess must all leave it null. When in doubt, null — the server only ever
uses it to LOWER the suggested billable days, and a human reviews every line.

CLIENT NAME EXTRACTION

Prefer signals in this order:
  1. In-body signature mention ("Eve Symington, BuzzFeed Producer" / sig block
     with "BuzzFeed, Inc." under the sender's name) — strongest signal.
  2. Sender's email domain when it's a real company domain (eve@buzzfeed.com →
     BuzzFeed). Ignore generic free-mail domains (gmail.com, yahoo.com,
     hotmail.com, outlook.com, icloud.com, proton.me, aol.com, fastmail.com,
     gmx.com, mail.com, me.com).
  3. Email SUBJECT line patterns. Production crews commonly use:
        [ProjectCode]_[CompanyName]_[Description]
        e.g. "Re: DOL_Radiance Films_Super cargo w/ liftgate + supplies"
              → company is "Radiance Films"
        e.g. "TFT_Anchor Stone Creative_truck pickup"
              → company is "Anchor Stone Creative"
     Underscore-delimited, three or more segments — extract the SECOND segment
     as the candidate company. Ignore if the segment is obviously generic
     ("Job", "Production", "Inquiry", "Quote", etc.).

If none of these signals are confident, leave clientName empty — the agent
will pick from the CRM. Don't guess from weak signals.

GENERAL RULES

- Return ONLY the JSON object. No markdown fences, no preamble.
- If clientName is unclear, leave it empty rather than guess.
- If a date is given as a duration ("for a week"), pick a reasonable startDate
  if mentioned and compute endDate (else leave both null).`
}

export interface AiItem {
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
  /** Explicit client-stated usage cadence ("2 days a week") — null unless
   *  the email says it outright. Only ever LOWERS the suggested days. */
  daysPerWeek?: number | null
}

// What the AI returns per contact (raw, pre-enrichment).
export interface ResolvedItem {
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
  /** Client-stated usage cadence extracted from the email, if any —
   *  consumed by applySectionCadence, then informational. */
  statedDaysPerWeek: number | null
  rate: number
  matchedProduct: { id: string; type: CatalogType; name: string; lineType: LineItemType } | null
  matchSource: 'AI' | 'ALIAS_FALLBACK' | 'AUTO_KIT' | null
  warnings: string[]
}

/**
 * Accessories that ride along with what was ordered — charging banks
 * and spare batteries with radios, and whatever else the catalog says.
 *
 * The ratios are per-item data now (InventoryKitPiece), not code: an
 * operator sets them in the inventory drawer. Quantities are still
 * arithmetic the SERVER does off the resolved line quantities — never
 * something the model estimates.
 *
 * Kit lines carry the accessory's real catalog id, so downstream they
 * are ordinary inventory lines: scannable on the pick list, countable
 * on the way out, chargeable if one doesn't come back. They quote at $0
 * (the FREE default) and carry a warning so the rep can see they were
 * added and why.
 *
 * Legacy fallback: a radio line the catalog didn't claim (unmatched, or
 * matched to an item with no kit configured yet) has no parent row to
 * hang a kit off. The old text-heuristic walkie kit still covers that
 * case — a short pick list is worse than an unlinked line — and drops
 * whichever accessory the catalog already supplied, so configuring the
 * CP200 kit doesn't put two chargers on the quote.
 */
/**
 * Spread a client-stated week cadence over its whole department section
 * (Wes 2026-08-31: "the parser should apply the week cadence to the whole
 * section too" — mirrors the builder's section-level Week control). When
 * any line in a department carries statedDaysPerWeek, EVERY line in that
 * department is repriced at that cadence (the most conservative one, if
 * several lines state different numbers), each from its own date range.
 * Cadence only ever LOWERS the week below the department default, and
 * every repriced line carries a warning so the rep sees it before send.
 */
export function applySectionCadence(items: ResolvedItem[]): ResolvedItem[] {
  const cadenceByDept = new Map<LineItemDepartment, number>()
  for (const it of items) {
    if (it.statedDaysPerWeek == null) continue
    const prev = cadenceByDept.get(it.department)
    cadenceByDept.set(it.department, prev == null ? it.statedDaysPerWeek : Math.min(prev, it.statedDaysPerWeek))
  }
  if (cadenceByDept.size === 0) return items

  return items.map((it) => {
    const cadence = cadenceByDept.get(it.department)
    if (cadence == null) return it
    const rules = BILLING_RULES[it.department]
    if (rules.model === 'PURCHASE') return it
    const deptDefault = rules.model === 'CAP_PER_WEEK' ? rules.cap : 7
    const effectiveCap = Math.min(cadence, deptDefault)
    if (effectiveCap >= deptDefault) return it
    const actualDays = inclusiveDayCount(it.pickupDate, it.returnDate)
    if (actualDays == null) return it
    return {
      ...it,
      billableDays: computeBillableDays(actualDays, effectiveCap),
      warnings: [
        ...it.warnings,
        `Priced at a ${effectiveCap}-day week — the email states a ${cadence}-day-per-week cadence, applied to the whole ${it.department} section (default: ${deptDefault}-day week). Verify before sending.`,
      ],
    }
  })
}

export async function appendKitPieces(items: ResolvedItem[]): Promise<ResolvedItem[]> {
  const kit = await deriveKitPieceLines(
    items.map((i) => ({
      inventoryItemId: i.catalogType === 'INVENTORY' ? i.catalogProductId : null,
      quantity: i.quantity,
    })),
  )

  // Ride along with the parent's dates so the kit can't outlast the gear.
  const anchorFor = (k: (typeof kit)[number]) =>
    items.find((i) => i.catalogProductId && k.parentItemIds.includes(i.catalogProductId)) ??
    items[0]

  const kitLines: ResolvedItem[] = kit.map((k) => {
    const anchor = anchorFor(k)
    return {
      description: k.description,
      quantity: k.quantity,
      catalogProductId: k.pieceItemId,
      catalogType: 'INVENTORY' as CatalogType,
      department: k.department,
      qualifier: null,
      rateType: anchor.rateType,
      pickupDate: anchor.pickupDate,
      returnDate: anchor.returnDate,
      billableDays: anchor.billableDays,
      statedDaysPerWeek: null,
      rate: k.rate,
      matchedProduct: {
        id: k.pieceItemId,
        type: 'INVENTORY' as CatalogType,
        name: k.description,
        lineType: k.lineType,
      },
      matchSource: 'AUTO_KIT' as const,
      warnings: [k.note],
    }
  })

  // Legacy fallback for radios the catalog didn't claim — either the
  // line never matched, or the matched radio has no kit configured yet.
  // Dropped per accessory when the catalog already produced that kind of
  // piece, so configuring the kit doesn't double the charger.
  const legacy = deriveWalkieKit(
    items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      matchedProductName: i.matchedProduct?.name ?? null,
    }))
  ).filter((l) => {
    const kind = /charg/i.test(l.description) ? /charg/i
      : /batter/i.test(l.description) ? /batter/i
      : null
    return kind ? !kit.some((k) => kind.test(k.description)) : true
  })

  if (kitLines.length === 0 && legacy.length === 0) return items

  const radioLine = items.find((i) => i.department === 'COMMUNICATIONS') ?? items[0]
  return [
    ...items,
    ...kitLines,
    ...legacy.map((k) => ({
      description: k.description,
      quantity: k.quantity,
      catalogProductId: null,
      catalogType: null,
      department: 'COMMUNICATIONS' as LineItemDepartment,
      qualifier: null,
      rateType: radioLine.rateType,
      pickupDate: radioLine.pickupDate,
      returnDate: radioLine.returnDate,
      billableDays: radioLine.billableDays,
      statedDaysPerWeek: null,
      rate: 0,
      matchedProduct: null,
      matchSource: 'AUTO_KIT' as const,
      warnings: [k.note],
    })),
  ]
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

export async function resolveItem(
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
  // Second line of defence behind the prompt's TODAY IS anchor: a prompt
  // is a request, not a guarantee. A rental date most of a year in the
  // past is a wrong year, never a booking — see lib/orders/parsedDateYear.
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(today)
  const fixYear = (d: string | null | undefined) => correctImpossibleYear(d, todayYmd)
  const pickupDate =
    fixYear(raw.pickupDate) || fixYear(parsedRange.startDate) || isoDate(today)
  const returnDate =
    fixYear(raw.returnDate) || fixYear(parsedRange.endDate) || isoDate(tomorrow)

  // Step 6: billableDays — pre-fill the dept-aware suggested default.
  // Cap-per-week depts get the cap math as a starting point; STAGES gets
  // the calendar duration; EXPENDABLES gets 1 (vestigial).
  // The rep can override this freely in the UI.
  const actualDays = inclusiveDayCount(pickupDate, returnDate) ?? 1
  const rules = BILLING_RULES[department]
  // Explicit week-cadence phrasing ("2 days a week for 3 weeks") is
  // carried OUT of the line as statedDaysPerWeek and applied to the
  // line's whole department section afterwards (applySectionCadence)
  // — mirroring the builder's section-level Week control (Wes
  // 2026-08-31). This step prices at the department default.
  const aiCadence =
    typeof raw.daysPerWeek === 'number' && Number.isFinite(raw.daysPerWeek) &&
    raw.daysPerWeek >= 1 && raw.daysPerWeek <= 7
      ? Math.floor(raw.daysPerWeek)
      : null
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
    statedDaysPerWeek: aiCadence,
    rate,
    matchedProduct: matchedProduct
      ? { id: matchedProduct.id, type: matchedProduct.type, name: matchedProduct.name, lineType: matchedProduct.lineType }
      : null,
    matchSource,
    warnings,
  }
}

// SirReel agent inboxes — anything @sirreel.com is us, not a client
// contact. Defensive belt-and-suspenders to the AI prompt's own filter.

/**
 * The AI half: pasted text in, the model's raw JSON out. Throws
 * AiJsonError when the response was truncated or unreadable so each
 * caller can word its own failure.
 *
 * Deliberately separate from resolveParsedItems below, because
 * /api/orders/parse-quote has to repair impossible years on the
 * QUOTE-level dates in between — the header, the job window and every
 * line have to inherit the same repair, and fixing only the lines left
 * the header a year out.
 */
export async function parseQuoteText(text: string): Promise<{
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
  contacts?: unknown[]
}> {
  const catalog = await loadCatalogForSnippet()
  const snippet = renderCatalogSnippet(catalog)

  const response = await anthropic.messages.create({
    model: PARSING_MODEL,
    // 3000 was the root cause of "AI response was not valid JSON" on long
    // documents: a big items+contacts payload exceeds it, the JSON is cut
    // mid-object, and JSON.parse fails. 8192 fits any realistic quote.
    max_tokens: 8192,
    system: buildSystemPrompt(snippet),
    messages: [{ role: 'user', content: `Quote request:\n\n${text.slice(0, 15000)}` }],
  })
  const aiText = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseAiJson(aiText, { tag: 'parse-quote', stopReason: response.stop_reason })
}

/**
 * The deterministic half: raw AI items in, catalog-resolved order lines
 * out — matching, section cadence, then kit-piece expansion.
 *
 * `anchor` is the window an unanchored line inherits. Starting a quote
 * passes what the email itself said; adding to an EXISTING order passes
 * that order's window, so "we also need 4 more carts" bills on the same
 * days as everything already on the order rather than a range the model
 * inferred from a signature block.
 */
export async function resolveParsedItems(
  rawItems: AiItem[] | undefined,
  anchor?: { startDate?: string | null; endDate?: string | null },
): Promise<ResolvedItem[]> {
  const items: AiItem[] = Array.isArray(rawItems) ? rawItems : []
  const resolved = await Promise.all(
    items.map((it) =>
      resolveItem(it, {
        startDate: anchor?.startDate ?? undefined,
        endDate: anchor?.endDate ?? undefined,
      }),
    ),
  )
  // Cadence BEFORE kit expansion so kit pieces copy already-capped days.
  return appendKitPieces(applySectionCadence(resolved))
}

/**
 * Which LineItemType a resolved item becomes.
 *
 * Lived in /api/orders/from-parse until 2026-09-08, when the paste-onto-
 * an-existing-order path needed it too and guessed instead — it sent
 * 'INVENTORY' / 'ASSET', which are not members of the enum (VEHICLE,
 * EQUIPMENT, EXPENDABLE, LABOR, FEE, DISCOUNT), so every single line
 * 400'd and nothing reached the order. Shared now so there is one answer.
 */
export function resolveLineType(
  itemType: 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE' | null | undefined,
  department: LineItemDepartment,
  catalogLineType?: LineItemType | null,
): LineItemType {
  if (itemType === 'PACKAGE') return 'EQUIPMENT'
  if (catalogLineType) return catalogLineType
  if (itemType === 'ASSET_CATEGORY') return 'VEHICLE'
  if (department === 'EXPENDABLES') return 'EXPENDABLE'
  return 'EQUIPMENT'
}
