import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

// Generates recurring/scheduled alerts that don't exist yet
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
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

  // Check for jobs starting tomorrow — flag upcoming work so dispatch
  // can confirm vehicles and drivers. Asset linkage lives on
  // BookingAssignment in the native engine.
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  // Was a raw query filtering `status NOT IN ('CANCELLED', 'CLOSED')`.
  // BookingStatus has no CLOSED — Postgres cannot cast the literal to
  // the enum, so this threw 22P02 on EVERY dashboard load and the whole
  // route 500'd. Every alert below this line silently stopped being
  // generated: COI expirations and payroll ran first and survived, but
  // this one killed the response before it returned.
  //
  // Rewritten on the typed client rather than fixing the string, so an
  // invalid status is a build error instead of a runtime 500. The
  // terminal states a "starts tomorrow" nudge should skip are CANCELLED
  // (dead), RETURNED and ARCHIVED (already done).
  const jobsStartingTomorrow = await prisma.booking.findMany({
    where: {
      startDate: new Date(`${tomorrowStr}T00:00:00.000Z`),
      status: { notIn: [BookingStatus.CANCELLED, BookingStatus.RETURNED, BookingStatus.ARCHIVED] },
    },
    select: { jobName: true, company: { select: { name: true } } },
    take: 5,
  })
  for (const job of jobsStartingTomorrow) {
    await upsertAlert(
      'job_starting_' + job.jobName,
      'Job Starts Tomorrow',
      (job.company?.name || 'Job') + ' — ' + (job.jobName || '') + ' starts tomorrow. Confirm vehicles and driver.',
      'high',
      '/jobs',
      new Date(tomorrow.getTime() + 86400000)
    )
  }

  return NextResponse.json({ ok: true, created })
}
