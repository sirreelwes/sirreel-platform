/**
 * WHICH DAYS a unit is bound for.
 *
 * A hold is a category line on a booking; an assignment is one truck on
 * specific days. Those days have been wrong twice now, each time because
 * the window was taken from something WIDER than what was quoted:
 *
 *   · the BOOKING ENVELOPE spans every order on the job (fixed in
 *     b5799955 — a truck was held Sep 22 → Oct 10 to cover three days);
 *   · the ORDER SPAN covers every line on that order, and one order
 *     routinely carries two date blocks of the same class;
 *   · ANOTHER WEEK ENTIRELY — the days the job's previous order was
 *     quoted for. Oliver, 2026-09-18, put Cargo 22 on a fresh 9/18
 *     reservation for KPDH Multi Block 2 (SR-2026-0449) and the van
 *     came out on 9/18 in the job's reservation window but nowhere on
 *     the board: the only other order on that job was S260914-021,
 *     already out on 9/15, and with no cargo line to read the resolver
 *     handed back THAT order's span. The van was bound to three days
 *     earlier — a bar in the past on a reservation for today.
 *
 * Oliver, 2026-09-14, on ADV Carrera (SR-2026-0387): "HQ won't let me
 * assign pass 2 on 9/29 - 9/30 because pass 2 returns on 9/28. Client
 * specifically requested two 12-pass vans on 9/29 - 9/30." He was right.
 * The order S260914-001 quotes a passenger van from 9/28 AND two more
 * from 9/29, so the ORDER span is 9/28 → 9/30 — and the write checked
 * Pass 2 against 9/28, the day it comes home from the VMA Shoot. The
 * picker beside it checked the HOLD window (9/29 → 9/30) and rendered
 * the same van "tight", so the modal and the button disagreed about the
 * same truck on the same screen.
 *
 * PURE — no I/O, so the rule is testable on its own
 * (`npm run test:assign-window`). The lines it reads come from
 * `quotedLines.ts`.
 *
 * The truth is narrower than both: a unit is bound for the DATE BLOCK it
 * is filling — one distinct pickup → return pair off the quoted lines.
 * This module resolves that block and nothing else does; both the picker
 * (what states it shows) and the write (what it checks and what it
 * stamps) call it, so they cannot drift apart again.
 *
 * And narrower in one more way: the ORDER has to be about the hold. An
 * order that covers the hold's days speaks for it, second and third date
 * blocks included — NECTARHOUSE S3 quotes a cube 9/18 → 9/19 and another
 * 9/24 → 9/25 on one order, and Cube 32 is rightly on both even though
 * the booking envelope stops at the 19th. An order that does NOT reach
 * the hold is a different rental of the same job, and its blocks are not
 * this hold's to fill; with nothing quoted for these days the hold's own
 * window is the answer. An agent may still NAME any block the order
 * covers (`requested`) — this is only about what gets picked FOR them.
 */
import { toCalendarDateString } from '@/lib/dates/calendarDate'

export interface DateWindow {
  start: Date
  end: Date
}

/** One distinct pickup → return pair quoted against a class, and how
 *  many units of it that block asks for. */
export interface QuotedBlock extends DateWindow {
  quantity: number
}

export type WindowSource =
  /** The caller named the days — the block the agent picked in the
   *  modal, or the line that was just added to the order. */
  | 'requested'
  /** The only block quoted against this class. */
  | 'block'
  /** Several blocks; this is the one still short of units. */
  | 'block-open'
  /** No lines to read — the order's span, clamped to the hold. */
  | 'overlap'
  /** Nothing quoted for these days — the hold's own window. */
  | 'hold'

export interface ResolvedWindow extends DateWindow {
  source: WindowSource
}

export interface AssignmentSpan {
  startDate: Date
  endDate: Date
}

const sameDay = (a: Date, b: Date): boolean => a.getTime() === b.getTime()

export function windowsOverlap(a: DateWindow, b: DateWindow): boolean {
  return a.start <= b.end && a.end >= b.start
}

