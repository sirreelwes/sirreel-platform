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
      await prisma.$executeRawUnsafe(`
        UPDATE paperwork_requests SET
          cc_cardholder_first=$1, cc_cardholder_last=$2,
          cc_card_type=$3, cc_card_last4=$4, cc_card_number_encrypted=$5,
          cc_charge_estimate=$6, cc_auth_signed_at=$7,
          credit_card_auth=true
        WHERE token=$8`,
        body.ccCardholderFirst, body.ccCardholderLast,
        body.ccCardType, body.ccToken?.slice(-4), body.ccToken,
        body.ccChargeEstimate ? parseFloat(body.ccChargeEstimate) : null,
        now, params.token
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
