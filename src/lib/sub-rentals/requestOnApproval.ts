/**
 * The acceptance hook: client approves the quote → the partner is asked to
 * actually HOLD their unit.
 *
 * The status enum has said since it was written that "client acceptance moves
 * it to REQUESTED, which is the point at which we ask the vendor for driver
 * details" — but nothing ever performed that transition. A sub-rental created
 * by the estimate flow sat at ESTIMATED forever, which meant the vendor's last
 * word from us was "this is NOT a booking" no matter what the client did. This
 * module is that missing edge.
 *
 * SCOPE — which sub-rentals belong to an approved order:
 *   · orderId === the approved order  (bound at create, or via the line), OR
 *   · orderId IS NULL and jobId === the order's job.
 * The null-orderId arm exists because createPotentialSubRental hangs the row
 * off the JOB — a quote exists before any order does. The arm is deliberately
 * NOT "every ESTIMATED row on the job": a job with two orders out would then
 * have approving one order commit the other one's partner units too.
 *
 * FAILURE POSTURE — the flip is durable, the mail is best-effort. The client's
 * yes happened; a Resend outage must not undo it. So status moves regardless
 * and `vendorHoldRequestedAt` is stamped ONLY on a send that really left. That
 * makes `status = REQUESTED AND vendorHoldRequestedAt IS NULL` the precise set
 * of partners a human still has to phone, and the caller surfaces it loudly
 * rather than swallowing it.
 */
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc, agentReplyTo } from '@/lib/email/teamVisibility'
import { buildVendorHoldRequest } from '@/lib/sub-rentals/vendorNotice'
import { vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import { isClientCommittedOrder } from '@/lib/sub-rentals/commitment'

const TOKEN_BYTES = 32

export interface HoldRequestOutcome {
  subRentalId: string
  vendorName: string
  vehicleName: string
  /** yyyy-mm-dd, or null when the row was quoted without dates. */
  startDate: string | null
  endDate: string | null
  quantity: number
  /** True only when the hold notice actually left. */
  notified: boolean
  /** Why the vendor was not told. Null when notified. */
  warning: string | null
}

export interface RequestOnApprovalResult {
  /** Every row this approval moved ESTIMATED → REQUESTED. */
  requested: HoldRequestOutcome[]
  /** The subset whose vendor could NOT be told — needs a human. */
  unnotified: HoldRequestOutcome[]
}

/** A @db.Date value as yyyy-mm-dd, with no timezone drift. */
function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/**
 * Ask ONE partner to hold, and record whether they were really told.
 *
 * Extracted so the HQ job panel's "resend" button and the approval hook are
 * the same code path — a second copy would drift, and the thing that would
 * drift first is the conduit rule (what the notice is allowed to name).
 *
 * `flip` is false on a resend: the row is already REQUESTED and re-stamping
 * the status would be a lie about when the client said yes.
 */
export async function sendHoldRequest(args: {
  subRentalId: string
  jobCode: string | null
  agentName: string | null
  agentEmail: string | null
  /** Anchors the EmailDelivery row when the sub-rental belongs to an order. */
  orderId: string | null
  /** Move ESTIMATED → REQUESTED first. False when re-sending. */
  flip: boolean
}): Promise<HoldRequestOutcome | null> {
  const s = await prisma.subRental.findUnique({
    where: { id: args.subRentalId },
    select: {
      id: true,
      itemDescription: true,
      quantity: true,
      startDate: true,
      endDate: true,
      vendorToken: true,
      subcontractedVehicle: { select: { name: true } },
      vendor: { select: { id: true, name: true, email: true, poEmail: true } },
    },
  })
  if (!s) return null

  const vehicleName = s.subcontractedVehicle?.name ?? s.itemDescription
  const startDate = isoDate(s.startDate)
  const endDate = isoDate(s.endDate)

  // Mint a token if this row somehow has none (an ad-hoc sub-rental that was
  // switched to ESTIMATED by hand). The notice is worthless without a page to
  // point at, and the vendor page IS the credential — there is no login.
  let token = s.vendorToken
  if (!token) {
    token = randomBytes(TOKEN_BYTES).toString('hex')
    await prisma.subRental.update({
      where: { id: s.id },
      data: { vendorToken: token, vendorTokenMintedAt: new Date() },
    })
  }

  // The durable half. Done before the send, and never rolled back by it.
  if (args.flip) {
    await prisma.subRental.update({ where: { id: s.id }, data: { status: 'REQUESTED' } })
  }

  const outcome: HoldRequestOutcome = {
    subRentalId: s.id,
    vendorName: s.vendor.name,
    vehicleName,
    startDate,
    endDate,
    quantity: s.quantity,
    notified: false,
    warning: null,
  }

  // poEmail is where ordering goes when the partner keeps a separate desk —
  // same precedence the estimate notice uses.
  const to = s.vendor.poEmail ?? s.vendor.email
  if (!to) {
    outcome.warning = `${s.vendor.name} has no email on file — nobody has been asked to hold ${vehicleName}.`
  } else if (!startDate || !endDate) {
    outcome.warning = `${vehicleName} was quoted without dates, so ${s.vendor.name} could not be asked to hold anything.`
  } else {
    const notice = buildVendorHoldRequest({
      vendorName: s.vendor.name,
      vehicleName,
      startDate,
      endDate,
      quantity: s.quantity,
      reference: args.jobCode,
      vendorUrl: `${PUBLIC_SITE_ORIGIN}${vendorPagePath(token)}`,
      agentName: args.agentName ?? 'Team SirReel',
    })
    // rentals@ is CC'd for the same reason the estimate CCs it: a hold commits
    // a partner's unit and the desk must see that it went out.
    const res = await sendAgreementEmail({
      to: [to],
      cc: await withTeamCc([], to),
      replyTo: agentReplyTo(args.agentEmail) ?? undefined,
      subject: notice.subject,
      html: notice.html,
      text: notice.text,
      label: 'sub-rental-hold-request',
      orderId: args.orderId,
    }).catch((err: any) => ({ ok: false as const, reason: err?.message || 'send threw' }))

    if (res.ok) {
      outcome.notified = true
      await prisma.subRental.update({
        where: { id: s.id },
        data: { vendorHoldRequestedAt: new Date() },
      })
    } else {
      outcome.warning = `${s.vendor.name} could not be asked to hold ${vehicleName}: ${res.reason}`
    }
  }

  return outcome
}

export async function requestSubRentalsOnApproval(args: {
  orderId: string
  jobId: string | null
  /** Reference shown to the vendor — our own job code, never a client name. */
  jobCode: string | null
  /** The rep who owns the order; becomes Reply-To and signs the note. */
  agentName: string | null
  agentEmail: string | null
  /** Which path committed the client — recorded on the audit row. */
  via?: 'portal-quote-approval' | 'hq-order-status' | 'hq-book' | 'job-panel'
  /** Staff member acting, when it is staff and not the client. */
  userId?: string | null
}): Promise<RequestOnApprovalResult> {
  const subs = await prisma.subRental.findMany({
    where: {
      status: 'ESTIMATED',
      OR: [
        { orderId: args.orderId },
        ...(args.jobId ? [{ orderId: null, jobId: args.jobId }] : []),
      ],
    },
    select: { id: true },
  })

  const requested: HoldRequestOutcome[] = []

  for (const { id } of subs) {
    const outcome = await sendHoldRequest({
      subRentalId: id,
      jobCode: args.jobCode,
      agentName: args.agentName,
      agentEmail: args.agentEmail,
      orderId: args.orderId,
      flip: true,
    })
    if (!outcome) continue

    await prisma.auditLog.create({
      data: {
        action: 'sub_rental.hold_requested',
        entityType: 'SubRental',
        entityId: id,
        // Null on the portal path: the actor is the client approving, not a
        // signed-in member of staff.
        userId: args.userId ?? null,
        oldValues: { status: 'ESTIMATED' },
        newValues: {
          status: 'REQUESTED',
          vendor: outcome.vendorName,
          vehicle: outcome.vehicleName,
          startDate: outcome.startDate,
          endDate: outcome.endDate,
          notified: outcome.notified,
          via: args.via ?? 'portal-quote-approval',
          orderId: args.orderId,
        },
      },
    }).catch((err) => console.error('[hold-request] audit write failed:', err))

    requested.push(outcome)
  }

  return { requested, unnotified: requested.filter((r) => !r.notified) }
}

/**
 * The same hook, keyed by ORDER — for the paths where the client's yes arrives
 * through HQ rather than the portal.
 *
 * Found 2026-09-05 (the FIGUROV job booked): only the portal's approve-quote
 * route ever called requestSubRentalsOnApproval. A rep marking the order
 * APPROVED on the order page, or clicking "Book it", committed the client
 * without a word to the partner — whose last notice from us still read "this
 * is NOT a booking". The job panel stayed quiet too, because an ESTIMATED row
 * is by design not an "unasked hold". So the unit sat bookable by anyone
 * else until somebody noticed.
 *
 * Idempotent: only ESTIMATED rows move, so calling it on APPROVED and again
 * on BOOKED (or after the portal already ran it) sends nothing twice. It
 * refuses to act on an order that is not actually committed — a status write
 * that lands on DRAFT must never ask a partner to hold.
 *
 * Best-effort and non-throwing, like every caller's posture: the order's
 * status change is the durable fact and has already happened. A partner we
 * could not reach becomes a high-severity Alert on the order, the same
 * signal the portal path raises, so the staff path is not the quiet one.
 */
export async function requestSubRentalsForOrder(args: {
  orderId: string
  via: 'hq-order-status' | 'hq-book'
  userId: string | null
}): Promise<RequestOnApprovalResult> {
  const empty: RequestOnApprovalResult = { requested: [], unnotified: [] }
  try {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        job: { select: { id: true, jobCode: true } },
        agent: { select: { name: true, email: true } },
      },
    })
    if (!order || !isClientCommittedOrder(order.status)) return empty

    const result = await requestSubRentalsOnApproval({
      orderId: order.id,
      jobId: order.job?.id ?? null,
      jobCode: order.job?.jobCode ?? null,
      agentName: order.agent?.name ?? null,
      agentEmail: order.agent?.email ?? null,
      via: args.via,
      userId: args.userId,
    })

    if (result.unnotified.length > 0) {
      const names = result.unnotified.map((r) => `${r.vendorName} (${r.vehicleName})`).join(', ')
      await prisma.alert.create({
        data: {
          type: 'sub_rental.hold_unsent',
          title: `${order.orderNumber}: a sub-rental partner has NOT been asked to hold`,
          body: `${order.orderNumber} is ${order.status.toLowerCase()} but the hold request did not reach ${names}. The unit is still bookable by someone else — send it from the job page or call them.`,
          severity: 'high',
          link: `/orders/${order.id}`,
        },
      }).catch((err) => console.error('[hold-request] alert write failed:', err))
    }
    return result
  } catch (err) {
    console.error(`[hold-request] ${args.via} hook failed for order ${args.orderId}:`, err)
    return empty
  }
}
