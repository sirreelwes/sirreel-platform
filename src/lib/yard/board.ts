/**
 * The yard board — ONE list of what the warehouse/fleet crew has to do
 * on a given day, vehicles and gear together.
 *
 * Wes, 2026-09-02: "combine fleet and warehouse into one view. no need
 * to separate." Before this the crew had two homes that never referred
 * to each other: /fleet/today (booking assignments departing/returning,
 * one card per truck) and /warehouse/pick (pick lists, one row per
 * order). A show that takes a 10-ton and three carts of expendables was
 * two unrelated queues on two screens, and nothing on either told you
 * the other half existed.
 *
 * So the unit here is the JOB, not the lane. Every row — truck or cart —
 * is grouped under the show it belongs to, and each row carries the ONE
 * thing it's asking someone to do (inspect it / pick it / count it in).
 * A group is done when every row under it is done.
 *
 * Both sides are read off the same Pacific day:
 *   - vehicles  → BookingAssignment.startDate / .endDate (@db.Date)
 *     via fleetMovementsOn, which is ALSO what the readiness cron reads.
 *     Do not re-derive it here; the two must not drift.
 *   - gear      → PickList → Order.startDate / .endDate (@db.Date).
 *     Those columns are a maintained MIRROR of the line dates
 *     (see syncOrderWindow) — never typed by a person, always current —
 *     so matching a day against them is safe and cheap. Reading line
 *     items instead would mean scanning every line of every open order.
 */

import { prisma } from '@/lib/prisma'
import type { PickListStatus } from '@prisma/client'
import { companyLabel } from '@/lib/scheduling/infoGaps'
import { fleetMovementsOn, pacificYmd, ymdToDbDate, type FleetMovement } from '@/lib/fleet/todayBoard'

export type YardEdge = 'out' | 'back'
export type YardKind = 'VEHICLE' | 'GEAR'

/**
 * How far along a row is, in the shades a person on the floor cares
 * about. `flag` is a row that finished BADLY (a short count) and must
 * not read as done. `info` is a row HQ has no action for — a vehicle
 * due back, since there is no return-side inspection flow yet: it is
 * neither work to do nor work completed, and calling it either would
 * lie. It shows neutral and counts toward neither total.
 */
export type YardState = 'todo' | 'doing' | 'done' | 'flag' | 'info'

export interface YardRow {
  /** BookingAssignment id (VEHICLE) or PickList id (GEAR). */
  id: string
  kind: YardKind
  /** "Unit 0250" / "12 items". The thing itself. */
  title: string
  /** Category for a vehicle, order number for gear. */
  detail: string
  /** Free-text delivery/pickup time off the booking. Gear has none. */
  time: string | null
  /** Where a tap goes — the screen that does the work. */
  href: string
  /** The verb on the button. One action per row, never a menu. */
  action: string
  state: YardState
  stateLabel: string
  /** 0–100 for gear, null for vehicles (an inspection is binary). */
  progress: number | null
}

export interface YardGroup {
  /** jobId when both lanes agree on one; otherwise a name+company key. */
  key: string
  jobName: string
  company: string
  rows: YardRow[]
  /**
   * Every row actually finished. An `info`-only group (a truck due back
   * and nothing else) is NOT done — there was never anything to finish —
   * so it gets neither the green tick nor a to-do count.
   */
  done: boolean
  /** Rows still asking for something. Drives the group's count chip. */
  openCount: number
  /**
   * Rows that finished badly — a short count. Rolled up to the group
   * because the group collapses when nothing is outstanding, and a
   * collapsed "✓ Done" over a two-item shortfall is exactly the lie
   * this board exists to stop telling.
   */
  flagCount: number
}

export interface YardBoard {
  date: string
  out: YardGroup[]
  back: YardGroup[]
}

// A PickList only belongs on the board once its order is actually
// booked. syncPickListOnLineAdd files a list on every warehouse line
// add "regardless of order status", so quotes grow lists too — on
// 2026-09-01, 19 of 20 open lists belonged to orders nobody had booked.
// Same guard as /api/picklists; keep the two in step.
const BOOKED_ORDER_STATES = [
  'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED',
] as const

