import { NextRequest, NextResponse } from 'next/server'
import { authorizeStoredCredential, isApproved } from '@/lib/cardpointe/client'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
    const body = await req.json()
    const ip = req.headers.get('x-forwarded-for') || 'unknown'
    const now = new Date()

    if (body.step === 'agreement') {
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          signer_name=$1, rental_agreement=true
        WHERE token=$2`,
        body.signerName, params.token
      )
      await prisma.booking.update({ where: { id: request.bookingId }, data: { rentalAgreement: true } })
    }

    if (body.step === 'lcdw') {
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET lcdw_accepted=true
        WHERE token=$1`,
        params.token
      )
    }

    if (body.step === 'cc') {
      // Payment intent: CHECK_WIRE = client will pay by check/bank
      // transfer, card is on file as SECURITY ONLY. Default CARD.
      const paymentPreference = body.ccPaymentPreference === 'CHECK_WIRE' ? 'CHECK_WIRE' : 'CARD'

      // $0 authorization BEFORE storing. Two reasons:
      //  1. It validates the card. Previously a token was saved with no
      //     gateway call at all, so a mistyped or dead card sat in the
      //     collections queue looking valid until someone tried to charge it
      //     weeks later — after the job had wrapped.
      //  2. It establishes the stored credential under the Visa/Mastercard
      //     framework (cofpermission), which every later merchant-initiated
      //     charge references.
      //
      // Deliberately NON-BLOCKING on the storage itself: if the gateway is
      // unreachable we still record the client's signed authorization rather
      // than making them redo the paperwork. The validation result is logged
      // and the card is stored either way.
      const ccExpiry =
        typeof body.ccExpiry === 'string' ? body.ccExpiry.replace(/\D/g, '').slice(0, 4) : ''
      // Captured so the outcome survives the request. The response used to be
      // discarded — logged only on failure — which meant nobody could tell
      // whether a card on file had actually validated, and the retref that
      // established the stored credential was lost. The card-brand framework
      // expects later merchant-initiated charges to reference that retref.
      let authRetref: string | null = null
      let authRespCode: string | null = null
      let authRespStat: string | null = null
      let authRespText: string | null = null
      let authValidatedAt: Date | null = null

      if (body.ccToken && ccExpiry.length === 4) {
        try {
          const zero = await authorizeStoredCredential({
            cardToken: body.ccToken,
            expiry: ccExpiry,
            cardholderName: [body.ccCardholderFirst, body.ccCardholderLast]
              .filter(Boolean)
              .join(' '),
            reference: `AUTH-${params.token.slice(0, 12)}`,
          })
          authRetref = zero.retref ?? null
          authRespCode = zero.respcode ?? null
          authRespStat = zero.respstat ?? null
          authRespText = zero.resptext?.slice(0, 300) ?? null
          authValidatedAt = new Date()
          if (!isApproved(zero)) {
            console.error(
              `[cc-auth] $0 validation NOT approved for token ${params.token.slice(0, 8)}: ` +
                `${zero.respcode} ${zero.resptext}`,
            )
          }
        } catch (err) {
          console.error('[cc-auth] $0 validation threw:', err)
          authRespText = err instanceof Error ? err.message.slice(0, 300) : 'gateway error'
        }
      } else {
        console.error('[cc-auth] no expiry supplied — card stored WITHOUT validation')
      }

      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          cc_cardholder_first=$1, cc_cardholder_last=$2,
          cc_card_type=$3, cc_card_last4=$4, cc_card_number_encrypted=$5,
          cc_charge_estimate=$6, cc_auth_signed_at=$7,
          cc_payment_preference=$8,
          cc_auth_retref=$9, cc_auth_respcode=$10, cc_auth_respstat=$11,
          cc_auth_resptext=$12, cc_auth_validated_at=$13,
          cc_card_expiry=$14,
          credit_card_auth=true
        WHERE token=$15`,
        body.ccCardholderFirst, body.ccCardholderLast,
        body.ccCardType, body.ccToken?.slice(-4), body.ccToken,
        body.ccChargeEstimate ? parseFloat(body.ccChargeEstimate) : null,
        now, paymentPreference,
        authRetref, authRespCode, authRespStat, authRespText, authValidatedAt,
        // Every later charge against this token needs it; the $0 auth used to
        // be the only consumer and it was dropped straight afterwards.
        ccExpiry || null,
        params.token
      )
    }

    if (body.step === 'studio') {
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          studio_contract_signed=true,
          rental_agreement=true,
          completed_at=$1
        WHERE token=$2`,
        now, params.token
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[portal/sign]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
