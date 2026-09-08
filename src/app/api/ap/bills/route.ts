import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApUser } from '@/lib/ap/access'
import { countBillCandidates } from '@/lib/ap/candidates'
import { scannedEmailIds } from '@/lib/ap/scan'

/**
 * GET /api/ap/bills — everything on the accounts-payable desk.
 *
 * Read-only and cheap: the expensive part (a Gmail attachment download plus
 * a Sonnet read of the PDF) happened at scan time and is stored. The one
 * live computation is how many candidate emails are still unread, which the
 * desk needs in order to offer another pass.
 *
 * Nothing here is an authorisation to pay. The totals are "what we appear to
 * have been billed", not an AP ledger — HQ does not hold one.
 */

export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_DAYS = 180

export async function GET() {
  const user = await requireApUser()
  if (user instanceof NextResponse) return user

  const [bills, scanned] = await Promise.all([prisma.apBill.findMany({ orderBy: { sentAt: 'desc' } }), scannedEmailIds()])

  const waiting = await countBillCandidates({
    sinceDays: DEFAULT_WINDOW_DAYS,
    skipEmailMessageIds: scanned,
  })

  const rows = bills.map((b) => ({
    id: b.id,
    emailMessageId: b.emailMessageId,
    gmailMessageId: b.gmailMessageId,
    inbox: b.inbox,
    sentAt: b.sentAt,
    fromAddress: b.fromAddress,
    subject: b.subject,
    vendorName: b.vendorName,
    vendorDomain: b.vendorDomain,
    vendorId: b.vendorId,
    invoiceNumber: b.invoiceNumber,
    invoiceDate: b.invoiceDate,
    dueDate: b.dueDate,
    amountTotal: b.amountTotal === null ? null : Number(b.amountTotal),
    currency: b.currency,
    terms: b.terms,
    poNumberRaw: b.poNumberRaw,
    jobReference: b.jobReference,
    lineSummary: b.lineSummary,
    attachmentNames: b.attachmentNames,
    readPdf: b.readPdf,
    isBill: b.isBill,
    aiSummary: b.aiSummary,
    aiConfidence: b.aiConfidence,
    matchStatus: b.matchStatus,
    matchedPoSource: b.matchedPoSource,
    matchNote: b.matchNote,
    poCandidates: (b.poCandidates as unknown[] | null) ?? [],
    reviewState: b.reviewState,
    reviewNote: b.reviewNote,
    reviewedAt: b.reviewedAt,
  }))

  // Totals cover only rows that ARE bills and that Wes hasn't struck as a
  // misread. A NOT_A_BILL row still exists (so it is never re-read) but must
  // not add a dollar to what SirReel appears to owe.
  const live = rows.filter((r) => r.isBill && r.reviewState !== 'NOT_A_BILL')
  const sum = (rs: typeof live) => rs.reduce((t, r) => t + (r.amountTotal ?? 0), 0)
  const needsAnswer = live.filter((r) => r.matchStatus === 'PO_NOT_FOUND' || r.matchStatus === 'AMOUNT_MISMATCH')

  return NextResponse.json({
    rows,
    totals: {
      bills: live.length,
      billed: sum(live),
      needsAnswer: needsAnswer.length,
      needsAnswerAmount: sum(needsAnswer),
      unmatched: live.filter((r) => r.matchStatus === 'NO_PO_ON_BILL' || r.matchStatus === 'NO_CANDIDATES').length,
      unread: waiting,
      windowDays: DEFAULT_WINDOW_DAYS,
    },
  })
}