/** Pick statuses that mean "this line has left the shelf". */
const OUTBOUND_DONE = new Set(['PICKED', 'STAGED', 'LOADED', 'RETURNED', 'SHORT'])
/** Pick statuses that mean "this line has been counted back in". */
const INBOUND_DONE = new Set(['RETURNED', 'SHORT'])

export interface GearList {
  id: string
  status: PickListStatus
  assignedTo: string | null
  orderId: string
  orderNumber: string
  jobId: string | null
  jobName: string
  company: string
  total: number
  outDone: number
  inDone: number
  short: number
}

async function gearListsOn(dbDate: Date, edge: YardEdge): Promise<GearList[]> {
  const rows = await prisma.pickList.findMany({
    where: {
      status: { not: 'CANCELLED' },
      order: {
        status: { in: [...BOOKED_ORDER_STATES] },
        ...(edge === 'out' ? { startDate: dbDate } : { endDate: dbDate }),
      },
    },
    select: {
      id: true,
      status: true,
      assignedTo: { select: { name: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          company: { select: { name: true } },
          job: { select: { id: true, name: true } },
        },
      },
      items: { select: { orderLineItem: { select: { pickStatus: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return rows.map((r) => {
    let outDone = 0
    let inDone = 0
    let short = 0
    for (const i of r.items) {
      const s = i.orderLineItem.pickStatus
      if (!s) continue
      if (OUTBOUND_DONE.has(s)) outDone += 1
      if (INBOUND_DONE.has(s)) inDone += 1
      if (s === 'SHORT') short += 1
    }
    return {
      id: r.id,
      status: r.status,
      assignedTo: r.assignedTo?.name ?? null,
      orderId: r.order.id,
      orderNumber: r.order.orderNumber,
      jobId: r.order.job?.id ?? null,
      jobName: r.order.job?.name || r.order.company.name,
      company: companyLabel(r.order.company?.name),
      total: r.items.length,
      outDone,
      inDone,
      short,
    }
  })
}

const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0)

export function gearRow(g: GearList, edge: YardEdge): YardRow {
  const base = {
    id: g.id,
    kind: 'GEAR' as const,
    title: `${g.total} item${g.total === 1 ? '' : 's'}`,
    detail: g.orderNumber,
    time: null,
    href: `/warehouse/pick/${g.id}`,
  }

  if (edge === 'out') {
    // LOADED and beyond means the gear is on the truck — the outbound
    // pass is finished even though the list itself stays open for the
    // return count.
    const finished = g.status === 'LOADED' || g.status === 'CHECKING_IN' || g.status === 'CHECKED_IN'
    const label: Record<string, string> = {
      DRAFT: 'Not started',
      PICKING: `${g.outDone} of ${g.total} picked`,
      READY_TO_STAGE: 'Picked — stage it',
      STAGED: 'Staged — load it',
    }
    return {
      ...base,
      action: finished ? 'View' : 'Pick',
      state: finished ? 'done' : g.status === 'DRAFT' ? 'todo' : 'doing',
      stateLabel: finished ? 'Loaded' : label[g.status] ?? g.status.replaceAll('_', ' '),
      progress: finished ? 100 : pct(g.outDone, g.total),
    }
  }

  // Inbound. A list that never made it out the door still shows up on
  // its return day — better an odd-looking row than a silent gap.
  if (g.status === 'CHECKED_IN') {
    return {
      ...base,
      action: 'View',
      state: g.short > 0 ? 'flag' : 'done',
      stateLabel: g.short > 0 ? `${g.short} short` : 'All back',
      progress: 100,
    }
  }
  const started = g.status === 'CHECKING_IN'
  return {
    ...base,
    action: 'Count',
    state: started ? 'doing' : 'todo',
    stateLabel: started ? `${g.inDone} of ${g.total} counted` : 'Not counted',
    progress: pct(g.inDone, g.total),
  }
}

/**
 * Group key. Two rows belong together when they share a Job — which is
 * the whole point of merging the lanes, since a booking and an order for
 * the same show both point at one. Bookings predating the Planyo import
 * carry no jobId, so fall back to the name+company pair they DO share.
 */
export const groupKey = (jobId: string | null, jobName: string, company: string) =>
  jobId ? `job:${jobId}` : `name:${jobName.trim().toLowerCase()}|${company.trim().toLowerCase()}`

export interface YardEntry {
  key: string
  jobName: string
  company: string
  row: YardRow
}

export function assemble(rows: YardEntry[]): YardGroup[] {
  const byKey = new Map<string, YardGroup>()
  for (const r of rows) {
    let g = byKey.get(r.key)
    if (!g) {
      g = { key: r.key, jobName: r.jobName, company: r.company, rows: [], done: false, openCount: 0, flagCount: 0 }
      byKey.set(r.key, g)
    }
    g.rows.push(r.row)
  }
  const groups = [...byKey.values()]
  for (const g of groups) {
    // Vehicles first inside a group: a truck that leaves uninspected is
    // the costlier miss, and it's usually the thing with a clock on it.
    g.rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'VEHICLE' ? -1 : 1))
    g.openCount = g.rows.filter((r) => r.state === 'todo' || r.state === 'doing').length
    g.flagCount = g.rows.filter((r) => r.state === 'flag').length
    g.done = g.openCount === 0 && g.rows.every((r) => r.state === 'done' || r.state === 'flag')
  }
  // Work first, then anything merely worth knowing about, then the
  // finished. Within a band, the busiest group leads.
  const band = (g: YardGroup) => (g.openCount > 0 ? 0 : g.done ? 2 : 1)
  return groups.sort((a, b) => {
    if (band(a) !== band(b)) return band(a) - band(b)
    if (b.openCount !== a.openCount) return b.openCount - a.openCount
    return a.jobName.localeCompare(b.jobName)
  })
}

/** One vehicle assignment as a board entry. Exported so the grouping
 *  rules can be tested without a database. */
export function vehicleEntry(m: FleetMovement, edge: YardEdge): YardEntry {
  const inspected = !!m.inspection
  return {
    key: groupKey(m.jobId, m.jobName, m.company),
    jobName: m.jobName || m.company,
    company: m.company,
    row: {
      id: m.assignmentId,
      kind: 'VEHICLE',
      title: `Unit ${m.unitName}`,
      detail: m.category,
      time: edge === 'out' ? m.deliveryTime : m.pickupTime,
      href: `/fleet/inspection/${m.assignmentId}`,
      // Returns have no HQ-side inspection flow yet, so the inbound card
      // is informational and says so rather than pretending there's a
      // walkaround to complete — or, worse, ticking itself green as if
      // someone had received the truck.
      action: edge === 'out' ? (inspected ? 'View' : 'Inspect') : 'View',
      state: edge === 'out' ? (inspected ? 'done' : 'todo') : 'info',
      stateLabel:
        edge === 'out'
          ? inspected
            ? `Inspected${m.inspection?.inspectorName ? ` · ${m.inspection.inspectorName.split(' ')[0]}` : ''}`
            : 'Needs inspection'
          : 'Due back',
      progress: null,
    },
  }
}

/** One pick list as a board entry. Exported for the same reason. */
export function gearEntry(g: GearList, edge: YardEdge): YardEntry {
  return {
    key: groupKey(g.jobId, g.jobName, g.company),
    jobName: g.jobName,
    company: g.company,
    row: gearRow(g, edge),
  }
}

export async function yardBoardFor(ymd: string): Promise<YardBoard> {
  const dbDate = ymdToDbDate(ymd)
  const [vOut, vBack, gOut, gBack] = await Promise.all([
    fleetMovementsOn(dbDate, 'start'),
    fleetMovementsOn(dbDate, 'end'),
    gearListsOn(dbDate, 'out'),
    gearListsOn(dbDate, 'back'),
  ])

  return {
    date: ymd,
    out: assemble([...vOut.map((m) => vehicleEntry(m, 'out')), ...gOut.map((g) => gearEntry(g, 'out'))]),
    back: assemble([...vBack.map((m) => vehicleEntry(m, 'back')), ...gBack.map((g) => gearEntry(g, 'back'))]),
  }
}

export { pacificYmd }
