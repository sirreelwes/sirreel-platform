/**
 * /warehouse/labels — print our own SR labels.
 *
 * Every label on the gear was printed by RentalWorks; RW is going away
 * and the check-out desk only counts what it can scan. This page mints
 * SR numbers from HQ's block (SR900000+) for new pieces of a catalog
 * item and prints them as Code 39 on Avery-compatible stock, and
 * reprints any label the register knows.
 *
 * Yard door — the same crew that scans them.
 */

import { Lock } from 'lucide-react'
import Link from 'next/link'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { LabelPrinter } from '@/components/warehouse/LabelPrinter'

export const dynamic = 'force-dynamic'

export default async function WarehouseLabelsPage() {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-lg font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-sm">Label printing is for fleet and warehouse staff.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-1 py-2">
      <header className="mb-5">
        <div className="text-amber-700 text-xs font-semibold uppercase tracking-wide mb-1">Warehouse</div>
        <h1 className="text-lt-fg text-2xl font-bold">Print labels</h1>
        <p className="text-lt-fg2 text-sm mt-0.5">
          Give new gear an SR barcode the check-out desk can scan, or reprint a worn one.{' '}
          <Link href="/warehouse/units" className="text-amber-700 hover:text-amber-600 font-semibold">Find a unit</Link> reads them.
        </p>
      </header>
      <LabelPrinter />
    </div>
  )
}
