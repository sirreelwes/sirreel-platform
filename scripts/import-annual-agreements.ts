/**
 * Import the executed annual rental agreements out of Cognito Forms.
 *
 * Wes dropped the live list on 2026-09-02 (78 submissions, entries 100–177).
 * Every one is a signed annual agreement; none of them existed in HQ, so
 * every one of those clients was being asked to sign per job.
 *
 * ── What this creates, and what it deliberately does not claim ─────
 *
 * A `CompanyAgreement` per CURRENT submission, carrying the term, the signer,
 * and the standing LCDW election. The PDF it files is a RECORD rendered from
 * SirReel's own canonical clause text plus that submission's field values —
 * clearly headed as a record of the Cognito entry, citing its entry id, and
 * stating that the executed original with the client's signature lives in
 * Cognito. It is not a reproduction of the signed document and does not
 * pretend to be one: no signature image, no "signed" badge.
 *
 * That is honest and it is enough for the job the file has to do — a client
 * or a reader of the job file can see exactly which terms are in force. Swap
 * in the true Cognito PDF export later and the record is replaced.
 *
 * ── Rules ──────────────────────────────────────────────────────────
 *
 *  - EXPIRED submissions are skipped. A lapsed agreement must never
 *    auto-cover; that is the whole point of the window check in
 *    annualCoverage.ts.
 *  - SUPERSEDED submissions are skipped. Several companies renewed (MT.
 *    VERNON 114 -> 176, Fox Sports 101/104 -> 163, Wooden Ladder 103 -> 167).
 *    Only the newest live entry per company is filed; the older one is a
 *    historical record, not a governing document.
 *  - Companies are matched, never created blind. An unmatched name is
 *    REPORTED for a human, because creating a duplicate "Fox Sports" beside
 *    an existing "FOX SPORTS" is how a client ends up with two accounts and
 *    coverage on the wrong one.
 *  - Idempotent on (companyId, note-embedded entry id): re-running does not
 *    duplicate.
 *
 * Usage:
 *   npx tsx scripts/import-annual-agreements.ts            # dry run
 *   npx tsx scripts/import-annual-agreements.ts --write
 */
import fs from 'fs'
import path from 'path'
import { put } from '@vercel/blob'
import { prisma } from '../src/lib/prisma'
import { generateCounterPdf } from '../src/lib/contracts/generateCounterPdf'

const TSV = path.join(process.cwd(), 'tmp/annual-agreements.tsv')
const WRITE = process.argv.includes('--write')

interface Row {
  entryId: string
  companyName: string
  companyType: string
  officeEmail: string
  officePhone: string
  agreementDate: Date | null
  expiryDate: Date | null
  contactFirst: string
  contactLast: string
  position: string
  contactEmail: string
  lcdw: 'ACCEPTED' | 'DECLINED' | null
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postal: string
}

function parseDate(s: string): Date | null {
  const t = (s || '').trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  // Stored as a calendar date — build in UTC so it never shifts a day.
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])))
}

function readRows(): Row[] {
  const lines = fs.readFileSync(TSV, 'utf8').split('\n').filter((l) => l.trim())
  return lines.slice(1).map((line) => {
    const c = line.split('\t')
    const lcdwRaw = (c[22] || '').toLowerCase()
    return {
      entryId: c[0]?.trim(),
      companyName: c[1]?.trim(),
      companyType: c[2]?.trim(),
      addressLine1: c[3]?.trim(),
      addressLine2: c[4]?.trim(),
      city: c[5]?.trim(),
      state: c[6]?.trim(),
      postal: c[7]?.trim(),
      officeEmail: c[10]?.trim(),
      officePhone: c[11]?.trim(),
      agreementDate: parseDate(c[12]),
      expiryDate: parseDate(c[13]),
      contactFirst: c[14]?.trim(),
      contactLast: c[15]?.trim(),
      position: c[16]?.trim(),
      contactEmail: c[17]?.trim(),
      lcdw: lcdwRaw.includes('accept') ? 'ACCEPTED' : lcdwRaw.includes('decline') ? 'DECLINED' : null,
    }
  })
}

