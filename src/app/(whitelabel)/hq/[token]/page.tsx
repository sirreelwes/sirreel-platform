/** Today — what's moving, what's out, what still needs an answer. */
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadToday } from '@/lib/hq-white-label/data'
import type { HqBooking } from '@/lib/hq-white-label/data'
import { fmtDay, fmtRange } from '@/lib/hq-white-label/dates'
import { CARD, Empty, H2, MUTED, NeedsChip, PAGE, PageHead, SourceChip, StatusChip } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

function Row({ b, base }: { b: HqBooking; base: string }) {
  const href = b.href ?? `${base}/bookings`
  const external = b.source === 'partner'
  const inner = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-[#111827]">{b.quantity > 1 ? `${b.quantity} × ` : ''}{b.vehicleName}</div>
        <div className={MUTED}>
          {b.title}{b.clientName ? ` · ${b.clientName}` : ''} · {fmtRange(b.startDate, b.endDate)}{b.callTime ? ` · call ${b.callTime}` : ''}{b.driverName ? ` · ${b.driverName}` : ''}
        </div>
        {b.needs.length > 0 && <div className="flex flex-wrap gap-1.5 mt-1.5">{b.needs.map((n) => <NeedsChip key={n} text={n} />)}</div>}
      </div>
      <SourceChip source={b.source} />
      <StatusChip status={b.status} />
    </div>
  )
  return external ? (
    <a href={href} className="block hover:bg-[#fafbfc] no-underline">{inner}</a>
  ) : (
    <Link href={href} className="block hover:bg-[#fafbfc] no-underline">{inner}</Link>
  )
}

function Block({ title, rows, base, empty }: { title: string; rows: HqBooking[]; base: string; empty: string }) {
  return (
    <section>
      <h2 className={`${H2} mb-2`}>{title} · {rows.length}</h2>
      {rows.length === 0 ? <Empty>{empty}</Empty> : <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>{rows.map((b) => <Row key={b.id} b={b} base={base} />)}</div>}
    </section>
  )
}

export default async function TodayPage({ params }: { params: { token: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const t = await loadToday(ws)
  return (
    <div className={PAGE}>
      <PageHead title={`Today · ${fmtDay(t.today, { weekday: true })}`} sub={`${t.unitsOutToday} of ${t.unitCount} unit${t.unitCount === 1 ? '' : 's'} out today.`} action={{ href: `${base}/bookings/new`, label: '+ New booking' }} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Going out" rows={t.goingOut} base={base} empty="Nothing leaving the lot today." />
        <Block title="Coming back" rows={t.comingBack} base={base} empty="Nothing due back today." />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 mt-6">
        <Block title="Out right now" rows={t.onRent} base={base} empty="Nothing on rent through today." />
        <Block title="Needs an answer" rows={t.needsAnswer} base={base} empty="Nothing waiting on you." />
      </div>
      <div className="mt-6">
        <Block title="Next two weeks" rows={t.upcoming} base={base} empty="Nothing booked in the next two weeks." />
      </div>
      {t.unitCount === 0 && (
        <div className={`${CARD} mt-6 px-5 py-5`}>
          <div className="text-[15px] font-semibold">Start with your fleet</div>
          <p className={`${MUTED} mt-1`}>Add each unit once — name, type, rates — and the calendar and booking form fill themselves in.</p>
          <Link href={`${base}/fleet/new`} className="inline-block mt-3 text-[14px] font-semibold text-[var(--hq-accent)]">Add your first unit →</Link>
        </div>
      )}
    </div>
  )
}
