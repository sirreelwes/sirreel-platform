/**
 * The annual rental agreement, signed in the ACCOUNT portal.
 *
 * Wes 2026-09-04: "Make their default Annual Rental Agreement" → "build it".
 *
 * ── What "covered" means (Wes 2026-09-04) ─────────────────────────────
 * Not "never signs again". Each job is still confirmed with a one-page
 * addendum that logs the show under the master (JobAgreementAddendum +
 * the per-job LcdwElection acknowledgement); what the annual removes is
 * re-signing the full agreement per show. Every client-facing sentence
 * about the annual says exactly that and no more.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 * Every annual master on file so far is a RECORD of a signature given in
 * Cognito. Radical Media never signed one, and marking them auto-covered
 * without a signature would stop asking their coordinators to sign on the
 * strength of a document that doesn't exist — the exact hazard the annual
 * feature exists to prevent. So the master is OFFERED (filed pending) and
 * an executive signs it in their own portal; only that signature flips
 * auto-cover on.
 *
 * ── Two states of one row ──────────────────────────────────────────────
 *   pendingSignature=true,  autoCoverJobs=false  → offered, unsigned
 *   pendingSignature=false, autoCoverJobs=true   → signed, covering
 * The sign route flips both in ONE update. There is no state in which a
 * pending master covers anything — annualCoverage.ts reads the flag, and
 * the flag is false until the signature lands.
 *
 * A THIRD state exists in the wild and this file has to cope with it:
 * covering, unsigned, never offered. `fileNegotiatedAgreement` writes it
 * deliberately — a client whose counsel settled the terms is covered on the
 * strength of that settlement, and the signature is chased afterwards. When
 * it arrives, `signAnnual` switches auto-cover OFF on the unsigned row (see
 * the supersede step) so the account is never covered by two masters, one of
 * which nobody signed.
 *
 * ── A negotiated client signs THEIR document, not ours ─────────────────
 * Where the registry in negotiatedAgreement.ts holds an agreement for the
 * company, both the offer and the countersigned copy render THAT document.
 * The default path renders our baseline, and getting this wrong is not a
 * cosmetic bug: `offerAnnual` used to build every offer from
 * CANONICAL_CLAUSES, so offering an annual to Graduation Day would have put
 * our standard terms in front of the one client whose lawyer had spent five
 * months not agreeing to them.
 *
 * ── What the signature produces ────────────────────────────────────────
 * The same countersigned PDF the per-order flow produces (canonical clause
 * text, signature block, IP/UA), stored to the private blob, replacing the
 * unsigned offer on the row. The LCDW election the signer makes becomes the
 * master's standing election — the one every job on the account starts
 * from (see LcdwElection / effectiveLcdwDecision).
 */

