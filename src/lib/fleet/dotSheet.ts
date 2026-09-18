/**
 * DOT info sheet — gather + render. Phase 2, made self-refreshing 2026-09-17.
 *
 * Sources every field from the Asset DOT columns + the latest BitInspection
 * (max inspectionDate) — the CANONICAL BIT, NOT the legacy
 * bitCertificateUrl/bitCertificateExpiresAt. One page per assigned VEHICLE
 * unit on THIS ORDER.
 *
 * DOWNLOADS RENDER FRESH (renderDotSheet below). The stored blob is no longer
 * on the read path, so a unit swapped after a rep pressed publish cannot go
 * on being named in the client's PDF. See dotSheetPublish.ts for why that
 * beat calling generate from every assignment write path.
 *
 * `generateAndStoreDotSheet` remains for the explicit "publish anyway"
 * override: what it really records is `dotSheetGeneratedAt`, a human's
 * decision to send an incomplete record. The PDF it uploads is an artifact of
 * what was approved, not what gets served.
 */
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { DotSheetDocument, type DotUnit } from '@/lib/fleet/DotSheetDocument'
import { narrowAssignmentsToOrder } from '@/lib/fleet/vehicleDocs'
import { dotSheetState, missingDotFields, type DotSheetState } from '@/lib/fleet/dotSheetPublish'

export interface DotSheetResult {
  ok: boolean
  reason?: string
  units: DotUnit[]
  /** Units that are missing at least one DOT field (for the pre-send warning). */
  incompleteUnits: { unitName: string; missing: string[] }[]
  pdfUrl?: string
  generatedAt?: Date
}

const toIso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)

/**
 * Assemble the per-unit DOT data for an order's assigned vehicle units.
 *
 * `alsoOwnOrderIds` is the order a portal session FOLLOWED OFF (a rebuilt,
 * cancelled order whose link the client still holds) — those are their trucks
 * too. Staff callers pass nothing.
 */
export async function gatherDotUnits(orderId: string, alsoOwnOrderIds: readonly (string | null | undefined)[] = []): Promise<{
  company: string | null
  jobName: string | null
  jobCode: string | null
  bookingId: string | null
  units: DotUnit[]
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { bookingId: true, company: { select: { name: true } }, job: { select: { name: true, jobCode: true } } },
  })
  const base = { company: order?.company?.name ?? null, jobName: order?.job?.name ?? null, jobCode: order?.job?.jobCode ?? null, bookingId: order?.bookingId ?? null, units: [] as DotUnit[] }
  if (!order?.bookingId) return base

  // The booking is JOB-level (holdOnQuoteSend appends to the job's newest
  // one), so a raw booking scope puts a SIBLING ORDER'S trucks on this
  // order's sheet — the same leak the client portal fixed on 2026-09-15
  // (Wrong Number, SR-JOB-0273). It was never fixed here: until now a
  // two-order job handed the client a DOT page for a van that is not theirs,
  // with somebody else's plate on it. Narrowed with the portal's own rule.
  const onBooking = await prisma.bookingAssignment.findMany({
    where: {
      bookingItem: { bookingId: order.bookingId },
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      asset: { category: { department: 'VEHICLES' } },
    },
    select: {
      orderId: true,
      asset: {
        select: {
          id: true, unitName: true, year: true, make: true, model: true, vin: true, licensePlate: true,
          category: { select: { name: true } },
          bitInspections: { orderBy: { inspectionDate: 'desc' }, take: 1, select: { inspectionDate: true } },
        },
      },
    },
  })
  const assignments = narrowAssignmentsToOrder(onBooking, [orderId, ...alsoOwnOrderIds])

  // Dedupe by asset id (a unit could in theory be assigned to >1 item).
  const seen = new Set<string>()
  const units: DotUnit[] = []
  for (const { asset } of assignments) {
    if (seen.has(asset.id)) continue
    seen.add(asset.id)
    const latestBitDate = toIso(asset.bitInspections[0]?.inspectionDate)
    const missing = missingDotFields({ ...asset, hasBitInspection: !!latestBitDate })
    units.push({
      unitName: asset.unitName,
      categoryName: asset.category.name,
      year: asset.year, make: asset.make, model: asset.model, vin: asset.vin, licensePlate: asset.licensePlate,
      latestBitDate, missing,
    })
  }
  units.sort((a, b) => a.unitName.localeCompare(b.unitName, undefined, { numeric: true }))
  return { ...base, units }
}

/** Generate the combined DOT packet, upload to private blob, store on the Order. */
export async function generateAndStoreDotSheet(orderId: string): Promise<DotSheetResult> {
  const { company, jobName, jobCode, units } = await gatherDotUnits(orderId)
  if (units.length === 0) {
    return { ok: false, reason: 'No assigned vehicle units on this order — assign units first.', units: [], incompleteUnits: [] }
  }

  const generatedAt = new Date()
  const buffer = await renderDotSheet({ company, jobName, jobCode, units, generatedAt })

  const { fileUrl, blobKey } = await uploadPrivateImage({
    keyPrefix: 'dot-sheets',
    ownerId: orderId,
    filename: `DOT-${jobCode ?? orderId}.pdf`,
    contentType: 'application/pdf',
    data: Buffer.from(buffer),
  })

  await prisma.order.update({
    where: { id: orderId },
    data: { dotSheetPdfKey: blobKey, dotSheetPdfUrl: fileUrl, dotSheetGeneratedAt: generatedAt },
  })

  const incompleteUnits = units.filter((u) => u.missing.length > 0).map((u) => ({ unitName: u.unitName, missing: u.missing }))
  return { ok: true, units, incompleteUnits, pdfUrl: fileUrl, generatedAt }
}

