/**
 * Idempotent seed for the Employee table. Re-runnable — uses upsert
 * keyed on workEmail. Links each Employee to the existing User row
 * with the same workEmail when one exists (most current staff do
 * have HQ logins; the link is nullable on Employee for future non-
 * login staff like drivers/warehouse).
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/seed-hr-employees.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface EmployeeSeed {
  fullName: string
  workEmail: string
  title?: string
  department?: string
}

const SEED: EmployeeSeed[] = [
  { fullName: 'Wes Bailey',     workEmail: 'wes@sirreel.com',     title: 'CEO',                 department: 'Executive' },
  { fullName: 'Dani Novoa',     workEmail: 'dani@sirreel.com',    title: 'COO',                 department: 'Executive' },
  { fullName: 'Hugo Servin',    workEmail: 'hugo@sirreel.com',    title: 'GM',                  department: 'Operations' },
  { fullName: 'Ana DeAngelis',  workEmail: 'ana@sirreel.com',     title: 'Vehicle Claims & Repairs', department: 'Accounting' },
  { fullName: 'Jose Pacheco',   workEmail: 'jose@sirreel.com',    title: 'Sales',               department: 'Sales' },
  { fullName: 'Oliver Carlson', workEmail: 'oliver@sirreel.com',  title: 'Sales',               department: 'Sales' },
  { fullName: 'Julian Ponce',   workEmail: 'julian@sirreel.com',  title: 'Dispatch / Fleet',    department: 'Fleet' },
  { fullName: 'Chris Valencia', workEmail: 'chris@sirreel.com',   title: 'Fleet Associate',     department: 'Fleet' },
]

async function main() {
  console.log(`Seeding ${SEED.length} employees…`)
  for (const e of SEED) {
    // Find the matching User by email so the userId link populates
    // when the staff member already has an HQ login. NULL link is
    // acceptable — Employee.userId is nullable by design.
    const user = await prisma.user.findUnique({
      where: { email: e.workEmail },
      select: { id: true },
    })
    const employee = await prisma.employee.upsert({
      where: { workEmail: e.workEmail },
      create: {
        fullName: e.fullName,
        workEmail: e.workEmail,
        title: e.title,
        department: e.department,
        userId: user?.id ?? null,
        isActive: true,
      },
      update: {
        // Re-link to user when one shows up after the first seed.
        // Don't overwrite fullName / title — the table may have been
        // hand-edited; the seed is for new rows + linking, not
        // mass-rewriting.
        userId: user?.id ?? undefined,
      },
      select: { id: true, fullName: true, workEmail: true, userId: true },
    })
    const linked = employee.userId ? 'linked to User' : 'no User link yet'
    console.log(`  ${employee.fullName.padEnd(20)} ${(employee.workEmail ?? '(no email)').padEnd(28)} (${linked})`)
  }
  console.log('Done.')
}

main()
  .catch((err) => { console.error('Seed failed:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
