import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const incompleteJobs = await prisma.$queryRaw<any[]>`
      SELECT b.id, b.job_name AS "jobName", b.status, b.created_at AS "createdAt",
        c.name AS "companyName",
        CONCAT(p.first_name, ' ', p.last_name) AS "agentName",
        pr.token, pr.coi_received AS "coiReceived", pr.wc_received AS "wcReceived"
      FROM bookings b
      LEFT JOIN companies c ON b.company_id = c.id
      LEFT JOIN people p ON b.agent_id = p.id
      LEFT JOIN paperwork_requests pr ON pr.booking_id = b.id
      WHERE b.status NOT IN ('CANCELLED','COMPLETE','CLOSED')
        AND (pr.coi_received = false OR pr.wc_received = false OR pr.id IS NULL)
      ORDER BY b.created_at DESC LIMIT 30`

    const coiQueue = await prisma.$queryRaw<any[]>`
      SELECT b.id AS "bookingId", b.job_name AS "jobName", c.name AS "companyName",
        pr.token, pr.coi_ai_review AS "coiAiReview", pr.coi_received AS "coiReceived"
      FROM paperwork_requests pr
      JOIN bookings b ON pr.booking_id = b.id
      LEFT JOIN companies c ON b.company_id = c.id
      WHERE pr.coi_ai_review IS NOT NULL
        AND (pr.coi_ai_review->>'overallPass')::boolean = false
      ORDER BY b.created_at DESC LIMIT 20`

    const redlines = await prisma.$queryRaw<any[]>`
      SELECT b.id AS "bookingId", b.job_name AS "jobName", c.name AS "companyName",
        pr.token, pr.contract_redline_status AS "redlineStatus",
        pr.contract_redline_review AS "redlineReview",
        pr.contract_redline_uploaded_at AS "redlineUploadedAt"
      FROM paperwork_requests pr
      JOIN bookings b ON pr.booking_id = b.id
      LEFT JOIN companies c ON b.company_id = c.id
      WHERE pr.contract_redline_status = 'pending_review'
      ORDER BY pr.contract_redline_uploaded_at DESC LIMIT 20`

    const recentActivity = await prisma.$queryRaw<any[]>`
      SELECT b.id AS "bookingId", b.job_name AS "jobName", c.name AS "companyName",
        pr.token, pr.coi_received AS "coiReceived", pr.wc_received AS "wcReceived",
        pr.updated_at AS "updatedAt"
      FROM paperwork_requests pr
      JOIN bookings b ON pr.booking_id = b.id
      LEFT JOIN companies c ON b.company_id = c.id
      ORDER BY pr.updated_at DESC LIMIT 15`

    return NextResponse.json({ ok: true, incompleteJobs, coiQueue, redlines, recentActivity })
  } catch (err: any) {
    console.error('[paperwork-summary]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
