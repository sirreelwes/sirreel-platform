/**
 * Payroll v1 seed — the nine people on the timesheet, and the first period.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/seed-payroll-roster.ts            # dry run, prints the plan
 *   npx tsx scripts/seed-payroll-roster.ts --write
 *
 * IDEMPOTENT. Matches existing Employee rows by name before creating anything,
 * so a second run adds nobody. Every id it creates is written to a journal
 * under tmp/ so the run is reversible BY CAPTURED ID — this script never
 * deletes and never matches on a pattern (see CLAUDE.md, "Verification
 * fixtures & cleanup").
 *
 * THE ROSTER IS NOT FORKED. Hugo Servin and Julian Ponce already exist as
 * Employees; they are LINKED, not duplicated. The other seven are new rows in
 * the same table. There is exactly one employee list in this system.
 *
 * NAME ORDER — needs Wes's eye. The paper timesheet is written
 * "Lastname Firstname" (Arceo Salvador, Pineda Oscar, Servin Hugo). The HR
 * roster is written "Firstname Lastname" (Hugo Servin). These are stored the
 * HR way so the two match. "Franky Blom" is the one that does not fit the
 * pattern in either direction and is stored verbatim — if that is backwards,
 * fix the fullName on the Employee row; nothing else depends on it.
 *
 * NO EMPTY TIME ENTRIES. The period is created with zero TimeEntry rows on
 * purpose. The grid is sparse — a day with no row renders as a blank cell,
 * which is what an unkeyed day should look like. Pre-creating 9 × 14 = 126
 * zero rows would make every cell read "0.00" instead of blank, and would put
 * 126 all-zero lines in front of the exceptions strip and the CSV. Wes opens
 * the period and types into empty cells; the rows appear as he does.
 */

import { writeFileSync } from 'fs'
import { prisma } from '../src/lib/prisma'

const WRITE = process.argv.includes('--write')

/** Stored Firstname Lastname, matching the existing HR roster convention. */
const CREW = [
  'Salvador Arceo',
  'Franky Blom',
  'Albert Cabera',
  'Andy Miranda',
  'Oscar Pineda',
  'Carlos Pizano',
  'Julian Ponce',
  'Hugo Servin',
  'Pedro Sierra',
]

/** The paper sheet's spelling, kept so a future OCR ingest can match on it. */
const PAPER_NAMES: Record<string, string> = {
  'Salvador Arceo': 'Arceo Salvador',
  'Franky Blom': 'Franky Blom',
  'Albert Cabera': 'Cabera Albert',
  'Andy Miranda': 'Miranda Andy',
  'Oscar Pineda': 'Pineda Oscar',
  'Carlos Pizano': 'Pizano Carlos',
  'Julian Ponce': 'Ponce Julian',
  'Hugo Servin': 'Servin Hugo',
  'Pedro Sierra': 'Sierra Pedro',
}

const PERIOD_START = new Date('2026-08-15T00:00:00.000Z') // Saturday
const PERIOD_END = new Date('2026-08-28T00:00:00.000Z')   // Friday, two weeks later

/** Match an existing Employee on either spelling, case-insensitively. */
function findExisting(
  existing: Array<{ id: string; fullName: string }>,
  name: string,
): { id: string; fullName: string } | undefined {
  const wanted = new Set([name.toLowerCase(), (PAPER_NAMES[name] ?? '').toLowerCase()])
  return existing.find((e) => wanted.has(e.fullName.trim().toLowerCase()))
}

async function main() {
  const existing = await prisma.employee.findMany({ select: { id: true, fullName: true } })

  const journal = {
    ranAt: new Date().toISOString(),
    write: WRITE,
    createdEmployeeIds: [] as string[],
    createdProfileIds: [] as string[],
    linkedEmployeeIds: [] as string[],
    createdPeriodId: null as string | null,
  }

  console.log(`\nRoster — ${existing.length} existing Employee rows\n`)

  for (const name of CREW) {
    const match = findExisting(existing, name)

    if (match) {
      console.log(`  link    ${name.padEnd(18)} → existing "${match.fullName}" (${match.id})`)
      if (WRITE) {
        const profile = await prisma.payrollProfile.upsert({
          where: { employeeId: match.id },
          create: { employeeId: match.id, onPayroll: true },
          update: { onPayroll: true },
          select: { id: true },
        })
        journal.linkedEmployeeIds.push(match.id)
        journal.createdProfileIds.push(profile.id)
      }
      continue
    }

    console.log(`  create  ${name.padEnd(18)} (new Employee + payroll profile)`)
    if (WRITE) {
      const emp = await prisma.employee.create({
        data: {
          fullName: name,
          personalEmails: [],
          department: 'Operations',
          isActive: true,
          notes: `Payroll v1 seed 2026-09-01. Paper timesheet spelling: "${PAPER_NAMES[name]}".`,
          payrollProfile: { create: { onPayroll: true } },
        },
        select: { id: true, payrollProfile: { select: { id: true } } },
      })
      journal.createdEmployeeIds.push(emp.id)
      if (emp.payrollProfile) journal.createdProfileIds.push(emp.payrollProfile.id)
    }
  }

  // The first period. Aug 15–28 2026 = two Sat–Fri workweeks, which is what
  // the California OT math buckets on.
  const already = await prisma.payPeriod.findFirst({
    where: { startDate: PERIOD_START, endDate: PERIOD_END },
    select: { id: true, status: true },
  })

  console.log('')
  if (already) {
    console.log(`  period  Aug 15 – Aug 28 2026 already exists (${already.id}, ${already.status}) — left alone`)
  } else {
    console.log('  period  Aug 15 – Aug 28 2026, DRAFT, no entries (grid renders blank cells)')
    if (WRITE) {
      const p = await prisma.payPeriod.create({
        data: {
          startDate: PERIOD_START,
          endDate: PERIOD_END,
          note: 'Seeded 2026-09-01 for the verified paper timesheets.',
        },
        select: { id: true },
      })
      journal.createdPeriodId = p.id
    }
  }

  if (WRITE) {
    await prisma.auditLog.create({
      data: {
        action: 'payroll.seed_roster',
        entityType: 'pay_period',
        entityId: journal.createdPeriodId ?? already?.id ?? 'none',
        newValues: journal as object,
      },
    })
    const path = `tmp/payroll-seed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    writeFileSync(path, JSON.stringify(journal, null, 2))
    console.log(`\n  journal → ${path}`)
    console.log(`  created ${journal.createdEmployeeIds.length} employees, ` +
      `linked ${journal.linkedEmployeeIds.length}, ` +
      `${journal.createdProfileIds.length} payroll profiles\n`)
  } else {
    console.log('\n  DRY RUN — nothing written. Re-run with --write.\n')
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
