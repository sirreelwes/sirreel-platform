/**
 * GET /api/drive/[token]/condition-report — the driver's own copy of the
 * vehicle's condition report, as a PDF, on their phone.
 *
 * Wes, 2026-09-17, on Julian's blind-pickup process ("Damage ID, fill out
 * the vehicle checkout sheet, leave a copy of the checkout sheet inside
 * the assigned vehicle"): "I think we should give the drivers a link to
 * the PDF checkout … it would be much better for them to have it on
 * their phone."
 *
 * This REPLACES the paper copy left in the cab, and it is the same
 * document the yard reads — `buildInspectionReport` +
 * `ConditionReportDocument`, rendered identically to the staff route at
 * /api/fleet/inspections/report/[bookingAssignmentId]. One renderer, so
 * the driver's copy cannot drift from the record it is a copy of.
 *
 * NO LOGIN: the token is the credential, exactly as everywhere else
 * under /api/drive. Scoped to the ONE vehicle that token was minted for
 * — a driver on another job sees nothing here.
 *
 * Three things this must never carry, and does not:
 *   · the DRIVER'S LICENCE photo — `buildInspectionReport` filters
 *     DRIVERS_LICENSE out of every side, deliberately (see its header);
 *   · the lockbox or gate CODE — the report has never carried
 *     `Asset.accessCode`, and codes reach a driver only through the
 *     earned-and-unlocked path on the page itself;
 *   · anyone else's rental — the token resolves to one assignment.
 *
 * It is NOT the client-facing send. `inspectionReportSendingEnabled()`
 * stays dark and is not consulted here: that gate is about EMAILING the
 * renter a report, which is a different act from handing the person
 * driving the truck the sheet that used to sit on its passenger seat.
 */

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { buildInspectionReport } from '@/lib/fleet/inspectionReport'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { ConditionReportDocument, type PhotoData } from '@/lib/fleet/ConditionReportDocument'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Matches the staff route: one pathological assignment must not time the
// render out. Anything past the cap prints as "unavailable" rather than
// failing the whole document.
const MAX_PHOTOS = 40

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: { id: true, status: true, expiresAt: true, bookingAssignmentId: true },
  })
  if (!da) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (da.expiresAt && da.expiresAt < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }
  if (da.status === 'CANCELLED') {
    return NextResponse.json({ error: 'this assignment was cancelled' }, { status: 409 })
  }

  const report = await buildInspectionReport(da.bookingAssignmentId)
  if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!report.out && !report.back) {
    // Nothing has been walked around yet. The page hides the link in this
    // state; say it plainly for anyone who kept an old one.
    return NextResponse.json({ error: 'no walk-around has been filed for this vehicle yet' }, { status: 404 })
  }

  const wanted = [
    ...report.pairs.flatMap((p) => [p.out, p.back]),
    ...report.damagePhotos.out,
    ...report.damagePhotos.back,
    ...report.unpositioned.out,
    ...report.unpositioned.back,
  ]
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, MAX_PHOTOS)

  const rows = wanted.length
    ? await prisma.inspectionPhoto.findMany({
        where: { id: { in: wanted.map((p) => p.id) } },
        select: { id: true, fileUrl: true, contentType: true },
      })
    : []

  // Fetched in parallel; a photo that cannot be read is simply absent
  // from the map and prints as "unavailable". One unreachable blob must
  // not cost the driver the whole sheet.
  const photoData: PhotoData = {}
  await Promise.all(
    rows.map(async (r) => {
      const buf = await readPrivateBlobBuffer(r.fileUrl)
      if (!buf) return
      photoData[r.id] = `data:${r.contentType || 'image/jpeg'};base64,${buf.toString('base64')}`
    }),
  )

  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(ConditionReportDocument, { report, photoData }) as any,
  )

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // Inline: a phone opens it in the browser's viewer, which is what
      // "have it on their phone" means. Saving is one tap from there.
      'Content-Disposition': `inline; filename="condition-${report.unitName.replace(/[^\w.-]/g, '_')}-${report.bookingNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
