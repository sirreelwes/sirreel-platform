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

Extract structured data from a quote request (email, spec sheet, or order form) into the JSON shape below.

Return ONLY valid JSON, no markdown fences, no preamble. Omit top-level fields you cannot determine.

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
      "rentalDays": 1
    }
  ]
}

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

RENTAL DAYS

If startDate and endDate are present, set \`rentalDays\` to the inclusive day
count between them (Mar 30 → Apr 2 = 4). Otherwise default 1. The user can
adjust per line.

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
  rentalDays: number
}

interface ResolvedItem extends AiItem {
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

  // Step 5: rentalDays — trust AI; verify against parsed range; final fallback 1.
  let rentalDays = Number.isFinite(raw.rentalDays) && raw.rentalDays > 0 ? Math.floor(raw.rentalDays) : 1
  const computedDays = inclusiveDayCount(parsedRange.startDate, parsedRange.endDate)
  if (computedDays && Math.abs(computedDays - rentalDays) > 1) {
    // AI's rentalDays drifted from the dates — trust the dates.
    rentalDays = computedDays
  }

  return {
    description: raw.description,
    quantity: Math.max(1, Math.floor(raw.quantity || 1)),
    catalogProductId: matchedProduct?.id ?? null,
    catalogType: matchedProduct?.type ?? null,
    department,
    qualifier: raw.qualifier?.trim() || null,
    rateType,
    rentalDays,
    rate,
    matchedProduct: matchedProduct
      ? { id: matchedProduct.id, type: matchedProduct.type, name: matchedProduct.name }
      : null,
    matchSource,
    warnings,
  }
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
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[parse-quote] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
