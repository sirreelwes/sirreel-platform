'use client'

/**
 * "Add 6 sandbags?" under a tent line.
 *
 * Wes 2026-09-13: "Whenever we rent tents, we want to offer sandbags. So
 * if someone is using the order form and chooses tents, make sure the
 * sandbags show in the options."
 *
 * An OFFER, not an auto-add. Sandbags are billable, so a line the rep did
 * not ask for is a charge the client did not ask for — and tents get
 * staked instead on some locations. The count is the part a rep should
 * not have to remember, so that is what this computes; pressing the
 * button is still a decision.
 *
 * Renders NOTHING unless there is something to offer: the row has to be a
 * sized tent (src/lib/sales/tentSandbags.ts), the order must not already
 * carry sandbags, and the rep must not have waved it off. Silence is the
 * default state of this component.
 */

import { useEffect, useState } from 'react'
import { sandbagOffer } from '@/lib/sales/tentSandbags'

export interface SandbagCatalogItem {
  id: string
  name: string
  department: string
  dailyRate: number
  weeklyRate: number
  listDailyRate?: number
  listWeeklyRate?: number
  negotiated?: boolean
}

export interface TentSandbagOfferProps {
  /** The line's description — what decides whether this is a tent. */
  tentName: string
  /** The tent line's quantity: three 10x20s need 24 bags, not 8. */
  tentQuantity: number
  /** Prices the offered row off this client's deal — their rate card,
   *  or an item-scoped standing discount that covers sandbags. */
  companyId: string | null
  /** The order already has a sandbag line — don't nag. */
  alreadyOnOrder: boolean
  /** Insert the sandbag line. The parent owns the rows. */
  onAdd: (item: SandbagCatalogItem, quantity: number) => void
}

export function TentSandbagOffer({
  tentName, tentQuantity, companyId, alreadyOnOrder, onAdd,
}: TentSandbagOfferProps) {
  const [dismissed, setDismissed] = useState(false)
  const [item, setItem] = useState<SandbagCatalogItem | null>(null)
  const [added, setAdded] = useState(false)

  const offer = sandbagOffer(tentName, tentQuantity)
  const show = !!offer && !alreadyOnOrder && !dismissed && !added

  // WHICH sandbag row is a catalog question, so it is resolved server-side
  // (/api/catalog/tent-sandbags). Fetched only once an offer is actually
  // on screen — typing through the tents in the dropdown must not fire a
  // request per keystroke.
  useEffect(() => {
    if (!show || item) return
    let cancelled = false
    const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
    fetch(`/api/catalog/tent-sandbags${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.item) setItem(data.item as SandbagCatalogItem) })
      .catch(() => { /* no offer beats a broken row */ })
    return () => { cancelled = true }
  }, [show, item, companyId])

  // No offer, or the catalog has no sandbag to offer — render nothing at
  // all rather than a strip that cannot do anything.
  if (!show || !item) return null

  const bags = offer!.total
  const each = offer!.perTent

  return (
    <div className="px-3 pb-2 -mt-1">
      <div className="flex flex-wrap items-center gap-2 rounded border border-lt-hairline bg-chip-neutral-bg px-2.5 py-1.5">
        <span className="text-xs text-chip-neutral-fg">
          Tents need ballast — <strong className="font-semibold">{each} sandbags per {offer!.size} tent</strong>
          {bags !== each && <> · {bags} for this line</>}
        </span>
        <button
          type="button"
          onClick={() => { onAdd(item, bags); setAdded(true) }}
          className="text-xs font-semibold px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white"
        >
          Add {bags} {item.name}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs text-lt-fg3 hover:text-lt-fg2 px-1"
          aria-label="Dismiss sandbag suggestion"
        >
          Not needed
        </button>
      </div>
    </div>
  )
}
