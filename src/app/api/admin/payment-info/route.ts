/**
 * /api/admin/payment-info — Wes-managed payment/ACH details
 * (requireAdmin on every method). The ONLY storage for banking
 * details: SiteSetting.paymentDetails (server-side DB column). Never
 * in the repo, never in Blob, never client-reachable outside this
 * admin surface — public delivery is EMAIL ONLY via
 * /api/public/payment-info. Every change is audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

const SINGLETON = 'singleton'

export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { paymentDetails: true },
  })
  return NextResponse.json({ paymentDetails: s?.paymentDetails ?? '' })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as { paymentDetails?: unknown } | null
  const next = typeof body?.paymentDetails === 'string' ? body.paymentDetails.trim().slice(0, 5000) : null
  if (next === null) {
    return NextResponse.json({ error: 'paymentDetails (string) required' }, { status: 400 })
  }

  const prior = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { paymentDetails: true },
  })

  await prisma.siteSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, paymentDetails: next || null },
    update: { paymentDetails: next || null },
  })

  // Change log — who/when + before/after LENGTHS only (the values are
  // banking details; the audit trail must not become a second copy).
  await prisma.auditLog.create({
    data: {
      userId: gate.user.id,
      action: 'admin.payment_details_updated',
      entityType: 'SiteSetting',
      entityId: SINGLETON,
      oldValues: { length: prior?.paymentDetails?.length ?? 0 },
      newValues: { length: next.length, at: new Date().toISOString() },
    },
  })

  return NextResponse.json({ ok: true })
}
