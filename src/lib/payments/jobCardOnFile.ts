/**
 * "Does this job have a card on file?" — asked of BOTH places a card can live.
 *
 * Wes, 2026-09-04, on Jose keying in Grace's Cognito authorization for Dunwell
 * Productions: "job is not showing that a cc is on file." It was on file. The
 * card was in the company wallet (CompanyCard, source STAFF, $0 auth approved
 * at 17:52), and every job-level card check read only the OTHER store —
 * `PaperworkRequest.ccCardNumberEncrypted`, written exclusively by the portal
 * capture. So the tile the staff-keyed flow itself links out to ("Already have
 * a signed authorization? Key it in") could never turn green from doing what it
 * asked, and the /jobs readiness chip counted the job a blocker with a live
 * card sitting on the account.
 *
 * The wallet is company-scoped on purpose (a production keeps one card for all
 * its shows), so a wallet card counts for that company's jobs — the same rule
 * as annual COIs carrying forward. It is reported with `origin: 'account'` so
 * no surface claims this client authorized THIS job; the portal card, when one
 * exists, always wins, because it is the authorization tied to the booking.
 *
 * Display fields only. `cardToken` never crosses this boundary — charge paths
 * resolve it through companyCards.ts.
 */
import { prisma } from '@/lib/prisma'
import { isExpiryPast } from '@/lib/payments/companyCards'
import { normalizePaymentPreference, type PaymentPreference } from '@/lib/payments/paymentPreference'

export interface JobCardOnFile {
  onFile: true
  /** 'job' — the client authorized it in the portal for this job's booking.
   *  'account' — it is on the company's wallet, not tied to this job. */
  origin: 'job' | 'account'
  last4: string | null
  cardType: string | null
  cardholderName: string | null
  paymentPreference: PaymentPreference | null
  /** The $0 stored-credential validation came back approved. */
  validated: boolean
  /** MM/YY already past. The gateway still decides, but say it first. */
  expired: boolean
  /** account-origin only: where the signed authorization lives, and what
   *  staff called the card. Null on portal cards — the signature is the
   *  record and the wallet label does not exist. */
  authorizationRef: string | null
  label: string | null
}

/**
 * The company's best wallet card for a job, or null.
 *
 * Preference order: the card keyed against THIS job, then the company's
 * explicit default, then the most recently added. Unlike a charge path (which
 * refuses to guess between several cards) an existence question can answer
 * from any of them — the tile says "a card is on file", not "charge this one".
 */
export async function resolveWalletCardForJob(
  companyId: string | null | undefined,
  jobId: string,
): Promise<JobCardOnFile | null> {
  if (!companyId) return null
  const cards = await prisma.companyCard.findMany({
    where: { companyId, removedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: {
      last4: true, cardType: true, cardholderName: true, expiry: true,
      paymentPreference: true, authRespStat: true, authorizationRef: true,
      label: true, sourceJobId: true,
    },
  })
  if (cards.length === 0) return null
  // A card keyed while looking at THIS job is the one this job means, ahead
  // of the account default. Everything else falls back to the ordering above.
  const chosen = cards.find((c) => c.sourceJobId === jobId) ?? cards[0]
  return {
    onFile: true,
    origin: 'account',
    last4: chosen.last4,
    cardType: chosen.cardType,
    cardholderName: chosen.cardholderName,
    paymentPreference: normalizePaymentPreference(chosen.paymentPreference),
    validated: chosen.authRespStat === 'A',
    expired: isExpiryPast(chosen.expiry),
    authorizationRef: chosen.authorizationRef,
    label: chosen.label,
  }
}

/**
 * Which of these companies have at least one live wallet card — one query for
 * a whole page of jobs, so the /jobs list can ask the same question the detail
 * page asks without going N+1.
 */
export async function companiesWithWalletCards(
  companyIds: (string | null | undefined)[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(companyIds.filter((c): c is string => !!c)))
  if (ids.length === 0) return new Set()
  const rows = await prisma.companyCard.findMany({
    where: { companyId: { in: ids }, removedAt: null },
    select: { companyId: true },
    distinct: ['companyId'],
  })
  return new Set(rows.map((r) => r.companyId))
}
