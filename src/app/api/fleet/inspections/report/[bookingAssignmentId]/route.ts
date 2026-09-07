/**
 * GET /api/fleet/inspections/report/[bookingAssignmentId] — the
 * check-out / check-in condition report as a PDF.
 *
 * Rendered on demand and streamed, never stored: the report is a view
 * of the two inspections, and a stored copy goes stale the moment
 * anyone adds a photo or re-triages a damage row. Same call the send
 * path would make, so what Wes reviews here IS what a client would get.
 *
 * Photos are private blobs; their bytes are pulled server-side, turned
 * upright and downscaled (lib/fleet/reportPhoto — the phone's EXIF
 * rotation is not something PDFKit honours, and the originals weigh
 * 3–5 MB each), then embedded. That is the only way the PDF can be
 * self-contained — the /api/fleet/photos proxy needs an HQ session,
 * which a client will never have.
 *
 * Internal and session-gated. Nothing here sends anything: see
 * inspectionReportSendingEnabled in lib/fleet/inspectionReport.
 */

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { buildInspectionReport } from '@/lib/fleet/inspectionReport'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { ConditionReportDocument, type PhotoData } from '@/lib/fleet/ConditionReportDocument'
import { preparePhotoForReport, mapWithLimit } from '@/lib/fleet/reportPhoto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Params = { params: Promise<{ bookingAssignmentId: string }> }

// A full walk-around is 7 shots each end plus close-ups. The cap keeps
// one pathological assignment from timing the route out; anything past
// it renders as "unavailable" rather than failing the whole document.
const MAX_PHOTOS = 40
// Decoding a phone JPEG needs ~50 MB of working memory. Four at a time
// keeps a full walk-around comfortably inside the function's budget.
const PREPARE_CONCURRENCY = 4

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response

  const { bookingAssignmentId } = await params
  const report = await buildInspectionReport(bookingAssignmentId)
  if (!report) return NextResponse.json({ error: 'booking assignment not found' }, { status: 404 })
  if (!report.out && !report.back) {
    return NextResponse.json({ error: 'no inspections on this assignment yet' }, { status: 404 })
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
        select: { id: true, fileUrl: true },
      })
    : []

  // A photo that can't be read or decoded is simply absent from the
  // map and prints as "could not be printed". One bad blob must not
  // cost the whole report.
  const photoData: PhotoData = {}
  await mapWithLimit(rows, PREPARE_CONCURRENCY, async (r) => {
    const buf = await readPrivateBlobBuffer(r.fileUrl)
    if (!buf) return
    const prepared = await preparePhotoForReport(buf)
    if (prepared) photoData[r.id] = prepared.data
  })

  const buffer = await renderToBuffer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(ConditionReportDocument, { report, photoData }) as any,
  )

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="condition-report-${report.unitName.replace(/[^\w.-]/g, '_')}-${report.bookingNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
