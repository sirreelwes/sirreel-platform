/** Bookings — both sources, upcoming first, past folded below. */
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadBookings } from '@/lib/hq-white-label/data'
import type { HqBooking } from '@/lib/hq-white-label/data'
import { fmtRange, todayPacific } from '@/lib/hq-white-label/dates'
import { CARD, Empty, H2, MUTED, NeedsChip, PAGE, PageHead, SourceChip, StatusChip } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

function Row({ b }: { b: HqBooking }) {
  const inner = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-[#111827]">{b.title}{b.clientName ? <span className="font-normal text-[#6b7280]"> · {b.clientName}</span> : null}</div>
        <div className={MUTED}>{b.quantity > 1 ? `${b.quantity} × ` : ''}{b.vehicleName} · {fmtRange(b.startDate, b.endDate)}{b.callTime ? ` · call ${b.callTime}` : ''}{b.driverName ? ` · ${b.driverName}` : ''}</div>
        {b.needs.length > 0 && <div className="flex flex-wrap gap-1.5 mt-1.5">{b.needs.map((n) => <NeedsChip key={n} text={n} />)}</div>}
      </div>
      <SourceChip source={b.source} />
      <StatusChip status={b.status} />
    </div>
  )
  if (!b.href) return <div>{inner}</div>
  return b.source === 'partner' ? <a href={b.href} className="block hover:bg-[#fafbfc] no-underline">{inner}</a> : <Link href={b.href} className="block hover:bg-[#fafbfc] no-underline">{inner}</Link>
}

export default async function BookingsPage({ params }: { params: { token: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const all = await loadBookings(ws)
  const today = todayPacific()
  const live = all.filter((b) => b.status !== 'CANCELLED' && b.status !== 'RETURNED' && (!b.endDate || b.endDate >= today))
  const past = all.filter((b) => !live.includes(b)).sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  return (
    <div className={PAGE}>
      <PageHead title="Bookings" sub="Your own bookings, and the ones your rental partners send you. A partner booking opens on the partner's page — that's where the call time, driver and confirmation are exchanged." action={{ href: `${base}/bookings/new`, label: '+ New booking' }} />
      <h2 className={`${H2} mb-2`}>Current & upcoming · {live.length}</h2>
      {live.length === 0 ? <Empty>Nothing on the books. <Link href={`${base}/bookings/new`} className="font-semibold text-[var(--hq-accent)]">Create a booking</Link>.</Empty> : <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>{live.map((b) => <Row key={b.id} b={b} />)}</div>}
      {past.length > 0 && (
        <details className="mt-6">
          <summary className={`${H2} cursor-pointer mb-2`}>Past & cancelled · {past.length}</summary>
          <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>{past.slice(0, 100).map((b) => <Row key={b.id} b={b} />)}</div>
        </details>
      )}
    </div>
  )
}
