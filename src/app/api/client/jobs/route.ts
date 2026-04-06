import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  // Verify session
  const sessions = await prisma.$queryRaw<any[]>`
    SELECT email FROM client_sessions
    WHERE token = ${token} AND expires_at > now()
  `
  if (!sessions.length) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 401 })

  const email = sessions[0].email

  // Get all paperwork requests for this email
  const jobs = await prisma.$queryRaw<any[]>`
    SELECT
      pr.id, pr.token as portal_token, pr.sent_at, pr.completed_at,
      pr.coi_received, pr.wc_received, pr.rental_agreement,
      pr.lcdw_accepted, pr.credit_card_auth, pr.studio_contract_signed,
      pr.contract_type, pr.signer_name,
      b.id as booking_id, b.job_name, b.status,
      b.start_date, b.end_date, b.rw_order_id,
      c.name as company_name,
      CONCAT(p.first_name, ' ', p.last_name) as agent_name
    FROM paperwork_requests pr
    JOIN bookings b ON pr.booking_id = b.id
    LEFT JOIN companies c ON b.company_id = c.id
    LEFT JOIN people p ON b.agent_id = p.id
    WHERE LOWER(pr.sent_to) = LOWER(${email})
    ORDER BY pr.sent_at DESC
  `

  return NextResponse.json({ ok: true, email, jobs })
}