/** Render the PDF bytes. No DB, no blob — the download routes stream this. */
export async function renderDotSheet(args: {
  company: string | null
  jobName: string | null
  jobCode: string | null
  units: DotUnit[]
  generatedAt?: Date
}): Promise<Buffer> {
  const buffer = await renderToBuffer(
    React.createElement(DotSheetDocument, {
      companyName: args.company,
      jobName: args.jobName,
      jobCode: args.jobCode,
      // The stamp says when this COPY was made, which under fresh rendering
      // is now. That is the honest reading: the page in the client's hand
      // describes the trucks as of the moment they pulled it.
      generatedAt: args.generatedAt ?? new Date(),
      units: args.units,
    }) as React.ReactElement<DocumentProps>,
  )
  return Buffer.from(buffer)
}

export interface DotSheetForOrder {
  state: DotSheetState
  company: string | null
  jobName: string | null
  jobCode: string | null
  units: DotUnit[]
}

/**
 * Everything a reader needs about an order's DOT sheet, decided now: which
 * units are on it, what they are missing, and whether the client may have it.
 *
 * ONE call for every surface — the portal payload, the portal download, the
 * staff readiness check and the action item — so the desk can never be told
 * the sheet is withheld while the client is being offered it.
 */
export async function dotSheetForOrder(
  orderId: string,
  alsoOwnOrderIds: readonly (string | null | undefined)[] = [],
  /** Pass Order.dotSheetGeneratedAt when you already hold it (the portal
   *  payload does) — it saves a round trip on a hot path. */
  publishedAt?: Date | null,
): Promise<DotSheetForOrder> {
  const [gathered, order] = await Promise.all([
    gatherDotUnits(orderId, alsoOwnOrderIds),
    publishedAt === undefined
      ? prisma.order.findUnique({ where: { id: orderId }, select: { dotSheetGeneratedAt: true } })
      : Promise.resolve({ dotSheetGeneratedAt: publishedAt }),
  ])
  const state = dotSheetState({
    unitCount: gathered.units.length,
    gaps: gathered.units.map((u) => ({ unitName: u.unitName, missing: u.missing })),
    publishedAt: order?.dotSheetGeneratedAt ?? null,
  })
  return { state, company: gathered.company, jobName: gathered.jobName, jobCode: gathered.jobCode, units: gathered.units }
}

/**
 * `dotSheetState` for MANY orders in a fixed number of queries.
 *
 * The action-item provider runs on every /jobs landing render, so calling
 * dotSheetForOrder in a loop would have put three queries per candidate order
 * — around 360 — on that page. This is four, whatever the list length.
 *
 * Only the STATE is returned: nothing here renders, and the unit rows are not
 * carried out, because the caller only needs to know which orders are stuck
 * and on what.
 */
export async function dotSheetStatesForOrders(
  orders: readonly { id: string; bookingId: string | null; dotSheetGeneratedAt: Date | null }[],
): Promise<Map<string, DotSheetState>> {
  const out = new Map<string, DotSheetState>()
  const withBooking = orders.filter((o) => o.bookingId)
  for (const o of orders) {
    if (!o.bookingId) out.set(o.id, dotSheetState({ unitCount: 0, gaps: [], publishedAt: o.dotSheetGeneratedAt }))
  }
  if (withBooking.length === 0) return out

  const bookingIds = [...new Set(withBooking.map((o) => o.bookingId as string))]
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      bookingItem: { bookingId: { in: bookingIds } },
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      asset: { category: { department: 'VEHICLES' } },
    },
    select: {
      orderId: true,
      bookingItem: { select: { bookingId: true } },
      asset: { select: { id: true, unitName: true, year: true, make: true, vin: true, licensePlate: true } },
    },
  })

  // One groupBy for every unit's newest BIT, rather than a take:1 subquery per
  // assignment (the same shape /api/fleet uses for its at-a-glance column).
  const assetIds = [...new Set(rows.map((r) => r.asset.id))]
  const bits = assetIds.length
    ? await prisma.bitInspection.groupBy({ by: ['assetId'], where: { assetId: { in: assetIds } }, _max: { inspectionDate: true } })
    : []
  const hasBit = new Set(bits.filter((b) => b._max.inspectionDate).map((b) => b.assetId))

  const byBooking = new Map<string, typeof rows>()
  for (const r of rows) {
    const b = r.bookingItem.bookingId
    const list = byBooking.get(b)
    if (list) list.push(r)
    else byBooking.set(b, [r])
  }

  for (const o of withBooking) {
    // Same narrowing as the sheet itself — a sibling order's trucks are not
    // this order's gaps, and counting them would raise an item nobody here
    // can clear.
    const mine = narrowAssignmentsToOrder(byBooking.get(o.bookingId as string) ?? [], [o.id])
    const seen = new Set<string>()
    const gaps: { unitName: string; missing: string[] }[] = []
    let unitCount = 0
    for (const { asset } of mine) {
      if (seen.has(asset.id)) continue
      seen.add(asset.id)
      unitCount++
      const missing = missingDotFields({ ...asset, hasBitInspection: hasBit.has(asset.id) })
      if (missing.length) gaps.push({ unitName: asset.unitName, missing })
    }
    out.set(o.id, dotSheetState({ unitCount, gaps, publishedAt: o.dotSheetGeneratedAt }))
  }
  return out
}
