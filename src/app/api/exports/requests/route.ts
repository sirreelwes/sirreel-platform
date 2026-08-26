/**
 * GET  /api/exports/requests — the queue.
 *        Approver sees every request; everyone else sees only their own.
 * POST /api/exports/requests — ask for a client-list CSV.
 *
 * Wes's rule (2026-08-26): exporting proprietary data requires HIS approval.
 * POST therefore never returns data — it returns a PENDING row. The CSV only
 * exists at the download endpoint, and only after a decision.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  requireExportRequester,
} from '@/lib/exports/requireExportApprover'
import { EXPORT_APPROVAL_TTL_HOURS } from '@/lib/exports/approver'
import {
  normalizeFilters,
  countClientRows,
  describeFilters,
  type ClientListFilters,
} from '@/lib/exports/clientListCsv'
import { effectiveStatus } from '@/lib/exports/requestStatus'
import { notifyExportApprover } from '@/lib/exports/notifyApprover'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const SELECT = {
  id: true,
  kind: true,
  status: true,
  reason: true,
  filters: true,
  rowCountAtRequest: true,
  requestedAt: true,
  decidedAt: true,
  decisionNote: true,
  expiresAt: true,
  downloadCount: true,
  firstDownloadedAt: true,
  lastDownloadedAt: true,
  rowCountDelivered: true,
  requestedBy: { select: { id: true, name: true, email: true } },
  decidedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DataExportRequestSelect

export async function GET() {
  const guard = await requireExportRequester()
  if (!guard.ok) return guard.response
  const { user } = guard

  const rows = await prisma.dataExportRequest.findMany({
    // Non-approvers see ONLY their own requests. Another agent's export
    // reason is not theirs to read.
    where: user.isApprover ? {} : { requestedById: user.id },
    orderBy: [{ requestedAt: 'desc' }],
    take: 200,
    select: SELECT,
  })

  return NextResponse.json({
    isApprover: user.isApprover,
    requests: rows.map((r) => ({
      ...r,
      status: effectiveStatus(r),
      scopeLabel: describeFilters((r.filters ?? {}) as ClientListFilters),
      // Only the requester (or the approver) can act on a row, and only
      // while the approval window is open.
      canDownload:
        effectiveStatus(r) === 'APPROVED' || effectiveStatus(r) === 'FULFILLED',
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireExportRequester()
  if (!guard.ok) return guard.response
  const { user } = guard

  let payload: Record<string, unknown> = {}
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
  if (reason.length < 10) {
    return NextResponse.json(
      { error: 'A reason of at least 10 characters is required.' },
      { status: 400 },
    )
  }
  if (reason.length > 2000) {
    return NextResponse.json({ error: 'Reason is too long.' }, { status: 400 })
  }

  const filters = normalizeFilters(payload.filters)
  const rowCount = await countClientRows(filters)

  // The approver requesting his own export IS the approval — he is the sole
  // approver, so requiring a second party would make it impossible for Wes to
  // ever export. Recorded explicitly (decidedBy = himself, note says so)
  // rather than silently, so the audit trail never implies a review that
  // didn't happen. No other identity can reach this branch.
  const selfApproved = user.isApprover
  const now = new Date()

  const created = await prisma.dataExportRequest.create({
    data: {
      kind: 'CLIENT_LIST',
      reason,
      filters: filters as unknown as Prisma.InputJsonValue,
      rowCountAtRequest: rowCount,
      requestedById: user.id,
      ...(selfApproved
        ? {
            status: 'APPROVED' as const,
            decidedById: user.id,
            decidedAt: now,
            decisionNote: 'Auto-approved — requested by the export approver.',
            expiresAt: new Date(
              now.getTime() + EXPORT_APPROVAL_TTL_HOURS * 3_600_000,
            ),
          }
        : {}),
    },
    select: SELECT,
  })

  if (!selfApproved) {
    notifyExportApprover({
      requestId: created.id,
      requesterName: user.name,
      requesterEmail: user.email,
      scopeLabel: describeFilters(filters),
      rowCount,
      reason,
    })
  }

  return NextResponse.json(
    {
      request: {
        ...created,
        status: effectiveStatus(created),
        scopeLabel: describeFilters(filters),
      },
autoApproved: selfApproved,
    },
    { status: 201 },
  )
}
