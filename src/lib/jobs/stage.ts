/**
 * Job stage — the ONE color a job wears everywhere (Wes, 2026-09-10).
 *
 * "We need to completely overhaul the reservation color coding to align
 * more with Planyo's colors. Holds (BLUE) will be placed as soon as the
 * agent has seen/responded to the inquiry. Everything related to the job
 * — from the left-hand color on the job tile to the highlighted progress
 * bar and the final color of the asset bar on the reservations page —
 * will be that color. When a COI or Rental Agreement or CCA has been
 * SENT, the job moves to booked (GREEN). If an order that needs to be
 * fulfilled by SirReel's warehouse is in a quote on that job, the color
 * switches to RED."
 *
 * So the stage is a LADDER, and it climbs on what has gone OUT to the
 * client — not on what has come back:
 *
 *   inquiry   dashed  nobody on our side has responded yet
 *   hold      blue    an agent has seen it / responded / quoted it
 *   booked    green   paperwork went out: an agreement released, the
 *                     paperwork (COI · agreement · card) link sent, a
 *                     certificate or card already on file, an annual
 *                     addendum covering it, an order past the quote, or
 *                     a booking confirmed by hand
 *   order     red     booked AND a live order carries a WAREHOUSE-lane
 *                     line — something the warehouse has to pull
 *   cancelled / lost  off the ladder, struck outline
 *
 * It is DERIVED, never stored, from facts the app already writes. The
 * operational cadence (src/lib/jobs/cadence.ts — quoted / picking up /
 * on rental / returning) is a DIFFERENT axis and stays in WORDS on the
 * tile and the header pill; the stage is the color. A job on rental is
 * still green or red — Planyo's bars never changed hue when the truck
 * left, and the team reads the board that way.
 *
 * Assumption, stated so it can be flipped in one place: RED requires the
 * booked threshold. A warehouse quote on a job whose paperwork has not
 * gone out stays BLUE — Planyo's "ORDER ATTACHED" was a booked color, and
 * red to the warehouse means "there is a pull on this job", which is not
 * yet true of an unpapered quote. See `warehouseBeatsHold` below.
 *
 * Inputs are the SAME rollup states the /jobs list and the readiness
 * batch already compute (AgreementRollupState / CoiRollupState), so the
 * list, the job header and the reservations board cannot disagree about
 * which rung a job is on.
 */
import type { AgreementStatus, BookingStatus, JobStatus, OrderStatus } from '@prisma/client'
import type { LineItemDepartment } from '@prisma/client'
import type { StageToken } from '@/lib/scheduling/statusTokens'
import type { AgreementRollupState, CoiRollupState } from './listRow'

export type JobStage = StageToken

/** If true, a warehouse line on ANY live order paints red even before
 *  paperwork has gone out. Off by default — see the header. */
const warehouseBeatsHold = false

/** Departments whose lines the WAREHOUSE pulls — the same routing
 *  bookOrder.ts applies at book time (routeDepartment), listed here so a
 *  QUOTE (no fulfillmentLane yet) can be judged the same way. Callers count
 *  these with NOT PARTNER_LINE_WHERE — a partner's unit is never a pull. */
export const WAREHOUSE_DEPARTMENTS: LineItemDepartment[] = [
  'COMMUNICATIONS',
  'PRO_SUPPLIES',
  'EXPENDABLES',
  'GE',
  'ART',
  'WARDROBE_MAKEUP',
  'PHOTO_SHOOT',
]

/** Order statuses past the quote — the client has said yes, or more. */
const PAST_QUOTE: ReadonlySet<OrderStatus> = new Set([
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
  'INVOICED',
  'CLOSED',
])

/** Booking statuses a human (or the Planyo import) has confirmed. */
const CONFIRMED_BOOKING: ReadonlySet<BookingStatus> = new Set(['CONFIRMED', 'ACTIVE', 'RETURNED', 'ARCHIVED'])

/** An agreement row that has left our hands — anything but the unreleased draft. */
export function agreementWentOut(status: AgreementStatus): boolean {
  return status !== 'PORTAL_GENERATED'
}

