/**
 * POST /api/orders/[id]/agreement/release
 *
 * Agent action — transitions a rental SignedAgreement from
 * PORTAL_GENERATED to PORTAL_RELEASED. The release-gate moment for
 * the native flow:
 *
 *   1. Agent generates the agreement (status: PORTAL_GENERATED) —
 *      PDF rendered + persisted, but NOT yet visible to the client
 *      in the portal as a signable document.
 *   2. Agent reviews internally, clicks "Release to portal" (this
 *      endpoint) — status flips to PORTAL_RELEASED.
 *   3. Client's next /portal/job/[slug] visit shows the "Sign
 *      agreement →" button (commit 6 will wire that read).
 *
 * Why a dedicated endpoint vs reusing PATCH /agreement:
 *   - PATCH is recovery-mode (any RECOVERABLE_AGREEMENT_STATE → any
 *     other). Release is one specific, gated transition with stricter
 *     preconditions (must have documentToSignUrl).
 *   - Audit clarity — server logs distinguish agent release from
 *     admin recovery flips.
 *   - Forward-looking — release will likely gain notification side
 *     effects later (an email to the client) without entangling the
 *     PATCH semantics.
 *
 * Refuses when:
 *   - current status is not PORTAL_GENERATED (no backward
 *     transitions, no re-releases from later states)
 *   - documentToSignUrl is null (the client would land on a Sign page
 *     with no PDF — fail fast on the agent side instead)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const agreement = await prisma.signedAgreement.findUnique({
    where: {
      orderId_contractType: { orderId: params.id, contractType: 'RENTAL_AGREEMENT' },
    },
    select: { id: true, status: true, documentToSignUrl: true },
  })
  if (!agreement) {
    return bad(404, 'No rental agreement on this order — generate it first.')
  }
  if (agreement.status !== 'PORTAL_GENERATED') {
    return bad(
      409,
      `Agreement is in ${agreement.status} — can only release from PORTAL_GENERATED. ` +
        'Use Manual Override for other transitions.',
    )
  }
  if (!agreement.documentToSignUrl) {
    return bad(
      409,
      'Agreement PDF is missing — regenerate the agreement before releasing it to the client.',
    )
  }

  const userRow = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const updated = await prisma.signedAgreement.update({
    where: { id: agreement.id },
    data: {
      status: 'PORTAL_RELEASED',
      // Reuse the release-trail fields the schema already carries.
      // Concrete field names will land if/when we add explicit
      // releasedAt / releasedById columns; for now the status flip
      // + updatedAt provide the audit signal.
    },
    select: { id: true, status: true, updatedAt: true },
  })

  // userRow is intentionally referenced even if not persisted yet —
  // future commit can add releasedById to the SignedAgreement
  // schema. Reading session.user is still useful for any audit
  // logging side effects that land later.
  void userRow

  return NextResponse.json({ ok: true, agreement: updated })
}
