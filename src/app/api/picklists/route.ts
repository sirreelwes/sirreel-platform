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

// LOADED and CHECKING_IN are OPEN, not terminal. They used to be the
// end of the line — the gear was on the truck and the warehouse was
// done thinking about it. The inbound pass starts from LOADED, so a
// list parked there is work the queue still owes: hiding it behind
// ?includeTerminal=1 would make check-in unreachable from the floor.
const OPEN_STATES = ['DRAFT', 'PICKING', 'READY_TO_STAGE', 'STAGED', 'LOADED', 'CHECKING_IN'] as const
const ALL_STATES = [...OPEN_STATES, 'CHECKED_IN', 'CANCELLED'] as const

// The picking floor is a POST-BOOK surface — a PickList is meant to be
// minted at book time (see the schema note on the model). But
// syncPickListOnLineAdd files one on every warehouse line add
// "regardless of order status", so quotes and approved-but-unbooked
// orders were growing lists too: on 2026-09-01, 19 of the 20 open lists
// belonged to orders nobody had booked, including DRAFT quotes. The
// warehouse was being shown work that does not exist yet.
//
// Gated on order STATUS, not bookedAt — one legitimately booked order
// carries a null bookedAt, and hiding a real list is the worse error.
//
// The OR on `releasedAt` is the escape hatch (Wes 2026-09-09): a rep
// who explicitly sends the pull order to the warehouse gets the list on
// the floor whatever the order status, because they said so. It cannot
// reflood the queue the way the old status-blind rule did — a stamp per
// order, put there by a person. See lib/warehouse/sendPullOrder.ts.
const BOOKED_ORDER_STATES = [
  'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED',
] as const

export async function GET(req: NextRequest) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const includeTerminal = req.nextUrl.searchParams.get('includeTerminal') === '1'
  const statuses = includeTerminal ? ALL_STATES : OPEN_STATES

  const rows = await prisma.pickList.findMany({
    where: {
      status: { in: [...statuses] },
      OR: [
        { order: { status: { in: [...BOOKED_ORDER_STATES] } } },
        { releasedAt: { not: null } },
      ],
      // A cancelled order has nothing to pull no matter who released it.
      order: { status: { not: 'CANCELLED' } },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      releasedAt: true,
      releaseNote: true,
      releasedBy: { select: { id: true, name: true } },
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
    // Pickup date stays the primary sort — the floor works the day, not
    // the inbox. A release is surfaced by its badge on the row, not by
    // jumping the queue.
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
      releasedAt: r.releasedAt,
      releaseNote: r.releaseNote,
      releasedBy: r.releasedBy,
      assignedTo: r.assignedTo,
      order: r.order,
      itemCount: r.items.length,
      counts,
    }
  })

  return NextResponse.json({ picklists })
}
