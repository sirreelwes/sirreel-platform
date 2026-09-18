/**
 * Filing a client's negotiated agreement as their ANNUAL master — the WORK,
 * separated from the way it is started.
 *
 * Wes, 2026-09-18, on Party Giraffes and Graduation Day: "I need to make
 * those negotiated agreements standard for each job as an annual agreement."
 * Their counsel's redline had been transcribed, rendered on SirReel paper and
 * given a filing script back on 2026-09-15 — and then nothing ran it, because
 * the write needs both the production database AND `BLOB_READ_WRITE_TOKEN`,
 * which is deliberately not in .env.local. So the one thing standing between
 * a settled negotiation and every job being papered by it was a laptop.
 *
 * Hence the 2026-09-16 split: the logic lives here and gets TWO entry points.
 *
 *   laptop  scripts/file-negotiated-agreement.ts  — thin wrapper + journal file
 *   iPad    /admin/maintenance                    — same function + AuditLog row
 *
 * The web path also happens to be the one place the blob token is simply
 * PRESENT: the Vercel runtime carries it, so a run from a phone needs no
 * `vercel env run` incantation at all.
 *
 * ── The two halves of "standard for each job" ──────────────────────────
 * Wes's sentence names both mechanisms this repo already has, and a client
 * whose lawyer we negotiated with needs both:
 *
 *   1. `CompanyAgreement.autoCoverJobs` — the ANNUAL master. While its window
 *      is current, every job for that company is papered by this document and
 *      the portal asks only for the LCDW election (annualCoverage.ts).
 *   2. `Company.negotiatedTermsUrl` — the STANDING document. Whenever an
 *      agreement IS released for signature on one of their orders, it is
 *      THEIR paper that goes out, not our baseline template
 *      (`ensureSignedAgreementForOrder`).
 *
 * Coverage outranks standing terms, so while the annual is current only (1)
 * is felt. (2) is what stops the day the window lapses — 2026-12-31 here —
 * from quietly handing that client the standard template and asking them to
 * sign terms their counsel already redlined. Both point at the same rendered
 * PDF, so there is one document, filed twice for two different questions.
 *
 * ── What it will not do ────────────────────────────────────────────────
 * Superseding somebody's filed contract is a human decision, not a script's:
 *  - a company already carrying a CURRENT auto-covering master of this type
 *    is SKIPPED and named;
 *  - a company already carrying standing negotiated terms keeps them — the
 *    annual is still filed, and the log says the standing document was left
 *    alone;
 *  - companies are matched by EXACT name and 0 or 2+ matches is a refusal to
 *    guess, with the near-misses printed as ready-to-paste aliases.
 *
 * Nothing here prints, exits, or decides how it is reported: a refusal is a
 * thrown `TaskRefused`, which the CLI turns into exit code 2 and the route
 * into a 409 with a fix line.
 */

import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { TaskRefused } from '@/lib/admin/taskRefused'
import { isCoverageCurrent } from '@/lib/orders/annualCoverage'
import { generateNegotiatedAgreementPdf } from '@/lib/contracts/generateNegotiatedAgreementPdf'
import {
  findNegotiatedAgreement,
  crossReferencesHold,
  NEGOTIATED_AGREEMENTS,
  type NegotiatedAgreement,
} from '@/lib/contracts/negotiatedAgreement'

export { TaskRefused }

export interface FileNegotiatedOptions {
  /** Which negotiated agreement — a key from NEGOTIATED_AGREEMENTS. */
  key: string
  /** Report what would happen and write NOTHING. */
  dryRun: boolean
  /** YYYY-MM-DD overrides for a one-off; the agreed window is on the agreement. */
  effective?: string | null
  expires?: string | null
  /** Registry name → the company's EXACT name in the DB. Overrides the
   *  agreement's own `companyAliases`. */
  aliases?: Record<string, string> | null
  /** The HQ user who pressed the button. Null on the CLI. */
  actorUserId?: string | null
}

