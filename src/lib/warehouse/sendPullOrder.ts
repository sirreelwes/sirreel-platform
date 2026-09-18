/**
 * "Send the pull order to the warehouse" — the explicit handoff.
 *
 * Wes, 2026-09-09: "we need a 'send picklist pull order to warehouse'
 * on orders."
 *
 * WHY THIS DID NOT ALREADY EXIST, given all the pieces did:
 * a PickList is filed the MOMENT a warehouse line is added, at any
 * order status (lib/orders/pickListSync.ts). Its existence has
 * therefore never meant anyone asked the floor to pull anything — on
 * 2026-09-01, 19 of the 20 open lists belonged to orders nobody had
 * booked, which is why /api/picklists was gated to BOOKED-or-beyond.
 * That gate fixed the flood and created this gap: a rep with an
 * approved order and a client waiting had no way to say "pull this
 * now" except to book it. The only push to the floor was the nightly
 * day-before digest (api/cron/pickup-picklist), which is a bridge, is
 * job-shaped, and cannot be aimed at one order.
 *
 * So the release is a stamp, not a status: PickList.releasedAt +
 * releasedById + releaseNote. Two effects, one gesture —
 *   1. The list appears on /warehouse/pick regardless of order status
 *      (api/picklists ORs on releasedAt). Explicit, per-order, so it
 *      cannot reflood the queue the way the old status-blind rule did.
 *   2. The 'warehouse-pull-orders' channel — warehouse@sirreel.com by
 *      default — gets the pull sheet as an ATTACHED PDF, plus the pickup
 *      window, the line count, and, exactly as the cron does, the
 *      readiness blockers NAMED rather than the send refused. A sheet
 *      going out on a job missing a COI is ordinary; the floor pulling
 *      gear nobody told them about is not.
 *
 *      Attached, not just linked (Wes, 2026-09-09: "during the
 *      transition, pull list pdfs should be sent to warehouse@sirreel.com
 *      for them to pull"). The link behind /api/orders/[id]/pick-list-pdf
 *      needs an HQ login, and during the transition the people pulling do
 *      not all have one — a link they cannot open is not a pull order.
 *      The link rides along anyway for anyone who does, because the
 *      attachment is a SNAPSHOT and the link is live.
 *
 * Deliberately NOT gated on readiness or on BOOKED. The rep is the
 * one who knows; the email carries the caveats. It IS gated on there
 * being warehouse lines to pull — a release with nothing on it is a
 * mistake every time.
 *
 * Re-sending is allowed and re-stamps releasedAt (plans change, and
 * the floor's copy has to change with them). Every send writes its own
 * AuditLog row, so the history survives the re-stamp.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { isPartnerLineIn, PARTNER_SUB_RENTAL_WHERE } from '@/lib/orders/partnerLines'
import { isPickableLine } from '@/lib/orders/lineType'
import { addedAfterPullForOrder, type AddedLine } from '@/lib/orders/addedAfterPull'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, p, calloutBox, detailTable } from '@/lib/email/templates/shell'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'
import { renderPickListPdf } from '@/lib/warehouse/renderPickListPdf'
import { computeReadiness } from '@/lib/jobs/readiness'
import { rollupCoiState } from '@/lib/coi/coiState'
import { newestFullCoi, OWN_COI_TAKE } from '@/lib/coi/companyCoi'
import { deriveVehicleScope } from '@/lib/coi/vehicleScope'
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

type TxClient = PrismaClient | Prisma.TransactionClient

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Calendar dates are stored at UTC midnight — format them in UTC or
 *  every pickup reads as the day before. */
