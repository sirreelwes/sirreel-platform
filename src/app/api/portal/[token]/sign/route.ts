import { NextRequest, NextResponse } from 'next/server'
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
          signer_name=$1, signer_title=$2, signer_email=$3, signer_phone=$4,
          po_number=$5, dot_number=$6, additional_contacts=$7::jsonb,
          ra_terms_accepted=true, ra_signature_data=$8, ra_signed_at=$9,
          ra_signer_ip=$10, rental_agreement=true
        WHERE token=$11`,
        body.signerName, body.signerTitle, body.signerEmail, body.signerPhone,
        body.poNumber, body.dotNumber, JSON.stringify(body.additionalContacts || []),
        body.signatureData, now, ip, params.token
      )
      await prisma.booking.update({ where: { id: request.bookingId }, data: { rentalAgreement: true } })
    }

    if (body.step === 'lcdw') {
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          lcdw_accepted=$1, lcdw_signature_data=$2,
          lcdw_fuel_acknowledged=$3, lcdw_signed_at=$4
        WHERE token=$5`,
        body.lcdwAccepted, body.lcdwSignatureData, body.fuelAcknowledged, now, params.token
      )
    }

    if (body.step === 'cc') {
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          cc_rep_first_name=$1, cc_rep_last_name=$2, cc_rep_phone=$3, cc_rep_email=$4,
          cc_cardholder_first=$5, cc_cardholder_last=$6,
          cc_billing_address1=$7, cc_billing_address2=$8, cc_billing_city=$9,
          cc_billing_state=$10, cc_billing_zip=$11, cc_billing_phone=$12, cc_billing_email=$13,
          cc_card_type=$14, cc_card_last4=$15, cc_card_number_encrypted=$16,
          cc_card_expiry=$17, cc_card_ccv_hash=$18,
          cc_charge_summary=$19, cc_charge_estimate=$20,
          cc_auth_signature_data=$21, cc_auth_signed_at=$22,
          credit_card_auth=true, completed_at=$22
        WHERE token=$23`,
        body.ccRepFirst, body.ccRepLast, body.ccRepPhone, body.ccRepEmail,
        body.ccCardholderFirst, body.ccCardholderLast,
        body.ccAddress1, body.ccAddress2, body.ccCity,
        body.ccState, body.ccZip, body.ccBillingPhone, body.ccBillingEmail,
        body.ccCardType, body.ccToken?.slice(-4), body.ccToken,
        body.ccExpiry, body.ccCcv,
        body.ccChargeSummary, body.ccChargeEstimate ? parseFloat(body.ccChargeEstimate) : null,
        body.ccSignatureData, now, params.token
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
