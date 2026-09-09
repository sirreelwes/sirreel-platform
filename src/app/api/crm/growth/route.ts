/**
 * GET /api/crm/growth — "how many new contacts did we add this week /
 * month / year", plus the same for client companies.
 *
 * Counting rules, matching the rest of /crm:
 *
 * - **Contacts** are Person rows, counted by `createdAt`. The
 *   @sirreel.com exclusion that /api/crm/people applies to its chip
 *   counts applies here too — us hiring someone is not book growth.
 *   (Like there, it is a COUNTING rule, not a visibility one.)
 * - **Companies** are Company rows by `createdAt`.
 * - Periods are Pacific-anchored and each carries a prior window of the
 *   same elapsed length, so "this week" is compared against last week
 *   *to the same point*. See src/lib/crm/growthWindows.ts.
 *
 * Two findMany passes (contacts, companies) from the oldest boundary
 * forward, bucketed in memory, rather than twelve counts — the windows
 * nest, so one scan answers all of them.
 *
 * Auth: getServerSession. Read-only.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  bucketByWindows,
  growthFloor,
  growthWindows,
  type GrowthPeriodKey,
} from '@/lib/crm/growthWindows'

export const dynamic = 'force-dynamic'

export interface GrowthPeriodPayload {
  key: GrowthPeriodKey
  label: string
  priorLabel: string
  start: string
  priorStart: string
  priorEnd: string
  people: number
  peoplePrior: number
  companies: number
  companiesPrior: number
}

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const windows = growthWindows(now)
  const floor = growthFloor(windows)

  // Internal staff are excluded from every count on this page.
  const notInternal = {
    NOT: { email: { contains: '@sirreel.com', mode: 'insensitive' as const } },
  }

  const [peopleRows, companyRows, peopleTotal, companiesTotal] = await Promise.all([
    prisma.person.findMany({
      where: { createdAt: { gte: floor }, ...notInternal },
      select: { createdAt: true },
    }),
    prisma.company.findMany({
      where: { createdAt: { gte: floor } },
      select: { createdAt: true },
    }),
    prisma.person.count({ where: notInternal }),
    prisma.company.count(),
  ])

  const peopleBuckets = bucketByWindows(peopleRows.map((r) => r.createdAt), windows)
  const companyBuckets = bucketByWindows(companyRows.map((r) => r.createdAt), windows)

  const periods: GrowthPeriodPayload[] = windows.map((w) => ({
    key: w.key,
    label: w.label,
    priorLabel: w.priorLabel,
    start: w.start.toISOString(),
    priorStart: w.priorStart.toISOString(),
    priorEnd: w.priorEnd.toISOString(),
    people: peopleBuckets[w.key].current,
    peoplePrior: peopleBuckets[w.key].prior,
    companies: companyBuckets[w.key].current,
    companiesPrior: companyBuckets[w.key].prior,
  }))

  return NextResponse.json({
    generatedAt: now.toISOString(),
    periods,
    totals: { people: peopleTotal, companies: companiesTotal },
  })
}
