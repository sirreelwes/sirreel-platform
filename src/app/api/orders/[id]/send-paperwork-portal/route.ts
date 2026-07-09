import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendPortalInvite } from '@/lib/portal/sendPortalInvite'
import {
  ensureSignedAgreementForOrder,
  ensureBaselineRentalDocumentToSign,
} from '@/lib/orders/signedAgreement'

export const dynamic = 'force-dynamic'

// Portal states from which the rental agreement is already reviewable /
// signable (the sign + download routes accept these) — no release needed.
const ALREADY_SIGNABLE = new Set(['PORTAL_RELEASED', 'NEGOTIATED_READY', 'DOWNLOAD_SENT', 'REDLINE_UPLOADED', 'UNDER_REVIEW'])
const ALREADY_SIGNED = new Set(['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'])

/**
 * POST /api/orders/[id]/send-paperwork-portal
 *
 * ONE agent action, no quote needed: invite the client to their portal AND
 * make the rental agreement immediately signable. Composes existing pieces —
 * nothing here renders contract text of its own:
 *
 *   1. ensureSignedAgreementForOrder     — creates the RENTAL_AGREEMENT row
 *      (BASELINE PORTAL_GENERATED, or NEGOTIATED_READY when the company has
 *      standing terms).
 *   2. ensureBaselineRentalDocumentToSign — renders the approved-clause
 *      doc-to-sign from contractClauses.ts (idempotent; no-op when filled).
 *   3. Release PORTAL_GENERATED → PORTAL_RELEASED (same transition + guards
 *      as /agreement/release) so "Sign agreement →" shows on first visit.
 *      Already-signable / already-signed states pass through untouched.
 *   4. sendPortalInvite — mints/refreshes the magic link and emails the
 *      portal URL with the standard portalInvite template (NOT the quote
 *      composer). The quote flow is untouched.
 *
 * Agreement prep is captured, not fatal: if generate/release fails, the
 * invite still sends and the response carries agreementError so the agent
 * sees exactly what needs attention (never a silent half-send).
 *
 * Body: { email: string, firstName?: string, lastName?: string }
 * Gate: signed-in staff — matches the existing invite/release routes.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown
    firstName?: unknown
    lastName?: unknown
  }

  // ── 1–3. Agreement prep (best-effort; failure reported, invite still sends).
  let agreementStatus: string | null = null
  let agreementError: string | null = null
  try {
    await ensureSignedAgreementForOrder(params.id)
    await ensureBaselineRentalDocumentToSign(params.id)
    const agreement = await prisma.signedAgreement.findUnique({
      where: { orderId_contractType: { orderId: params.id, contractType: 'RENTAL_AGREEMENT' } },
      select: { id: true, status: true, documentToSignUrl: true },
    })
    if (!agreement) {
      agreementError = 'No rental agreement row could be created for this order.'
    } else if (ALREADY_SIGNED.has(agreement.status)) {
      agreementStatus = agreement.status // already executed — nothing to release
    } else if (ALREADY_SIGNABLE.has(agreement.status)) {
      agreementStatus = agreement.status // client can already review + sign
    } else if (agreement.status === 'PORTAL_GENERATED') {
      if (!agreement.documentToSignUrl) {
        agreementError =
          'Agreement PDF could not be generated — the portal invite was sent, but the client cannot sign yet. Regenerate the agreement, then use "Release to portal".'
      } else {
        const updated = await prisma.signedAgreement.update({
          where: { id: agreement.id },
          data: { status: 'PORTAL_RELEASED' },
          select: { status: true },
        })
        agreementStatus = updated.status
      }
    } else {
      agreementError = `Agreement is in ${agreement.status} — not auto-releasable from here. The portal invite was sent; resolve the agreement state via Manual Override.`
      agreementStatus = agreement.status
    }
  } catch (err) {
    console.error('[send-paperwork-portal] agreement prep failed:', params.id, err)
    agreementError = 'Agreement generation failed — the portal invite was sent, but the client cannot sign yet.'
  }

  // ── 4. Portal invite (always attempted).
  try {
    const invite = await sendPortalInvite({
      orderId: params.id,
      email: typeof body.email === 'string' ? body.email : '',
      firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
      lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
    })
    return NextResponse.json({
      ok: true,
      portalUrl: invite.portalUrl,
      person: invite.person,
      emailResult: invite.emailResult,
      agreement: {
        status: agreementStatus,
        signable: agreementStatus !== null && (ALREADY_SIGNABLE.has(agreementStatus) || ALREADY_SIGNED.has(agreementStatus)),
      },
      agreementError,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invite failed'
    const status = msg === 'Order not found' ? 404 : msg === 'Order has no portal slug' ? 409 : 400
    // Invite failed — the whole action failed (agreement prep alone is not a send).
    return NextResponse.json({ error: msg, agreementError }, { status })
  }
}