/** Distinct date blocks across the quoted lines, earliest first. Lines
 *  that share a pickup AND a return are one block of the summed
 *  quantity — three vans on the same days is one decision, not three. */
export function quotedBlocks(
  lines: { pickupDate: Date | string | null; returnDate: Date | string | null; quantity: number }[],
): QuotedBlock[] {
  const byKey = new Map<string, QuotedBlock>()
  for (const l of lines) {
    if (!l.pickupDate || !l.returnDate) continue
    const start = l.pickupDate instanceof Date ? l.pickupDate : new Date(l.pickupDate)
    const end = l.returnDate instanceof Date ? l.returnDate : new Date(l.returnDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue
    const key = `${toCalendarDateString(start)}|${toCalendarDateString(end)}`
    const existing = byKey.get(key)
    if (existing) existing.quantity += Math.max(0, Math.floor(l.quantity))
    else byKey.set(key, { start, end, quantity: Math.max(0, Math.floor(l.quantity)) })
  }
  return [...byKey.values()].sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime())
}

/**
 * How many live units already cover a block.
 *
 * Counted by EXACT window match, not overlap. Every assignment this
 * module stamps takes its block's days verbatim, so an exact match is
 * the only unambiguous answer to "which block is this truck filling?" —
 * and overlap is actively wrong here: on ADV Carrera the 9/28 → 9/30 van
 * overlaps the 9/29 → 9/30 block too, which would have read that block
 * as full and refused Oliver a second time by another route.
 */
export function coverageOfBlock(block: DateWindow, assignments: AssignmentSpan[]): number {
  return assignments.filter((a) => sameDay(a.startDate, block.start) && sameDay(a.endDate, block.end)).length
}

export interface BlockCapacity {
  /** Units this block asks for — the quoted count when the window IS a
   *  quoted block, the hold's own quantity otherwise. */
  quantity: number
  assignedCount: number
  remaining: number
  /** The quoted block the window landed on, or null when none matches. */
  block: QuotedBlock | null
}

/**
 * HOW MANY units a window has, and how many it still wants — ONE rule for
 * the picker and the write.
 *
 * Jose, 2026-09-17, on Mad Minds (SR-JOB-0389): changing Cargo 35 for
 * another van was refused with "booking item is fully assigned". The
 * picker in front of him counted EXACT-DAY coverage against the QUOTED
 * quantity (the ADV Carrera rule above), while the write counted every
 * OVERLAPPING assignment against the hold's own quantity. Two answers to
 * "is this block full?" on one screen: the picker offered a plain assign
 * or a swap on its numbers, and the server refused on its own.
 *
 * When the window is a quoted block, the block's quantity and exact
 * coverage are the truth — that is what the quote sold and what the
 * picker shows. With no quoted lines to read (a bare hold, a gantt drag
 * on an order with no vehicle line) there is no block to be exact
 * against, so it falls back to the hold's quantity and overlap, which is
 * all either side ever had there.
 */
export function blockCapacity(args: {
  window: DateWindow
  blocks?: QuotedBlock[]
  assignments?: AssignmentSpan[]
  itemQuantity: number
}): BlockCapacity {
  const assignments = args.assignments ?? []
  // A block quoting ZERO units (a line zeroed out but not removed) is no
  // block to count against — it would read every window as full.
  const block =
    (args.blocks ?? []).find(
      (b) => b.quantity > 0 && sameDay(b.start, args.window.start) && sameDay(b.end, args.window.end),
    ) ?? null
  const quantity = block ? block.quantity : Math.max(0, Math.floor(args.itemQuantity))
  const assignedCount = block
    ? coverageOfBlock(block, assignments)
    : assignments.filter((a) => windowsOverlap({ start: a.startDate, end: a.endDate }, args.window)).length
  return { quantity, assignedCount, remaining: Math.max(0, quantity - assignedCount), block }
}

