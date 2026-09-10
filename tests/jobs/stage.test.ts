/**
 * Job stage ladder tests.
 *
 *   npx tsx tests/jobs/stage.test.ts
 *   npm run test:job-stage
 *
 * Pure + offline. The stage is the ONE color a job wears on the /jobs
 * tile rail, the paperwork wash and the reservations bar (Wes 2026-09-10):
 * inquiry → hold → booked → warehouse order, with cancelled / lost off
 * the ladder.
 */
import { deriveJobStage, type JobStageInputs } from '../../src/lib/jobs/stage'
import { STAGE_RAIL, STAGE_CHIP, STATUS_COLORS, LEGEND_ITEMS, barColor, readinessMeterStyle, readinessLabelClass } from '../../src/lib/scheduling/statusTokens'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

const base: JobStageInputs = {
  jobStatus: 'NEW',
  inquiry: null,
  liveOrders: [],
  liveBookings: [],
  allBookingsCancelled: false,
  agreement: 'NONE',
  stageAgreement: null,
  coi: 'NONE',
  cardOnFile: false,
  cardRequested: false,
}
const w = (over: Partial<JobStageInputs>): JobStageInputs => ({ ...base, ...over })

console.log('\ninquiry → hold')
eq(deriveJobStage(w({ inquiry: { respondedAt: null } })), 'inquiry', 'converted from an inquiry nobody answered → inquiry')
eq(deriveJobStage(w({ inquiry: { respondedAt: new Date() } })), 'hold', 'answered inquiry → hold')
eq(deriveJobStage(w({})), 'hold', 'staff-created job (no inquiry) counts as seen → hold')
eq(deriveJobStage(w({ inquiry: { respondedAt: null }, liveOrders: [{ status: 'DRAFT', quoteSentAt: null, warehouseLines: 0 }] })), 'hold', 'a draft quote on an unanswered inquiry = someone saw it → hold')
eq(deriveJobStage(w({ inquiry: { respondedAt: null }, liveBookings: [{ status: 'PENDING_APPROVAL' }] })), 'hold', 'a placed hold on an unanswered inquiry → hold')
eq(deriveJobStage(w({ inquiry: { respondedAt: null }, liveBookings: [{ status: 'REQUEST' }] })), 'inquiry', 'a REQUEST booking alone is still an inquiry')
eq(deriveJobStage(w({ liveOrders: [{ status: 'QUOTE_SENT', quoteSentAt: new Date(), warehouseLines: 0 }] })), 'hold', 'a sent quote is a hold — paperwork has not gone out')

console.log('\nhold → booked (something went OUT)')
eq(deriveJobStage(w({ agreement: 'SENT' })), 'booked', 'rental agreement released → booked')
eq(deriveJobStage(w({ agreement: 'DRAFT' })), 'hold', 'agreement generated but not released → still hold')
eq(deriveJobStage(w({ agreement: 'SIGNED' })), 'booked', 'signed agreement → booked (sent is implied)')
eq(deriveJobStage(w({ stageAgreement: 'SENT' })), 'booked', 'stage contract out → booked')
eq(deriveJobStage(w({ cardRequested: true })), 'booked', 'CCA / paperwork link sent → booked')
eq(deriveJobStage(w({ cardOnFile: true })), 'booked', 'card on file → booked')
eq(deriveJobStage(w({ coi: 'PENDING' })), 'booked', 'a COI arrived (so the request went out) → booked')
eq(deriveJobStage(w({ coi: 'EXPIRED' })), 'booked', 'an expired COI still proves the request went out')
eq(deriveJobStage(w({ liveOrders: [{ status: 'APPROVED', quoteSentAt: new Date(), warehouseLines: 0 }] })), 'booked', 'client-approved order → booked')
eq(deriveJobStage(w({ liveBookings: [{ status: 'CONFIRMED' }] })), 'booked', 'booking confirmed by hand / Planyo import → booked')
eq(deriveJobStage(w({ liveOrders: [{ status: 'ON_JOB', quoteSentAt: new Date(), warehouseLines: 0 }] })), 'booked', 'on rental stays green — the ladder never climbs on returns')

console.log('\nbooked → warehouse order (red)')
eq(deriveJobStage(w({ agreement: 'SENT', liveOrders: [{ status: 'QUOTE_SENT', quoteSentAt: new Date(), warehouseLines: 2 }] })), 'order', 'booked + a quote with warehouse lines → red')
eq(deriveJobStage(w({ agreement: 'SENT', liveOrders: [{ status: 'QUOTE_SENT', quoteSentAt: new Date(), warehouseLines: 0 }] })), 'booked', 'booked + a vehicle-only quote stays green')
eq(deriveJobStage(w({ liveOrders: [{ status: 'QUOTE_SENT', quoteSentAt: new Date(), warehouseLines: 2 }] })), 'hold', 'warehouse lines on an UNPAPERED quote stay blue (documented assumption)')
eq(deriveJobStage(w({ liveOrders: [{ status: 'BOOKED', quoteSentAt: new Date(), warehouseLines: 1 }] })), 'order', 'a booked order with warehouse lines → red (order status is itself the sent signal)')

console.log('\noff the ladder')
eq(deriveJobStage(w({ jobStatus: 'LOST', agreement: 'SIGNED' })), 'lost', 'LOST overrides everything')
eq(deriveJobStage(w({ allBookingsCancelled: true })), 'cancelled', 'every booking cancelled, no orders → cancelled')
eq(deriveJobStage(w({ allBookingsCancelled: true, liveOrders: [{ status: 'DRAFT', quoteSentAt: null, warehouseLines: 0 }] })), 'hold', 'cancelled bookings but a live order → the order grain rules')
eq(deriveJobStage(w({ jobStatus: 'HOLD', agreement: 'SENT' })), 'booked', 'a client-paused job keeps its rung — the pause is words, not a color')

console.log('\ntokens')
eq(Object.keys(STAGE_RAIL).sort(), ['booked', 'cancelled', 'hold', 'inquiry', 'lost', 'order'], 'every stage has a rail')
eq(Object.keys(STAGE_CHIP).length >= 6, true, 'every stage has a chip')
eq(barColor('order').bg, STATUS_COLORS.order.bg, 'order stage paints the Planyo dark red')
eq(barColor('order', { blindPickup: true }).bg, 'bg-violet-500', 'blind pickup still wins over red')
eq(barColor('hold', { blindPickup: true }).bg, STATUS_COLORS.hold.bg, 'blind pickup does not color an unbooked hold')
eq(LEGEND_ITEMS.some((l) => l.label === 'Booked · Warehouse order'), true, 'legend names the red rung')
eq(readinessMeterStyle(3, 5, { stage: 'hold' }).backgroundImage?.includes('147, 197, 253'), true, 'a hold washes blue')
eq(readinessMeterStyle(3, 5, { stage: 'order' }).backgroundImage?.includes('253, 164, 175'), true, 'a warehouse-order job washes rose')
eq(readinessMeterStyle(3, 5, { stage: 'cancelled' }), {}, 'a cancelled bar draws no wash')
eq(readinessLabelClass('text-white', { done: 3 }, 'order').includes('bg-white/85'), true, 'a washed label sits on a white plate, not dark ink on dark red')
eq(readinessLabelClass('text-white', { done: 0 }, 'order'), 'text-white', 'no wash, no plate — white on the solid bar as before')
eq(readinessLabelClass('text-green-800', { done: 3 }, 'inquiry'), 'text-green-800', 'dark-ink tokens keep their ink')

console.log('')
if (failures.length) { console.log(`${failures.length} failure(s)`); process.exit(1) }
console.log('all stage tests passed')
