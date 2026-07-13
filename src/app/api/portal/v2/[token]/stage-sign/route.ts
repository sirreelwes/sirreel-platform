import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { renderStrykerPlainText } from '@/lib/contracts/strykerAgreement'
import { stageAreaLabel, STRYKER_TRIGGER_KEY, includedComplexAreaLabels } from '@/lib/contracts/stageAreas'

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
 *  2. Stryker Master Media Use Agreement: when the hospital set is among
 *     the areas, the FULL agreement (rendered from the single-source
 *     template in @/lib/contracts/strykerAgreement) must be separately
 *     acknowledged AND separately signed. The Stryker signature, printed
 *     name, timestamp, and an exact populated-text snapshot are persisted
 *     alongside the studio-contract signature.
 *
 * The signoff (signer, signatures, Stryker block, and a snapshot of the
 * terms as signed) is merged into the stageDetails JSON under `signoff`
 * — extra keys there are ignored by every other reader of the column.
 * Completion flags mirror the legacy studio step exactly.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true } } },
    })
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
    const requiresStryker = sets.includes(STRYKER_TRIGGER_KEY)
    const strykerSignature = typeof body.strykerSignatureData === 'string' ? body.strykerSignatureData : ''
    if (requiresStryker && (!body.strykerAcknowledged || !strykerSignature.trim())) {
      return NextResponse.json(
        { error: 'The Stryker Master Media Use Agreement must be acknowledged and separately signed for hospital-set bookings' },
        { status: 400 },
      )
    }

    const now = new Date()
    const ip = req.headers.get('x-forwarded-for') || 'unknown'

    // Rebuild the populated Stryker text server-side so the persisted
    // snapshot is exactly what the template renders for this job — the
    // client never supplies contract text.
    const fmtLong = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    // endDate is a date-only column (UTC midnight) — format in UTC so the
    // return date never rolls back a day on servers in other timezones.
    const fmtLongUTC = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const strykerFields = requiresStryker
      ? {
          producerName: request.booking?.company?.name || 'Producer',
          producerAddress: request.booking?.company?.billingAddress || '',
          projectTitle: request.booking?.jobName || '',
          agreementDate: fmtLong(now),
          returnDate: request.booking?.endDate ? fmtLongUTC(new Date(request.booking.endDate)) : '',
        }
      : null

    const signoff = {
      signerName: typeof body.signerName === 'string' ? body.signerName.slice(0, 200) : '',
      strykerRequired: requiresStryker,
      signatureData: typeof body.signatureData === 'string' ? body.signatureData : '',
      signedAt: now.toISOString(),
      ip,
      stryker: strykerFields
        ? {
            acknowledged: !!body.strykerAcknowledged,
            printedName: typeof body.strykerPrintedName === 'string' ? body.strykerPrintedName.slice(0, 200) : '',
            signatureData: strykerSignature,
            signedAt: now.toISOString(),
            fields: strykerFields,
            textSnapshot: renderStrykerPlainText(strykerFields),
          }
        : null,
      termsSnapshot: {
        sets,
        // Labels frozen at signing time — if the area list is ever
        // relabeled later, the signed record (and its PDF) keeps
        // showing exactly what the client saw when they signed.
        setLabels: Object.fromEntries(sets.map((k) => [k, stageAreaLabel(k)])),
        // Included complex amenities frozen at signing — the signed PDF
        // renders these, never the live standing list.
        complexAreasIncluded: includedComplexAreaLabels(sd?.complexAreas),
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
