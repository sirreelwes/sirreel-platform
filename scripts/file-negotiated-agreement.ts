/**
 * File a negotiated rental agreement as a company master.
 *
 *   npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026
 *   npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026 --write \
 *     --effective 2026-01-01 --expires 2026-12-31
 *
 * Renders the client's negotiated agreement on SirReel paper (see
 * negotiatedAgreement.ts) and files ONE CompanyAgreement per company, with
 * `autoCoverJobs` on — so every job those companies book is papered by this
 * document and the portal asks only for the LCDW election.
 *
 * Wes, 2026-09-15: "rebrand their doc and file it for both companies."
 *
 * ── Safety ────────────────────────────────────────────────────────────
 * DRY RUN unless --write. Live DB is production (see SHIPLOG Hard Rules), so:
 *  - Companies are matched by EXACT name and the script refuses on 0 or 2+
 *    matches rather than guessing which client gets a contract.
 *  - It never updates or soft-deletes an existing row. If a company already
 *    carries a current auto-covering master for this contract type, that
 *    company is SKIPPED and named — superseding someone's filed contract is a
 *    human decision, not a script's.
 *  - Every created id is written to journals/file-negotiated-agreement-*.json
 *    before the run reports success, so a reversal has captured ids to work
 *    from and never has to match on shape.
 *  - An expiry date is REQUIRED with --write: an auto-covering master with no
 *    end date never lapses and nothing ever hands the signing ask back. The
 *    route that files these by hand refuses for the same reason.
 */
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { put } from '@vercel/blob'
import { prisma } from '../src/lib/prisma'
import { generateNegotiatedAgreementPdf } from '../src/lib/contracts/generateNegotiatedAgreementPdf'
import {
  findNegotiatedAgreement,
  crossReferencesHold,
  NEGOTIATED_AGREEMENTS,
} from '../src/lib/contracts/negotiatedAgreement'
import { isCoverageCurrent } from '../src/lib/orders/annualCoverage'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const WRITE = process.argv.includes('--write')

function parseDate(v: string | undefined, label: string): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`--${label} is not a date: ${v}`)
  return d
}

async function main() {
  const key = arg('key')
  if (!key) {
    console.log('Usage: --key <agreement-key> [--write] [--effective YYYY-MM-DD] [--expires YYYY-MM-DD]')
    console.log('Known keys:', NEGOTIATED_AGREEMENTS.map((a) => a.key).join(', '))
    process.exit(1)
  }
  const agreement = findNegotiatedAgreement(key)
  if (!agreement) throw new Error(`No negotiated agreement with key "${key}"`)

  // The appended clause cites section numbers. If the client's numbering ever
  // stops matching, that clause would point at the wrong terms — stop.
  const xref = crossReferencesHold(agreement.clauses)
  if (!xref.ok) {
    console.error('Cross-references do NOT hold — appended clause would cite the wrong sections:')
    for (const m of xref.mismatched) console.error(`  section ${m.ref}: ours "${m.ours}" vs theirs "${m.theirs}"`)
    process.exit(2)
  }

  const effectiveDate = parseDate(arg('effective'), 'effective')
  const expiryDate = parseDate(arg('expires'), 'expires')
  if (WRITE && !expiryDate) {
    console.error('--expires is required with --write: an auto-covering master with no end date never lapses.')
    process.exit(1)
  }

  console.log(`\n${agreement.title} (${agreement.key})`)
  console.log(`  ${agreement.clauses.length} negotiated clauses + ${agreement.appendedClauses.length} appended, plus Fleet + LCDW`)
  console.log(`  appended: ${agreement.appendedClauses.map((c) => `${c.ref}. ${c.title}`).join(', ')}`)
  console.log(`  effective ${effectiveDate ? effectiveDate.toISOString().slice(0, 10) : '(none)'} → ${expiryDate ? expiryDate.toISOString().slice(0, 10) : '(none)'}`)
  console.log(WRITE ? '  MODE: WRITE\n' : '  MODE: dry run (pass --write to file)\n')

  const journal: Array<Record<string, unknown>> = []

  for (const companyName of agreement.companies) {
    const matches = await prisma.company.findMany({
      where: { name: companyName },
      select: { id: true, name: true },
    })
    if (matches.length !== 1) {
      console.log(`  ✗ ${companyName}: ${matches.length} companies match that exact name — skipped`)
      continue
    }
    const company = matches[0]

    const existing = await prisma.companyAgreement.findMany({
      where: { companyId: company.id, contractType: 'RENTAL_AGREEMENT', deletedAt: null },
      select: { id: true, title: true, autoCoverJobs: true, deletedAt: true, effectiveDate: true, expiryDate: true },
    })
    const covering = existing.find((a) => isCoverageCurrent(a))
    if (covering) {
      console.log(`  ✗ ${company.name}: already covered by "${covering.title ?? covering.id}" — skipped (supersede by hand)`)
      continue
    }

    const buffer = await generateNegotiatedAgreementPdf({ agreement, companyName: company.name })
    const filename = `${agreement.title.replace(/[^A-Za-z0-9 ._-]+/g, '')} - ${company.name.replace(/[^A-Za-z0-9 ._-]+/g, '')}.pdf`

    if (!WRITE) {
      console.log(`  · ${company.name}: would file "${filename}" (${buffer.length} bytes), autoCoverJobs=true`)
      continue
    }

    const blobKey = `company-agreements/${company.id}/${randomUUID()}-${filename.replace(/\s+/g, '-')}`
    const blob = await put(blobKey, buffer, {
      access: 'private' as 'public',
      contentType: 'application/pdf',
    })

    const created = await prisma.companyAgreement.create({
      data: {
        companyId: company.id,
        contractType: 'RENTAL_AGREEMENT',
        title: agreement.title,
        fileKey: blobKey,
        fileUrl: blob.url,
        originalFilename: filename,
        fileSize: buffer.length,
        mimeType: 'application/pdf',
        isAnnual: true,
        autoCoverJobs: true,
        effectiveDate,
        expiryDate,
        note: `Negotiated with ${agreement.companies.join(' / ')} counsel; rendered from ${agreement.key}. ${agreement.version}.`,
        source: 'INTERNAL',
      },
      select: { id: true },
    })

    await prisma.auditLog.create({
      data: {
        action: 'company_agreement.filed',
        entityType: 'CompanyAgreement',
        entityId: created.id,
        newValues: { companyId: company.id, key: agreement.key, title: agreement.title, script: true },
      },
    })

    journal.push({ companyId: company.id, companyName: company.name, companyAgreementId: created.id, blobKey })
    console.log(`  ✓ ${company.name}: filed ${created.id}`)
  }

  if (WRITE && journal.length) {
    const dir = path.join(process.cwd(), 'journals')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `file-negotiated-agreement-${agreement.key}-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify({ key: agreement.key, at: new Date().toISOString(), created: journal }, null, 2))
    console.log(`\nJournal: ${file}`)
  }
  console.log()
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
