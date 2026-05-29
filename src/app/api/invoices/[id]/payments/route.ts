/**
 * POST /api/invoices/[id]/payments  — record a payment.
 * GET  /api/invoices/[id]/payments  — list payments on this invoice.
 *
 * Phase 5 commit 3 — payment recording + INVOICED → CLOSED advance
 * when the rental invoice hits PAID.
 *
 * Auth: any authenticated session. The order detail UI gates the
 * Record-payment affordance on perms.billing.
 *
 * POST body:
 *   {
 *     amount: number,         // required, > 0
 *     method: PaymentMethod,  // required
 *     receivedAt?: 'YYYY-MM-DD',  // optional, defaults to today
 *     reference?: string,     // check #, wire id, etc.
 *     notes?: string,
 *     allowOverpay?: boolean  // default false
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { PaymentMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordPayment } from '@/lib/invoices/recordPayment'

export const dynamic = 'force-dynamic'

const VALID_METHODS: PaymentMethod[] = [
  'CHECK',
  'WIRE',
  'ACH',
  'CREDIT_CARD',
  'CARDPOINTE',
  'CASH',
  'OTHER',
]

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    amount?: unknown
    method?: unknown
    receivedAt?: unknown
    reference?: unknown
    notes?: unknown
    allowOverpay?: unknown
  }

  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount)
  if (!Number.isFinite(amount)) {
    return NextResponse.json({ error: 'amount required (number)' }, { status: 400 })
  }
  const method =
    typeof body.method === 'string' && VALID_METHODS.includes(body.method as PaymentMethod)
      ? (body.method as PaymentMethod)
      : null
  if (!method) {
    return NextResponse.json(
      { error: `method required (one of ${VALID_METHODS.join(', ')})` },
      { status: 400 },
    )
  }
  const receivedAt =
    typeof body.receivedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.receivedAt)
      ? new Date(`${body.receivedAt}T00:00:00.000Z`)
      : new Date()
  const reference =
    typeof body.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 200)
      : null
  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 5000)
      : null
  const allowOverpay = body.allowOverpay === true

  const result = await recordPayment({
    invoiceId: params.id,
    amount,
    method,
    receivedAt,
    reference,
    notes,
    recordedById: user.id,
    allowOverpay,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result, { status: 201 })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const payments = await prisma.payment.findMany({
    where: { invoiceId: params.id },
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      receivedAt: true,
      notes: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      recordedBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true } },
    },
    orderBy: { receivedAt: 'desc' },
  })
  return NextResponse.json({ payments })
}