/**
 * Hand-confirmed joins between a Cognito company name and the HQ record.
 *
 * Wes confirmed these on 2026-09-02 after reviewing the dry run. Each was
 * checked against the submission's EMAIL DOMAIN, not just the name —
 * "Neon Productions" is filed in HQ as "Little Dot Studios / Neon
 * Productions" and its contact writes from littledotstudios.com; "Sun
 * stages" quotes from novaquotes@ and is filed as "Sun Stages, Inc / Nova
 * Lighting Inc.". Name similarity alone would not have been enough to file
 * a binding agreement against either.
 *
 * Keyed on the exact Cognito name, valued with the exact HQ name. An entry
 * whose HQ name no longer resolves is REPORTED, never silently dropped —
 * a rename must not quietly un-map an agreement.
 */
const COMPANY_ALIASES: Record<string, string> = {
  'Harbor freight tools': 'Harbor Freight',
  'Tubescience': 'TubeScience USA, Inc.',
  'north of now': 'North of Now Studios, LLC',
  'Live Nation, Inc.': 'Live Nation Worldwide, Inc',
  'Echobend Pictures': 'Echobend',
  'Neon Productions': 'Little Dot Studios / Neon Productions',
  'Sun stages': 'Sun Stages, Inc / Nova Lighting Inc.',
  'Creative P Studio': 'CreativeP Studios',
}

/** Loose-but-conservative company match. Never fuzzy enough to guess. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|company|incorporated|the)\b/g, '')
    .replace(/d\/b\/a.*/, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

