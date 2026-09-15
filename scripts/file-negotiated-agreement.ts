/**
 * File a negotiated rental agreement as a company master.
 *
 *   npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026
 *   vercel env run -e production -- \
 *     npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026 --write
 *
 * The write needs BLOB_READ_WRITE_TOKEN, which is deliberately not in
 * .env.local — hence `vercel env run` (same pattern as fetch-company-logos.ts).
 *
 * The coverage window comes from the agreement itself; --effective/--expires
 * override it for a one-off.
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

/**
 * `--alias "Party Giraffes=Party Giraffes, LLC"` (repeatable) maps the name in
 * the registry to the company's EXACT name in the DB.
 *
 * The registry names a company the way we talk about it; the DB row may carry
 * the legal entity. Matching stays exact — an alias is a human stating which
 * row, not the script loosening its rule and picking a near-match. Filing a
 * contract against the wrong company is the failure worth being rigid about.
 */
function aliases(): Map<string, string> {
  const m = new Map<string, string>()
  process.argv.forEach((a, i) => {
    if (a !== '--alias') return
    const raw = process.argv[i + 1] || ''
    const eq = raw.indexOf('=')
    if (eq > 0) m.set(raw.slice(0, eq).trim(), raw.slice(eq + 1).trim())
  })
  return m
}

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
    console.log('       [--alias "Registry Name=Exact DB Name"] (repeatable)')
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

  // The agreed window lives on the agreement; flags override for a one-off.
  const effectiveOverride = arg('effective')
  const expiryOverride = arg('expires')
  const effectiveDate = parseDate(effectiveOverride ?? agreement.effectiveDate, 'effective')
  const expiryDate = parseDate(expiryOverride ?? agreement.expiryDate, 'expires')
  if (WRITE && !expiryDate) {
    console.error('No expiry date: an auto-covering master with no end date never lapses.')
    console.error('Set expiryDate on the agreement in negotiatedAgreement.ts, or pass --expires.')
    process.exit(1)
  }

  // Checked BEFORE anything is rendered or written. The PDF goes to the
  // private blob store first and the CompanyAgreement row second, so a
  // missing token fails mid-company — after the first upload, possibly
  // between the two companies — and leaves the run half-done. BLOB_READ_
  // WRITE_TOKEN is deliberately NOT in .env.local (see
  // scripts/fetch-company-logos.ts), so this is the normal way to get it
  // wrong, not an edge case.
  if (WRITE && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is not set — the agreement PDF has nowhere to go.')
    console.error('It is not in .env.local by design. Run the write under Vercel env:')
    console.error('')
    console.error(`  vercel env run -e production -- npx tsx scripts/file-negotiated-agreement.ts --key ${key} --write`)
    process.exit(1)
  }

  const src = (o: string | undefined) => (o ? 'flag' : 'agreement')
  console.log(`\n${agreement.title} (${agreement.key})`)
  console.log(`  ${agreement.clauses.length} negotiated clauses + ${agreement.appendedClauses.length} appended, plus Fleet + LCDW`)
  console.log(`  appended: ${agreement.appendedClauses.map((c) => `${c.ref}. ${c.title}`).join(', ')}`)
  console.log(
    `  effective ${effectiveDate!.toISOString().slice(0, 10)} (${src(effectiveOverride)})` +
      ` → ${expiryDate!.toISOString().slice(0, 10)} (${src(expiryOverride)})`,
  )
  console.log(WRITE ? '  MODE: WRITE\n' : '  MODE: dry run (pass --write to file)\n')

  const journal: Array<Record<string, unknown>> = []

  const alias = aliases()

  for (const registryName of agreement.companies) {
    const companyName = alias.get(registryName) ?? registryName
    const matches = await prisma.company.findMany({
      where: { name: companyName },
      select: { id: true, name: true },
    })
    if (matches.length !== 1) {
      console.log(
        `  ✗ ${registryName}: ${matches.length} companies match the exact name "${companyName}" — skipped`,
      )
      // Name the candidates so the next run is a one-liner rather than a
      // guessing game. Read-only, and it still refuses to choose.
      const near = await prisma.company.findMany({
        where: { name: { contains: companyName.split(/\s+/)[0], mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 10,
      })
      if (near.length) {
        console.log('      did you mean:')
        for (const n of near) console.log(`        --alias "${registryName}=${n.name}"   (${n.id})`)
      }
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
