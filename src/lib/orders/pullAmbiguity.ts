/**
 * A line the warehouse cannot pull from.
 *
 * Wes, 2026-09-14, forwarding the floor: "'10x10 Pop Ups with sides'
 * doesn't work for a pull list. They need to know how many sides."
 *
 * The line he was looking at is order S260904-002 line 2: description
 * "10' x 10' Pop-Ups with Sides", quantity 2, and the catalog row behind
 * it is *Sidewalls, 10x10*. So the order says two of something, the
 * shelf has tents and walls as separate items, and nothing anywhere says
 * eight walls. Two different faults, both invisible until a pull sheet
 * is printed:
 *
 *   1. BUNDLED — the description promises accessories ("with sides")
 *      without a count. The client agreed to a bundle; the floor needs
 *      the pieces.
 *   2. MISCATALOGUED — what the line SAYS (a tent) and the catalog row
 *      it is booked against (an accessory) are different kinds of thing.
 *      Availability, the kit checks and inventory all follow the row, so
 *      this one is also a quietly wrong count on the shelf.
 *
 * PURE and prisma-free so the pull sheet PDF, the check in/out report and
 * anything on the order page read the same answer. It NAMES a question
 * rather than fixing anything: the line carries a rate and a signed
 * quote behind it, and splitting one is the agent's call, not the yard's
 * and not this module's.
 *
 * The four-sides-per-tent number is geometry (a rectangular pop-up has
 * four sides), not a rate table — but it is still phrased as "ask", the
 * way tentSandbags.ts refuses to guess an unlisted size. A crew that
 * pulls three walls because the client wanted an open front is fine; a
 * crew that pulls none is a job on location with no shade.
 */
import { tentRole } from '@/lib/sales/tentFirst'
import { tentFootprint } from '@/lib/sales/tentSandbags'

export type PullGapKind = 'BUNDLED_SIDES' | 'MISCATALOGUED'

export interface PullGap {
  kind: PullGapKind
  /** One sentence for whoever is holding the sheet. */
  message: string
}

export interface PullLine {
  description: string
  quantity: number
  /** The catalog row's own name, when the line is bound to one. */
  catalogName?: string | null
}

/** Sides on a rectangular pop-up. Geometry, not a price list. */
export const SIDES_PER_TENT = 4

/**
 * "with sides" and its spellings — but only when no count rides along.
 * "10x10 pop-up with 4 sides" already answers the question, and a line
 * that answers it must not be flagged.
 */
const SIDES_PROMISED = /\b(?:with|w\/|incl(?:uding|\.)?|plus|and)\s+(?:the\s+)?(sides?|side\s?walls?|walls?)\b/i
const SIDES_COUNTED = /\b(?:with|w\/|incl(?:uding|\.)?|plus|and)\s+(?:the\s+)?\d+\s*(?:x\s*)?(?:sides?|side\s?walls?|walls?)\b/i
/** A line that IS the walls, however it is spelled. */
const IS_SIDES = /\b(sides?|side\s?walls?|walls?)\b/i

const isAccessoryName = (name: string) => tentRole(name) === 'ACCESSORY'
const isShelterName = (name: string) => tentRole(name) === 'SHELTER'

/**
 * What is unanswerable about this line, given the rest of the order.
 * Empty when the sheet can be pulled from as written.
 */
export function pullGapsForLine(line: PullLine, siblings: PullLine[] = []): PullGap[] {
  const gaps: PullGap[] = []
  const desc = line.description ?? ''
  const qty = Math.max(1, Math.floor(line.quantity || 1))

  // ── 1. A bundle with no pieces ──────────────────────────────────
  // Read the HEAD of the description, not the whole of it: "Pop-Ups with
  // Sides" names the accessory in its second half, and tentRole — which
  // exists to stop a sidewall row outranking a tent in search — would
  // call the whole string an accessory. What is being rented is whatever
  // stands before the "with".
  const promise = desc.match(SIDES_PROMISED)
  const head = promise ? desc.slice(0, promise.index ?? 0) : desc
  if (promise && isShelterName(head) && !SIDES_COUNTED.test(desc)) {
    // Somebody may have itemised them on their own line — that is the
    // fix, and a fixed order must not keep nagging.
    const itemised = siblings
      .filter((s) => s !== line)
      .filter((s) => isAccessoryName(s.catalogName || s.description) && IS_SIDES.test(s.catalogName || s.description))
      .reduce((n, s) => n + Math.max(0, Math.floor(s.quantity || 0)), 0)
    if (itemised === 0) {
      const size = tentFootprint(desc)
      const want = qty * SIDES_PER_TENT
      gaps.push({
        kind: 'BUNDLED_SIDES',
        message:
          `Sides are promised here but counted nowhere on the order. ` +
          `${qty} ${size ? `${size} ` : ''}tent${qty === 1 ? '' : 's'} ${qty === 1 ? 'takes' : 'take'} ` +
          `${want} walls at four a tent — check with the agent before pulling.`,
      })
    }
  }

  // ── 2. The row underneath is a different thing ──────────────────
  const catalog = (line.catalogName ?? '').trim()
  if (catalog) {
    if (isShelterName(desc) && isAccessoryName(catalog)) {
      gaps.push({
        kind: 'MISCATALOGUED',
        message:
          `This line reads as a tent but is booked against “${catalog}”, an accessory — ` +
          `so the tent itself is on nobody's list. The agent has to fix the order.`,
      })
    } else if (isAccessoryName(desc) && isShelterName(catalog)) {
      gaps.push({
        kind: 'MISCATALOGUED',
        message:
          `This line reads as an accessory but is booked against “${catalog}”, a tent. ` +
          `The agent has to fix the order before the count means anything.`,
      })
    }
  }

  return gaps
}

/** Every gap on an order, by line index — for the printed sheet. */
export function pullGapsForOrder(lines: PullLine[]): Map<number, PullGap[]> {
  const out = new Map<number, PullGap[]>()
  lines.forEach((l, i) => {
    const gaps = pullGapsForLine(l, lines)
    if (gaps.length) out.set(i, gaps)
  })
  return out
}
