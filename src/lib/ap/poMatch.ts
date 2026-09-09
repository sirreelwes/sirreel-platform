import { prisma } from '@/lib/prisma'
import type { ApMatchStatus } from '@prisma/client'

/**
 * Cross-checking a vendor's bill against the purchase orders SirReel's own
 * team created.
 *
 * ── What counts as "a PO the team created" ────────────────────────────────
 * Two things, and the second is the reason this desk is interesting:
 *
 *   SUB_RENTAL  A SubRental row carrying a poNumber. This is the structured
 *               commitment: a vendor, a unit, dates, and what we agreed to
 *               pay them (vendorTotal). It is the only PO HQ actually models.
 *
 *   EMAIL_PO    An OUTBOUND message from a @sirreel.com address that issued
 *               the PO — "PO 4471 attached", "here's our PO for the two
 *               cubes". Most POs at SirReel have only ever existed like
 *               this. A desk that checked the database alone would report
 *               PO_NOT_FOUND on nearly every real, properly-authorised bill
 *               and teach its reader to ignore it.
 *
 * ── Nothing is auto-linked on a guess ─────────────────────────────────────
 * An exact PO-number hit links. Everything softer — same vendor, similar
 * amount, overlapping dates — is offered as a CANDIDATE with its reasoning
 * and left for a human. "Same vendor, about the right money" is precisely
 * how a duplicate invoice gets paid twice.
 *
 * ── Nothing here approves or pays ─────────────────────────────────────────
 * The output is a status and a list of candidates. No balance moves.
 */

/** Amounts agree if they are within a dollar, or within 1% on larger bills. */
const AMOUNT_TOLERANCE_ABS = 1
const AMOUNT_TOLERANCE_PCT = 0.01

/** How far either side of the bill to look for the same vendor's work. */
const WINDOW_DAYS = 120

export type CandidateSource = 'SUB_RENTAL' | 'EMAIL_PO'
export type CandidateTier = 'EXACT_PO' | 'VENDOR_AMOUNT' | 'VENDOR_WINDOW'

export interface PoCandidate {
  source: CandidateSource
  tier: CandidateTier
  /** Stable id of the underlying row — SubRental.id or EmailMessage.id. */
  refId: string
  /** What to show: "PO 4471 · King Kong · 26ft cube" */
  label: string
  poNumber: string | null
  vendorName: string | null
  /** What SirReel committed to pay, when the PO says. */
  amount: number | null
  /** Rental window on a sub-rental, or the send date of an email PO. */
  dates: string | null
  /** Who on the team created it — the answer to "who ordered this?" */
  createdBy: string | null
  why: string
}

export interface MatchResult {
  status: ApMatchStatus
  vendorId: string | null
  matchedPoSource: CandidateSource | null
  matchedSubRentalId: string | null
  matchedPoEmailId: string | null
  candidates: PoCandidate[]
  note: string
}

/** Strip everything a human might type differently. "PO #4471-A" → "4471A". */
export function normalizePo(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw
    .toUpperCase()
    .replace(/\b(PURCHASE\s*ORDER|P\.?\s?O\.?|ORDER|REF(?:ERENCE)?|NO|NUM(?:BER)?)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
  // Two characters is not an identifier — "PO 7" matches half the corpus.
  return cleaned.length >= 3 ? cleaned : null
}

function amountsAgree(a: number, b: number): boolean {
  const diff = Math.abs(a - b)
  return diff <= AMOUNT_TOLERANCE_ABS || diff <= Math.max(a, b) * AMOUNT_TOLERANCE_PCT
}

function ymd(d: Date | null | undefined): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null
}

function range(a: Date | null | undefined, b: Date | null | undefined): string | null {
  const s = ymd(a)
  const e = ymd(b)
  if (!s && !e) return null
  if (s && e) return s === e ? s : `${s} → ${e}`
  return s ?? e
}

/**
 * Which Vendor row this bill came from, if any.
 *
 * Domain first: a vendor's billing address changes name spelling far more
 * often than it changes domain. Name matching is a whole-token containment
 * test in both directions ("King Kong Production Rentals" ↔ "King Kong"),
 * never a substring — substring matching pairs "Cast" with "Castex".
 */
export async function resolveVendor(args: {
  vendorDomain: string | null
  vendorName: string | null
}): Promise<{ id: string; name: string } | null> {
  const { vendorDomain, vendorName } = args
  const vendors = await prisma.vendor.findMany({
    select: { id: true, name: true, email: true, poEmail: true },
  })

  if (vendorDomain) {
    const d = `@${vendorDomain.toLowerCase()}`
    const byDomain = vendors.find(
      (v) =>
        (v.email && v.email.toLowerCase().endsWith(d)) ||
        (v.poEmail && v.poEmail.toLowerCase().endsWith(d)),
    )
    if (byDomain) return { id: byDomain.id, name: byDomain.name }
  }

  if (vendorName) {
    const tokens = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !['inc', 'llc', 'ltd', 'the', 'and', 'corp', 'company', 'rentals', 'rental', 'productions', 'production', 'studios', 'studio', 'group'].includes(t))
    const want = tokens(vendorName)
    if (want.length) {
      const byName = vendors.find((v) => {
        const have = tokens(v.name)
        if (!have.length) return false
        const shared = want.filter((t) => have.includes(t))
        // Every distinctive token of the shorter name must appear in the
        // longer one. One shared word is a coincidence.
        return shared.length >= Math.min(want.length, have.length)
      })
      if (byName) return { id: byName.id, name: byName.name }
    }
  }

  return null
}

