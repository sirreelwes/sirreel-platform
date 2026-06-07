/**
 * GET    /api/claims/mail-triage/[id]  — single row, including full parse
 *                                        for the Create-claim modal pre-
 *                                        fill.
 * PATCH  /api/claims/mail-triage/[id]  — { dismiss: true } stamps
 *                                        reviewer + dismisses the row
 *                                        from the active triage view.
 *
 * Auth: getServerSession-guarded.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const row = await prisma.claimMail.findUnique({
    where: { id },
    select: {
      id: true, disposition: true, parse: true, claimId: true, reason: true,
      dismissed: true, reviewedAt: true, createdAt: true,
      emailMessage: {
        select: {
          id: true, gmailMessageId: true, fromAddress: true,
          subject: true, sentAt: true, snippet: true,
        },
      },
      claim: { select: { id: true, claimNumber: true, status: true } },
    },
  })
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ row })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { dismiss?: unknown }
  if (body.dismiss !== true) {
    return NextResponse.json({ error: 'only { dismiss: true } is supported' }, { status: 400 })
  }

  const updated = await prisma.claimMail.update({
    where: { id },
    data: {
      dismissed: true,
      reviewedById: me.id,
      reviewedAt: new Date(),
    },
    select: { id: true, dismissed: true, reviewedAt: true },
  }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, ...updated })
}
