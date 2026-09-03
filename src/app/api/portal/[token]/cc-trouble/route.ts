/**
 * POST /api/portal/[token]/cc-trouble — the client's card step reporting
 * that it just failed them.
 *
 * Called from the portal itself (no session; the paperwork token is the
 * credential, same as every other /api/portal/[token] route). It writes an
 * attempt row and, on the rules in src/lib/portal/cardTrouble.ts, emails the
 * desk while the client is still sitting in the form.
 *
 * Always answers 204. The client is mid-authorization and nothing here is
 * theirs to fix — a failure to record their trouble must not become another
 * error on their screen.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { recordCardTrouble, type CardTroubleKind } from '@/lib/portal/cardTrouble'

export const dynamic = 'force-dynamic'

const KINDS: CardTroubleKind[] = ['CARD_INVALID', 'SUBMIT_REJECTED']

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; detail?: unknown }
    const kind = KINDS.find((k) => k === body.kind)
    // AUTH_DECLINED is deliberately not acceptable from the browser: it is
    // the gateway's verdict and is recorded server-side by the sign route.
    if (!kind) return new NextResponse(null, { status: 204 })

    // Cheap flood guard. A stuck client generates a handful of rows; a loop
    // or a bored visitor could generate thousands, and the table exists to
    // be read by a person.
    const request = await prisma.paperworkRequest.findUnique({
      where: { token },
      select: { id: true },
    })
    if (!request) return new NextResponse(null, { status: 204 })
    const lastHour = await prisma.portalCardAttempt.count({
      where: { paperworkRequestId: request.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    })
    if (lastHour >= 40) return new NextResponse(null, { status: 204 })

    recordCardTrouble({
      token,
      kind,
      detail: typeof body.detail === 'string' ? body.detail : null,
    })
  } catch (err) {
    console.error('[cc-trouble] swallowed:', err)
  }
  return new NextResponse(null, { status: 204 })
}
