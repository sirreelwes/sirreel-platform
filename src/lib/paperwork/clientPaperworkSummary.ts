/**
 * "Here's where your paperwork stands" — the CLIENT-facing reading of the
 * job page's Paperwork strip.
 *
 * The strip answers a staff question ("can this job go out?") and scores
 * six tiles, two of which are ours alone: gear assigned is Julian picking
 * a truck this afternoon, and the final invoice is billing. Neither
 * belongs in a client's inbox — an email that lists them reads as a bill
 * of complaints against someone who cannot act on half of it.
 *
 * So this is a deliberately different list: only the things a production
 * can DO something about, each with the one place they do it. Three
 * states, and the distinction between the last two is the whole point:
 *
 *   done    — we have it; nothing owed by anyone
 *   waiting — we have it, or it isn't released yet, and the next move is
 *             OURS (a certificate in review, an agreement that follows
 *             quote approval). Listed, never chased.
 *   needed  — the client owes us this, and `link` says where.
 *
 * Statuses derive from the same truths the staff strip reads —
 * rollupCoiState for the certificate (human decision is the verdict),
 * isSignedAgreementStatus + the annual-addendum override for signatures,
 * the two card stores, live booking assignments for drivers — so the
 * email and the page cannot tell a client and a rep different stories.
 */

import { prisma } from '@/lib/prisma'
import { rollupCoiState } from '@/lib/coi/coiState'
import { resolveJobCoi } from '@/lib/coi/companyCoi'
import { carriedCoiApplies, getJobCoiConfirmation } from '@/lib/coi/jobCoiConfirmation'
import { describeAgreementStatus, isSignedAgreementStatus } from '@/lib/portal/agreementStatus'
import { isStageLineItem } from '@/lib/orders/stageLines'
import { resolveWalletCardForJob } from '@/lib/payments/jobCardOnFile'
import { summarizeJobLcdwCoverage } from '@/lib/lcdw/jobElection'

export type PaperworkItemKey = 'coi' | 'wc' | 'agreement' | 'stage' | 'lcdw' | 'card' | 'drivers'
export type PaperworkItemState = 'done' | 'waiting' | 'needed'

/**
 * Where the client goes to deal with this item. A destination, not a URL:
 * the composer owns link-building because only it knows whether the send
 * has a job-portal magic link or a paperwork-portal token.
 */
export type PaperworkDestination = 'paperwork' | 'drivers' | 'lcdw'

export interface ClientPaperworkItem {
  key: PaperworkItemKey
  /** Client-facing row label. */
  label: string
  state: PaperworkItemState
  /** Two or three words — the status column. */
  status: string
  /** One sentence: what it means, or what to do. */
  detail: string
  /** Only ever set on `needed` rows — a done row with a button asks a
   *  client to redo work they've finished. */
  link: PaperworkDestination | null
}

export interface ClientPaperworkSummary {
  jobId: string
  jobCode: string
  jobName: string
  companyName: string | null
  items: ClientPaperworkItem[]
  /** Rows the client owes, in the order they appear. */
  outstanding: ClientPaperworkItem[]
  /** Complete of the rows that HAVE an answer — 'waiting' counts against
   *  neither side, so "2 of 3" never scolds a client for our review queue. */
  done: number
  scored: number
  /** The job's live order with a client portal, when it has one. */
  portalSlug: string | null
  orderId: string | null
}

