/**
 * DOT info sheet — gather + render + store. Phase 2.
 *
 * Sources every field from the Asset DOT columns + the latest BitInspection
 * (max inspectionDate) — the CANONICAL BIT, NOT the legacy
 * bitCertificateUrl/bitCertificateExpiresAt. One combined PDF, one page per
 * assigned VEHICLE unit on the order's booking. Uploaded to PRIVATE blob and
 * stored on the Order; served only through the gated proxy.
 */
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { DotSheetDocument, type DotUnit } from '@/lib/fleet/DotSheetDocument'

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

/** Assemble the per-unit DOT data for an order's assigned vehicle units. */
export async function gatherDotUnits(orderId: string): Promise<{
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

  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      bookingItem: { bookingId: order.bookingId },
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      asset: { category: { department: 'VEHICLES' } },
    },
    select: {
      asset: {
        select: {
          id: true, unitName: true, year: true, make: true, model: true, vin: true, licensePlate: true,
          category: { select: { name: true } },
          bitInspections: { orderBy: { inspectionDate: 'desc' }, take: 1, select: { inspectionDate: true } },
        },
      },
    },
  })

  // Dedupe by asset id (a unit could in theory be assigned to >1 item).
  const seen = new Set<string>()
  const units: DotUnit[] = []
  for (const { asset } of assignments) {
    if (seen.has(asset.id)) continue
    seen.add(asset.id)
    const latestBitDate = toIso(asset.bitInspections[0]?.inspectionDate)
    const missing: string[] = []
    if (!asset.vin) missing.push('VIN')
    if (!asset.licensePlate) missing.push('license plate')
    if (!asset.year) missing.push('year')
    if (!asset.make) missing.push('make')
    if (!latestBitDate) missing.push('BIT inspection')
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
  const buffer = await renderToBuffer(
    React.createElement(DotSheetDocument, { companyName: company, jobName, jobCode, generatedAt, units }) as React.ReactElement<DocumentProps>,
  )

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
