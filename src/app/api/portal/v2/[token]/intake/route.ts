import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Portal v2 "collect-once" intake — the single Your-details step the
 * guided portal captures up front and threads into every document card.
 *
 * Keyed by the same PaperworkRequest token the rest of /api/portal/[token]
 * uses, so the row's lifetime matches the paperwork link. Purely additive:
 * nothing here touches paperwork_requests, signing, or payment routes.
 */

const FIELDS = [
  'fullName',
  'title',
  'company',
  'email',
  'phone',
  'billingAddress1',
  'billingAddress2',
  'billingCity',
  'billingState',
  'billingZip',
] as const

type IntakeField = (typeof FIELDS)[number]

function pickFields(body: Record<string, unknown>): Partial<Record<IntakeField, string>> {
  const out: Partial<Record<IntakeField, string>> = {}
  for (const f of FIELDS) {
    if (typeof body[f] === 'string') out[f] = (body[f] as string).slice(0, 500)
  }
  return out
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
    const intake = await prisma.portalV2Intake.findUnique({ where: { token: params.token } })
    return NextResponse.json({ intake })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const data = pickFields(body)
    const intake = await prisma.portalV2Intake.upsert({
      where: { token: params.token },
      create: { token: params.token, ...data },
      update: data,
    })
    return NextResponse.json({ intake })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
