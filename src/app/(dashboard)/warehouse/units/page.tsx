/**
 * /warehouse/units — "where is this walkie?"
 *
 * A scan box and an answer. The register row (RW's description, serial,
 * shelf, what it costs to replace) plus HQ's own record: the order it is
 * out on right now, and its recent trips through the check-out desk.
 * Barcode phase 3 — the read side of tracking high-value units.
 *
 * Light-shell chrome like /yard; the yard door because it is the same
 * crew, and a unit's whereabouts is not a sales question.
 */

import { Lock } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { UnitLookup } from '@/components/warehouse/UnitLookup'
import { PrintBarcodesButton } from '@/components/warehouse/PrintBarcodesButton'

export const dynamic = 'force-dynamic'

export default async function WarehouseUnitsPage() {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-lg font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-sm">Unit lookups are for fleet and warehouse staff.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-1 py-2">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-amber-700 text-xs font-semibold uppercase tracking-wide mb-1">Warehouse</div>
          <h1 className="text-lt-fg text-2xl font-bold">Find a unit</h1>
          <p className="text-lt-fg2 text-sm mt-0.5">
            Scan a label to see what it is, which order it is out on, and where it has been.
          </p>
        </div>
        <PrintBarcodesButton className="flex-none mt-1" />
      </header>
      <UnitLookup />
    </div>
  )
}
