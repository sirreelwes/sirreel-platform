/**
 * One pay period — the full grid, and the status transitions.
 *
 * The grid is computed by src/lib/payroll/period.ts, the same function the
 * CSV export reads, so the screen an admin locks and the file ADP receives
 * cannot disagree.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePayrollAccess } from '@/lib/payroll/access'
import { loadPeriodGrid } from '@/lib/payroll/period'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const grid = await loadPeriodGrid(params.id)
  if (!grid) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(grid)
}

/**
 * Status transitions. Only these three moves exist:
 *
 *   DRAFT → LOCKED     numbers agreed, grid goes read-only
 *   LOCKED → DRAFT     unlock to fix something found late
 *   EXPORTED → DRAFT   reopen after export — allowed, but it means the CSV
 *                      already handed to ADP is now stale, so the caller has
 *                      to pass reopen:true and the reason lands in the note.
 *
 * DRAFT → EXPORTED is NOT here. Export is the act of downloading the file;
 * marking a period exported without producing one would claim ADP has numbers
 * it never received. That transition lives in the export route.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await requirePayrollAccess()
  if (me instanceof NextResponse) return me

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const period = await prisma.payPeriod.findUnique({ where: { id: params.id } })
  if (!period) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const next = String(body.status ?? '')

  if (next === 'LOCKED') {
    if (period.status !== 'DRAFT') {
      return NextResponse.json({ error: `cannot lock a ${period.status} period` }, { status: 409 })
    }
    await prisma.payPeriod.update({
      where: { id: period.id },
      data: { status: 'LOCKED', lockedAt: new Date(), lockedById: me.id },
    })
  } else if (next === 'DRAFT') {
    if (period.status === 'EXPORTED' && !body.reopen) {
      return NextResponse.json({
        error: 'this period was already exported to ADP — reopening makes that file stale. Pass reopen:true to confirm.',
      }, { status: 409 })
    }
    await prisma.payPeriod.update({
      where: { id: period.id },
      data: {
        status: 'DRAFT',
        lockedAt: null, lockedById: null,
        // The export stamp is deliberately KEPT. "This was exported on the
        // 3rd and reopened on the 5th" is the fact an admin needs when ADP
        // and HQ disagree; clearing it would erase the reason they differ.
      },
    })
  } else if (typeof body.note === 'string') {
    // Note-only edit — allowed in any status; it is commentary, not numbers.
    await prisma.payPeriod.update({ where: { id: period.id }, data: { note: body.note || null } })
  } else {
    return NextResponse.json({ error: 'unsupported transition' }, { status: 400 })
  }

  const grid = await loadPeriodGrid(params.id)
  return NextResponse.json(grid)
}