import { put } from '@vercel/blob'
import type { LcdwDecision, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateCounterPdf } from '@/lib/contracts/generateCounterPdf'
import { generateSignedAgreementPdf } from '@/lib/contracts/generateSignedAgreementPdf'
import { generateNegotiatedAgreementPdf } from '@/lib/contracts/generateNegotiatedAgreementPdf'
import {
  findNegotiatedAgreement,
  negotiatedAgreementForCompany,
  type NegotiatedAgreement,
} from '@/lib/contracts/negotiatedAgreement'
import { applyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

const ONE_YEAR_MS = 365 * 86_400_000

/**
 * How a row records WHICH document it is.
 *
 * `CompanyAgreement.source` is the existing free-text "where did this come
 * from" column ('INTERNAL' on everything HQ files) and nothing reads it, so
 * the negotiated key rides there rather than behind a migration — the live
 * DB carries drift and an ALTER is a laptop job (see CLAUDE.md).
 *
 * It is written at OFFER time and read at SIGN time on purpose: the client
 * must be countersigned onto the document they actually read, not onto
 * whatever the registry says today. If next year's agreement lands between
 * the offer and the signature, the offer still signs as itself.
 */
const NEGOTIATED_SOURCE_PREFIX = 'NEGOTIATED:'

export function negotiatedSource(key: string): string {
  return `${NEGOTIATED_SOURCE_PREFIX}${key}`
}

export function negotiatedKeyFromSource(source: string | null | undefined): string | null {
  if (!source || !source.startsWith(NEGOTIATED_SOURCE_PREFIX)) return null
  const key = source.slice(NEGOTIATED_SOURCE_PREFIX.length).trim()
  return key.length ? key : null
}

export interface PendingAnnual {
  id: string
  title: string
  effectiveDate: Date | null
  expiryDate: Date | null
  createdAt: Date
  /** The negotiated agreement this offer IS, when it is one — so the portal
   *  can say "the agreement your counsel negotiated" rather than implying
   *  the client is being handed our standard terms. */
  negotiatedKey: string | null
}

/** The unsigned master currently offered to this company, if any. */
export async function findPendingAnnual(companyId: string): Promise<PendingAnnual | null> {
  const row = await prisma.companyAgreement.findFirst({
    where: { companyId, pendingSignature: true, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, originalFilename: true, effectiveDate: true, expiryDate: true, createdAt: true, source: true },
  })
  if (!row) return null
  return {
    id: row.id,
    title: row.title || row.originalFilename,
    effectiveDate: row.effectiveDate,
    expiryDate: row.expiryDate,
    createdAt: row.createdAt,
    negotiatedKey: negotiatedKeyFromSource(row.source),
  }
}

/**
 * File the annual master for signature. Idempotent per company: a second
 * call while one is pending returns the existing offer rather than
 * stacking a duplicate the client could sign twice.
 *
 * Needs the blob token — like every agreement write, run under
 * `vercel env run -e production` from a laptop.
 */
export async function offerAnnualForSignature(
  companyId: string,
  opts: {
    byUserId: string | null
    effectiveDate?: Date
    expiryDate?: Date
    /**
     * Force which document is offered. Omitted, the registry decides by
     * company name; `null` forces our baseline for a client who has a
     * negotiated agreement but is being offered the standard one.
     */
    negotiatedKey?: string | null
  },
): Promise<PendingAnnual> {
  const existing = await findPendingAnnual(companyId)
  if (existing) return existing

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, industry: true, billingAddress: true, billingEmail: true },
  })
  if (!company) throw new Error('company not found')

  // Which document is this? Explicit key wins; otherwise the registry
  // answers by the company's own name (aliases included). Only `null`
  // suppresses a match that exists.
  let negotiated: NegotiatedAgreement | undefined
  if (opts.negotiatedKey === undefined) {
    negotiated = negotiatedAgreementForCompany(company.name)
  } else if (opts.negotiatedKey !== null) {
    negotiated = findNegotiatedAgreement(opts.negotiatedKey)
    if (!negotiated) throw new Error(`no negotiated agreement with key "${opts.negotiatedKey}"`)
  }

  const day = (v: string) => new Date(`${v}T00:00:00Z`)
  // A negotiated document carries the window its counsel agreed to; the
  // baseline offer dates from today. Flags override either.
  const effectiveDate =
    opts.effectiveDate ?? (negotiated ? day(negotiated.effectiveDate) : new Date())
  const expiryDate =
    opts.expiryDate ??
    (negotiated ? day(negotiated.expiryDate) : new Date(effectiveDate.getTime() + ONE_YEAR_MS))
  const title = negotiated ? negotiated.title : `${effectiveDate.getUTCFullYear()} Annual Rental Agreement`

  const pdf = negotiated
    ? await generateNegotiatedAgreementPdf({ agreement: negotiated, companyName: company.name })
    : await generateCounterPdf({
        company: {
          name: company.name,
          industry: company.industry ?? null,
          billingAddress: company.billingAddress ?? null,
          billingEmail: company.billingEmail ?? null,
          notes: null,
        },
        job: null,
        aiChanges: [],
        decisions: [],
        generatedAt: new Date(),
        grantedScope: null,
        documentTitle: `${title} — for signature`,
        finalized: true,
      })

  const key = `company-agreements/${company.id}/annual-${effectiveDate.getUTCFullYear()}-offer-${Date.now()}.pdf`
  const up = await put(key, pdf, { access: 'private' as 'public', contentType: 'application/pdf' })

  const created = await prisma.companyAgreement.create({
    data: {
      companyId: company.id,
      contractType: 'RENTAL_AGREEMENT',
      title,
      fileKey: key,
      fileUrl: up.url,
      originalFilename: `${title.replace(/\s+/g, '-')}.pdf`,
      fileSize: pdf.length,
      mimeType: 'application/pdf',
      isAnnual: true,
      autoCoverJobs: false,
      pendingSignature: true,
      effectiveDate,
      expiryDate,
      source: negotiated ? negotiatedSource(negotiated.key) : 'INTERNAL',
      uploadedById: opts.byUserId,
      note: negotiated
        ? `Offered for signature in the account portal on ${new Date().toISOString().slice(0, 10)}. THEIR negotiated document (${negotiated.key}, ${negotiated.version}), rendered on SirReel paper. Unsigned until an executive signs it there.`
        : `Offered for signature in the account portal on ${new Date().toISOString().slice(0, 10)}. Unsigned until an executive signs it there.`,
    },
    select: { id: true, title: true, originalFilename: true, effectiveDate: true, expiryDate: true, createdAt: true, source: true },
  })
  return {
    ...created,
    title: created.title || created.originalFilename,
    negotiatedKey: negotiatedKeyFromSource(created.source),
  }
}

