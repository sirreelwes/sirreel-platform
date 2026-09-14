'use client'

/**
 * The red flag on an order line — "the warehouse changed this at pickup".
 *
 * Oliver, 2026-09-13: "on RW when they add or swap something, we can see
 * a little red flag by the item on the order to denote this item was
 * added or swapped by warehouse at the time of pickup. The client
 * doesn't see this red flag, nor should they."
 *
 * Staff-only by construction: the data reaches the page through
 * GET /api/orders/[id], which the middleware gates to an HQ session.
 * Nothing here is rendered by the quote PDF, the job portal or any
 * client email — those build their lines from the order's own rows and
 * know nothing about check reports. Do not lift this into a shared
 * line-row component without re-checking that.
 *
 * The chip states the change in the SAME sentence the agent's flag, the
 * audit row and the client's corrected quote were written from
 * (describeCheckChange) — the warehouse's own words, so an agent
 * reading the order and an agent reading the alert see one story.
 */

import { Flag } from 'lucide-react'
import type { WarehouseLineFlag as Flagged, WarehouseAddedLine } from '@/lib/orders/warehouseLineFlags'

function filedOn(filedAt: string): string {
  const d = new Date(filedAt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
}

/** One line's flag. Renders nothing when the warehouse left it alone,
 *  which is almost every line on almost every order. */
export function WarehouseLineFlag({
  flag,
  filedAt,
  preppedBy,
}: {
  flag: Flagged | undefined
  filedAt: string
  preppedBy: string | null
}) {
  if (!flag) return null
  const who = preppedBy ? ` by ${preppedBy}` : ''
  return (
    <span
      title={`Warehouse, ${filedOn(filedAt)}${who}: ${flag.detail}${flag.note ? ` — "${flag.note}"` : ''}`}
      className={`ml-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-middle text-[10px] font-semibold ${
        // An unpriced line is not a note about history — it is money
        // sitting at zero and an invoice that will not cut. It gets the
        // solid treatment so it reads as a to-do, not a footnote.
        flag.unpriced
          ? 'bg-chip-bad-fg text-white'
          : 'bg-chip-bad-bg border border-chip-bad-fg/30 text-chip-bad-fg'
      }`}
    >
      <Flag size={10} aria-hidden />
      {flag.label}
    </span>
  )
}

/**
 * Rows the warehouse wrote in that were never on the order.
 *
 * They are deliberately NOT order lines — the yard cannot see rates and
 * a $0 line would under-bill the job, so the agent prices them by hand
 * (see lib/orders/checkReports.ts). Which is exactly why they belong on
 * screen next to the lines rather than only inside the action item: the
 * gear went out on the truck, and until someone prices it the order is
 * the only place anybody would think to look for it.
 */
export function WarehouseAddedLines({
  added,
  filedAt,
  preppedBy,
}: {
  added: WarehouseAddedLine[]
  filedAt: string
  preppedBy: string | null
}) {
  if (added.length === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg px-3 py-2.5">
      <p className="flex items-start gap-2 text-[13px] font-semibold text-chip-bad-fg">
        <Flag size={13} aria-hidden className="mt-0.5 flex-none" />
        <span>
          Added at the warehouse{preppedBy ? ` by ${preppedBy}` : ''} on {filedOn(filedAt)} — not on
          the order, and not billed until someone prices it.
        </span>
      </p>
      <ul className="mt-1.5 ml-[21px] space-y-0.5">
        {added.map((a, i) => (
          <li key={i} className="text-[13px] text-lt-fg">
            <span className="font-semibold">{a.quantity}×</span> {a.description}
            {a.note ? <span className="text-lt-fg2"> — {a.note}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 ml-[21px] text-[12px] text-lt-fg2">
        The client never sees this. Sheets filed from 14 Sep put written-in gear straight onto the
        order; these came in before that, so add them as lines to bill them.
      </p>
    </div>
  )
}

/**
 * The order cannot be invoiced while this is up.
 *
 * Warehouse-added lines land unpriced when the floor could not name the
 * item off the catalog (lib/orders/warehouseAddedLines.ts). That is the
 * deliberate trade that let the 2026-09-03 refusal be lifted: the gear
 * reaches the order and the driver's paperwork, and the money stops
 * until a person looks at it. So this banner has to say what is stuck
 * and what unsticks it, not merely that something is wrong.
 */
export function UnpricedLinesBanner({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="rounded-lg border border-chip-bad-fg/40 bg-chip-bad-bg px-3 py-2.5">
      <p className="flex items-start gap-2 text-[13px] font-semibold text-chip-bad-fg">
        <Flag size={13} aria-hidden className="mt-0.5 flex-none" />
        <span>
          {count === 1 ? 'One line has' : `${count} lines have`} no price. The warehouse added{' '}
          {count === 1 ? 'it' : 'them'} at check-out and couldn&rsquo;t name{' '}
          {count === 1 ? 'it' : 'them'} from the catalog.
        </span>
      </p>
      <p className="mt-1 ml-[21px] text-[12px] text-lt-fg2">
        This order can&rsquo;t be invoiced, and the client isn&rsquo;t sent a corrected quote, until{' '}
        {count === 1 ? 'it has a rate' : 'they have rates'} — edit the flagged{' '}
        {count === 1 ? 'line' : 'lines'} below and set the price.
      </p>
    </div>
  )
}

/** Re-exported so the order page types the payload without importing a
 *  module that pulls in prisma. Type-only, so it is erased at build. */
export type { OrderWarehouseFlags } from '@/lib/orders/warehouseLineFlags'
