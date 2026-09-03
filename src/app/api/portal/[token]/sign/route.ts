import { NextRequest, NextResponse } from 'next/server'
import { authorizeStoredCredential, isApproved } from '@/lib/cardpointe/client'
import { recordCardTrouble } from '@/lib/portal/cardTrouble'
import { notifyPortalPaperwork } from '@/lib/email/notifyPortalPaperwork'
import { mirrorPaperworkCardToWallet } from '@/lib/payments/companyCards'
import { normalizePaymentPreference, paymentPreferenceLabel } from '@/lib/payments/paymentPreference'
import { prisma } from '@/lib/prisma'

/**
 * Record the LCDW accept/decline election.
 *
 * Shared by two callers because the election now arrives two ways: folded
 * into the rental agreement (Wes 2026-09-02 — "LCDW needs to be a part of the
 * rental agreement"), and via the standalone `lcdw` step, which annual-
 * agreement clients still use because their RA is signed once at the company
 * level and never per job.
 *
 * `signatureData` is the writing the addendum requires. On the folded path
 * that is the AGREEMENT's signature — one signature covering a document that
 * already contains the LCDW addendum in full.
 */
async function applyLcdwElection(
  token: string,
  opts: { accepted: boolean; fuelAcknowledged: boolean; signatureData?: unknown },
  now: Date,
) {
  await prisma.paperworkRequest.update({
    where: { token },
    data: {
      lcdwDecision: opts.accepted ? 'ACCEPTED' : 'DECLINED',
      lcdwDecidedAt: now,
      lcdwSignatureData:
        typeof opts.signatureData === 'string' && opts.signatureData ? opts.signatureData : null,
      lcdwFuelAcknowledged: opts.fuelAcknowledged,
      // Legacy mirror — true ONLY on acceptance, which is what the old
      // column was always supposed to mean.
      lcdwAccepted: opts.accepted,
    },
  })
}

/** The team-email line for an election, so both paths word it identically. */
function lcdwDetail(accepted: boolean) {
  return {
    label: 'LCDW',
    value: accepted
      ? 'ACCEPTED — $24/day/vehicle'
      : 'DECLINED — client carries their own coverage',
  }
}

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

      // The LCDW election rides along with the agreement it belongs to.
      // Absent stays absent: a booking with no eligible vehicle never shows
      // the election, posts no `lcdwAccepted`, and keeps a NULL decision —
      // which is a different fact from declining.
      const lcdwAnswered = typeof body.lcdwAccepted === 'boolean'
      if (lcdwAnswered) {
        await applyLcdwElection(
          params.token,
          {
            accepted: body.lcdwAccepted === true,
            fuelAcknowledged: body.fuelAcknowledged === true,
            // One signature. The client signed an agreement that contains the
            // LCDW addendum in full, so that signature is the addendum's
            // required writing.
            signatureData: body.signatureData,
          },
          now,
        )
      }

      // Fire-and-forget hq@ notification with a deep link to the job —
      // mirrors the per-form emails the Cognito flow used to send.
      notifyPortalPaperwork({
        token: params.token,
        step: 'agreement',
        details: [
          { label: 'Signed by', value: String(body.signerName ?? '—') },
          ...(lcdwAnswered ? [lcdwDetail(body.lcdwAccepted === true)] : []),
        ],
      })
    }

    if (body.step === 'lcdw') {
      // RECORD THE CHOICE THE CLIENT MADE. This used to write
      // `lcdw_accepted=true` unconditionally, ignoring the accept/decline
      // radio both portals post — so every client who DECLINED the waiver
      // was filed as having accepted it, at $24/day/vehicle. The signature
      // and fuel acknowledgement were posted and dropped on the floor too,
      // though the LCDW addendum requires the decision "be confirmed in
      // writing per fleet vehicle rental".
      //
      // Absent stays absent: a client who never reached this step has a
      // NULL decision, which is a different fact from declining.
      const accepted = body.lcdwAccepted === true
      await applyLcdwElection(
        params.token,
        {
          accepted,
          fuelAcknowledged: body.fuelAcknowledged === true,
          signatureData: body.lcdwSignatureData,
        },
        now,
      )
      notifyPortalPaperwork({
        token: params.token,
        step: 'lcdw',
        // The team's email said a decision had been made but never which
        // one, which is half the reason nobody could tell.
        details: [lcdwDetail(accepted)],
      })
    }

    if (body.step === 'cc') {
      // Payment intent: CHECK_WIRE = client will pay by check/bank transfer,
      // card is on file as SECURITY ONLY. UNDECIDED = they have not chosen
      // yet, which is a real answer and must NOT be flattened into CARD —
      // staff read CARD as consent to the processing fee. Anything else
      // (including a legacy client that sends nothing) still defaults to CARD.
      const paymentPreference =
        normalizePaymentPreference(body.ccPaymentPreference) ?? 'CARD'

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
            // Tell the desk NOW. The client is told their authorization is
            // submitted (it is — the row is written either way), but this
            // card will fail at charge time and only a person can sort that
            // out. SR-JOB-0260 carried a declined card for two days reading
            // "On file" on every staff surface.
            recordCardTrouble({
              token: params.token,
              kind: 'AUTH_DECLINED',
              detail: [zero.respcode, zero.resptext].filter(Boolean).join(' ') || null,
            })
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

      // Put the card in the COMPANY's wallet, so a client who authorizes a
      // second card ends up with two cards on file instead of one card that
      // quietly replaced the other on every read (Wes, 2026-09-01). The
      // paperwork row above stays the record of this authorization; the
      // wallet row is the record of the card.
      //
      // Best-effort: never fail a client's signed paperwork over the mirror.
      // The row is already written and the legacy read paths still resolve it.
      if (body.ccToken) {
        await mirrorPaperworkCardToWallet(request.id).catch((err) =>
          console.error('[cc-auth] wallet mirror failed (card IS stored):', request.id, err),
        )
      }

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
            value: paymentPreferenceLabel(paymentPreference),
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
