import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT 
        pr.id, pr.token, pr.sent_to, pr.sent_at,
        pr.rental_agreement, pr.coi_received, pr.credit_card_auth,
        pr.contract_redline_status, pr.contract_redline_review, pr.contract_redline_uploaded_at,
        pr.coi_ai_review, pr.coi_review_at,
        pr.coi_admin_approved, pr.coi_admin_approved_by, pr.coi_admin_approval_note,
        b.id as booking_id, b.job_name, b.booking_number, b.start_date,
        c.name as company_name
      FROM paperwork_requests pr
      JOIN bookings b ON b.id = pr.booking_id
      JOIN companies c ON c.id = b.company_id
      WHERE 
        pr.contract_redline_status = 'pending_review'
        OR (
          pr.coi_ai_review IS NOT NULL 
          AND (pr.coi_ai_review->>'requiresAdminApproval')::boolean = true
          AND (pr.coi_admin_approved IS NULL OR pr.coi_admin_approved = false)
        )
        OR (
          pr.coi_ai_review IS NOT NULL 
          AND (pr.coi_ai_review->>'hardPass')::boolean = false
          AND pr.coi_received = false
        )
      ORDER BY pr.sent_at DESC
      LIMIT 50
    `) as any[]

    const reviews = rows.map(r => {
      const coiReview = r.coi_ai_review
      let coiItem = null
      if (coiReview) {
        if (coiReview.requiresAdminApproval && !r.coi_admin_approved) {
          coiItem = { type: 'needs_admin_approval', review: coiReview, reviewedAt: r.coi_review_at }
        } else if (!coiReview.hardPass) {
          coiItem = { type: 'hard_fail', review: coiReview, reviewedAt: r.coi_review_at }
        }
      }
      return {
        id: r.id, token: r.token, sentTo: r.sent_to,
        bookingId: r.booking_id, jobName: r.job_name,
        bookingNumber: r.booking_number, startDate: r.start_date,
        companyName: r.company_name,
        paperwork: { rentalAgreement: r.rental_agreement, coiReceived: r.coi_received, creditCardAuth: r.credit_card_auth },
        redline: r.contract_redline_status === 'pending_review' ? {
          status: r.contract_redline_status, review: r.contract_redline_review, uploadedAt: r.contract_redline_uploaded_at,
        } : null,
        coi: coiItem,
      }
    }).filter(r => r.redline || r.coi)

    return NextResponse.json({ reviews })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
