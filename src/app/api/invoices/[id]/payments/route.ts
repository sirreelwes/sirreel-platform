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
 *     receivedAt?: 'YYYY-MM-DD',  // optional; a Pacific day, defaults to now
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
import { manualReceivedAt } from '@/lib/invoices/manualReceivedAt'

export const dynamic = 'force-dynamic'

const VALID_METHODS: PaymentMethod[] = [
  'CHECK',
  'WIRE',
  'ACH',
  'CREDIT_CARD',
  'CARDPOINTE',
  'CASH',
  'ZELLE',
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
  // A calendar day, placed inside that PACIFIC day — see manualReceivedAt.
  // Stored as UTC midnight it read as the afternoon before, and that is the
  // day the EOD report and the order page then showed.
  const received = manualReceivedAt(body.receivedAt)
  if (!received.ok) {
    return NextResponse.json({ ok: false, error: received.error }, { status: 400 })
  }
  const receivedAt = received.at
  const reference =
    typeof body.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 200)
      : null
  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 5000)
      : null
  const allowOverpay = body.allowOverpay === true

  // "How was it paid" is the point of recording by hand (Ana, 2026-09-11).
  // Every other method names itself; Other says nothing unless someone does.
  if (method === 'OTHER' && !reference && !notes) {
    return NextResponse.json(
      { ok: false, error: 'say how it was paid — Other needs a reference or a note' },
      { status: 400 },
    )
  }

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
