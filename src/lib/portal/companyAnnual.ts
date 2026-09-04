/**
 * The annual rental agreement, signed in the ACCOUNT portal.
 *
 * Wes 2026-09-04: "Make their default Annual Rental Agreement" → "build it".
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
import { applyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

const ONE_YEAR_MS = 365 * 86_400_000

export interface PendingAnnual {
  id: string
  title: string
  effectiveDate: Date | null
  expiryDate: Date | null
  createdAt: Date
}

/** The unsigned master currently offered to this company, if any. */
export async function findPendingAnnual(companyId: string): Promise<PendingAnnual | null> {
  const row = await prisma.companyAgreement.findFirst({
    where: { companyId, pendingSignature: true, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, originalFilename: true, effectiveDate: true, expiryDate: true, createdAt: true },
  })
  if (!row) return null
  return {
    id: row.id,
    title: row.title || row.originalFilename,
    effectiveDate: row.effectiveDate,
    expiryDate: row.expiryDate,
    createdAt: row.createdAt,
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
  opts: { byUserId: string | null; effectiveDate?: Date; expiryDate?: Date },
): Promise<PendingAnnual> {
  const existing = await findPendingAnnual(companyId)
  if (existing) return existing

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, industry: true, billingAddress: true, billingEmail: true },
  })
  if (!company) throw new Error('company not found')

  const effectiveDate = opts.effectiveDate ?? new Date()
  const expiryDate = opts.expiryDate ?? new Date(effectiveDate.getTime() + ONE_YEAR_MS)
  const title = `${effectiveDate.getUTCFullYear()} Annual Rental Agreement`

  const pdf = await generateCounterPdf({
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
      source: 'INTERNAL',
      uploadedById: opts.byUserId,
      note: `Offered for signature in the account portal on ${new Date().toISOString().slice(0, 10)}. Unsigned until an executive signs it there.`,
    },
    select: { id: true, title: true, originalFilename: true, effectiveDate: true, expiryDate: true, createdAt: true },
  })
  return { ...created, title: created.title || created.originalFilename }
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
}

/**
 * Countersign the offered master. One transaction-shaped sequence:
 * render → store → flip the row → paper the account's open orders.
 */
export async function signAnnual(input: SignAnnualInput): Promise<SignAnnualResult> {
  const row = await prisma.companyAgreement.findFirst({
    where: { id: input.agreementId, companyId: input.companyId, deletedAt: null },
    select: { id: true, pendingSignature: true, signedAt: true, title: true, effectiveDate: true, expiryDate: true, fileKey: true },
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
  const pdf = await generateSignedAgreementPdf({
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
    html: `<p>${input.signerName}${input.signerTitle ? ` (${input.signerTitle})` : ''} signed the ${row.title ?? 'annual rental agreement'} for <strong>${rep?.name ?? ''}</strong> in the account portal.</p><p>LCDW: <strong>${input.lcdw}</strong>. ${papered} open order${papered === 1 ? '' : 's'} now covered. Auto-cover is on through ${row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : '—'}.</p>`,
    text: `${input.signerName} signed the annual rental agreement for ${rep?.name ?? ''} in the account portal. LCDW: ${input.lcdw}. ${papered} open orders now covered.`,
    label: 'company-annual-signed',
  }).catch(() => null)

  return { agreementId: row.id, signedAt, paperedOrders: papered }
}

export type { Prisma }
