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
 *     routinely carries two date blocks of the same class.
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
  | 'order'
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

  if (blocks.length === 1) {
    return { start: blocks[0].start, end: blocks[0].end, source: 'block' }
  }

  if (blocks.length > 1) {
    // The earliest block that still wants a unit. Ties and legacy rows
    // (stamped with an order span that matches no block) leave the
    // earliest block looking short, which is the conservative guess.
    const open = blocks.find((b) => coverageOfBlock(b, assignments) < b.quantity)
    if (open) return { start: open.start, end: open.end, source: 'block-open' }
  }

  // No lines to read: the order's span clamped to the hold, so a shared
  // booking's other orders can't drag this one wide.
  if (orderStart && orderEnd) {
    const orderWindow = { start: orderStart, end: orderEnd }
    if (windowsOverlap(orderWindow, hold)) {
      return {
        start: new Date(Math.max(orderStart.getTime(), hold.start.getTime())),
        end: new Date(Math.min(orderEnd.getTime(), hold.end.getTime())),
        source: 'overlap',
      }
    }
    return { start: orderStart, end: orderEnd, source: 'order' }
  }

  return { start: hold.start, end: hold.end, source: 'hold' }
}
