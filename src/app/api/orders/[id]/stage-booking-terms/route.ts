import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Stage booking terms — the negotiated parameters captured by sales before
 * a stage contract PDF can be generated. One row per order; client-facing
 * fields only (no internal cost data). The PDF generator in
 * /api/orders/[id]/generate-stage-contract reads this row and renders the
 * Terms section accordingly.
 *
 * GET  → returns current terms (or null if not yet captured)
 * PUT  → upsert (sales rep saves / updates)
 */

interface StageBookingTermsInput {
  rentalDates?: unknown
  dailyRate?: unknown
  productionOfficeRental?: unknown
  specificSpaces?: unknown
  securityGuardRequired?: unknown
  salesNotes?: unknown
}

function isoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function coerceTerms(input: StageBookingTermsInput): {
  ok: true
  data: {
    rentalDates: string[]
    dailyRate: string
    productionOfficeRental: boolean
    specificSpaces: string[]
    securityGuardRequired: boolean
    salesNotes: string | null
  }
} | { ok: false; error: string } {
  // rentalDates must be a non-empty array of yyyy-MM-dd strings.
  const dates = Array.isArray(input.rentalDates) ? input.rentalDates : null
  if (!dates || dates.length === 0) return { ok: false, error: 'rentalDates: provide at least one date' }
  for (const d of dates) {
    if (typeof d !== 'string' || !isoDate(d)) {
      return { ok: false, error: `rentalDates: "${String(d)}" is not in yyyy-MM-dd format` }
    }
  }

  // dailyRate stored as Decimal — accept number or numeric string. Reject
  // anything that can't round-trip as a positive amount.
  const rateRaw = input.dailyRate
  const rateNum = typeof rateRaw === 'number' ? rateRaw : typeof rateRaw === 'string' ? Number(rateRaw) : NaN
  if (!Number.isFinite(rateNum) || rateNum <= 0) {
    return { ok: false, error: 'dailyRate must be a positive number' }
  }

  const spaces = Array.isArray(input.specificSpaces)
    ? input.specificSpaces.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => String(s).trim())
    : []

  return {
    ok: true,
    data: {
      rentalDates: dates as string[],
      dailyRate: rateNum.toFixed(2),
      productionOfficeRental: input.productionOfficeRental === true,
      specificSpaces: spaces,
      securityGuardRequired: input.securityGuardRequired === true,
      salesNotes: typeof input.salesNotes === 'string' && input.salesNotes.trim() !== ''
        ? input.salesNotes.trim()
        : null,
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const row = await prisma.stageBookingTerms.findUnique({
    where: { orderId: params.id },
  })
  if (!row) return NextResponse.json({ terms: null })

  return NextResponse.json({
    terms: {
      id: row.id,
      rentalDates: row.rentalDates,
      dailyRate: row.dailyRate.toString(),
      productionOfficeRental: row.productionOfficeRental,
      specificSpaces: row.specificSpaces,
      securityGuardRequired: row.securityGuardRequired,
      salesNotes: row.salesNotes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const order = await prisma.order.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as StageBookingTermsInput
  const coerced = coerceTerms(body)
  if (!coerced.ok) return NextResponse.json({ error: coerced.error }, { status: 400 })

  const saved = await prisma.stageBookingTerms.upsert({
    where: { orderId: params.id },
    create: {
      orderId: params.id,
      ...coerced.data,
      createdById: user.id,
    },
    update: {
      rentalDates: coerced.data.rentalDates,
      dailyRate: coerced.data.dailyRate,
      productionOfficeRental: coerced.data.productionOfficeRental,
      specificSpaces: coerced.data.specificSpaces,
      securityGuardRequired: coerced.data.securityGuardRequired,
      salesNotes: coerced.data.salesNotes,
    },
  })

  return NextResponse.json({
    terms: {
      id: saved.id,
      rentalDates: saved.rentalDates,
      dailyRate: saved.dailyRate.toString(),
      productionOfficeRental: saved.productionOfficeRental,
      specificSpaces: saved.specificSpaces,
      securityGuardRequired: saved.securityGuardRequired,
      salesNotes: saved.salesNotes,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    },
  })
}
