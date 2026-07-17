/**
 * POST /api/public/supply-request — hardened public submission.
 *
 * Receives a unified cart (supplies + vehicles) + contact + production
 * + delivery payload from the public production-order page and writes
 * a single Inquiry(WEB_FORM, NEW) for the operator triage queue. No
 * Job or Order is created here — conversion goes through /orders/new-quote.
 *
 * Unified cart shape (each line carries its own dates):
 *   { itemKind: 'SUPPLY' | 'VEHICLE', itemId, qty, pickupDate, returnDate }
 *
 * SUPPLY lines resolve against publicVisible=true InventoryItem rows;
 * VEHICLE lines resolve against active=true VehicleCategory rows.
 * Inquiry-level preferredStartDate / preferredEndDate are derived
 * server-side as min(pickupDate) / max(returnDate) across all lines.
 *
 * Hardening:
 *   - Per-IP sliding-window rate limit (5 / 10 min default).
 *   - Honeypot field `website` — populated → silent 200 ok with a
 *     fake reference, no DB write.
 *   - Strict typed validation: required contact name + email, valid
 *     email format, plausible date strings, max cart size, qty caps.
 *   - Every itemId resolved against the appropriate public catalog
 *     server-side (rejects legacy/RW/unreviewed items).
 *   - Server-snapshots every line's price + name + type — stale
 *     client carts can't fake totals.
 *   - Captcha env-gated (TURNSTILE_SECRET_KEY).
 *   - **No getServerSession()** here — public endpoint must never
 *     accidentally attach an authenticated user as assignedTo.
 *
 * Reference: SR-REQ-NNNN where N is (count of WEB_FORM inquiries + 1)
 * zero-padded. Race-tolerant — two concurrent submissions might end
 * up sharing a reference; the inquiry IDs are still distinct.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const CART_MAX_ITEMS = 50
const QTY_MAX = 1000
const NOTES_MAX = 5000

type ItemKind = 'SUPPLY' | 'VEHICLE'

interface CartLineIn {
  itemKind?: unknown
  itemId?: unknown
  qty?: unknown
  pickupDate?: unknown
  returnDate?: unknown
  /** Client shoot-days claim (gear/vehicle rentals only) — a REQUEST. */
  claimedDays?: unknown
}
interface SubmitBody {
  contact?: { name?: unknown; email?: unknown; phone?: unknown; role?: unknown }
  production?: {
    companyName?: unknown
    jobName?: unknown
    poNumber?: unknown
    jobNumber?: unknown
  }
  /** Legacy form-level window. Ignored when cart lines carry dates —
   *  inquiry dates are derived from min/max across lines. Kept here
   *  for tolerance until the form-level inputs are removed. */
  dates?: { start?: unknown; end?: unknown }
  delivery?: { method?: unknown; address?: unknown }
  cart?: CartLineIn[]
  notes?: unknown
  /** Honeypot — must be empty. */
  website?: unknown
  /** Captcha token from the client widget when TURNSTILE_SECRET_KEY is set. */
  captchaToken?: unknown
}

const DELIVERY_METHODS = ['will-call', 'sirreel-vehicle', 'stage', 'location'] as const
type DeliveryMethod = (typeof DELIVERY_METHODS)[number]

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
function asItemKind(v: unknown): ItemKind | null {
  return v === 'SUPPLY' || v === 'VEHICLE' ? v : null
}

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

function fakeReference(): string {
  const n = Math.floor(Math.random() * 9000) + 1000
  return `SR-REQ-${n}`
}

async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip })
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

// Ruled formula (Wes, shoot-days claim build): computedDays =
// max(1, returnDate − pickupDate) — EXCLUSIVE count. Matches
// src/lib/orders/days.ts computeDays(); keep in lockstep.
function rentalDaysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1
  return Math.max(1, Math.round((e - s) / 86_400_000))
}

