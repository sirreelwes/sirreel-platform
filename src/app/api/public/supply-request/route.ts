/**
 * POST /api/public/supply-request — hardened public submission.
 *
 * Phase 3 chunk 3 of the supply-ordering brief. Unauthenticated by
 * design. Receives a cart + contact + production + delivery payload
 * from /order/supplies and writes a single Inquiry(WEB_FORM, NEW)
 * for the operator triage queue. No Job or Order is created here —
 * conversion goes through /orders/new-quote.
 *
 * Hardening:
 *   - Per-IP sliding-window rate limit (5 / 10 min default).
 *   - Honeypot field `website` — populated → silent 200 ok with a
 *     fake reference, no DB write.
 *   - Strict typed validation: required contact name + email, valid
 *     email format, plausible date strings, max cart size, qty caps.
 *   - Every itemId resolved against publicVisible=true InventoryItem
 *     rows server-side (rejects legacy/RW/unreviewed items).
 *   - Server-snapshots every line's price + name + type — stale
 *     client carts can't fake totals.
 *   - Captcha env-gated (TURNSTILE_SECRET_KEY). If unset, skipped —
 *     so dev/local testing isn't blocked. Verify before launch by
 *     populating the env var.
 *   - **No getServerSession()** here — public endpoint must never
 *     accidentally attach an authenticated user as assignedTo.
 *
 * Reference: SR-REQ-NNNN where N is (count of WEB_FORM inquiries + 1)
 * zero-padded. Race-tolerant — two concurrent submissions might end
 * up sharing a reference; the inquiry IDs are still distinct and
 * the reference is for client/agent eyeballs, not a unique key.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const CART_MAX_ITEMS = 50
const QTY_MAX = 1000
const NOTES_MAX = 5000

interface CartLineIn {
  itemId?: unknown
  quantity?: unknown
}
interface SubmitBody {
  contact?: { name?: unknown; email?: unknown; phone?: unknown; role?: unknown }
  production?: {
    companyName?: unknown
    jobName?: unknown
    poNumber?: unknown
    jobNumber?: unknown
  }
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

function bad(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

function fakeReference(): string {
  // Honeypot path — bots get a plausible-looking response.
  const n = Math.floor(Math.random() * 9000) + 1000
  return `SR-REQ-${n}`
}

async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // env-gated off in dev/local
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

function deriveDaysFromWindow(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1)
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req)

  // ── Rate limit (per IP, sliding window) ────────────────────
  const rl = checkRateLimit(`supply-request:${ip}`)
  if (!rl.ok) {
    return bad(429, 'Too many requests. Try again shortly.', { retryAfterSeconds: rl.retryAfterSeconds })
  }

  const body = (await req.json().catch(() => null)) as SubmitBody | null
  if (!body) return bad(400, 'invalid JSON body')

  // ── Honeypot ───────────────────────────────────────────────
  // Bots that auto-fill every visible field tend to populate the
  // hidden `website` slot. Pretend success — no DB write — so the
  // bot can't tell its submission was rejected.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return NextResponse.json({
      ok: true,
      reference: fakeReference(),
      message: 'Request received.',
    })
  }

  // ── Captcha (env-gated) ────────────────────────────────────
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

  // ── Dates ─────────────────────────────────────────────────
  const startStr = isYmd(body.dates?.start) ? (body.dates!.start as string) : null
  if (!startStr) return bad(400, 'dates.start required (YYYY-MM-DD)')
  const endStr = isYmd(body.dates?.end) ? (body.dates!.end as string) : startStr
  if (endStr < startStr) return bad(400, 'dates.end must be on or after dates.start')

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

  // ── Cart ──────────────────────────────────────────────────
  if (!Array.isArray(body.cart) || body.cart.length === 0) return bad(400, 'cart cannot be empty')
  if (body.cart.length > CART_MAX_ITEMS) return bad(400, `cart exceeds max ${CART_MAX_ITEMS} items`)

  type Line = { itemId: string; quantity: number }
  const lines: Line[] = []
  for (const raw of body.cart) {
    const itemId = asString(raw.itemId)
    const quantity = asInt(raw.quantity, QTY_MAX)
    if (!itemId) return bad(400, 'each cart line needs an itemId')
    if (!quantity) return bad(400, `quantity must be 1..${QTY_MAX}`)
    lines.push({ itemId, quantity })
  }

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
    if (!itemById.has(l.itemId)) return bad(400, `unknown or unavailable item: ${l.itemId}`)
  }

  // ── Notes ─────────────────────────────────────────────────
  const notes = (() => {
    if (typeof body.notes !== 'string') return null
    const t = body.notes.trim()
    if (!t) return null
    return t.length > NOTES_MAX ? t.slice(0, NOTES_MAX) : t
  })()

  // ── Snapshot lines + totals (server-computed) ─────────────
  const rentalDays = deriveDaysFromWindow(startStr, endStr)
  const snapshot = lines.map((l) => {
    const row = itemById.get(l.itemId)!
    const unitPrice = Number(row.dailyRate)
    const isRental = row.type === 'EQUIPMENT'
    const days = isRental ? rentalDays : 1
    const lineTotal = unitPrice * l.quantity * (isRental ? days : 1)
    return {
      itemId: row.id,
      code: row.code,
      name: row.description ?? row.code,
      type: row.type,
      category: row.category?.name ?? '',
      unitPrice,
      quantity: l.quantity,
      days: isRental ? days : null,
      lineTotal,
    }
  })
  const grandTotal = snapshot.reduce((s, l) => s + l.lineTotal, 0)
  const totalUnits = snapshot.reduce((s, l) => s + l.quantity, 0)

  // ── Reference SR-REQ-NNNN ─────────────────────────────────
  // Count existing WEB_FORM inquiries + 1, zero-padded. Race-tolerant
  // (worst case is duplicate references on simultaneous submissions;
  // the inquiry ids are still unique, the ref is just for eyeballs).
  const seq = (await prisma.inquiry.count({ where: { source: 'WEB_FORM' } })) + 1
  const reference = `SR-REQ-${String(seq).padStart(4, '0')}`

  // ── Inquiry write ─────────────────────────────────────────
  const titleClient = companyName
  const titleProd = jobName ? ` · ${jobName}` : ''
  const title = `Supply request — ${titleClient}${titleProd}`

  const description = [
    `${reference} · From ${contactName} <${contactEmail}>${contactPhone ? ` · ${contactPhone}` : ''}`,
    `Company: ${companyName}`,
    jobName ? `Production: ${jobName}` : null,
    contactRole ? `Role: ${contactRole}` : null,
    poNumber ? `PO #: ${poNumber}` : null,
    jobNumber ? `Job #: ${jobNumber}` : null,
    `Dates: ${startStr} → ${endStr} (${rentalDays}d rental window)`,
    `Delivery: ${deliveryMethod}${deliveryAddress ? ` — ${deliveryAddress}` : ''}`,
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

  await prisma.inquiry.create({
    data: {
      title,
      description,
      source: 'WEB_FORM',
      status: 'NEW',
      estimatedValue: grandTotal,
      preferredStartDate: new Date(startStr),
      preferredEndDate: new Date(endStr),
      sourceMetadata: {
        kind: 'supply-order',
        reference,
        contact: { name: contactName, email: contactEmail, phone: contactPhone, role: contactRole },
        production: { companyName, jobName, poNumber, jobNumber },
        dates: { start: startStr, end: endStr, rentalDays },
        delivery: { method: deliveryMethod, address: deliveryAddress },
        cart: snapshot,
        totals: { units: totalUnits, amount: grandTotal },
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
