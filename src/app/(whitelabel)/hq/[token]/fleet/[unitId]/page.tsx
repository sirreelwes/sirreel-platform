import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadBookings, loadUnit } from '@/lib/hq-white-label/data'
import { fmtRange, todayPacific } from '@/lib/hq-white-label/dates'
import { UnitForm } from '@/components/hq-white-label/UnitForm'
import { CARD, H2, MUTED, PAGE, PageHead, SourceChip, StatusChip } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function UnitPage({ params }: { params: { token: string; unitId: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const u = await loadUnit(ws, params.unitId)
  if (!u) notFound()
  const today = todayPacific()
  const upcoming = (await loadBookings(ws, { from: today })).filter((b) => b.vehicleId === u.id && b.status !== 'CANCELLED').slice(0, 12)
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <PageHead title={u.name} sub={u.vehicleType ?? undefined} action={{ href: `${base}/bookings/new?unit=${u.id}`, label: '+ Book it' }} />
      <UnitForm
        base={base}
        token={params.token}
        unitId={u.id}
        ratesLocked={u.offeredToPartner}
        initial={{
          name: u.name, vehicleType: u.vehicleType ?? '', daily: u.daily != null ? String(u.daily) : '', weekly: u.weekly != null ? String(u.weekly) : '', monthly: u.monthly != null ? String(u.monthly) : '',
          rateNotes: u.rateNotes ?? '', specs: u.specs ?? '', offeredToPartner: u.offeredToPartner, active: u.active,
        }}
      />
      <h2 className={`${H2} mt-8 mb-2`}>Coming up on this unit · {upcoming.length}</h2>
      {upcoming.length === 0 ? (
        <p className={MUTED}>Nothing booked from today on.</p>
      ) : (
        <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>
          {upcoming.map((b) => {
            const inner = (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[#111827]">{b.title}{b.clientName ? <span className="font-normal text-[#6b7280]"> · {b.clientName}</span> : null}</div>
                  <div className={MUTED}>{fmtRange(b.startDate, b.endDate)}</div>
                </div>
                <SourceChip source={b.source} />
                <StatusChip status={b.status} />
              </div>
            )
            if (!b.href) return <div key={b.id}>{inner}</div>
            return b.source === 'partner' ? <a key={b.id} href={b.href} className="block no-underline hover:bg-[#fafbfc]">{inner}</a> : <Link key={b.id} href={b.href} className="block no-underline hover:bg-[#fafbfc]">{inner}</Link>
          })}
        </div>
      )}
    </div>
  )
}