// Client shoot-days CLAIM — a REQUEST, never a price. Bounded sanity
// only; approval happens agent-side in HQ.
function sanitizeClaim(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  if (!Number.isInteger(n) || n < 1 || n > 365) return null
  return n
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  const rl = checkRateLimit(`supply-request:${ip}`)
  if (!rl.ok) {
    return bad(429, 'Too many requests. Try again shortly.', { retryAfterSeconds: rl.retryAfterSeconds })
  }

  const body = (await req.json().catch(() => null)) as SubmitBody | null
  if (!body) return bad(400, 'invalid JSON body')

  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({
      ok: true,
      reference: fakeReference(),
      message: 'Request received.',
    })
  }

  const captchaOk = await verifyTurnstile(
    typeof body.captchaToken === 'string' ? body.captchaToken : null,
    ip,
  )
  if (!captchaOk) return bad(400, 'captcha failed')

  // ── Contact ───────────────────────────────────────────────
  const contactName = asString(body.contact?.name)
  const contactEmail = isPlausibleEmail(body.contact?.email)
    ? (body.contact!.email as string).trim().toLowerCase()
    : null
  const contactPhone = asString(body.contact?.phone, 30)
  const contactRole = asString(body.contact?.role)
  if (!contactName) return bad(400, 'contact.name required')
  if (!contactEmail) return bad(400, 'contact.email required')

  // ── Production ────────────────────────────────────────────
  const companyName = asString(body.production?.companyName)
  if (!companyName) return bad(400, 'production.companyName required')
  const jobName = asString(body.production?.jobName)
  const poNumber = asString(body.production?.poNumber, 60)
  const jobNumber = asString(body.production?.jobNumber, 60)

  // ── Delivery ──────────────────────────────────────────────
  const deliveryMethod = body.delivery?.method
  if (typeof deliveryMethod !== 'string' || !DELIVERY_METHODS.includes(deliveryMethod as DeliveryMethod)) {
    return bad(400, `delivery.method required (one of ${DELIVERY_METHODS.join(', ')})`)
  }
  const deliveryAddress =
    deliveryMethod === 'location'
      ? asString(body.delivery?.address, 500)
      : null
  if (deliveryMethod === 'location' && !deliveryAddress) {
    return bad(400, 'delivery.address required when method=location')
  }

  // ── Cart (unified) ────────────────────────────────────────
  if (!Array.isArray(body.cart) || body.cart.length === 0) return bad(400, 'cart cannot be empty')
  if (body.cart.length > CART_MAX_ITEMS) return bad(400, `cart exceeds max ${CART_MAX_ITEMS} items`)

  type ParsedLine = {
    itemKind: ItemKind
    itemId: string
    qty: number
    pickupDate: string
    returnDate: string
    claimedDays: number | null
  }
  const lines: ParsedLine[] = []
  for (const raw of body.cart) {
    const itemKind = asItemKind(raw.itemKind)
    if (!itemKind) return bad(400, 'each cart line needs itemKind (SUPPLY|VEHICLE)')
    const itemId = asString(raw.itemId)
    if (!itemId) return bad(400, 'each cart line needs an itemId')
    const qty = asInt(raw.qty, QTY_MAX)
    if (!qty) return bad(400, `qty must be 1..${QTY_MAX}`)
    const pickupDate = isYmd(raw.pickupDate) ? (raw.pickupDate as string) : null
    if (!pickupDate) return bad(400, 'each cart line needs pickupDate (YYYY-MM-DD)')
    const returnDate = isYmd(raw.returnDate) ? (raw.returnDate as string) : pickupDate
    if (returnDate < pickupDate) return bad(400, 'returnDate must be on or after pickupDate')
    lines.push({ itemKind, itemId, qty, pickupDate, returnDate, claimedDays: sanitizeClaim(raw.claimedDays) })
  }

  // ── Resolve catalog rows per kind ─────────────────────────
  const supplyIds = lines.filter((l) => l.itemKind === 'SUPPLY').map((l) => l.itemId)
  const vehicleIds = lines.filter((l) => l.itemKind === 'VEHICLE').map((l) => l.itemId)

  const [supplyRows, vehicleRows] = await Promise.all([
    supplyIds.length
      ? prisma.inventoryItem.findMany({
          where: {
            id: { in: supplyIds },
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
      : Promise.resolve([]),
    vehicleIds.length
      ? prisma.vehicleCategory.findMany({
          where: { id: { in: vehicleIds }, active: true },
          select: {
            id: true,
            name: true,
            slug: true,
            subtitle: true,
            dailyRate: true,
          },
        })
      : Promise.resolve([]),
  ])

  const supplyById = new Map(supplyRows.map((r) => [r.id, r]))
  const vehicleById = new Map(vehicleRows.map((r) => [r.id, r]))

  for (const l of lines) {
    if (l.itemKind === 'SUPPLY' && !supplyById.has(l.itemId)) {
      return bad(400, `unknown or unavailable supply item: ${l.itemId}`)
    }
    if (l.itemKind === 'VEHICLE' && !vehicleById.has(l.itemId)) {
      return bad(400, `unknown or unavailable vehicle category: ${l.itemId}`)
    }
  }

  // ── Notes ─────────────────────────────────────────────────
  const notes = (() => {
    if (typeof body.notes !== 'string') return null
    const t = body.notes.trim()
    if (!t) return null
    return t.length > NOTES_MAX ? t.slice(0, NOTES_MAX) : t
  })()

  // ── Per-line snapshot + totals (server-computed) ──────────
  // Vehicles are always treated as rentals (days = pickup→return).
  // Supplies: EQUIPMENT type is a rental, anything else (CONSUMABLE,
  // etc) is a flat per-unit charge with days=null.
  const snapshot = lines.map((l) => {
    const days = rentalDaysBetween(l.pickupDate, l.returnDate)
    if (l.itemKind === 'VEHICLE') {
      const row = vehicleById.get(l.itemId)!
      const unitPrice = row.dailyRate == null ? 0 : Number(row.dailyRate)
      const lineTotal = unitPrice * l.qty * days
      return {
        itemKind: 'VEHICLE' as const,
        itemId: row.id,
        code: row.slug,
        name: row.name + (row.subtitle ? ` (${row.subtitle})` : ''),
        type: 'VEHICLE',
        category: 'Vehicle',
        unitPrice,
        qty: l.qty,
        pickupDate: l.pickupDate,
        returnDate: l.returnDate,
        days,
        // Claim recorded verbatim (≠ computed only); NEVER used in
        // lineTotal here — the agent approves it into billableDays in HQ.
        claimedDays: l.claimedDays != null && l.claimedDays !== days ? l.claimedDays : null,
        lineTotal,
        priceOnQuote: unitPrice === 0,
      }
    }
    const row = supplyById.get(l.itemId)!
    const unitPrice = Number(row.dailyRate)
    const isRental = row.type === 'EQUIPMENT'
    const effDays = isRental ? days : 1
    const lineTotal = unitPrice * l.qty * effDays
    return {
      itemKind: 'SUPPLY' as const,
      itemId: row.id,
      code: row.code,
      name: row.description ?? row.code,
      type: row.type,
      category: row.category?.name ?? '',
      unitPrice,
      qty: l.qty,
      pickupDate: l.pickupDate,
      returnDate: l.returnDate,
      days: isRental ? days : null,
      claimedDays: isRental && l.claimedDays != null && l.claimedDays !== days ? l.claimedDays : null,
      lineTotal,
      priceOnQuote: false,
    }
  })

  const grandTotal = snapshot.reduce((s, l) => s + l.lineTotal, 0)
  const totalUnits = snapshot.reduce((s, l) => s + l.qty, 0)
  const hasPriceOnQuote = snapshot.some((l) => l.priceOnQuote)

  // Inquiry-level date window = min(pickup) / max(return) across lines.
  const windowStart = snapshot.reduce((acc, l) => (l.pickupDate < acc ? l.pickupDate : acc), snapshot[0].pickupDate)
  const windowEnd = snapshot.reduce((acc, l) => (l.returnDate > acc ? l.returnDate : acc), snapshot[0].returnDate)
  const windowDays = rentalDaysBetween(windowStart, windowEnd)

  // ── Reference SR-REQ-NNNN ─────────────────────────────────
  const seq = (await prisma.inquiry.count({ where: { source: 'WEB_FORM' } })) + 1
  const reference = `SR-REQ-${String(seq).padStart(4, '0')}`

  // ── Inquiry write ─────────────────────────────────────────
  const titleClient = companyName
  const titleProd = jobName ? ` · ${jobName}` : ''
  const title = `Production request — ${titleClient}${titleProd}`

  const description = [
    `${reference} · From ${contactName} <${contactEmail}>${contactPhone ? ` · ${contactPhone}` : ''}`,
    `Company: ${companyName}`,
    jobName ? `Production: ${jobName}` : null,
    contactRole ? `Role: ${contactRole}` : null,
    poNumber ? `PO #: ${poNumber}` : null,
    jobNumber ? `Job #: ${jobNumber}` : null,
    `Window: ${windowStart} → ${windowEnd} (${windowDays}d span across lines)`,
    `Delivery: ${deliveryMethod}${deliveryAddress ? ` — ${deliveryAddress}` : ''}`,
    `${totalUnits} unit(s), estimated $${grandTotal.toFixed(2)}${hasPriceOnQuote ? ' (some lines price-on-quote)' : ''}`,
    '',
    'Cart:',
    ...snapshot.map((l) => {
      const dateChunk =
        l.pickupDate === l.returnDate ? l.pickupDate : `${l.pickupDate}→${l.returnDate}`
      const priceChunk = l.priceOnQuote
        ? 'PRICE ON QUOTE'
        : `@ $${l.unitPrice}${l.itemKind === 'VEHICLE' || l.type === 'EQUIPMENT' ? '/day' : '/ea'}` +
          (l.days ? ` × ${l.days}d` : '') +
          ` = $${l.lineTotal.toFixed(2)}`
      return `  - [${l.itemKind}] ${l.qty}× ${l.name} (${dateChunk}) ${priceChunk}`
    }),
    notes ? `\nNotes:\n${notes}` : '',
  ]
    .filter((s) => s != null)
    .join('\n')

  await prisma.inquiry.create({
    data: {
      title,
      description,
      source: 'WEB_FORM',
      status: 'NEW',
      estimatedValue: grandTotal,
      preferredStartDate: new Date(windowStart),
      preferredEndDate: new Date(windowEnd),
      sourceMetadata: {
        kind: 'production-order',
        reference,
        contact: { name: contactName, email: contactEmail, phone: contactPhone, role: contactRole },
        production: { companyName, jobName, poNumber, jobNumber },
        window: { start: windowStart, end: windowEnd, days: windowDays },
        delivery: { method: deliveryMethod, address: deliveryAddress },
        cart: snapshot,
        totals: { units: totalUnits, amount: grandTotal, hasPriceOnQuote },
        notes,
        submittedAt: new Date().toISOString(),
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: req.headers.get('user-agent') || null,
      },
    },
    select: { id: true },
  })

  return NextResponse.json({
    ok: true,
    reference,
    message: 'Request received. Your SirReel agent will follow up shortly.',
  })
}
