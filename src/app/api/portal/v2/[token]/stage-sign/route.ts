import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Portal v2 studio-contract signing.
 *
 * Additive replacement for the legacy `step: 'studio'` branch of
 * POST /api/portal/[token]/sign (which stays untouched), adding the two
 * things v2 requires:
 *
 *  1. Server-side GATE: the contract is only signable after a SirReel
 *     agent has prepared the negotiated stage terms — at minimum the
 *     areas (sets) and the day rate — in PaperworkRequest.stageDetails.
 *  2. Stryker addendum: when the hospital set is among the areas, the
 *     client must explicitly acknowledge the Stryker Master Media
 *     Agreement addendum, and that acknowledgment is recorded.
 *
 * The signoff (signer, Stryker ack, signature, and a snapshot of the
 * terms as signed) is merged into the stageDetails JSON under `signoff`
 * — extra keys there are ignored by every other reader of the column.
 * Completion flags mirror the legacy studio step exactly.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    let sd: any = null
    try {
      sd = request.stageDetails ? JSON.parse(request.stageDetails) : null
    } catch {
      sd = null
    }

    const sets: string[] = Array.isArray(sd?.sets) ? sd.sets : []
    const termsReady = sets.length > 0 && !!sd?.ratePerDay
    if (!termsReady) {
      return NextResponse.json(
        { error: 'Stage terms are not finalized yet. Your SirReel agent must set the rate and areas before this contract can be signed.' },
        { status: 409 },
      )
    }

    const body = await req.json().catch(() => ({}))
    if (!body.studioAgreed) {
      return NextResponse.json({ error: 'Terms must be accepted' }, { status: 400 })
    }
    const requiresStryker = sets.includes('hospital')
    if (requiresStryker && !body.strykerAcknowledged) {
      return NextResponse.json({ error: 'The Stryker addendum must be acknowledged for hospital-set bookings' }, { status: 400 })
    }

    const now = new Date()
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const signoff = {
      signerName: typeof body.signerName === 'string' ? body.signerName.slice(0, 200) : '',
      strykerAcknowledged: !!body.strykerAcknowledged,
      strykerRequired: requiresStryker,
      signatureData: typeof body.signatureData === 'string' ? body.signatureData : '',
      signedAt: now.toISOString(),
      ip,
      termsSnapshot: {
        sets,
        prelitSets: sd?.prelitSets || [],
        ratePerDay: sd?.ratePerDay,
        otRate: sd?.otRate || '300',
        prepDays: sd?.prepDays || '',
        shootDays: sd?.shootDays || '',
        strikeDays: sd?.strikeDays || '',
        darkDays: sd?.darkDays || '',
        notes: sd?.notes || '',
      },
    }

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET
         stage_details=$1,
         studio_contract_signed=true,
         rental_agreement=true,
         completed_at=$2
       WHERE token=$3`,
      JSON.stringify({ ...sd, signoff }),
      now,
      params.token,
    )

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[portal/v2/stage-sign]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
