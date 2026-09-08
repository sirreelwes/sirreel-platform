import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { extractBill } from '@/lib/ap/extractBill'
import { matchBillToPos } from '@/lib/ap/poMatch'
import { senderDomain, type BillCandidate } from '@/lib/ap/candidates'

/**
 * One candidate email → one ApBill row: read it, cross-check it, store it.
 *
 * Idempotent by emailMessageId. Re-running the scanner over a window that
 * already has rows updates them rather than duplicating, so "scan the last
 * 180 days" is always safe to press again.
 *
 * The human's own columns (reviewState / reviewNote / reviewedAt) are NEVER
 * written here. A re-scan re-reads the vendor's document and re-runs the
 * match; it does not un-read what Wes already decided about the row.
 */

export interface ScanOutcome {
  emailMessageId: string
  isBill: boolean
  vendorName: string | null
  amountTotal: number | null
  matchStatus: string
}

/** Every email already on the desk — including rows read as NOT a bill, so
 *  a rejected read is never paid for twice. */
export async function scannedEmailIds(): Promise<Set<string>> {
  const rows = await prisma.apBill.findMany({ select: { emailMessageId: true } })
  return new Set(rows.map((r) => r.emailMessageId))
}

function asDate(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null
}

export async function scanCandidate(c: BillCandidate): Promise<ScanOutcome> {
  const extracted = await extractBill({
    inbox: c.inbox,
    gmailMessageId: c.gmailMessageId,
    fromAddress: c.fromAddress,
    subject: c.subject,
    sentAt: c.sentAt,
    bodyText: c.bodyText,
  })

  const vendorDomain = senderDomain(c.fromAddress)
  const invoiceDate = asDate(extracted.invoiceDate)

  // Matching is skipped for anything the reader says is not a bill against
  // us — there is nothing to reconcile, and running it would put candidate
  // POs next to a client's receivable email.
  const match = extracted.isBill
    ? await matchBillToPos({
        vendorName: extracted.vendorName,
        vendorDomain,
        poNumberRaw: extracted.poNumber,
        amountTotal: extracted.amountTotal,
        invoiceDate,
        sentAt: c.sentAt,
      })
    : null

  const data = {
    gmailMessageId: c.gmailMessageId,
    inbox: c.inbox,
    threadId: c.threadId,
    sentAt: c.sentAt,
    fromAddress: c.fromAddress,
    subject: c.subject,

    vendorName: extracted.vendorName,
    vendorDomain,
    vendorId: match?.vendorId ?? null,
    invoiceNumber: extracted.invoiceNumber,
    invoiceDate,
    dueDate: asDate(extracted.dueDate),
    amountTotal:
      extracted.amountTotal === null ? null : new Prisma.Decimal(extracted.amountTotal.toFixed(2)),
    currency: extracted.currency,
    terms: extracted.terms,
    poNumberRaw: extracted.poNumber,
    jobReference: extracted.jobReference,
    lineSummary: extracted.lineSummary,

    attachmentNames: extracted.attachmentNames,
    readPdf: extracted.readPdf,

    isBill: extracted.isBill,
    aiSummary: extracted.summary,
    aiConfidence: extracted.confidence,
    aiModel: extracted.model,
    extractedAt: new Date(),

    matchStatus: match?.status ?? ('NO_CANDIDATES' as const),
    matchedPoSource: match?.matchedPoSource ?? null,
    matchedSubRentalId: match?.matchedSubRentalId ?? null,
    matchedPoEmailId: match?.matchedPoEmailId ?? null,
    poCandidates: (match?.candidates ?? []) as unknown as Prisma.InputJsonValue,
    matchNote: match?.note ?? null,
    matchedAt: match ? new Date() : null,
  }

  await prisma.apBill.upsert({
    where: { emailMessageId: c.emailMessageId },
    create: { emailMessageId: c.emailMessageId, ...data },
    update: data,
  })

  return {
    emailMessageId: c.emailMessageId,
    isBill: extracted.isBill,
    vendorName: extracted.vendorName,
    amountTotal: extracted.amountTotal,
    matchStatus: data.matchStatus,
  }
}

/**
 * Re-run only the cross-check on a stored bill — no model call, no Gmail
 * fetch. This is the cheap half, and the half that goes stale: a sub-rental
 * gets its PO number filled in a week after the invoice arrived, and the
 * row should stop saying PO_NOT_FOUND without paying to read the PDF again.
 */
export async function rematchBill(id: string): Promise<{ ok: boolean; status?: string }> {
  const bill = await prisma.apBill.findUnique({ where: { id } })
  if (!bill) return { ok: false }

  const match = await matchBillToPos({
    vendorName: bill.vendorName,
    vendorDomain: bill.vendorDomain,
    poNumberRaw: bill.poNumberRaw,
    amountTotal: bill.amountTotal === null ? null : Number(bill.amountTotal),
    invoiceDate: bill.invoiceDate,
    sentAt: bill.sentAt,
  })

  await prisma.apBill.update({
    where: { id },
    data: {
      vendorId: match.vendorId,
      matchStatus: match.status,
      matchedPoSource: match.matchedPoSource,
      matchedSubRentalId: match.matchedSubRentalId,
      matchedPoEmailId: match.matchedPoEmailId,
      poCandidates: match.candidates as unknown as Prisma.InputJsonValue,
      matchNote: match.note,
      matchedAt: new Date(),
    },
  })
  return { ok: true, status: match.status }
}
