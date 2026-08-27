/**
 * Job readiness — the ONE derivation of "is this job ready to go out",
 * shared by the /jobs sidebar chip, its "Not ready" filter, and the job
 * detail page's paperwork strip, so the surfaces cannot disagree.
 *
 * Wes's rule (2026-08-27), five checks:
 *   gear assigned · COI verified · agreement signed · card on file ·
 *   driver named
 *
 * Blocker order is CLIENT LEAD TIME, longest first — COI (the client's
 * insurance broker, days) → agreement (the client signs) → card (the
 * client types it) → driver (the client names one) → gear (Julian, this
 * afternoon). The row chip shows only blockers[0], so this order decides
 * what an agent is told to chase first. It matches the detail strip's
 * tile order: the word on the row is always the strip's leftmost red tile.
 *
 * This intentionally supersedes canPickupConfirm() as the readiness
 * truth: that helper was contract-only, never gained a caller, and a
 * third definition of "ready" is how surfaces drift apart. (It still
 * stands as the order-level PICKUP_CONFIRMED gate if that transition is
 * ever automated.)
 *
 * WHERE IT RENDERS is as important as what it says: only on rows whose
 * rowState is in the outbound band — booked / picking-tmw / picking-today
 * (see readinessApplies). A quoted job with no COI is a normal quote,
 * not a deficiency, and an indicator that scolds 150 normal rows is
 * wallpaper by Friday. Omit, don't dim.
 */

import type { AgreementRollupState, CoiRollupState, RowState } from './listRow'

export type BlockerKey = 'coi' | 'sign' | 'card' | 'driver' | 'gear'

export interface ReadinessBlocker {
  key: BlockerKey
  /** Chip word — one short label, capitalized ("COI", "Sign", "Card"…). */
  label: string
}

export interface JobReadiness {
  ready: boolean
  /** Checks passed, of `total`. Drives the detail strip's "n of 5". */
  done: number
  total: number
  /** Failing checks, chase-priority first. Empty when ready. */
  blockers: ReadinessBlocker[]
}

export interface ReadinessInputs {
  coi: CoiRollupState
  rental: AgreementRollupState
  /** Null when the job has no stage scope — then only rental gates. */
  stage: AgreementRollupState | null
  /** A PaperworkRequest on the job's bookings holds an encrypted card.
   *  A check/wire client still counts: their card is on file as
   *  security, which is what this check is about. */
  cardOnFile: boolean
  /** LIVE booking items (non-cancelled bookings, item not UNFULFILLED /
   *  SUBSTITUTED) vs those with a unit ASSIGNED. */
  gear: { total: number; assigned: number }
  /** ACTIVE unit assignments (ASSIGNED / CHECKED_OUT) vs those with a
   *  named driver. */
  drivers: { units: number; named: number }
}

const LABEL: Record<BlockerKey, string> = {
  coi: 'COI',
  sign: 'Sign',
  card: 'Card',
  driver: 'Driver',
  gear: 'Gear',
}

export function computeReadiness(i: ReadinessInputs): JobReadiness {
  // Vacuous truths are deliberate. A job with no live booking items has
  // nothing for the scheduler to assign — most legacy order-only jobs —
  // and must not read "Gear" forever with no way to clear it. Likewise
  // drivers: with zero active unit assignments there is no one to name a
  // driver FOR, and the gear check is already carrying the real blocker.
  const gearOk = i.gear.total === 0 || i.gear.assigned >= i.gear.total
  const driverOk = i.drivers.units === 0 || i.drivers.named >= i.drivers.units
  const coiOk = i.coi === 'VERIFIED'
  const signOk = i.rental === 'SIGNED' && (i.stage === null || i.stage === 'SIGNED')

  const failing: BlockerKey[] = []
  if (!coiOk) failing.push('coi')
  if (!signOk) failing.push('sign')
  if (!i.cardOnFile) failing.push('card')
  if (!driverOk) failing.push('driver')
  if (!gearOk) failing.push('gear')

  return {
    ready: failing.length === 0,
    done: 5 - failing.length,
    total: 5,
    blockers: failing.map((key) => ({ key, label: LABEL[key] })),
  }
}

/** The outbound band — the only rows where the readiness chip renders. */
const OUTBOUND: ReadonlySet<RowState> = new Set(['booked', 'picking-tmw', 'picking-today'])

export function readinessApplies(state: RowState): boolean {
  return OUTBOUND.has(state)
}

/** "COI +2" / "Card" / "✓ Ready" — the row chip's text. */
export function readinessChipText(r: JobReadiness): string {
  if (r.ready) return '✓ Ready'
  const rest = r.blockers.length - 1
  return rest > 0 ? `${r.blockers[0].label} +${rest}` : r.blockers[0].label
}
