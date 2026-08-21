import { NextRequest, NextResponse } from 'next/server'
import { authorizeStoredCredential, isApproved } from '@/lib/cardpointe/client'
import { notifyPortalPaperwork } from '@/lib/email/notifyPortalPaperwork'
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
      // Fire-and-forget hq@ notification with a deep link to the job —
      // mirrors the per-form emails the Cognito flow used to send.
      notifyPortalPaperwork({
        token: params.token,
        step: 'agreement',
        details: [{ label: 'Signed by', value: String(body.signerName ?? '—') }],
      })
    }

    if (body.step === 'lcdw') {
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET lcdw_accepted=true
        WHERE token=$1`,
        params.token
      )
      notifyPortalPaperwork({ token: params.token, step: 'lcdw' })
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
      // The card already posted this from the client's billing details and
      // nothing kept it. The gateway needs it on every card-not-present auth
      // once surcharging is on, to decide whether the cardholder's region
      // permits a fee at all.
      const ccPostal =
        typeof body.ccZip === 'string' ? body.ccZip.replace(/[^0-9-]/g, '').slice(0, 10) : ''

      // Postal is REQUIRED whenever a card is being stored, and enforced here
      // rather than only in the form. Both card surfaces now guard the submit
      // button on a valid ZIP, but a disabled button is not a control: any
      // request that skips the UI still reaches this route, and the auth would
      // go to the gateway with no postal at all.
      //
      // That distinction matters beyond tidiness — SirReel has told Fiserv
      // that postal accompanies every card-not-present authorization, and a
      // client-side check cannot make that true.
      //
      // Rejected BEFORE the gateway call, and only when a card is actually
      // present: the rest of the cc step (signature, payment preference,
      // cardholder details) must still work for a client who is not putting a
      // card on file at all.
      if (body.ccToken && !/^\d{5}(-\d{4})?$/.test(ccPostal)) {
        return NextResponse.json(
          { error: 'A billing ZIP is required to authorize a card.' },
          { status: 400 },
        )
      }

      // Expiry gets the same treatment, and for a sharper reason than the
      // postal: without it the $0 authorization below is SKIPPED ENTIRELY.
      // Not a degraded auth — no gateway call at all, so no cofpermission and
      // no stored credential established, while the token is saved and the
      // step reports success. A card then sits in the collections queue
      // looking valid until someone tries to charge it, and the
      // merchant-initiated charges that follow have no initial transaction to
      // reference under the card-brand framework.
      //
      // That is exactly how the v1 portal behaved for its whole life: it had
      // no expiry field, so every card it stored took the silent path. Both
      // card forms now guard their submit button on expiry, but a disabled
      // button is not a control — same argument as the postal above.
      //
      // Month is validated, not just length: '9999' is four digits and would
      // satisfy the auth condition below while being no expiry at all.
      if (body.ccToken && !/^(0[1-9]|1[0-2])\d{2}$/.test(ccExpiry)) {
        return NextResponse.json(
          { error: 'A valid card expiry date is required to authorize a card.' },
          { status: 400 },
        )
      }
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
            postal: ccPostal || undefined,
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
      }
      // No else-branch log any more. The guard above makes a token without a
      // valid expiry a 400, so reaching this point with `body.ccToken` set is
      // impossible — the only way past it is no card at all, which is the
      // supported CHECK_WIRE path (signature, payment preference and
      // cardholder details still save). The old message claimed a card had
      // been "stored WITHOUT validation" and by now it would only ever fire
      // when nothing was stored.

      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          cc_cardholder_first=$1, cc_cardholder_last=$2,
          cc_card_type=$3, cc_card_last4=$4, cc_card_number_encrypted=$5,
          cc_charge_estimate=$6, cc_auth_signed_at=$7,
          cc_payment_preference=$8,
          cc_auth_retref=$9, cc_auth_respcode=$10, cc_auth_respstat=$11,
          cc_auth_resptext=$12, cc_auth_validated_at=$13,
          cc_card_expiry=$14, cc_billing_postal=$15,
          credit_card_auth=true
        WHERE token=$16`,
        body.ccCardholderFirst, body.ccCardholderLast,
        body.ccCardType, body.ccToken?.slice(-4), body.ccToken,
        body.ccChargeEstimate ? parseFloat(body.ccChargeEstimate) : null,
        now, paymentPreference,
        authRetref, authRespCode, authRespStat, authRespText, authValidatedAt,
        // Every later charge against this token needs it; the $0 auth used to
        // be the only consumer and it was dropped straight afterwards.
        ccExpiry || null,
        ccPostal || null,
        params.token
      )
      notifyPortalPaperwork({
        token: params.token,
        step: 'cc',
        details: [
          {
            label: 'Cardholder',
            value: [body.ccCardholderFirst, body.ccCardholderLast].filter(Boolean).join(' ') || '—',
          },
          {
            label: 'Card',
            value: `${body.ccCardType || 'card'} ····${typeof body.ccToken === 'string' ? body.ccToken.slice(-4) : '????'}`,
          },
          {
            label: 'Validation',
            value:
              authRespStat === 'A'
                ? `approved ($0 auth ${authRetref ?? ''})`.trim()
                : authRespStat
                  ? `NOT approved — ${authRespCode ?? ''} ${authRespText ?? ''}`.trim()
                  : 'no gateway response recorded',
          },
          {
            label: 'Pays invoices by',
            value: paymentPreference === 'CHECK_WIRE' ? 'check / wire (card is security only)' : 'card on file',
          },
        ],
      })
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
      notifyPortalPaperwork({ token: params.token, step: 'studio' })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[portal/sign]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