function dayLabel(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/** Who a pull order goes to. Its own channel (default
 *  warehouse@sirreel.com), NOT the day-before digest's — the two have
 *  different audiences and different cadences, and folding them
 *  together would mean silencing one silences the other. */
async function recipientsForPullOrder(): Promise<string[]> {
  return dedupeEmails(await channelRecipients('warehouse-pull-orders'))
}

/** Re-exported for the call sites that already import it from here. The
 *  rule itself moved to lib/orders/lineType.ts on 2026-09-18 so the
 *  added-after-the-pull derivation could share it. */
export { isPickableLine }

export interface PullOrderPreview {
  orderId: string
  orderNumber: string
  companyName: string
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  startDate: Date | null
  endDate: Date | null
  deliveryRequested: boolean
  /** Everything on the sheet — pickable lines, warehouse-routed or not.
   *  A pre-book order has no lane stamped yet, so counting only
   *  fulfillmentLane==='WAREHOUSE' would report zero on exactly the
   *  orders this feature exists to send. */
  pickableCount: number
  warehouseLineCount: number
  /** The five job readiness checks, named — not a gate. */
  blockers: string[]
  ready: boolean
  recipientCount: number
  /** Gear added to the order after its check-out sheet was filed — a
   *  mid-job add the floor has never pulled (addedAfterPull.ts). The
   *  send leads with these and attaches a sheet of just them. */
  addedSincePull: AddedLine[]
  /** Null until someone has sent it. */
  lastSentAt: Date | null
  lastSentBy: string | null
  pullSheetHref: string
}

/**
 * Everything the confirm dialog needs, and everything the send itself
 * re-reads. One query shape so the preview cannot promise something
 * the send then does differently.
 */
export async function previewPullOrder(
  orderId: string,
): Promise<{ ok: false; error: string; status: number } | { ok: true; preview: PullOrderPreview }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      deliveryRequested: true,
      company: { select: { name: true } },
      lineItems: {
        select: {
          id: true, type: true, fulfillmentLane: true, parentLineItemId: true,
          subRentals: { where: PARTNER_SUB_RENTAL_WHERE, select: { id: true } },
        },
      },
      pickList: {
        select: {
          releasedAt: true,
          releasedBy: { select: { name: true, email: true } },
        },
      },
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          coiChecks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: OWN_COI_TAKE,
            select: {
              humanDecision: true,
              policyExpiryDate: true,
              coverageVerified: true,
              decidedWithVehicles: true,
              aiResponse: true,
            },
          },
          orders: {
            where: { status: { not: 'CANCELLED' }, archivedAt: null },
            select: {
              status: true,
              signedAgreements: {
                select: { contractType: true, status: true, coveredByAgreementId: true },
              },
              lineItems: {
                select: {
                  type: true,
                  department: true,
                  fulfillmentLane: true,
                  assetCategory: { select: { department: true } },
                  inventoryItem: { select: { department: true } },
                },
              },
            },
          },
          bookings: {
            where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
            select: {
              paperworkRequests: { select: { id: true } },
              items: {
                select: {
                  status: true,
                  // Vehicle scope — a truck can be held on the reservation
                  // with no order line for it yet.
                  category: { select: { department: true } },
                  catalogItem: { select: { department: true } },
                  assignments: {
                    select: { status: true, _count: { select: { driverAssignments: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!order) return { ok: false, error: 'order not found', status: 404 }

  // Partner lines are not ours to pull (partnerLines.ts) — same filter the sheet applies.
  const pickable = order.lineItems.filter((li) => isPickableLine(li) && !isPartnerLineIn(li, order.lineItems))
  const recipients = await recipientsForPullOrder()
  const added = await addedAfterPullForOrder(orderId)

  return {
    ok: true,
    preview: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      companyName: order.company.name,
      jobId: order.job?.id ?? null,
      jobCode: order.job?.jobCode ?? null,
      jobName: order.job?.name ?? null,
      startDate: order.startDate,
      endDate: order.endDate,
      deliveryRequested: order.deliveryRequested,
      pickableCount: pickable.length,
      warehouseLineCount: pickable.filter((li) => li.fulfillmentLane === 'WAREHOUSE').length,
      addedSincePull: added.gear,
      ...jobReadiness(order.job),
      recipientCount: recipients.length,
      lastSentAt: order.pickList?.releasedAt ?? null,
      lastSentBy: order.pickList?.releasedBy?.name ?? order.pickList?.releasedBy?.email ?? null,
      pullSheetHref: `/api/orders/${order.id}/pick-list-pdf`,
    },
  }
}

/**
 * The five readiness checks for the order's JOB, computed exactly as
 * the /jobs board and the day-before digest compute them — same
 * computeReadiness, same shared rollupCoiState. A job-less order
 * (legacy) reports ready with no blockers rather than five false ones.
 */
function jobReadiness(
  job: {
    coiChecks: {
      humanDecision: string
      policyExpiryDate: Date | null
      coverageVerified: boolean
      decidedWithVehicles?: boolean | null
      aiResponse?: unknown
    }[]
    orders: {
      status?: string | null
      signedAgreements: { contractType: string; status: string; coveredByAgreementId: string | null }[]
      lineItems?: {
        type?: string | null
        department?: string | null
        fulfillmentLane?: string | null
        assetCategory?: { department?: string | null } | null
        inventoryItem?: { department?: string | null } | null
      }[]
    }[]
    bookings: {
      paperworkRequests: { id: string }[]
      items: {
        status: string
        category?: { department?: string | null } | null
        catalogItem?: { department?: string | null } | null
        assignments: { status: string; _count: { driverAssignments: number } }[]
      }[]
    }[]
  } | null,
): { blockers: string[]; ready: boolean } {
  if (!job) return { blockers: [], ready: true }

  // Newest FULL certificate — workers' comp on its own is not the COI.
  const coi = newestFullCoi(job.coiChecks)
  // A certificate approved for a gear-only job does not cover a truck someone
  // added since. This is the last gate before the pull sheet leaves for the
  // warehouse, so it is exactly where that has to bite.
  const coiState = coi
    ? rollupCoiState({ ...coi, jobHasVehicles: deriveVehicleScope(job).hasVehicles }).state
    : 'NONE'

  const liveOrderCount = job.orders.length
  const allAgreements = job.orders.flatMap((o) => o.signedAgreements)
  const agreementState = (rows: typeof allAgreements) => {
    if (rows.length === 0) return 'NONE' as const
    const signed = rows.filter(
      (r) => isSignedAgreementStatus(r.status as never) || !!r.coveredByAgreementId,
    ).length
    return signed === rows.length && rows.length >= liveOrderCount ? ('SIGNED' as const) : ('NONE' as const)
  }
  const rentalRows = allAgreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT')
  const stageRows = allAgreements.filter((a) => a.contractType === 'STAGE_CONTRACT')

  const liveItems = job.bookings.flatMap((b) =>
    b.items.filter((it) => it.status === 'REQUESTED' || it.status === 'ASSIGNED'),
  )
  const activeAssignments = liveItems.flatMap((it) =>
    it.assignments.filter((a) => a.status === 'ASSIGNED' || a.status === 'CHECKED_OUT'),
  )

  const readiness = computeReadiness({
    coi: coiState,
    rental: agreementState(rentalRows),
    stage: stageRows.length > 0 ? agreementState(stageRows) : null,
    cardOnFile: job.bookings.some((b) => b.paperworkRequests.length > 0),
    gear: { total: liveItems.length, assigned: liveItems.filter((it) => it.status === 'ASSIGNED').length },
    drivers: { units: activeAssignments.length, named: activeAssignments.filter((a) => a._count.driverAssignments > 0).length },
  })
  return { blockers: readiness.blockers.map((b) => b.label), ready: readiness.ready }
}

/** Find-or-create the order's PickList and file a PickListItem for
 *  every warehouse line missing one.
 *
 *  The backfill matters: lines added BEFORE the lane router ran (a
 *  quote built and then approved) carry fulfillmentLane null, and
 *  bookOrder is what normally stamps them. Releasing pre-book must not
 *  hand the floor a list with three of the eleven lines on it. */
async function ensurePickList(
  tx: TxClient,
  orderId: string,
): Promise<{ pickListId: string; created: boolean; itemsAdded: number }> {
  const existing = await tx.pickList.findUnique({ where: { orderId }, select: { id: true } })
  const pickListId =
    existing?.id ??
    (await tx.pickList.create({ data: { orderId, status: 'DRAFT' }, select: { id: true } })).id

  // Warehouse-routed lines with no PickListItem yet. `pickListItem` is
  // unique on orderLineItemId, so `is: null` is the whole test.
  const orphans = await tx.orderLineItem.findMany({
    where: { orderId, fulfillmentLane: 'WAREHOUSE', pickListItem: { is: null } },
    select: { id: true },
  })
  if (orphans.length > 0) {
    await tx.pickListItem.createMany({
      data: orphans.map((o) => ({ pickListId, orderLineItemId: o.id })),
      skipDuplicates: true,
    })
  }
  return { pickListId, created: !existing, itemsAdded: orphans.length }
}

export interface SendPullOrderResult {
  ok: boolean
  orderNumber: string
  pickListId: string
  resent: boolean
  itemsAdded: number
  recipients: number
  emailSent: boolean
  emailReason?: string
  /** False when the sheet could not be rendered — the email still went,
   *  carrying the link. The operator is told, because "the sheet is
   *  attached" is the one promise this feature makes. */
  sheetAttached: boolean
  blockers: string[]
}

/**
 * Perform the release. `note` is the rep's message to the floor.
 *
 * The stamp is committed BEFORE the email goes out, deliberately: a
 * Resend hiccup must not leave the floor unable to see a list the rep
 * was told they sent. A failed email is reported back and the operator
 * can re-send.
 */
export async function sendPullOrderToWarehouse(args: {
  orderId: string
  userId: string
  userName: string | null
  note: string | null
  ipAddress: string | null
}): Promise<{ ok: false; error: string; status: number } | { ok: true; result: SendPullOrderResult }> {
  const pre = await previewPullOrder(args.orderId)
  if (!pre.ok) return pre
  const { preview } = pre

  if (preview.pickableCount === 0) {
    return { ok: false, error: 'This order has nothing to pull — every line is a fee, discount or labor.', status: 400 }
  }

  const resent = preview.lastSentAt != null
  const note = args.note?.trim() || null

  const { pickListId, itemsAdded } = await prisma.$transaction(async (tx) => {
    const ensured = await ensurePickList(tx, args.orderId)
    await tx.pickList.update({
      where: { id: ensured.pickListId },
      data: { releasedAt: new Date(), releasedById: args.userId, releaseNote: note },
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        ipAddress: args.ipAddress,
        action: 'picklist.released_to_warehouse',
        entityType: 'PickList',
        entityId: ensured.pickListId,
        newValues: {
          orderId: args.orderId,
          orderNumber: preview.orderNumber,
          resent,
          note,
          itemsBackfilled: ensured.itemsAdded,
          blockers: preview.blockers,
        },
      },
    })
    return ensured
  })

  const to = await recipientsForPullOrder()
  if (to.length === 0) {
    return {
      ok: true,
      result: {
        ok: true, orderNumber: preview.orderNumber, pickListId, resent, itemsAdded,
        recipients: 0, emailSent: false, sheetAttached: false,
        emailReason: 'The Warehouse pull orders channel has no recipients (Admin → Notifications). The list is on the picking floor.',
        blockers: preview.blockers,
      },
    }
  }

  // The sheet itself. Rendered AFTER the stamp is committed: a render
  // failure must not cost the floor its visibility on /warehouse/pick,
  // and the email still carries the live link.
  const rendered = await renderPickListPdf(args.orderId)
  if (!rendered.ok) {
    console.error(`[sendPullOrder] pull sheet render failed for ${preview.orderNumber}: ${rendered.error}`)
  }
  // Gear added since the floor pulled this order is its OWN sheet, and it
  // goes first (Wes, 2026-09-18: the add has to reach the warehouse as if
  // it were a new order). The full sheet still rides along as the
  // reference for what is already on the truck.
  const addedCount = preview.addedSincePull.length
  const addedSheet = addedCount > 0 ? await renderPickListPdf(args.orderId, { addedOnly: true }) : null
  if (addedSheet && !addedSheet.ok) {
    console.error(`[sendPullOrder] added-gear sheet render failed for ${preview.orderNumber}: ${addedSheet.error}`)
  }
  const attachmentList = [
    ...(addedSheet?.ok ? [{ filename: `${addedSheet.result.stem}.pdf`, content: addedSheet.result.pdf }] : []),
    ...(rendered.ok ? [{ filename: `${rendered.result.stem}.pdf`, content: rendered.result.pdf }] : []),
  ]
  const attachments = attachmentList.length > 0 ? attachmentList : undefined
  const addedList = preview.addedSincePull
    .map((l) => `${l.quantity} \u00d7 ${l.description}`)
    .join(', ')

  const who = args.userName || 'A rep'
  const jobLine = preview.jobName
    ? `${preview.jobName}${preview.jobCode ? ` (${preview.jobCode})` : ''}`
    : '—'
  const window =
    preview.startDate && preview.endDate && preview.startDate.getTime() !== preview.endDate.getTime()
      ? `${dayLabel(preview.startDate)} → ${dayLabel(preview.endDate)}`
      : dayLabel(preview.startDate)

  const heading = addedCount > 0
    ? `Added gear to pull — ${preview.orderNumber}`
    : resent
      ? `Updated pull order — ${preview.orderNumber}`
      : `Pull order — ${preview.orderNumber}`

  const bodyHtml =
    p(
      addedCount > 0
        ? `<strong>${esc(who)}</strong> added ${addedCount} line${addedCount === 1 ? '' : 's'} to an order this floor has already pulled. ` +
            `Treat ${addedCount === 1 ? 'it' : 'them'} as a new pull — the rest of the order is out.`
        : `<strong>${esc(who)}</strong> sent this pull order to the warehouse${resent ? ' again — it has changed since the last sheet, so pull from THIS one' : ''}.`,
    ) +
    (addedCount > 0
      ? calloutBox(
          `<strong>Still to pull:</strong> ${esc(addedList)}.<br/>` +
            `The first attachment is a sheet for just ${addedCount === 1 ? 'this line' : 'these lines'}` +
            ` — <a href="${HQ_APP_URL}${preview.pullSheetHref}?added=1">print it here</a>.`,
        )
      : '') +
    detailTable([
      { label: 'Order', value: preview.orderNumber },
      { label: 'Client', value: preview.companyName },
      { label: 'Job', value: jobLine },
      { label: 'Pick up', value: window },
      { label: 'Out', value: preview.deliveryRequested ? 'Delivery' : 'Will call' },
      { label: 'Lines', value: `${preview.pickableCount} to pull` },
    ]) +
    (note ? calloutBox(`<strong>From ${esc(who)}:</strong><br/>${esc(note)}`) : '') +
    p(
      attachments
        ? `<strong>The pull sheet is attached</strong> — print it and pull from it. ` +
            `<a href="${HQ_APP_URL}${preview.pullSheetHref}">Open the live sheet in HQ</a>` +
            ` &nbsp;·&nbsp; <a href="${HQ_APP_URL}/warehouse/pick">Picking floor</a>`
        : `<a href="${HQ_APP_URL}${preview.pullSheetHref}" style="font-weight:700;">Print the pull sheet — ${esc(preview.orderNumber)}</a>` +
            ` &nbsp;·&nbsp; <a href="${HQ_APP_URL}/warehouse/pick">Picking floor</a>`,
    ) +
    // Blockers ride along NAMED rather than blocking the send — same
    // call the day-before digest makes. The floor pulling gear nobody
    // announced is the worse failure.
    (preview.blockers.length > 0
      ? calloutBox(
          `<strong>Paperwork still outstanding on this job:</strong> ${esc(preview.blockers.join(', '))}.<br/>` +
            `Pull it, but it does not leave the yard until these clear — ` +
            (preview.jobId
              ? `<a href="${HQ_APP_URL}/jobs/${preview.jobId}">open the job</a>`
              : 'check with the rep') +
            '.',
        )
      : '')

  const text = renderEmailText([
    heading,
    '',
    `Sent by: ${who}`,
    `Client: ${preview.companyName}`,
    `Job: ${jobLine}`,
    `Pick up: ${window}`,
    `Out: ${preview.deliveryRequested ? 'Delivery' : 'Will call'}`,
    `Lines: ${preview.pickableCount} to pull`,
    ...(addedCount > 0
      ? [
          '',
          `ADDED SINCE THIS ORDER WAS PULLED — still to pull: ${addedList}`,
          `Sheet for just those lines: ${HQ_APP_URL}${preview.pullSheetHref}?added=1`,
        ]
      : []),
    ...(note ? ['', `From ${who}: ${note}`] : []),
    '',
    attachments ? 'The pull sheet is attached as a PDF — print it and pull from it.' : '',
    `Live sheet in HQ: ${HQ_APP_URL}${preview.pullSheetHref}`,
    `Picking floor: ${HQ_APP_URL}/warehouse/pick`,
    ...(preview.blockers.length > 0
      ? ['', `Paperwork still outstanding: ${preview.blockers.join(', ')} — pull it, but it does not leave the yard until these clear.`]
      : []),
  ])

  const sent = await sendAgreementEmail({
    to,
    subject: addedCount > 0
      ? `Added gear to pull: ${preview.orderNumber} — ${preview.companyName} · ${addedCount} new line${addedCount === 1 ? '' : 's'}`
      : `${resent ? 'Updated pull order' : 'Pull order'}: ${preview.orderNumber} — ${preview.companyName} · out ${dayLabel(preview.startDate)}`,
    html: renderEmailShell({
      heading,
      eyebrow: 'Warehouse',
      preheader: addedCount > 0
        ? `${addedCount} line${addedCount === 1 ? '' : 's'} added after this order was pulled · ${addedList}`
        : `${preview.pickableCount} lines · out ${dayLabel(preview.startDate)}${preview.blockers.length ? ` · ${preview.blockers.join(', ')} outstanding` : ''}`,
      bodyHtml,
      footNote:
        'Sent from the order in HQ. The attached sheet is a snapshot — the link above is always current. ' +
        'Recipients are managed at HQ → Admin → Notifications (Warehouse pull orders).',
    }),
    text,
    attachments,
    label: 'orders/send-to-warehouse',
    orderId: args.orderId,
  })

  return {
    ok: true,
    result: {
      ok: true,
      orderNumber: preview.orderNumber,
      pickListId,
      resent,
      itemsAdded,
      recipients: to.length,
      emailSent: sent.ok,
      sheetAttached: !!attachments,
      emailReason: sent.ok ? undefined : sent.reason,
      blockers: preview.blockers,
    },
  }
}
