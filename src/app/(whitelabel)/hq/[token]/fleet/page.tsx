/** Fleet — every unit, theirs alone or offered to SirReel, with rates. */
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadUnits } from '@/lib/hq-white-label/data'
import { CARD, Empty, MUTED, PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)

export default async function FleetPage({ params }: { params: { token: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const units = await loadUnits(ws, { includeInactive: true })
  return (
    <div className={PAGE}>
      <PageHead title="Fleet" sub="Every unit you run. Units you share with a rental partner carry the rates agreed with them; the rest are priced however you like." action={{ href: `${base}/fleet/new`, label: '+ Add unit' }} />
      {units.length === 0 ? (
        <Empty>No units yet. <Link href={`${base}/fleet/new`} className="font-semibold text-[var(--hq-accent)]">Add the first one</Link>.</Empty>
      ) : (
        <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>
          {units.map((u) => (
            <Link key={u.id} href={`${base}/fleet/${u.id}`} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-[#fafbfc] no-underline ${u.active ? '' : 'opacity-55'}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[#111827]">{u.name}{u.vehicleType ? <span className="font-normal text-[#6b7280]"> · {u.vehicleType}</span> : null}</div>
                <div className={MUTED}>
                  {u.offeredToPartner ? 'Shared with partners' : 'Yours alone'}{!u.active ? ' · retired' : ''}{u.rateNotes ? ` · ${u.rateNotes}` : ''}
                </div>
              </div>
              <div className="text-right text-[13px] text-[#111827] leading-[1.6]">
                <div><strong>{money(u.daily)}</strong> <span className="text-[#6b7280]">/day</span></div>
                <div><strong>{money(u.weekly)}</strong> <span className="text-[#6b7280]">/week</span></div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