const fmtDate = (d: Date | string | null | undefined): string | null => {
  if (!d) return null
  const dt = typeof d === 'string' ? new Date(d) : d
  return Number.isNaN(dt.getTime())
    ? null
    : dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export async function buildClientPaperworkSummary(
  jobId: string,
): Promise<ClientPaperworkSummary | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      companyId: true,
      company: { select: { name: true } },
      // An annual master signed once for the year covers every job on the
      // account — same override the strip and the /jobs list apply.
      agreementAddenda: {
        select: {
          companyAgreement: {
            select: { contractType: true, isAnnual: true, expiryDate: true, signedAt: true },
          },
        },
      },
      orders: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          portalSlug: true,
          signedAgreements: {
            select: {
              contractType: true,
              status: true,
              signedAt: true,
              coveredByAgreementId: true,
            },
          },
          lineItems: { select: { department: true, description: true } },
        },
      },
      bookings: {
        where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: {
          id: true,
          items: {
            select: {
              assignments: {
                where: { status: { in: ['ASSIGNED', 'CHECKED_OUT'] } },
                select: {
                  id: true,
                  driverAssignments: {
                    where: { status: { not: 'CANCELLED' } },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!job) return null

  const bookingIds = job.bookings.map((b) => b.id)
  const paperwork = bookingIds.length
    ? await prisma.paperworkRequest.findMany({
        where: { bookingId: { in: bookingIds } },
        orderBy: { sentAt: 'desc' },
        select: {
          ccCardNumberEncrypted: true,
          ccCardLast4: true,
          wcFileUrl: true,
          wcUploadedAt: true,
        },
      })
    : []

  const items: ClientPaperworkItem[] = []

  // ── Certificate of Insurance ────────────────────────────────────────
  // A company certificate carries forward only while it still governs
  // THIS job — the confirmation can have pulled it off (SEPARATE_POLICY).
  const resolution = await resolveJobCoi(job.id)
  const confirmation = await getJobCoiConfirmation(job.id, resolution)
  const governing = resolution && carriedCoiApplies(confirmation) ? resolution.coi : null

  if (!governing) {
    items.push({
      key: 'coi',
      label: 'Certificate of Insurance',
      state: 'needed',
      status: 'Needed',
      detail:
        // The client has TOLD us this job is insured separately — asking as
        // though we had never spoken reads as not listening.
        // "SirReel", never the entity name — that belongs in contract text
        // and on the certificate itself, and the exact holder name is
        // already printed in the requirements on the job page this links to
        // (components/portal/CoiRequirementsBlock).
        confirmation.state === 'SEPARATE_POLICY'
          ? 'You let us know this job is insured under its own policy — we still need that certificate. The requirements, and the exact certificate holder to name, are on your job page.'
          : 'We need a current certificate naming SirReel as certificate holder and additional insured. Your broker can send it, or you can upload it — the full requirements are on your job page.',
      link: 'paperwork',
    })
  } else {
    const { state, expiresAt } = rollupCoiState({
      humanDecision: governing.humanDecision,
      policyExpiryDate: governing.policyExpiryDate,
      coverageVerified: !!governing.coverageVerified,
    })
    const expiry = fmtDate(expiresAt)
    // Covers the start of the rental and lapses before the end. Clean on
    // the day it is read, short on the day the vehicles come back — say so
    // now, while the broker still has time (lib/coi/companyCoi).
    const lapsesMidRental = fmtDate(resolution?.expiresDuringRental ?? null)
    if (lapsesMidRental && state !== 'EXPIRED' && state !== 'ISSUE') {
      items.push({
        key: 'coi',
        label: 'Certificate of Insurance',
        state: 'needed',
        status: 'Expires mid-rental',
        detail: `The certificate on file lapses ${lapsesMidRental}, before this rental ends — we need one that runs through the whole booking.`,
        link: 'paperwork',
      })
    } else if (state === 'VERIFIED') {
      items.push({
        key: 'coi',
        label: 'Certificate of Insurance',
        state: 'done',
        status: 'On file',
        detail: expiry ? `Received and verified — the policy runs through ${expiry}.` : 'Received and verified.',
        link: null,
      })
    } else if (state === 'EXPIRED') {
      items.push({
        key: 'coi',
        label: 'Certificate of Insurance',
        state: 'needed',
        status: 'Expired',
        detail: expiry
          ? `The certificate we have expired ${expiry} — we need a current one before the vehicles go out.`
          : 'The certificate we have has expired — we need a current one before the vehicles go out.',
        link: 'paperwork',
      })
    } else if (state === 'ISSUE') {
      items.push({
        key: 'coi',
        label: 'Certificate of Insurance',
        state: 'needed',
        status: 'Needs a correction',
        detail:
          "The certificate we received didn't meet our requirements. Your broker can send a corrected one — the requirements are on your job page.",
        link: 'paperwork',
      })
    } else {
      items.push({
        key: 'coi',
        label: 'Certificate of Insurance',
        state: 'waiting',
        status: 'With us',
        detail: 'We have it and it is being reviewed. Nothing needed from you — we will let you know if anything is missing.',
        link: null,
      })
    }
  }

  // ── Workers' Comp ───────────────────────────────────────────────────
  // Listed only when one is on file. There is no client-facing place to
  // drop a WC certificate on the job page today, so an always-red row
  // would be an ask with nowhere to go; it travels with the COI request
  // instead.
  const wc = paperwork.find((p) => !!p.wcFileUrl)
  if (wc) {
    const on = fmtDate(wc.wcUploadedAt)
    items.push({
      key: 'wc',
      label: "Workers' Comp certificate",
      state: 'done',
      status: 'On file',
      detail: on ? `Received ${on}.` : 'Received.',
      link: null,
    })
  }

  // ── Agreements ──────────────────────────────────────────────────────
  const now = new Date()
  const coveredByAnnual = (type: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT') =>
    job.agreementAddenda.find(
      (a) =>
        a.companyAgreement.contractType === type &&
        !(
          a.companyAgreement.isAnnual &&
          a.companyAgreement.expiryDate &&
          a.companyAgreement.expiryDate < now
        ),
    ) ?? null

  const agreementRow = (
    type: 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT',
    key: 'agreement' | 'stage',
    label: string,
  ): ClientPaperworkItem => {
    const annual = coveredByAnnual(type)
    if (annual) {
      const on = fmtDate(annual.companyAgreement.signedAt)
      return {
        key,
        label,
        state: 'done',
        status: 'On file',
        detail: on
          ? `Covered by the agreement on your account, signed ${on}. Nothing to sign for this job.`
          : 'Covered by the agreement on your account — nothing to sign for this job.',
        link: null,
      }
    }
    const rows = job.orders.flatMap((o) =>
      o.signedAgreements.filter((a) => a.contractType === type),
    )
    const signed = rows.filter((a) => isSignedAgreementStatus(a.status) || !!a.coveredByAgreementId)
    if (rows.length > 0 && signed.length === rows.length) {
      const on = fmtDate(signed.map((s) => s.signedAt).filter(Boolean)[0] ?? null)
      return {
        key,
        label,
        state: 'done',
        status: 'Signed',
        detail: on ? `Signed ${on} — thank you.` : 'Signed — thank you.',
        link: null,
      }
    }
    // Released means the client can act. Anything short of that is ours:
    // an agreement is prepared and released once the quote is approved,
    // and telling a client to "go sign" before then sends them to a page
    // with nothing on it.
    const released = rows.some((a) => describeAgreementStatus(a.status).isReleased)
    if (released) {
      return {
        key,
        label,
        state: 'needed',
        status: 'Ready to sign',
        detail:
          signed.length > 0
            ? 'One more signature is outstanding — you can read it and sign on your job page.'
            : 'It is waiting for you — read it and sign on your job page, no printing or scanning.',
        link: 'paperwork',
      }
    }
    return {
      key,
      label,
      state: 'waiting',
      status: 'Not sent yet',
      detail: 'We send this for signature once the quote is approved — nothing for you to do yet.',
      link: null,
    }
  }

  items.push(agreementRow('RENTAL_AGREEMENT', 'agreement', 'Rental agreement'))

  const stageRows = job.orders.flatMap((o) =>
    o.signedAgreements.filter((a) => a.contractType === 'STAGE_CONTRACT'),
  )
  const booksStage = job.orders.some((o) => o.lineItems.some(isStageLineItem))
  if (booksStage || stageRows.length > 0 || coveredByAnnual('STAGE_CONTRACT')) {
    items.push(agreementRow('STAGE_CONTRACT', 'stage', 'Stage contract'))
  }

  // ── Damage waiver ───────────────────────────────────────────────────
  // Only when there is an eligible vehicle to waive — see
  // lcdwEligibility.ts. No eligible vehicle, no question, no row.
  const lcdw = await summarizeJobLcdwCoverage(job.id).catch(() => null)
  if (lcdw && lcdw.coveredVehicles.length > 0) {
    const election = await prisma.lcdwElection.findUnique({
      where: { jobId: job.id },
      select: { decision: true, decidedAt: true },
    })
    if (election) {
      items.push({
        key: 'lcdw',
        label: 'Damage waiver',
        state: 'done',
        status: election.decision === 'ACCEPTED' ? 'Accepted' : 'Declined',
        detail:
          election.decision === 'ACCEPTED'
            ? 'The damage waiver is on this job.'
            : 'You declined the damage waiver — your own policy covers damage.',
        link: null,
      })
    } else {
      items.push({
        key: 'lcdw',
        label: 'Damage waiver',
        state: 'needed',
        status: 'Needs your answer',
        detail: 'Accept or decline our damage waiver for this job — either answer is fine, we just need one on record.',
        link: 'lcdw',
      })
    }
  }

  // ── Card authorization ──────────────────────────────────────────────
  // Two stores: a card the client typed into the portal for this job's
  // booking, and one keyed onto the company wallet from a signed paper
  // authorization (src/lib/payments/jobCardOnFile.ts). Either counts.
  const portalCard = paperwork.find((p) => !!p.ccCardNumberEncrypted) ?? null
  const walletCard = portalCard ? null : await resolveWalletCardForJob(job.companyId, job.id)
  const last4 = portalCard?.ccCardLast4 ?? walletCard?.last4 ?? null
  if (portalCard || walletCard) {
    items.push({
      key: 'card',
      label: 'Card authorization',
      state: 'done',
      status: 'On file',
      detail: last4
        ? `A card ending ${last4} is authorized for this job.`
        : 'A card is authorized for this job.',
      link: null,
    })
  } else {
    items.push({
      key: 'card',
      label: 'Card authorization',
      state: 'needed',
      status: 'Needed',
      detail:
        'We hold a card for security on every rental — adding it does not charge you, and you can still pay by ACH, check or wire.',
      link: 'paperwork',
    })
  }

  // ── Drivers ─────────────────────────────────────────────────────────
  // Vacuously true is not "all named": with no unit assigned there is
  // nobody to name a driver for, and the row simply doesn't apply yet.
  const assignments = job.bookings.flatMap((b) => b.items.flatMap((i) => i.assignments))
  if (assignments.length > 0) {
    const named = assignments.filter((a) => a.driverAssignments.length > 0).length
    if (named >= assignments.length) {
      items.push({
        key: 'drivers',
        label: 'Drivers',
        state: 'done',
        status: 'All named',
        detail:
          assignments.length === 1
            ? 'Your driver is named — they have their own link for the license and pickup details.'
            : 'Every vehicle has a driver named.',
        link: null,
      })
    } else {
      const short = assignments.length - named
      items.push({
        key: 'drivers',
        label: 'Drivers',
        state: 'needed',
        status: named > 0 ? `${named} of ${assignments.length} named` : 'Needed',
        detail: `Add the email address for ${short === 1 ? 'the driver' : `${short} more drivers`} on your job page. They get their own link and upload their license themselves — please don't send us a photo of it.`,
        link: 'drivers',
      })
    }
  }

  const scoredItems = items.filter((i) => i.state !== 'waiting')

  return {
    jobId: job.id,
    jobCode: job.jobCode,
    jobName: job.name,
    companyName: job.company?.name ?? null,
    items,
    outstanding: items.filter((i) => i.state === 'needed'),
    done: scoredItems.filter((i) => i.state === 'done').length,
    scored: scoredItems.length,
    portalSlug: job.orders.find((o) => o.portalSlug)?.portalSlug ?? null,
    orderId: job.orders.find((o) => o.portalSlug)?.id ?? job.orders[0]?.id ?? null,
  }
}