export interface FiledCompany {
  registryName: string
  companyName: string
  companyId: string
  companyAgreementId: string | null
  blobKey: string | null
  /** Whether their standing negotiated terms were pointed at this document. */
  standingTerms: 'set' | 'left-alone' | 'would-set'
}

export interface SkippedCompany {
  registryName: string
  /** The name we looked for — the alias, when one was given. */
  lookedFor: string
  reason: 'no-match' | 'ambiguous' | 'already-covered'
  detail: string
}

export interface FileNegotiatedResult {
  dryRun: boolean
  key: string
  title: string
  /** Null when the master covers from the moment it is filed. */
  effectiveDate: string | null
  expiryDate: string
  log: string[]
  /** Ids created THIS RUN. The only thing a cleanup may ever delete by. */
  createdIds: string[]
  /** Company rows whose standing terms were pointed at this document. */
  touchedIds: string[]
  filed: FiledCompany[]
  skipped: SkippedCompany[]
}

/**
 * `Registry Name=Exact DB Name`, one per line or separated by semicolons.
 *
 * NOT comma-separated, and that is not an oversight: the names this maps to
 * are legal entities — "Party Giraffes, LLC" — and a separator that appears
 * inside the value is a parser that silently files a contract against half a
 * company name.
 */
export function parseAliasEntries(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (raw ?? '').split(/[\n;]+/)) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const from = line.slice(0, eq).trim()
    const to = line.slice(eq + 1).trim()
    if (from && to) out[from] = to
  }
  return out
}

/** The exact DB name to look for: an explicit alias, else the agreement's own
 *  confirmed one, else the registry name as written. */
export function resolveCompanyName(
  agreement: Pick<NegotiatedAgreement, 'companyAliases'>,
  registryName: string,
  extra?: Record<string, string> | null,
): string {
  return extra?.[registryName] ?? agreement.companyAliases?.[registryName] ?? registryName
}

/** What the filed document is called on disk and in the client's inbox. */
export function agreementFilename(agreement: Pick<NegotiatedAgreement, 'title'>, companyName: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '')
  return `${safe(agreement.title)} - ${safe(companyName)}.pdf`
}

/** Plain-English record of WHAT was negotiated, for the CRM standing-terms card. */
export function standingTermsSummary(agreement: NegotiatedAgreement): string {
  const appended = agreement.appendedClauses.map((c) => `${c.ref}. ${c.title}`).join(', ')
  return (
    `${agreement.title} — the client's own redline, agreed with their counsel and rendered on SirReel paper ` +
    `(${agreement.version}). Their clauses are verbatim and in their numbering. ` +
    `Appended by SirReel because their document has none: ${appended}, plus the Fleet Agreement and the LCDW Addendum. ` +
    `Also filed as their annual master, so jobs inside the coverage window need no per-job signature.`
  )
}

