import { prisma } from '@/lib/prisma'
import type { CadenceState, LostReason } from '@prisma/client'
import type { CadenceTemplateContext } from '@/lib/email/templates/cadenceTemplates'
import { portalTokenUrl } from '@/lib/portal/portalUrl'

const AFTER_HOURS_LINE = '(888) 477-7335'

export interface CadenceOrderContext {
  order: {
    id: string
    orderNumber: string
    startDate: Date | null
    endDate: Date | null
    portalSlug: string | null
    cadenceState: CadenceState
    cadenceManualOverride: boolean
    cadencePausedUntil: Date | null
    lostReason: LostReason | null
  }
  company: { id: string; name: string }
  jobContact: {
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
  } | null
  agent: { id: string; name: string; email: string; phone: string | null }
  jobName: string
  jobCode: string | null
}

/**
 * Loads the data needed to render a cadence email + decide whether to send.
 * Returns null if the order doesn't exist. The cadence runner uses this in
 * every email handler; the manual-override and reply-classification flows
 * use it to inspect current state cheaply.
 */
export async function loadCadenceContextForOrder(orderId: string): Promise<CadenceOrderContext | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      portalSlug: true,
      cadenceState: true,
      cadenceManualOverride: true,
      cadencePausedUntil: true,
      lostReason: true,
      company: { select: { id: true, name: true } },
      job: { select: { name: true, jobCode: true } },
      jobContact: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      agent: { select: { id: true, name: true, email: true, phone: true } },
    },
  })
  if (!order) return null

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      startDate: order.startDate,
      endDate: order.endDate,
      portalSlug: order.portalSlug,
      cadenceState: order.cadenceState,
      cadenceManualOverride: order.cadenceManualOverride,
      cadencePausedUntil: order.cadencePausedUntil,
      lostReason: order.lostReason,
    },
    company: order.company,
    jobContact: order.jobContact,
    agent: order.agent,
    jobName: order.job?.name || order.orderNumber,
    jobCode: order.job?.jobCode ?? null,
  }
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', // calendar date — LA would render the day before
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d)
}

/**
 * There is no pickup time on an Order.
 *
 * Order.startDate / endDate are `@db.Date` — a calendar day with no time at
 * all. This used to run those columns through a time formatter, which turned
 * UTC midnight into "5:00 PM" Pacific and put that invented hour into live
 * client emails ("You're good to pick up on August 25 at 5:00 PM"). Both
 * halves were wrong: the day was off by one and the time never existed.
 *
 * The REAL value lives on `Booking.pickupTime` / `Booking.deliveryTime`
 * (String columns). The cadence context has no booking on it today, so
 * rather than invent an hour we say something true. Wire the booking through
 * and swap this out when a precise time is worth threading.
 */
const UNSPECIFIED_TIME = 'your scheduled time'

/**
 * Maps a CadenceOrderContext to the Handlebars context shape the cadence
 * templates expect. Optional template-specific fields (parkingInstructions,
 * invoiceAmount, etc.) are populated by per-event handlers; this helper
 * fills in everything that's derivable from order-level data.
 */
export function buildTemplateContext(ctx: CadenceOrderContext): CadenceTemplateContext {
  const portalLink = ctx.order.portalSlug ? portalTokenUrl(ctx.order.portalSlug) : ''
  return {
    firstName: ctx.jobContact?.firstName || '',
    companyName: ctx.company.name,
    jobName: ctx.jobName,
    pickupDate: fmtDate(ctx.order.startDate),
    pickupTime: UNSPECIFIED_TIME,
    returnDate: fmtDate(ctx.order.endDate),
    returnTime: UNSPECIFIED_TIME,
    repName: ctx.agent.name,
    repPhone: ctx.agent.phone || '',
    repEmail: ctx.agent.email,
    afterHoursLine: AFTER_HOURS_LINE,
    portalLink,
  }
}
