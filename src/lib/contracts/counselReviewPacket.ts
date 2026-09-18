/**
 * WHAT opposing counsel sees, and nothing else.
 *
 * The disclosure envelope for /agreement/review/[token], on the same
 * principle as `buildBrokerReviewPacket` (2026-09-17): the page renders
 * nothing this function does not return, so what a stranger with a
 * forwarded link can read is decided in ONE reviewable place rather than in
 * the JSX.
 *
 * IN: their own agreement (title, version, the agreed window), the company
 * it is for, whether it has been signed, and the two downloads.
 *
 * OUT, deliberately: every RATE and every dollar figure that is not part of
 * the contract text, the orders and jobs the master papers, the client's
 * other paperwork, any other client's terms, HQ's internal notes, who at
 * SirReel filed it, and the partner arrangements behind §32. Counsel is
 * reviewing a document, not auditing an account.
 *
 * ── The copy is rendered LIVE, not served from the blob ───────────────
 * The filed PDF is a snapshot of what was filed. This page exists because
 * §32 is still moving, so it renders from the registry at view time — the
 * same "recomputed on every view" rule the broker desk follows. Which means
 * the page must SAY that it is the current copy for review rather than the
 * executed agreement, and `isCurrentDraft` is what makes it say so.
 */

import { prisma } from '@/lib/prisma'
import {
  negotiatedAgreementForCompany,
  type NegotiatedAgreement,
} from '@/lib/contracts/negotiatedAgreement'

export interface CounselReviewPacket {
  companyAgreementId: string
  companyName: string
  /** The document itself — resolved from the registry, not the stored blob. */
  agreement: NegotiatedAgreement
  title: string
  version: string
  effectiveDate: string
  expiryDate: string
  /** Signed already? Then this is a copy of what was executed, not a draft. */
  signedAt: Date | null
  signerName: string | null
  /** True while nobody has signed — the page says "for your review". */
  isCurrentDraft: boolean
}

/**
 * Null when the token names a row that is gone, soft-deleted, or belongs to
 * a company with no negotiated agreement in the registry. The last case is
 * not an error to work around: this link is only ever for a document whose
 * clauses live in the repo, because that is the only thing we can render as
 * Word from data rather than converting a PDF.
 */
export async function buildCounselReviewPacket(
  companyAgreementId: string,
): Promise<CounselReviewPacket | null> {
  const row = await prisma.companyAgreement.findFirst({
    where: { id: companyAgreementId, deletedAt: null },
    select: {
      id: true,
      title: true,
      effectiveDate: true,
      expiryDate: true,
      signedAt: true,
      signerName: true,
      company: { select: { name: true } },
    },
  })
  if (!row?.company) return null

  const agreement = negotiatedAgreementForCompany(row.company.name)
  if (!agreement) return null

  const day = (d: Date | null, fallback: string) =>
    d
      ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : fallback

  return {
    companyAgreementId: row.id,
    companyName: row.company.name,
    agreement,
    title: row.title || agreement.title,
    version: agreement.version,
    effectiveDate: day(row.effectiveDate, agreement.effectiveDate),
    expiryDate: day(row.expiryDate, agreement.expiryDate),
    signedAt: row.signedAt,
    signerName: row.signerName,
    isCurrentDraft: !row.signedAt,
  }
}