function parseDate(v: string | null | undefined, label: string): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new TaskRefused(`"${v}" is not a date.`, `Give ${label} as YYYY-MM-DD.`)
  return d
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function fileNegotiatedAgreement(opts: FileNegotiatedOptions): Promise<FileNegotiatedResult> {
  const { dryRun } = opts
  const agreement = findNegotiatedAgreement(opts.key)
  if (!agreement) {
    throw new TaskRefused(
      `No negotiated agreement with key "${opts.key}".`,
      `Known keys: ${NEGOTIATED_AGREEMENTS.map((a) => a.key).join(', ')}.`,
    )
  }

  // The appended clause cites section numbers in THEIR sequence. If the
  // numbering ever stops matching, that clause points at the wrong terms —
  // stop before anything is rendered, let alone filed.
  const xref = crossReferencesHold(agreement.clauses)
  if (!xref.ok) {
    const bad = xref.mismatched.map((m) => `section ${m.ref}: ours "${m.ours}" vs theirs "${m.theirs}"`).join('; ')
    throw new TaskRefused(
      `Cross-references do not hold — the appended clause would cite the wrong sections. ${bad}`,
      'Re-check the appended clause against their numbering in negotiatedAgreement.ts before filing anything.',
    )
  }

  const effectiveDate = parseDate(opts.effective ?? agreement.effectiveDate, 'the effective date')
  const expiryDate = parseDate(opts.expires ?? agreement.expiryDate, 'the expiry date')
  if (!expiryDate) {
    throw new TaskRefused(
      'This agreement has no expiry date.',
      'An auto-covering master with no end date never lapses and nothing ever hands the signing ask back. Set expiryDate on the agreement, or pass one in.',
    )
  }

  // Checked BEFORE anything is rendered or written. The PDF goes to the blob
  // store first and the row second, so a missing token fails mid-company —
  // possibly BETWEEN two companies — and leaves the run half-done.
  if (!dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new TaskRefused(
      'BLOB_READ_WRITE_TOKEN is not set — the agreement PDF has nowhere to go.',
      `It is deliberately not in .env.local. Run it from /admin/maintenance (the Vercel runtime has the token), or on a laptop: vercel env run -e production -- npx tsx scripts/file-negotiated-agreement.ts --key ${agreement.key} --write`,
    )
  }

  const log: string[] = []
  const createdIds: string[] = []
  const touchedIds: string[] = []
  const filed: FiledCompany[] = []
  const skipped: SkippedCompany[] = []

  log.push(`${agreement.title} (${agreement.key})`)
  log.push(
    `  ${agreement.clauses.length} negotiated clauses verbatim + ${agreement.appendedClauses.length} appended` +
      `, plus the Fleet Agreement and the LCDW Addendum`,
  )
  log.push(`  coverage ${effectiveDate ? day(effectiveDate) : 'from today'} → ${day(expiryDate)} (inclusive)`)
  log.push(dryRun ? '  MODE: dry run — nothing is written' : '  MODE: writing')
  log.push('')

  const actorName = opts.actorUserId
    ? (await prisma.user.findUnique({ where: { id: opts.actorUserId }, select: { name: true } }))?.name ?? null
    : null

  for (const registryName of agreement.companies) {
    const companyName = resolveCompanyName(agreement, registryName, opts.aliases)
    const via = companyName === registryName ? '' : ` (as "${companyName}")`

    const matches = await prisma.company.findMany({
      where: { name: companyName },
      select: { id: true, name: true, negotiatedTermsUrl: true },
    })
    if (matches.length !== 1) {
      log.push(`  ✗ ${registryName}${via}: ${matches.length} companies carry that exact name — skipped`)
      // Name the candidates so the next run is one paste rather than a
      // guessing game. Read-only, and it still refuses to choose.
      const near = await prisma.company.findMany({
        where: { name: { contains: companyName.split(/\s+/)[0], mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 10,
      })
      for (const n of near) log.push(`      did you mean:  ${registryName}=${n.name}`)
      skipped.push({
        registryName,
        lookedFor: companyName,
        reason: matches.length === 0 ? 'no-match' : 'ambiguous',
        detail: near.length ? `candidates: ${near.map((n) => n.name).join(' · ')}` : 'no similar name on file',
      })
      continue
    }
    const company = matches[0]

    const existing = await prisma.companyAgreement.findMany({
      where: { companyId: company.id, contractType: 'RENTAL_AGREEMENT', deletedAt: null },
      select: { id: true, title: true, autoCoverJobs: true, deletedAt: true, effectiveDate: true, expiryDate: true },
    })
    const covering = existing.find((a) => isCoverageCurrent(a))
    if (covering) {
      log.push(`  ✗ ${company.name}: already covered by "${covering.title ?? covering.id}" — skipped (supersede by hand)`)
      skipped.push({
        registryName,
        lookedFor: companyName,
        reason: 'already-covered',
        detail: `covered by ${covering.title ?? covering.id}`,
      })
      continue
    }

    const buffer = await generateNegotiatedAgreementPdf({ agreement, companyName: company.name })
    const filename = agreementFilename(agreement, company.name)
    const standingHeld = !!company.negotiatedTermsUrl

    if (dryRun) {
      log.push(`  · ${company.name}: would file "${filename}" (${buffer.length.toLocaleString()} bytes) as their annual master`)
      log.push(
        standingHeld
          ? '      standing terms: already on file — would be left alone'
          : '      standing terms: would point at this document, so any per-job signature uses their paper',
      )
      filed.push({
        registryName,
        companyName: company.name,
        companyId: company.id,
        companyAgreementId: null,
        blobKey: null,
        standingTerms: standingHeld ? 'left-alone' : 'would-set',
      })
      continue
    }

    const blobKey = `company-agreements/${company.id}/${randomUUID()}-${filename.replace(/\s+/g, '-')}`
    // The store is PRIVATE; every reader streams it through a gated proxy.
    const blob = await put(blobKey, buffer, { access: 'private' as 'public', contentType: 'application/pdf' })

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.companyAgreement.create({
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
          // standingLcdwDecision stays NULL on purpose: their counsel settled
          // the terms, nobody elected the damage waiver. A null standing
          // answer is exactly what makes the portal ask per job — which is
          // the whole shape of an annual account (Wes, 2026-09-01).
          note: `Negotiated with ${agreement.companies.join(' / ')} counsel; rendered from ${agreement.key}. ${agreement.version}.`,
          source: 'INTERNAL',
          uploadedById: opts.actorUserId ?? null,
        },
        select: { id: true },
      })

      // Their paper becomes the document any per-job release would send —
      // never overwriting terms somebody already recorded.
      if (!standingHeld) {
        await tx.company.update({
          where: { id: company.id },
          data: {
            negotiatedTermsUrl: blob.url,
            negotiatedTermsSummary: standingTermsSummary(agreement),
            negotiatedTermsNegotiatedAt: effectiveDate,
            negotiatedTermsApprovedAt: new Date(),
            negotiatedTermsApprovedBy: actorName,
            negotiatedTermsActiveAsOf: effectiveDate,
            // When the coverage window ends, these terms are what the client
            // would be asked to sign — so that is the day to look at them.
            negotiatedTermsReviewDueDate: expiryDate,
          },
        })
      }
      return row
    })

    await prisma.auditLog.create({
      data: {
        userId: opts.actorUserId ?? undefined,
        action: 'company_agreement.filed',
        entityType: 'CompanyAgreement',
        entityId: created.id,
        newValues: {
          companyId: company.id,
          companyName: company.name,
          key: agreement.key,
          title: agreement.title,
          effectiveDate: effectiveDate ? day(effectiveDate) : null,
          expiryDate: day(expiryDate),
          autoCoverJobs: true,
          standingTerms: standingHeld ? 'left-alone' : 'set',
        },
      },
    }).catch(() => {})

    createdIds.push(created.id)
    if (!standingHeld) touchedIds.push(company.id)
    filed.push({
      registryName,
      companyName: company.name,
      companyId: company.id,
      companyAgreementId: created.id,
      blobKey,
      standingTerms: standingHeld ? 'left-alone' : 'set',
    })
    log.push(`  ✓ ${company.name}: filed ${created.id} — every job inside the window is papered by it`)
    log.push(
      standingHeld
        ? '      standing terms: already on file, left alone'
        : '      standing terms: now their document, so a per-job signature uses their paper',
    )
  }

  if (filed.length && !dryRun) {
    log.push('')
    log.push('Coverage is read live, so jobs already open for these companies are covered on their next read.')
    log.push(`It lapses after ${day(expiryDate)} — after that HQ asks for a signature again.`)
  }

  return {
    dryRun,
    key: agreement.key,
    title: agreement.title,
    effectiveDate: effectiveDate ? day(effectiveDate) : null,
    expiryDate: day(expiryDate),
    log,
    createdIds,
    touchedIds,
    filed,
    skipped,
  }
}