/**
 * WHICH ORDER a hold's unit goes out on, when nobody named one.
 *
 * "The job has exactly one order, so that's the one" is only true of a
 * job that runs for a week. A job that runs for months carries an order
 * per block, and its earlier one is just as alone on the job while being
 * finished, invoiced and gone. The order that speaks for a hold is one
 * whose days TOUCH it; several that do is an ambiguity the agent
 * resolves, not the server (Oliver, 2026-09-18 — see the header).
 *
 * Windows come from `deriveOrderWindow`; an order with no dates at all
 * says nothing about any hold and is skipped.
 */
export function soleOrderCoveringHold(
  candidates: { id: string; start: Date | null; end: Date | null }[],
  hold: DateWindow,
): string | null {
  const covering = candidates.filter(
    (c) => c.start && c.end && windowsOverlap({ start: c.start, end: c.end }, hold),
  )
  return covering.length === 1 ? covering[0].id : null
}

export interface ResolveArgs {
  /** The hold's own window — the booking envelope. Always present. */
  hold: DateWindow
  /** This order's span (earliest line pickup → latest line return). */
  orderWindow?: { start: Date | null; end: Date | null } | null
  /** Blocks quoted against this class on that order. */
  blocks?: QuotedBlock[]
  /** Live assignments already on the hold, for the "still short" pick. */
  assignments?: AssignmentSpan[]
  /** Days the caller explicitly asked for. Honoured when it falls inside
   *  what the order and the hold together cover — a picker choice or the
   *  line being added, never an arbitrary range from an API client. */
  requested?: { start: Date | null; end: Date | null } | null
}

export function resolveAssignWindow(args: ResolveArgs): ResolvedWindow {
  const hold = args.hold
  const orderStart = args.orderWindow?.start ?? null
  const orderEnd = args.orderWindow?.end ?? null
  const blocks = args.blocks ?? []
  const assignments = args.assignments ?? []

  // Everything the order and the hold between them cover. A requested
  // window has to live inside this; the 9/28 block on ADV Carrera sits
  // outside the HOLD (9/29 → 9/30) but inside the order, and is real.
  const envelopeStart = new Date(Math.min(hold.start.getTime(), orderStart?.getTime() ?? hold.start.getTime()))
  const envelopeEnd = new Date(Math.max(hold.end.getTime(), orderEnd?.getTime() ?? hold.end.getTime()))

  const req = args.requested
  if (req?.start && req?.end && req.start <= req.end) {
    if (req.start >= envelopeStart && req.end <= envelopeEnd) {
      return { start: req.start, end: req.end, source: 'requested' }
    }
  }

  // Blocks the resolver may pick on its own. All of them when the order
  // they were read off reaches the hold — a second block on that order
  // is the same reservation's next leg. Otherwise only blocks that touch
  // the hold themselves, which is none of them when the lines belong to
  // another week's order: that is how Cargo 22 landed on 9/15 for a 9/18
  // hold.
  const orderReachesHold = !!orderStart && !!orderEnd && windowsOverlap({ start: orderStart, end: orderEnd }, hold)
  const onHold = orderReachesHold ? blocks : blocks.filter((b) => windowsOverlap(b, hold))

  if (onHold.length === 1) {
    return { start: onHold[0].start, end: onHold[0].end, source: 'block' }
  }

  if (onHold.length > 1) {
    // The earliest block that still wants a unit. Ties and legacy rows
    // (stamped with an order span that matches no block) leave the
    // earliest block looking short, which is the conservative guess.
    const open = onHold.find((b) => coverageOfBlock(b, assignments) < b.quantity)
    if (open) return { start: open.start, end: open.end, source: 'block-open' }
  }

  // No lines to read for these days: the order's span clamped to the
  // hold, so a shared booking's other orders can't drag this one wide.
  if (orderStart && orderEnd) {
    const orderWindow = { start: orderStart, end: orderEnd }
    if (windowsOverlap(orderWindow, hold)) {
      return {
        start: new Date(Math.max(orderStart.getTime(), hold.start.getTime())),
        end: new Date(Math.min(orderEnd.getTime(), hold.end.getTime())),
        source: 'overlap',
      }
    }
  }

  // The order says nothing about these days — an order for another week,
  // or no order at all. The hold is then the only thing that does.
  return { start: hold.start, end: hold.end, source: 'hold' }
}