/**
 * Find every PO on our side that could belong to this bill, and say what the
 * comparison shows.
 */
export async function matchBillToPos(bill: {
  vendorName: string | null
  vendorDomain: string | null
  poNumberRaw: string | null
  amountTotal: number | null
  invoiceDate: Date | null
  sentAt: Date
}): Promise<MatchResult> {
  const wantPo = normalizePo(bill.poNumberRaw)
  const vendor = await resolveVendor({ vendorDomain: bill.vendorDomain, vendorName: bill.vendorName })
  const anchor = bill.invoiceDate ?? bill.sentAt
  const from = new Date(anchor.getTime() - WINDOW_DAYS * 86400000)
  const to = new Date(anchor.getTime() + WINDOW_DAYS * 86400000)

  const candidates: PoCandidate[] = []

  // ── 1. Sub-rentals: the structured POs ──────────────────────────────────
  // Every row carrying a PO number (so an exact hit is found even when the
  // vendor didn't resolve), plus everything for THIS vendor in the window
  // (so a bill with no PO still shows what we ordered from them).
  const subs = await prisma.subRental.findMany({
    where: {
      OR: [
        { poNumber: { not: null } },
        ...(vendor ? [{ vendorId: vendor.id, createdAt: { gte: from, lte: to } }] : []),
      ],
    },
    select: {
      id: true,
      poNumber: true,
      vendorId: true,
      itemDescription: true,
      quantity: true,
      vendorTotal: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      status: true,
      vendor: { select: { name: true } },
      order: { select: { orderNumber: true } },
      job: { select: { jobCode: true, name: true } },
    },
    take: 2000,
  })

  for (const s of subs) {
    const subPo = normalizePo(s.poNumber)
    const exact = !!wantPo && subPo === wantPo
    const sameVendor = !!vendor && s.vendorId === vendor.id
    if (!exact && !sameVendor) continue

    const amount = s.vendorTotal === null ? null : Number(s.vendorTotal)
    const inWindow =
      s.createdAt >= from && s.createdAt <= to
        ? true
        : !!(s.startDate && s.startDate >= from && s.startDate <= to)
    if (!exact && !inWindow) continue

    const amountHit = amount !== null && bill.amountTotal !== null && amountsAgree(amount, bill.amountTotal)
    const tier: CandidateTier = exact ? 'EXACT_PO' : amountHit ? 'VENDOR_AMOUNT' : 'VENDOR_WINDOW'
    const where = s.job ? `${s.job.jobCode} ${s.job.name}` : s.order?.orderNumber ?? null

    candidates.push({
      source: 'SUB_RENTAL',
      tier,
      refId: s.id,
      label: [
        s.poNumber ? `PO ${s.poNumber}` : 'no PO number recorded',
        s.vendor?.name ?? null,
        s.quantity > 1 ? `${s.quantity}× ${s.itemDescription}` : s.itemDescription,
        where,
      ]
        .filter(Boolean)
        .join(' · '),
      poNumber: s.poNumber,
      vendorName: s.vendor?.name ?? null,
      amount,
      dates: range(s.startDate, s.endDate) ?? ymd(s.createdAt),
      createdBy: null,
      why: exact
        ? 'the PO number on the bill is on this sub-rental'
        : amountHit
          ? 'same vendor, and our agreed cost matches the billed total'
          : `same vendor, ordered around this date (${s.status.toLowerCase()})`,
    })
  }

  // ── 2. Email POs: the ones that never became a row ──────────────────────
  // An outbound SirReel message quoting the PO number is proof a human here
  // issued it, even though nothing in HQ records it.
  if (wantPo && bill.poNumberRaw) {
    const needle = bill.poNumberRaw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    const digits = bill.poNumberRaw.match(/[A-Za-z0-9][A-Za-z0-9-]{2,}/)?.[0] ?? needle
    if (digits.length >= 3) {
      const mails = await prisma.emailMessage.findMany({
        where: {
          direction: 'outbound',
          duplicateOfId: null,
          OR: [
            { subject: { contains: digits, mode: 'insensitive' } },
            { bodyText: { contains: digits, mode: 'insensitive' } },
          ],
        },
        select: { id: true, subject: true, fromAddress: true, toAddresses: true, sentAt: true },
        orderBy: { sentAt: 'desc' },
        take: 25,
      })
      for (const m of mails) {
        candidates.push({
          source: 'EMAIL_PO',
          tier: 'EXACT_PO',
          refId: m.id,
          label: `${m.subject || '(no subject)'} → ${m.toAddresses.join(', ') || '(no recipient)'}`,
          poNumber: bill.poNumberRaw,
          vendorName: bill.vendorName,
          amount: null,
          dates: ymd(m.sentAt),
          createdBy: m.fromAddress,
          why: `${m.fromAddress} sent this PO number out from a SirReel address`,
        })
      }
    }
  }

  // No PO cited: look for one we sent this vendor around the same dates. It
  // is a lead, not a link — the tier says so and nothing auto-attaches.
  if (!wantPo && bill.vendorDomain) {
    const domain = `@${bill.vendorDomain.toLowerCase()}`
    const mails = await prisma.emailMessage.findMany({
      where: {
        direction: 'outbound',
        duplicateOfId: null,
        sentAt: { gte: from, lte: to },
        // "purchase order" spelled out, only. The bare token "PO" is a
        // substring of support, important, post and portal — it would fill
        // the 200-row budget with noise and push the real hits out.
        OR: [
          { subject: { contains: 'purchase order', mode: 'insensitive' } },
          { bodyText: { contains: 'purchase order', mode: 'insensitive' } },
        ],
      },
      select: { id: true, subject: true, fromAddress: true, toAddresses: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
      take: 200,
    })
    for (const m of mails) {
      if (!m.toAddresses.some((t) => t.toLowerCase().endsWith(domain))) continue
      candidates.push({
        source: 'EMAIL_PO',
        tier: 'VENDOR_WINDOW',
        refId: m.id,
        label: `${m.subject || '(no subject)'} → ${m.toAddresses.join(', ')}`,
        poNumber: null,
        vendorName: bill.vendorName,
        amount: null,
        dates: ymd(m.sentAt),
        createdBy: m.fromAddress,
        why: 'we mailed this vendor about a purchase order around this date',
      })
      if (candidates.filter((c) => c.source === 'EMAIL_PO').length >= 10) break
    }
  }

  // ── 3. The verdict ──────────────────────────────────────────────────────
  const exactSub = candidates.find((c) => c.source === 'SUB_RENTAL' && c.tier === 'EXACT_PO')
  const exactMail = candidates.find((c) => c.source === 'EMAIL_PO' && c.tier === 'EXACT_PO')

  if (exactSub) {
    const ours = exactSub.amount
    if (ours !== null && bill.amountTotal !== null && !amountsAgree(ours, bill.amountTotal)) {
      const delta = bill.amountTotal - ours
      return {
        status: 'AMOUNT_MISMATCH',
        vendorId: vendor?.id ?? null,
        matchedPoSource: 'SUB_RENTAL',
        matchedSubRentalId: exactSub.refId,
        matchedPoEmailId: null,
        candidates,
        note:
          `PO ${exactSub.poNumber} is ours, but we recorded $${ours.toFixed(2)} and the bill is ` +
          `$${bill.amountTotal.toFixed(2)} — ${delta > 0 ? 'over' : 'under'} by $${Math.abs(delta).toFixed(2)}.`,
      }
    }
    return {
      status: 'MATCHED',
      vendorId: vendor?.id ?? null,
      matchedPoSource: 'SUB_RENTAL',
      matchedSubRentalId: exactSub.refId,
      matchedPoEmailId: null,
      candidates,
      note:
        ours === null
          ? `PO ${exactSub.poNumber} is ours. No cost was recorded on it, so the amount could not be checked.`
          : `PO ${exactSub.poNumber} is ours and the amount agrees.`,
    }
  }

  if (exactMail) {
    return {
      status: 'MATCHED',
      vendorId: vendor?.id ?? null,
      matchedPoSource: 'EMAIL_PO',
      matchedSubRentalId: null,
      matchedPoEmailId: exactMail.refId,
      candidates,
      note:
        `This PO exists only as email — ${exactMail.createdBy} sent it on ${exactMail.dates}. ` +
        `Nothing in HQ records it, so there is no agreed amount to check the bill against.`,
    }
  }

  if (wantPo) {
    return {
      status: 'PO_NOT_FOUND',
      vendorId: vendor?.id ?? null,
      matchedPoSource: null,
      matchedSubRentalId: null,
      matchedPoEmailId: null,
      candidates,
      note:
        `The vendor cites PO "${bill.poNumberRaw}". Nothing in HQ carries it and no SirReel address ` +
        `has ever sent that number out. Someone authorised this off-system, or the vendor has it wrong.`,
    }
  }

  if (candidates.length) {
    return {
      status: 'NO_PO_ON_BILL',
      vendorId: vendor?.id ?? null,
      matchedPoSource: null,
      matchedSubRentalId: null,
      matchedPoEmailId: null,
      candidates,
      note: `No PO number on the bill. ${candidates.length} thing${candidates.length === 1 ? '' : 's'} on our side could be it — none linked automatically.`,
    }
  }

  return {
    status: 'NO_CANDIDATES',
    vendorId: vendor?.id ?? null,
    matchedPoSource: null,
    matchedSubRentalId: null,
    matchedPoEmailId: null,
    candidates,
    note: vendor
      ? `No PO on the bill, and nothing recorded for ${vendor.name} around this date.`
      : 'No PO on the bill, and this vendor is not in HQ at all.',
  }
}
