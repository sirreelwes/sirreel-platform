/**
 * GET /api/picklists — warehouse picking queue.
 *
 * Returns PickLists in non-terminal states (DRAFT, PICKING,
 * READY_TO_STAGE, STAGED) sorted by the order's pickup date ascending
 * — oldest pickup first so the floor view always shows what's
 * physically next. LOADED and CANCELLED lists are excluded from the
 * default queue; query ?includeTerminal=1 to surface them too.
 *
 * Per-list payload is compact: counts of pick statuses + order
 * context. Full item lists are fetched separately via /[id]/route.ts.
 *
 * Role-gated to ADMIN | MANAGER via requirePickerRole.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'

export const dynamic = 'force-dynamic'

const OPEN_STATES = ['DRAFT', 'PICKING', 'READY_TO_STAGE', 'STAGED'] as const
const ALL_STATES = [...OPEN_STATES, 'LOADED', 'CANCELLED'] as const

export async function GET(req: NextRequest) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const includeTerminal = req.nextUrl.searchParams.get('includeTerminal') === '1'
  const statuses = includeTerminal ? ALL_STATES : OPEN_STATES

  const rows = await prisma.pickList.findMany({
    where: { status: { in: [...statuses] } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      assignedTo: { select: { id: true, name: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          startDate: true,
          endDate: true,
          company: { select: { id: true, name: true } },
          job: { select: { id: true, jobCode: true, name: true } },
        },
      },
      items: {
        select: {
          orderLineItem: { select: { pickStatus: true } },
        },
      },
    },
    orderBy: [
      // NULLS LAST is the Postgres default for ascending, which keeps
      // dateless orders at the bottom of the queue rather than the top.
      { order: { startDate: 'asc' } },
      { createdAt: 'asc' },
    ],
  })

  const picklists = rows.map((r) => {
    const counts = { PENDING_PICK: 0, PICKED: 0, STAGED: 0, LOADED: 0 }
    for (const i of r.items) {
      const s = i.orderLineItem.pickStatus
      if (s && s in counts) counts[s as keyof typeof counts] += 1
    }
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      assignedTo: r.assignedTo,
      order: r.order,
      itemCount: r.items.length,
      counts,
    }
  })

  return NextResponse.json({ picklists })
}