export interface SignAnnualInput {
  agreementId: string
  companyId: string
  /** The CompanyPortalAccess doing the signing. */
  accessId: string
  signerName: string
  signerTitle: string | null
  signerEmail: string
  lcdw: LcdwDecision
  signatureImageData: string
  acknowledgmentText: string
  ipAddress: string | null
  userAgent: string | null
}

export interface SignAnnualResult {
  agreementId: string
  signedAt: Date
  /** Orders on the account that became covered by this signature. */
  paperedOrders: number
  /** Unsigned masters that stopped covering because this one was signed. */
  supersededAgreementIds: string[]
}

/**
 * Countersign the offered master. One transaction-shaped sequence:
 * render → store → flip the row → paper the account's open orders.
 */
export async function signAnnual(input: SignAnnualInput): Promise<SignAnnualResult> {
  const row = await prisma.companyAgreement.findFirst({
    where: { id: input.agreementId, companyId: input.companyId, deletedAt: null },
    select: { id: true, pendingSignature: true, signedAt: true, title: true, effectiveDate: true, expiryDate: true, fileKey: true, source: true },
  })
  if (!row) throw Object.assign(new Error('agreement not found'), { status: 404 })
  if (!row.pendingSignature || row.signedAt) {
    throw Object.assign(new Error('This agreement has already been signed.'), { status: 409 })
  }

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { name: true, billingAddress: true },
  })

  const signedAt = new Date()

  // WHICH document is being countersigned — read off the row, written at
  // offer time. `generateSignedAgreementPdf` renders CANONICAL_CLAUSES, so
  // using it for a negotiated offer would hand back a signature page
  // attached to OUR terms: the client would have signed something they
  // never read. A negotiated row renders its own document with the
  // signature block filled in instead.
  const negotiatedKey = negotiatedKeyFromSource(row.source)
  const negotiated = negotiatedKey ? findNegotiatedAgreement(negotiatedKey) : undefined
  if (negotiatedKey && !negotiated) {
    throw Object.assign(
      new Error(
        `This agreement was offered as negotiated document "${negotiatedKey}", which is no longer in the registry. It cannot be countersigned until that document is restored.`,
      ),
      { status: 409 },
    )
  }

  const pdf = negotiated
    ? await generateNegotiatedAgreementPdf({
        agreement: negotiated,
        companyName: company?.name ?? '',
        signature: {
          signerName: input.signerName,
          signerTitle: input.signerTitle,
          signerEmail: input.signerEmail,
          signatureImageDataUri: input.signatureImageData,
          acknowledgmentText: input.acknowledgmentText,
          signedAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      })
    : await generateSignedAgreementPdf({
        company: { name: company?.name ?? null, billingAddress: company?.billingAddress ?? null },
        job: null,
        signature: {
          signerName: input.signerName,
          signerTitle: input.signerTitle ?? '',
          signerEmail: input.signerEmail,
          signatureImageDataUri: input.signatureImageData,
          acknowledgmentText: input.acknowledgmentText,
          signedAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
        documentLabel: 'baseline',
      })

  const key = `company-agreements/${input.companyId}/annual-signed-${signedAt.getTime()}.pdf`
  const up = await put(key, pdf, { access: 'private' as 'public', contentType: 'application/pdf' })

  await prisma.companyAgreement.update({
    where: { id: row.id },
    data: {
      fileKey: key,
      fileUrl: up.url,
      originalFilename: `${(row.title || 'Annual-Rental-Agreement').replace(/\s+/g, '-')}-signed.pdf`,
      fileSize: pdf.length,
      mimeType: 'application/pdf',
      // Both flip together — see the header.
      pendingSignature: false,
      autoCoverJobs: true,
      standingLcdwDecision: input.lcdw,
      signedAt,
      signerName: input.signerName,
      signerTitle: input.signerTitle,
      signerEmail: input.signerEmail,
      signerIpAddress: input.ipAddress,
      signerUserAgent: input.userAgent,
      signatureImageData: input.signatureImageData,
      acknowledgmentText: input.acknowledgmentText,
      signedViaPortalAccessId: input.accessId,
      note: `Signed in the account portal on ${signedAt.toISOString().slice(0, 10)} by ${input.signerName}${input.signerTitle ? ` (${input.signerTitle})` : ''}, ${input.signerEmail}. LCDW: ${input.lcdw}. Signed PDF replaced the unsigned offer (${row.fileKey}).`,
    },
  })

  // ── Supersede the unsigned master, if one was covering ────────────────
  // `fileNegotiatedAgreement` files a master that covers on the strength of
  // a counsel settlement, with no signature on it. The moment a signature
  // lands, that row must stop covering: two covering masters for one
  // account, one of them unsigned, is a file nobody can read back, and the
  // job addendum cites whichever one coverage happens to resolve to.
  //
  // ONLY unsigned rows are switched off. A master somebody actually signed
  // is never quietly disabled by another signature — that is a human
  // decision, and the operator makes it on the CRM panel.
  const stale = await prisma.companyAgreement.findMany({
    where: {
      companyId: input.companyId,
      contractType: 'RENTAL_AGREEMENT',
      deletedAt: null,
      autoCoverJobs: true,
      signedAt: null,
      id: { not: row.id },
    },
    select: { id: true, title: true, note: true, fileUrl: true },
  })
  for (const old of stale) {
    await prisma.companyAgreement.update({
      where: { id: old.id },
      data: {
        autoCoverJobs: false,
        note: `${old.note ? `${old.note}\n\n` : ''}Auto-cover switched off ${signedAt.toISOString().slice(0, 10)}: superseded by the countersigned master ${row.id}, signed by ${input.signerName}. Row kept as filed — the document and its window are unchanged.`,
      },
    })
    await prisma.auditLog.create({
      data: {
        action: 'company_agreement.superseded',
        entityType: 'CompanyAgreement',
        entityId: old.id,
        oldValues: { autoCoverJobs: true, signedAt: null },
        newValues: { autoCoverJobs: false, supersededBy: row.id, signerName: input.signerName },
      },
    }).catch(() => null)

    // The company's STANDING negotiated terms point at the document any
    // per-job release would send. When they point at the very file just
    // superseded, move them to the executed copy — same document, now with
    // a signature on it. Anything else is left alone: standing terms that
    // name a DIFFERENT document are somebody's deliberate choice.
    if (old.fileUrl) {
      await prisma.company.updateMany({
        where: { id: input.companyId, negotiatedTermsUrl: old.fileUrl },
        data: {
          negotiatedTermsUrl: up.url,
          negotiatedTermsApprovedAt: signedAt,
          negotiatedTermsActiveAsOf: row.effectiveDate ?? signedAt,
        },
      })
    }
  }

  // Paper the account's open orders now, the way a newly filed Cognito
  // master did. applyAnnualCoverage is per order and re-derives, so an
  // order already signed on its own is left alone.
  const orders = await prisma.order.findMany({
    where: { companyId: input.companyId, status: { notIn: ['CANCELLED', 'CLOSED'] } },
    select: { id: true },
  })
  let papered = 0
  for (const o of orders) {
    const cov = await applyAnnualCoverage(o.id, 'RENTAL_AGREEMENT').catch(() => null)
    if (cov?.companyAgreementId === row.id) papered++
  }

  // Tell the desk. Rep on the account, else Wes.
  const rep = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { name: true, defaultAgent: { select: { email: true, name: true } } },
  })
  const to = [rep?.defaultAgent?.email || 'wes@sirreel.com']
  await sendAgreementEmail({
    to,
    subject: `${rep?.name ?? 'A client'} signed their annual rental agreement`,
    html: `<p>${input.signerName}${input.signerTitle ? ` (${input.signerTitle})` : ''} signed the ${row.title ?? 'annual rental agreement'} for <strong>${rep?.name ?? ''}</strong> in the account portal.</p><p>LCDW: <strong>${input.lcdw}</strong>. ${papered} open order${papered === 1 ? '' : 's'} now covered. Auto-cover is on through ${row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : '—'}.</p>${stale.length ? `<p>${stale.length} unsigned master${stale.length === 1 ? '' : 's'} stopped covering this account: ${stale.map((x) => x.title ?? x.id).join(', ')}. Nothing was deleted.</p>` : ''}`,
    text: `${input.signerName} signed the annual rental agreement for ${rep?.name ?? ''} in the account portal. LCDW: ${input.lcdw}. ${papered} open orders now covered.${stale.length ? ` Superseded ${stale.length} unsigned master${stale.length === 1 ? '' : 's'}.` : ''}`,
    label: 'company-annual-signed',
  }).catch(() => null)

  return {
    agreementId: row.id,
    signedAt,
    paperedOrders: papered,
    supersededAgreementIds: stale.map((x) => x.id),
  }
}

export type { Prisma }
