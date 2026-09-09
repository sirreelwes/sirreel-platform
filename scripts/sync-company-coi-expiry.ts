#!/usr/bin/env tsx
/**
 * Sync `Company.coiOnFile` / `Company.coiExpiry` from the account's newest
 * APPROVED certificate.
 *
 * Wes, 2026-09-09 ("fix all 11"). Those two columns are hand-typed in the
 * CRM and NOTHING writes them — not a COI upload, not an approval on the
 * review desk. So the CRM chip drifts away from the certificate the rest of
 * HQ resolves: on 2026-09-09 eleven accounts rendered a red "COI expired"
 * chip on /crm and /crm/portals while holding an approved cert running a
 * year or more longer (Gopher Digital's chip was two years stale). Fox
 * Sports read "expired Jun 30, 2026" against a cert good through Jun 30,
 * 2027.
 *
 * Authority is `findCompanyCoi` — the same resolver behind the job and
 * portal surfaces — so the chip cannot disagree with the job pages again.
 * That means APPROVED only, and an expiry date required; a PENDING cert
 * never sets the chip green.
 *
 * ONLY MOVES THE DATE FORWARD. A stored expiry later than any cert on file
 * is left alone and reported: it may have been typed off a document that
 * was never uploaded, and overwriting it would delete the only record of
 * that policy.
 *
 * Usage:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/sync-company-coi-expiry.ts          # dry run
 *   npx tsx scripts/sync-company-coi-expiry.ts --write
 *
 * Reverse: journals/company-coi-expiry-sync-<ts>.json holds the prior
 *   coiOnFile/coiExpiry per company id. Reversal is BY CAPTURED ID only.
 */
import { prisma } from '@/lib/prisma'
import { writeFileSync, mkdirSync } from 'node:fs'

const WRITE = process.argv.includes('--write')
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '—')

async function main() {
  const now = new Date()
  console.log(`Company COI expiry sync — ${WRITE ? 'LIVE WRITE' : 'DRY RUN (pass --write to apply)'}\n`)

  // Every company holding at least one approved, dated certificate.
  const certs = await prisma.coiCheck.findMany({
    where: {
      deletedAt: null,
      humanDecision: 'APPROVED',
      companyId: { not: null },
      policyExpiryDate: { not: null },
    },
    orderBy: [{ policyExpiryDate: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, companyId: true, originalFilename: true, policyExpiryDate: true },
  })

  const newest = new Map<string, (typeof certs)[number]>()
  for (const c of certs) if (!newest.has(c.companyId!)) newest.set(c.companyId!, c)

  const companies = await prisma.company.findMany({
    where: { id: { in: [...newest.keys()] } },
    select: { id: true, name: true, coiOnFile: true, coiExpiry: true },
    orderBy: { name: 'asc' },
  })

  const changes: any[] = []
  const aheadOfCerts: any[] = []

  for (const co of companies) {
    const cert = newest.get(co.id)!
    const to = cert.policyExpiryDate!
    const from = co.coiExpiry
    if (from && from.getTime() > to.getTime()) {
      aheadOfCerts.push({ name: co.name, stored: day(from), newestCert: day(to) })
      continue
    }
    if (from && from.getTime() === to.getTime() && co.coiOnFile) continue
    changes.push({
      companyId: co.id,
      name: co.name,
      from: { coiOnFile: co.coiOnFile, coiExpiry: from ? from.toISOString() : null },
      to: { coiOnFile: true, coiExpiry: to.toISOString() },
      expired: !!from && from.getTime() < now.getTime(),
      coiCheckId: cert.id,
      file: cert.originalFilename,
    })
  }

  console.log(`${companies.length} accounts hold an approved dated certificate`)
  console.log(`${changes.length} need the chip synced (${changes.filter((c) => c.expired).length} currently read EXPIRED)\n`)
  for (const c of changes) {
    console.log(`  ${c.name}`)
    console.log(`     ${day(c.from.coiExpiry ? new Date(c.from.coiExpiry) : null)} -> ${day(new Date(c.to.coiExpiry))}   ${c.file}`)
  }
  if (aheadOfCerts.length) {
    console.log(`\nLEFT ALONE — stored expiry is later than any cert on file (${aheadOfCerts.length}):`)
    for (const a of aheadOfCerts) console.log(`  ${a.name}: stored ${a.stored}, newest cert ${a.newestCert}`)
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/company-coi-expiry-sync-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), write: WRITE, changes, aheadOfCerts }, null, 2))
  console.log(`\njournal → ${path}`)

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written.')
    return
  }

  for (const c of changes) {
    await prisma.company.update({
      where: { id: c.companyId },
      data: { coiOnFile: true, coiExpiry: new Date(c.to.coiExpiry) },
    })
    await prisma.auditLog.create({
      data: {
        action: 'company.coi_expiry_sync',
        entityType: 'Company',
        entityId: c.companyId,
        oldValues: c.from as any,
        newValues: { ...c.to, fromCoiCheckId: c.coiCheckId, journal: path } as any,
      },
    })
  }
  console.log(`\nDONE. ${changes.length} companies updated.`)
}

main().finally(() => prisma.$disconnect())
