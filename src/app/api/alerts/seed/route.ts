import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Generates recurring/scheduled alerts that don't exist yet
export async function GET() {
  const created: string[] = []

  const upsertAlert = async (type: string, title: string, body: string, severity: string, link: string | null, expiresAt: Date | null) => {
    const existing = await prisma.$queryRaw<any[]>`
      SELECT id FROM alerts
      WHERE type = ${type}
        AND created_at > now() - interval '7 days'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1
    `
    if (existing.length > 0) return
    await prisma.$executeRaw`
      INSERT INTO alerts (type, title, body, severity, link, expires_at)
      VALUES (${type}, ${title}, ${body}, ${severity}, ${link}, ${expiresAt})
    `
    created.push(type)
  }

  const now = new Date()
  const dayOfWeek = now.getDay()
  const dayOfMonth = now.getDate()

  // Payroll reminder — every other Friday (biweekly)
  const weekNumber = Math.floor(dayOfMonth / 7)
  if (dayOfWeek === 5 && weekNumber % 2 === 0) {
    const exp = new Date(now); exp.setDate(exp.getDate() + 2)
    await upsertAlert(
      'payroll_reminder',
      'Payroll Due Today',
      'Biweekly payroll processing deadline. Ensure timesheets are approved.',
      'high',
      null,
      exp
    )
  }

  // Insurance renewal reminder — 1st of each month
  if (dayOfMonth === 1) {
    const exp = new Date(now); exp.setDate(exp.getDate() + 7)
    await upsertAlert(
      'insurance_check',
      'Monthly Insurance Review',
      'Review fleet insurance certificates and check for upcoming expirations.',
      'medium',
      '/coi-check',
      exp
    )
  }

  // Check for COI expirations from paperwork requests
  const expiringCOIs = await prisma.$queryRaw<any[]>`
    SELECT b.job_name, c.name as company
    FROM paperwork_requests pr
    JOIN bookings b ON pr.booking_id = b.id
    JOIN companies c ON b.company_id = c.id
    WHERE pr.coi_received = true
      AND b.end_date > now()
      AND b.end_date < now() + interval '7 days'
    LIMIT 5
  `
  for (const coi of expiringCOIs) {
    await upsertAlert(
      'coi_expiring_' + coi.company,
      'COI Expiring Soon',
      (coi.company || 'Client') + ' COI expires within 7 days — ' + (coi.job_name || 'active job'),
      'high',
      '/jobs',
      new Date(now.getTime() + 7 * 86400000)
    )
  }

  // Check for jobs starting tomorrow with no linked Planyo reservation
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)
  const jobsStartingTomorrow = await prisma.$queryRaw<any[]>`
    SELECT b.job_name, c.name as company
    FROM bookings b
    LEFT JOIN companies c ON b.company_id = c.id
    WHERE DATE(b.start_date) = ${tomorrowStr}::date
      AND b.status NOT IN ('CANCELLED', 'CLOSED')
    LIMIT 5
  `
  for (const job of jobsStartingTomorrow) {
    await upsertAlert(
      'job_starting_' + job.job_name,
      'Job Starts Tomorrow',
      (job.company || 'Job') + ' — ' + (job.job_name || '') + ' starts tomorrow. Confirm vehicles and driver.',
      'high',
      '/jobs',
      new Date(tomorrow.getTime() + 86400000)
    )
  }

  return NextResponse.json({ ok: true, created })
}
