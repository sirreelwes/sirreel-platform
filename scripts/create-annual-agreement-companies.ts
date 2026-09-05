#!/usr/bin/env tsx
/**
 * Create the Company records for annual-agreement clients that HQ has never
 * booked.
 *
 * Five of the 61 current Cognito annual agreements (2026-09-02) named a
 * company with no HQ record at all — they signed an annual agreement without
 * ever reaching a job in the new system. The importer deliberately refuses to
 * create companies itself (filing a binding agreement against a company you
 * invented is the failure mode that matters), so this is the explicit,
 * reviewed step Wes asked for.
 *
 * Every field comes from that client's own submission — name, type, address,
 * office email and phone. Nothing is inferred.
 *
 * Idempotent: a company whose name already exists is SKIPPED, not duplicated.
 * That matters because this script exists to fix duplicates, and running it
 * twice must not create the exact problem it is cleaning up.
 *
 * Usage:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/create-annual-agreement-companies.ts          # dry run
 *   npx tsx scripts/create-annual-agreement-companies.ts --write
 *
 * Reverse: journals/annual-agreement-companies-<ts>.json holds every created id.
 * Deletion is BY CAPTURED ID only.
 */
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'

const WRITE = process.argv.includes('--write')

interface Seed {
  name: string
  /**
   * The free-text "Company Type" from the Cognito form. NOT written to
   * Company.industry — that column is a `ProductionType` enum (FILM / TV /
   * COMMERCIAL / MUSIC_VIDEO / CORPORATE / EVENT_PLANNER / OTHER), and
   * "Production Company" is not a production type. Mapping Taco Bell to
   * COMMERCIAL or a non-profit to CORPORATE would be inventing a
   * classification the client never gave, so `industry` keeps its OTHER
   * default and the client's own words are preserved in notes.
   */
  cognitoType: string
  billingAddress: string
  billingEmail: string
  /** Company has no phone column — kept in notes rather than discarded. */
  phone: string
  /** The Cognito entry this company was created for, kept in notes so the
   *  record can be traced back to the submission that justified it. */
  cognitoEntry: string
}

const SEEDS: Seed[] = [
  {
    name: 'Rise and Shine LLC',
    cognitoType: 'Production Company',
    billingAddress: '23327 Anza Ave\nTorrance, CA 90505',
    billingEmail: 'anthony@riseandshine.la',
    phone: '(310) 429-3385',
    cognitoEntry: '170',
  },
  {
    name: 'Sad But Drew, LLC',
    cognitoType: 'Production Company',
    billingAddress: '1168 Bellevue Avenue, Apt 306\nLos Angeles, CA 90012',
    billingEmail: 'drew@sadbutdrew.com',
    phone: '(305) 409-3427',
    cognitoEntry: '166',
  },
  {
    name: 'Bear Valley Springs Cultural Arts Association',
    cognitoType: 'Non-Profit',
    billingAddress: 'PO Box 1366\nTehachapi, CA 93581',
    billingEmail: 'treasurer@bvscaa.org',
    phone: '(714) 743-3104',
    cognitoEntry: '162',
  },
  {
    name: 'Taco Bell',
    cognitoType: 'Production Company',
    billingAddress: '1 Glen Bell Way\nIrvine, CA 92618',
    billingEmail: 'vannie.ly@yum.com',
    phone: '(714) 333-5618',
    cognitoEntry: '132',
  },
  {
    name: 'JS Reps Miami, Inc., d/b/a Art Department',
    cognitoType: 'Production Company',
    billingAddress: '424 E San Marino Drive\nMiami, FL 33139',
    billingEmail: 'taylor@art-dept.com',
    phone: '(516) 343-6663',
    cognitoEntry: '129',
  },
]

async function main() {
  const created: { id: string; name: string; cognitoEntry: string }[] = []
  const skipped: string[] = []

  for (const s of SEEDS) {
    // Case-insensitive so "taco bell" does not become a second Taco Bell.
    const existing = await prisma.company.findFirst({
      where: { name: { equals: s.name, mode: 'insensitive' } },
      select: { id: true, name: true },
    })
    if (existing) {
      skipped.push(`${s.name} — already exists (${existing.id})`)
      continue
    }

    if (!WRITE) {
      console.log(`  would create: ${s.name}  <${s.billingEmail}>  [cognito ${s.cognitoEntry}]`)
      continue
    }

    const row = await prisma.company.create({
      data: {
        name: s.name,
        billingAddress: s.billingAddress,
        billingEmail: s.billingEmail,
        notes:
          `Created 2026-09-02 from the executed annual rental agreement ` +
          `(Cognito entry ${s.cognitoEntry}). This client signed an annual ` +
          `agreement before ever booking a job in HQ. ` +
          `Company type per their submission: ${s.cognitoType}. ` +
          `Office phone: ${s.phone}.`,
      },
      select: { id: true, name: true },
    })
    created.push({ id: row.id, name: row.name, cognitoEntry: s.cognitoEntry })
    console.log(`  created: ${row.name} (${row.id})`)
  }

  if (skipped.length) {
    console.log('\nSKIPPED (already in HQ):')
    for (const s of skipped) console.log(`  ${s}`)
  }

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write.\n')
    return
  }

  const out = path.join(
    process.cwd(),
    `journals/annual-agreement-companies-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  )
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(created, null, 2))
  console.log(`\nCreated ${created.length}. Journal (reversible by captured id): ${out}\n`)
}

main().finally(() => prisma.$disconnect())
