/**
 * POST /api/public/supplies/submit — public supply-order submission.
 *
 * Phase 3 of the supply-ordering brief. Unauthenticated. Receives a
 * cart + contact + dates payload from /supplies, validates every
 * itemId against publicVisible InventoryItem rows (snapshot prices
 * server-side so a stale client cart can't fake totals), and writes
 * one Inquiry(source=WEB_FORM, status=NEW) carrying the full payload
 * in sourceMetadata for the operator-triage queue (Phase 4).
 *
 * No Job or Order is created here — those land when an agent picks
 * up the Inquiry from the queue and runs it through /orders/new-quote
 * (which already wires Inquiry.convertedJobId on conversion).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const CART_MAX_ITEMS = 50
const QTY_MAX = 1000
const DAYS_MAX = 365
const NOTES_MAX = 5000

interface CartLineIn {
  itemId?: unknown
  quantity?: unknown
  days?: unknown
}
interface SubmitBody {
  contact?: { name?: unknown; email?: unknown; phone?: unknown }
  production?: { companyName?: unknown; productionName?: unknown }
  dates?: { start?: unknown; end?: unknown }
  cart?: CartLineIn[]
  notes?: unknown
}

function isPlausibleEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}
function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function asInt(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.floor(v)
  if (n < 1 || n > max) return null
  return n
}
function asString(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SubmitBody | null
  if (!body) return bad(400, 'invalid JSON body')

  // Contact — name + email required, phone optional.
  const contactName = asString(body.contact?.name)
  const contactEmail = isPlausibleEmail(body.contact?.email)
    ? (body.contact!.email as string).trim().toLowerCase()
    : null
  const contactPhone = asString(body.contact?.phone, 30)
  if (!contactName) return bad(400, 'contact.name required')
  if (!contactEmail) return bad(400, 'contact.email required and must look like an email')

  // Production (optional metadata).
  const companyName = asString(body.production?.companyName)
  const productionName = asString(body.production?.productionName)

  // Dates — required only when the cart contains any EQUIPMENT item.
  // We re-derive that after cart validation; capture inputs now.
  const startStr = isYmd(body.dates?.start) ? (body.dates!.start as string) : null
  const endStr = isYmd(body.dates?.end) ? (body.dates!.end as string) : null
  if ((startStr && !endStr) || (!startStr && endStr)) {
    return bad(400, 'dates.start and dates.end must be both set or both omitted')
  }
  if (startStr && endStr && endStr < startStr) return bad(400, 'dates.end must be on or after dates.start')

  // Cart shape.
  if (!Array.isArray(body.cart) || body.cart.length === 0) return bad(400, 'cart cannot be empty')
  if (body.cart.length > CART_MAX_ITEMS) return bad(400, `cart exceeds max ${CART_MAX_ITEMS} items`)

  type Line = { itemId: string; quantity: number; days: number | null }
  const lines: Line[] = []
  for (const raw of body.cart) {
    const itemId = asString(raw.itemId)
    const quantity = asInt(raw.quantity, QTY_MAX)
    if (!itemId) return bad(400, 'each cart line needs an itemId')
    if (!quantity) return bad(400, `quantity must be 1..${QTY_MAX}`)
    const days = raw.days == null ? null : asInt(raw.days, DAYS_MAX)
    if (raw.days != null && !days) return bad(400, `days must be 1..${DAYS_MAX} when provided`)
    lines.push({ itemId, quantity, days })
  }

  // Resolve each cart itemId against publicVisible InventoryItem.
  // Items not in this set (legacy / RW / unreviewed) are rejected —
  // we don't let clients order things outside the curated catalog.
  const itemRows = await prisma.inventoryItem.findMany({
    where: {
      id: { in: lines.map((l) => l.itemId) },
      publicVisible: true,
      isActive: true,
      categoryId: { not: null },
    },
    select: {
      id: true,
      code: true,
      description: true,
      dailyRate: true,
      type: true,
      category: { select: { name: true, slug: true } },
    },
  })
  const itemById = new Map(itemRows.map((r) => [r.id, r]))
  for (const l of lines) {
    if (!itemById.has(l.itemId)) {
      return bad(400, `unknown or unavailable item: ${l.itemId}`)
    }
  }

  // EQUIPMENT items need a rental window. EXPENDABLE items don't.
  const hasEquipment = lines.some((l) => itemById.get(l.itemId)!.type === 'EQUIPMENT')
  if (hasEquipment && (!startStr || !endStr)) {
    return bad(400, 'dates.start and dates.end required when cart contains rental items')
  }

  // Server-snapshot every line (price, name, type) so the historical
  // record on the Inquiry stays accurate even if the catalog changes
  // later. Compute lineTotal + grand total here, not from client input.
  type SnapshotLine = {
    itemId: string
    code: string
    name: string
    type: string
    category: string
    unitPrice: number
    quantity: number
    days: number | null
    lineTotal: number
  }
  const snapshot: SnapshotLine[] = lines.map((l) => {
    const row = itemById.get(l.itemId)!
    const unitPrice = Number(row.dailyRate)
    const isRental = row.type === 'EQUIPMENT'
    const billDays = isRental ? l.days ?? deriveDaysFromWindow(startStr, endStr) ?? 1 : 1
    const lineTotal = unitPrice * l.quantity * (isRental ? billDays : 1)
    return {
      itemId: row.id,
      code: row.code,
      name: row.description ?? row.code,
      type: row.type,
      category: row.category?.name ?? '',
      unitPrice,
      quantity: l.quantity,
      days: isRental ? billDays : null,
      lineTotal,
    }
  })
  const grandTotal = snapshot.reduce((s, l) => s + l.lineTotal, 0)
  const totalUnits = snapshot.reduce((s, l) => s + l.quantity, 0)

  const notes = (() => {
    if (typeof body.notes !== 'string') return null
    const t = body.notes.trim()
    if (!t) return null
    return t.length > NOTES_MAX ? t.slice(0, NOTES_MAX) : t
  })()

  // Inquiry title — agent-readable in the triage queue.
  const titleClient = companyName || contactName
  const titleProd = productionName ? ` · ${productionName}` : ''
  const title = `Supply request — ${titleClient}${titleProd}`

  // Description — operator-readable cart rendering. Phase 4 triage UI
  // will render the structured sourceMetadata instead; this text is the
  // human-eyeball fallback for list views.
  const description = [
    `From ${contactName} <${contactEmail}>${contactPhone ? ` · ${contactPhone}` : ''}`,
    companyName ? `Company: ${companyName}` : null,
    productionName ? `Production: ${productionName}` : null,
    startStr && endStr ? `Dates: ${startStr} → ${endStr}` : null,
    `${totalUnits} unit(s), estimated $${grandTotal.toFixed(2)}`,
    '',
    'Cart:',
    ...snapshot.map(
      (l) =>
        `  - ${l.quantity}× ${l.name}` +
        (l.type === 'EQUIPMENT' && l.days ? ` × ${l.days}d` : '') +
        ` @ $${l.unitPrice}${l.type === 'EQUIPMENT' ? '/day' : '/ea'}` +
        ` = $${l.lineTotal.toFixed(2)}`,
    ),
    notes ? `\nNotes:\n${notes}` : '',
  ]
    .filter((s) => s != null)
    .join('\n')

  const inquiry = await prisma.inquiry.create({
    data: {
      title,
      description,
      source: 'WEB_FORM',
      status: 'NEW',
      estimatedValue: grandTotal,
      preferredStartDate: startStr ? new Date(startStr) : null,
      preferredEndDate: endStr ? new Date(endStr) : null,
      sourceMetadata: {
        kind: 'supply-order',
        contact: { name: contactName, email: contactEmail, phone: contactPhone },
        production: { companyName, productionName },
        dates: { start: startStr, end: endStr },
        cart: snapshot,
        totals: { units: totalUnits, amount: grandTotal },
        notes,
        submittedAt: new Date().toISOString(),
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: req.headers.get('user-agent') || null,
      },
    },
    select: { id: true },
  })

  return NextResponse.json({
    ok: true,
    reference: inquiry.id.slice(0, 8).toUpperCase(),
    message: 'Request received. Your SirReel agent will follow up shortly.',
  })
}

function deriveDaysFromWindow(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
}