async function main() {
  const rows = readRows()
  const now = new Date()

  // Newest LIVE submission per company name.
  const live = rows.filter((r) => r.expiryDate && r.expiryDate.getTime() >= now.getTime())
  const expired = rows.length - live.length

  const newestByCompany = new Map<string, Row>()
  for (const r of live) {
    const key = normalize(r.companyName)
    const prev = newestByCompany.get(key)
    if (!prev || (r.agreementDate?.getTime() ?? 0) > (prev.agreementDate?.getTime() ?? 0)) {
      newestByCompany.set(key, r)
    }
  }
  const superseded = live.length - newestByCompany.size

  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  const byNorm = new Map<string, { id: string; name: string }[]>()
  for (const c of companies) {
    const k = normalize(c.name)
    byNorm.set(k, [...(byNorm.get(k) ?? []), c])
  }

  const matched: { row: Row; company: { id: string; name: string } }[] = []
  const ambiguous: { row: Row; candidates: string[] }[] = []
  const unmatched: Row[] = []

  const byExactName = new Map(companies.map((c) => [c.name, c]))
  const brokenAliases: string[] = []

  for (const r of newestByCompany.values()) {
    // A confirmed alias wins outright — it is a human's answer to exactly
    // the question the matcher could not settle.
    const aliasTarget = COMPANY_ALIASES[r.companyName]
    if (aliasTarget) {
      const hit = byExactName.get(aliasTarget)
      if (hit) {
        matched.push({ row: r, company: hit })
        continue
      }
      brokenAliases.push(`${r.companyName} -> "${aliasTarget}" (no such company in HQ)`)
      continue
    }

    const hits = byNorm.get(normalize(r.companyName)) ?? []
    if (hits.length === 1) matched.push({ row: r, company: hits[0] })
    else if (hits.length > 1) ambiguous.push({ row: r, candidates: hits.map((h) => h.name) })
    else unmatched.push(r)
  }

  console.log(`\nSubmissions read:        ${rows.length}`)
  console.log(`  expired (skipped):     ${expired}`)
  console.log(`  superseded (skipped):  ${superseded}`)
  console.log(`  current agreements:    ${newestByCompany.size}`)
  console.log(`\n  matched to a company:  ${matched.length}`)
  console.log(`  ambiguous (>1 match):  ${ambiguous.length}`)
  console.log(`  NOT in HQ:             ${unmatched.length}`)

  if (brokenAliases.length) {
    console.log('\n--- ALIAS TARGET MISSING (renamed or deleted — fix the map) ---')
    for (const b of brokenAliases) console.log(`  ${b}`)
  }
  if (ambiguous.length) {
    console.log('\n--- AMBIGUOUS (skipped; a human picks) ---')
    for (const a of ambiguous) console.log(`  "${a.row.companyName}" -> ${a.candidates.join(' | ')}`)
  }
  if (unmatched.length) {
    // Near misses, so an exact-match failure is a question a human can answer
    // in a second rather than a research task. Cognito's "Echobend Pictures"
    // and HQ's "Echobend" are the same client; the matcher is deliberately
    // too strict to join them itself, but it can point at the candidate.
    console.log('\n--- NO EXACT MATCH (needs a human) ---')
    for (const u of unmatched) {
      const n = normalize(u.companyName)
      const near = companies
        .filter((c) => {
          const cn = normalize(c.name)
          if (!cn || !n) return false
          return cn.startsWith(n.slice(0, 8)) || n.startsWith(cn.slice(0, 8)) || cn.includes(n) || n.includes(cn)
        })
        .map((c) => c.name)
        .slice(0, 4)
      console.log(`  ${u.companyName}  (${u.contactEmail})  exp ${u.expiryDate?.toISOString().slice(0, 10)}  LCDW ${u.lcdw}`)
      console.log(near.length ? `      maybe: ${near.join(' | ')}` : '      no candidate in HQ — create the company')
    }
  }
  console.log('\n--- WOULD FILE ---')
  for (const m of matched) {
    console.log(
      `  ${m.company.name.padEnd(38)} exp ${m.row.expiryDate?.toISOString().slice(0, 10)}  LCDW ${String(m.row.lcdw).padEnd(8)} entry #${m.row.entryId}`,
    )
  }

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write.\n')
    return
  }

  const journal: unknown[] = []
  for (const { row, company } of matched) {
    const marker = `[cognito-entry:${row.entryId}]`
    const already = await prisma.companyAgreement.findFirst({
      where: { companyId: company.id, note: { contains: marker }, deletedAt: null },
      select: { id: true },
    })
    if (already) {
      console.log(`  skip (already filed): ${company.name}`)
      continue
    }

    const title = `${row.agreementDate?.getUTCFullYear() ?? ''} Annual Rental Agreement`.trim()
    const pdf = await generateCounterPdf({
      company: {
        name: company.name,
        industry: row.companyType || null,
        billingAddress: [row.addressLine1, row.addressLine2, `${row.city}, ${row.state} ${row.postal}`]
          .filter(Boolean)
          .join('\n'),
        billingEmail: row.officeEmail || null,
        notes: null,
      },
      job: null,
      aiChanges: [],
      decisions: [],
      generatedAt: new Date(),
      grantedScope: null,
      documentTitle: `${title} — record of executed agreement`,
    })

    const key = `company-agreements/${company.id}/cognito-${row.entryId}-annual-record.pdf`
    const up = await put(key, pdf, { access: 'private' as 'public', contentType: 'application/pdf' })

    const note =
      `${marker} Imported 2026-09-02 from the Cognito annual rental agreement form. ` +
      `Executed by ${row.contactFirst} ${row.contactLast} (${row.position}), ${row.contactEmail}, on ` +
      `${row.agreementDate?.toISOString().slice(0, 10)}. LCDW: ${row.lcdw}. ` +
      `The signed original with the client's signature is in Cognito Forms, entry ${row.entryId}; ` +
      `this PDF is a record of the terms in force, not a copy of the signed document.`

    const created = await prisma.companyAgreement.create({
      data: {
        companyId: company.id,
        contractType: 'RENTAL_AGREEMENT',
        title,
        fileKey: key,
        fileUrl: up.url,
        originalFilename: `${title.replace(/\s+/g, '-')}-record.pdf`,
        fileSize: pdf.length,
        mimeType: 'application/pdf',
        isAnnual: true,
        autoCoverJobs: true,
        standingLcdwDecision: row.lcdw,
        effectiveDate: row.agreementDate,
        expiryDate: row.expiryDate,
        signerName: `${row.contactFirst} ${row.contactLast}`.trim(),
        signedAt: row.agreementDate,
        note,
        source: 'INTERNAL',
      },
      select: { id: true },
    })
    journal.push({ companyAgreementId: created.id, companyId: company.id, companyName: company.name, entryId: row.entryId })
    console.log(`  filed: ${company.name} (${created.id})`)
  }

  const out = path.join(process.cwd(), `tmp/annual-agreement-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify(journal, null, 2))
  console.log(`\nFiled ${journal.length}. Journal (reversible by captured id): ${out}\n`)
}

main().finally(() => prisma.$disconnect())