export interface JobStageInputs {
  jobStatus: JobStatus
  /** The inquiry this job was converted from, if any. `null` = the job was
   *  created by staff (or imported), which counts as seen. */
  inquiry: { respondedAt: Date | string | null } | null
  /** Non-cancelled orders on the job. */
  liveOrders: {
    status: OrderStatus
    quoteSentAt: Date | string | null
    /** Lines in a WAREHOUSE department (WAREHOUSE_DEPARTMENTS), any status. */
    warehouseLines: number
  }[]
  /** Non-cancelled bookings on the job. */
  liveBookings: { status: BookingStatus }[]
  /** Every booking on the job is CANCELLED (and there is at least one). */
  allBookingsCancelled: boolean
  /** Rental agreement rollup — SENT / PARTIAL / SIGNED all mean it went out. */
  agreement: AgreementRollupState
  /** Stage contract rollup, null when the job has no stage scope. */
  stageAgreement: AgreementRollupState | null
  /** COI rollup — anything but NONE means a certificate reached us, which
   *  means the request went out. */
  coi: CoiRollupState
  /** A card is on file (either store — lib/payments/jobCardOnFile). */
  cardOnFile: boolean
  /** The card-authorization / paperwork link went out (any PaperworkRequest). */
  cardRequested: boolean
}

function went(state: AgreementRollupState | null): boolean {
  return state === 'SENT' || state === 'PARTIAL' || state === 'SIGNED'
}

/** Has anything gone out to the client that makes this a booking? */
export function paperworkWentOut(i: JobStageInputs): boolean {
  if (went(i.agreement) || went(i.stageAgreement)) return true
  if (i.coi !== 'NONE') return true
  if (i.cardOnFile || i.cardRequested) return true
  if (i.liveOrders.some((o) => PAST_QUOTE.has(o.status))) return true
  if (i.liveBookings.some((b) => CONFIRMED_BOOKING.has(b.status))) return true
  return false
}

/** Has anyone on our side seen this job? */
export function agentHasResponded(i: JobStageInputs): boolean {
  if (!i.inquiry) return true
  if (i.inquiry.respondedAt) return true
  // Writing a quote — sent or not — is seeing it. So is placing a hold.
  if (i.liveOrders.length > 0) return true
  if (i.liveBookings.some((b) => b.status !== 'REQUEST')) return true
  return false
}

export function hasWarehouseOrder(i: JobStageInputs): boolean {
  return i.liveOrders.some((o) => o.warehouseLines > 0)
}

export function deriveJobStage(i: JobStageInputs): JobStage {
  if (i.jobStatus === 'LOST') return 'lost'
  if (i.allBookingsCancelled && i.liveOrders.length === 0) return 'cancelled'
  const warehouse = hasWarehouseOrder(i)
  if (paperworkWentOut(i)) return warehouse ? 'order' : 'booked'
  if (warehouseBeatsHold && warehouse) return 'order'
  return agentHasResponded(i) ? 'hold' : 'inquiry'
}

export const STAGE_LABEL: Record<JobStage, string> = {
  inquiry: 'Inquiry',
  hold: 'Hold',
  booked: 'Booked',
  order: 'Booked · Warehouse order',
  cancelled: 'Cancelled',
  lost: 'Lost',
}

/** Short form for chips on tight surfaces. */
export const STAGE_SHORT: Record<JobStage, string> = {
  inquiry: 'Inquiry',
  hold: 'Hold',
  booked: 'Booked',
  order: 'Warehouse order',
  cancelled: 'Cancelled',
  lost: 'Lost',
}

/** One sentence per rung — hover text, so nobody has to decode a hue. */
export const STAGE_HINT: Record<JobStage, string> = {
  inquiry: 'Nobody has responded to this inquiry yet',
  hold: 'An agent has seen it — the reservation is a hold until paperwork goes out',
  booked: 'Paperwork has gone to the client — a COI, agreement, or card authorization was sent',
  order: 'Booked, and an order on this job has gear the warehouse must pull',
  cancelled: 'Every booking on it was cancelled',
  lost: 'Did not win it',
}

/** Ladder order, for sorting and for the legend. */
export const STAGE_ORDER: JobStage[] = ['inquiry', 'hold', 'booked', 'order', 'cancelled', 'lost']
