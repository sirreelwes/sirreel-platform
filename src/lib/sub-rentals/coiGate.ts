/**
 * A partner's unit does not get CONFIRMED onto a job whose certificate hasn't
 * cleared.
 *
 * ── Why this is a gate and not an action item ───────────────────────────────
 * Everything the partner agreements promise a partner runs through the
 * production's insurance. Partner Vehicle Agreement §3 and Partner Equipment
 * Agreement §3 both say the unit "receives every protection that agreement
 * gives SirReel-owned equipment, including the production's indemnity and
 * insurance obligations", and §4 spells the coverage out by name. §5 then caps
 * what SirReel owes when those sources do not pay — at the unit's actual cash
 * value, which is a cap on a bill SirReel still writes for a truck or a
 * generator it does not own.
 *
 * So confirming a partner unit onto a job with a failing or absent certificate
 * is the single moment HQ converts SirReel from a broker into the insurer. It
 * is worth stopping at, and nothing stopped at it: there was no reference to a
 * COI anywhere in src/lib/sub-rentals/ before this file.
 *
 * ── What clears it ─────────────────────────────────────────────────────────
 * The same derivation every other paperwork surface uses — resolveJobCoi (so
 * an annual account's carried-forward certificate counts, per
 * companyCoi.ts) then rollupCoiState, scoped by what is actually going out
 * (jobScope.ts). VERIFIED clears; everything else blocks. A carried-forward
 * policy that lapses mid-rental blocks too: the partner's unit is exposed for
 * the days after it stops, and "mostly insured" is not the answer to give the
 * person whose generator it is.
 *
 * ── The override is deliberate, and it is named ────────────────────────────
 * Wes books things the day they ship, and a certificate that is one endorsement
 * short at 4pm on a Friday is a business decision, not a bug. So this refuses
 * by default and takes a written reason to proceed, which lands in the audit
 * log against the person who gave it. A gate nobody can pass gets worked
 * around; a gate that records who opened it gets used honestly.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { resolveJobCoi } from '@/lib/coi/companyCoi'
import { rollupCoiState, type CoiRollupState } from '@/lib/coi/coiState'
import { COI_SCOPE_SELECT, deriveCoiScope } from '@/lib/coi/jobScope'

type Db = PrismaClient | Prisma.TransactionClient

/** Statuses that actually commit a partner's unit to a job. ESTIMATED is a
 *  pitch — the partner is told their calendar is being quoted and nothing is
 *  held — so it stays open; a quote nobody has accepted must not be blocked on
 *  paperwork the client has no reason to have filed yet. */
export const COI_GATED_SUB_RENTAL_STATUSES = ['CONFIRMED', 'PICKED_UP', 'ON_RENT'] as const

export function isCoiGatedSubRentalStatus(status: string | null | undefined): boolean {
  return (COI_GATED_SUB_RENTAL_STATUSES as readonly string[]).includes(status ?? '')
}

export interface SubRentalCoiVerdict {
  /** False means: do not write this status without an override. */
  ok: boolean
  /** Null when the sub-rental has no job to check — nothing to enforce. */
  state: CoiRollupState | null
  /** One sentence, written to be shown to whoever tried. */
  reason: string | null
  /** For the audit row + the client-side confirm dialog. */
  jobId: string | null
  partnerName: string | null
}

/**
 * Can this sub-rental move to a committing status?
 *
 * A sub-rental with no job attached passes: there is no production whose
 * certificate could be judged, and blocking it would stop the loose,
 * order-less rows Hugo creates by hand from ever being confirmed.
 */
export async function checkSubRentalCoi(
  subRentalId: string,
  db: Db = defaultPrisma,
): Promise<SubRentalCoiVerdict> {
  const sub = await db.subRental.findUnique({
    where: { id: subRentalId },
    select: {
      jobId: true,
      order: { select: { jobId: true } },
      vendor: { select: { name: true } },
    },
  })
  const jobId = sub?.jobId ?? sub?.order?.jobId ?? null
  const partnerName = sub?.vendor?.name ?? null
  if (!jobId) return { ok: true, state: null, reason: null, jobId: null, partnerName }

  const resolution = await resolveJobCoi(jobId, db)
  if (!resolution) {
    return {
      ok: false,
      state: 'NONE',
      reason:
        `No certificate of insurance on this job. ${partnerName ?? 'The partner'}'s unit is covered by the ` +
        `production's policy under the partner agreement — with no certificate there is nothing behind it but SirReel.`,
      jobId,
      partnerName,
    }
  }

  const job = await db.job.findUnique({ where: { id: jobId }, select: COI_SCOPE_SELECT })
  const scope = deriveCoiScope(job ?? {})
  const { state } = rollupCoiState({
    humanDecision: resolution.coi.humanDecision,
    policyExpiryDate: resolution.coi.policyExpiryDate,
    coverageVerified: resolution.coi.coverageVerified,
    decidedWithVehicles: resolution.coi.decidedWithVehicles,
    jobHasVehicles: scope.hasVehicles,
  })

  if (state !== 'VERIFIED') {
    const wording: Record<CoiRollupState, string> = {
      NONE: 'has no certificate of insurance',
      PENDING: 'has a certificate that has not been signed off yet',
      EXPIRED: 'has an expired certificate',
      ISSUE: 'has a certificate that failed review',
      VERIFIED: '',
    }
    return {
      ok: false,
      state,
      reason:
        `This job ${wording[state]}. ${partnerName ?? 'The partner'}'s unit relies on the production's ` +
        `insurance under the partner agreement, so confirming it now puts the loss on SirReel.`,
      jobId,
      partnerName,
    }
  }

  if (resolution.expiresDuringRental) {
    const stops = resolution.expiresDuringRental.toISOString().slice(0, 10)
    return {
      ok: false,
      state,
      reason:
        `The certificate covering this job expires ${stops}, before the rental ends. ` +
        `${partnerName ?? 'The partner'}'s unit would be uninsured for the remaining days.`,
      jobId,
      partnerName,
    }
  }

  return { ok: true, state, reason: null, jobId, partnerName }
}
