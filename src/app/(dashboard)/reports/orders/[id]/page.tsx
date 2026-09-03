/**
 * /reports/orders/[id]?edge=OUT|IN — the report itself.
 *
 * A thin server shell (the yard gate + the draft) around the form. Same
 * split as the rest of the yard surfaces: the gate runs here so a
 * refused visitor never gets the data, and the typing happens client-side.
 */

import { Lock } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { reportDraft } from '@/lib/orders/checkReports'
import { CheckReportForm } from '@/components/reports/CheckReportForm'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edge?: string }>
}

export default async function OrderCheckReportPage({ params, searchParams }: Props) {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-zinc-500" />
        <h1 className="text-white text-lg font-semibold mb-2">Yard access required</h1>
        <p className="text-zinc-400 text-sm">Check in/out reports are for fleet and warehouse staff.</p>
      </div>
    )
  }

  const { id } = await params
  const sp = await searchParams
  // Default to the check-OUT sheet: it is the one with consequences, and
  // it is what a supervisor is holding when they sit down.
  const edge = sp.edge === 'IN' ? 'IN' : 'OUT'
  const draft = await reportDraft(id, edge)

  if (!draft) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <h1 className="text-white text-lg font-semibold mb-2">Order not found</h1>
        <p className="text-zinc-400 text-sm">It may have been deleted since this list was drawn.</p>
      </div>
    )
  }

  return <CheckReportForm draft={draft} />
}
