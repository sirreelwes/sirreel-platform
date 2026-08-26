/**
 * GET /api/exports/requests/[id]/download — serve an APPROVED client-list CSV.
 *
 * This is the only place proprietary client data leaves the app as a file, so
 * every condition is re-checked here rather than trusted from the UI:
 *
 *   1. Authenticated, and either the original requester or the approver.
 *      NOT "anyone with the link" — there is deliberately no bearer token,
 *      because a token in a URL is forwardable to someone Wes never approved.
 *   2. Status is APPROVED/FULFILLED and the window has not closed
 *      (effectiveStatus derives EXPIRED from expiresAt on read).
 *   3. The CSV is rebuilt from the SNAPSHOTTED filters, never from query
 *      params on this request — otherwise an approval for "tier NEW" could be
 *      spent on the entire book.
 *
 * Re-download stays legal until expiry so a failed transfer isn't a new
 * approval; every hit increments downloadCount.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireExportRequester } from '@/lib/exports/requireExportApprover'
import { buildClientListCsv, type ClientListFilters } from '@/lib/exports/clientListCsv'
import { effectiveStatus, isDownloadable } from '@/lib/exports/requestStatus'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await requireExportRequester()
  if (!guard.ok) return guard.response
  const { user } = guard

  const reqRow = await prisma.dataExportRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      kind: true,
      status: true,
      expiresAt: true,
      filters: true,
      requestedById: true,
      requestedAt: true,
    },
  })
  if (!reqRow) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // Ownership: the requester, or the approver overseeing it. A third agent
  // with a copied URL gets a 404 — not a 403, which would confirm the
  // request exists.
  if (reqRow.requestedById !== user.id && !user.isApprover) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const status = effectiveStatus(reqRow)
  if (!isDownloadable(reqRow)) {
    return NextResponse.json(
      {
        error:
          status === 'PENDING'
            ? 'This export is still waiting on approval from Wes.'
            : status === 'DENIED'
              ? 'This export request was denied.'
              : status === 'EXPIRED'
                ? 'This approval has expired. Request the export again.'
                : `Export is ${status}.`,
        status,
      },
      { status: 403 },
    )
  }

  const filters = (reqRow.filters ?? {}) as ClientListFilters
  const { csv, rowCount } = await buildClientListCsv(filters)

  const now = new Date()
  await prisma.dataExportRequest.update({
    where: { id: reqRow.id },
    data: {
      status: 'FULFILLED',
      downloadCount: { increment: 1 },
      firstDownloadedAt: reqRow.status === 'FULFILLED' ? undefined : now,
      lastDownloadedAt: now,
      rowCountDelivered: rowCount,
    },
  })

  const stamp = now.toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sirreel-clients-${stamp}.csv"`,
      // Never let a proxy or the browser retain the book of business.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
