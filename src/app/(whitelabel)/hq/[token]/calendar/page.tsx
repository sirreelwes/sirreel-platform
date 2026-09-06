/**
 * Calendar — every unit down the side, the month across the top, one bar
 * per booking. Server-rendered: no drag, no drawer, just the grid a
 * dispatcher reads at a glance. A day with two live bookings on one unit
 * is outlined red.
 */
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadCalendar } from '@/lib/hq-white-label/data'
import type { HqBookingStatus } from '@/lib/hq-white-label/data'
import { fmtMonth, isMonth, shiftMonth, todayPacific } from '@/lib/hq-white-label/dates'
import { BTN_SECONDARY, CARD, Empty, MUTED, PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

const BAR: Record<HqBookingStatus, string> = {
  QUOTED: 'bg-[#ede9fe] text-[#5b3fa6] border-dashed border-[#c4b5fd]',
  HOLD: 'bg-[#fff1c2] text-[#6b4c00] border-[#f0dfa0]',
  CONFIRMED: 'bg-[#d1ecdb] text-[#1f6b45] border-[#b7dfc6]',
  OUT: 'bg-[var(--hq-accent)] text-white border-transparent',
  RETURNED: 'bg-[#e5e7eb] text-[#4b5563] border-[#d5d9de]',
  CANCELLED: 'bg-transparent text-[#9ca3af] border-transparent',
}

export default async function CalendarPage({ params, searchParams }: { params: { token: string }; searchParams: { month?: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const month = isMonth(searchParams.month) ? searchParams.month : todayPacific().slice(0, 7)
  const cal = await loadCalendar(ws, month)
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })
  const weekend = (d: string) => {
    const n = new Date(`${d}T12:00:00Z`).getUTCDay()
    return n === 0 || n === 6
  }

  return (
    <div className={PAGE}>
      <PageHead title="Calendar" action={{ href: `${base}/bookings/new`, label: '+ New booking' }} />
      <div className="flex items-center gap-2 mb-4">
        <Link href={`${base}/calendar?month=${shiftMonth(month, -1)}`} className={BTN_SECONDARY}>‹</Link>
        <div className="text-[17px] font-bold min-w-[170px] text-center">{fmtMonth(month)}</div>
        <Link href={`${base}/calendar?month=${shiftMonth(month, 1)}`} className={BTN_SECONDARY}>›</Link>
        {month !== cal.today.slice(0, 7) && <Link href={`${base}/calendar`} className={`${BTN_SECONDARY} ml-1`}>Today</Link>}
        <div className={`${MUTED} ml-auto hidden sm:flex items-center gap-3`}>
          <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-[#fff1c2] border border-[#f0dfa0]" />Hold</span>
          <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-[#d1ecdb] border border-[#b7dfc6]" />Confirmed</span>
          <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-[var(--hq-accent)]" />Out</span>
          <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm bg-[#ede9fe] border border-dashed border-[#c4b5fd]" />Quoted</span>
        </div>
      </div>

      {cal.rows.length === 0 ? (
        <Empty>No units yet. <Link href={`${base}/fleet/new`} className="font-semibold text-[var(--hq-accent)]">Add your first unit</Link> and it appears here.</Empty>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="border-collapse text-[12px]" style={{ minWidth: 220 + cal.days.length * 34 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white text-left font-semibold text-[#6b7280] px-3 py-2 border-b border-r border-[#eef0f3] w-[220px] min-w-[220px]">Unit</th>
                {cal.days.map((d) => (
                  <th key={d} className={`font-semibold px-0 py-1.5 border-b border-[#eef0f3] w-[34px] min-w-[34px] text-center ${d === cal.today ? 'text-[var(--hq-accent)]' : weekend(d) ? 'text-[#9ca3af] bg-[#fafbfc]' : 'text-[#6b7280]'}`}>
                    <div className="text-[10px] uppercase">{dow(d)}</div>
                    <div className={`text-[12px] ${d === cal.today ? 'font-black' : ''}`}>{Number(d.slice(-2))}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cal.rows.map((r) =>
                Array.from({ length: r.laneCount }, (_, lane) => {
                  const bars = r.bars.filter((b) => b.lane === lane)
                  const cells: React.ReactNode[] = []
                  for (let i = 0; i < cal.days.length; i++) {
                    const d = cal.days[i]
                    const bar = bars.find((b) => b.startIdx === i)
                    if (bar) {
                      const b = bar.booking
                      const label = `${b.title}${b.clientName ? ` · ${b.clientName}` : ''}`
                      const el = (
                        <div className={`m-[3px] h-[36px] rounded-md border px-2 flex items-center overflow-hidden whitespace-nowrap text-[12px] font-semibold ${BAR[b.status]} ${bar.conflict ? 'ring-2 ring-[#dc2626]' : ''}`} title={`${label} · ${b.startDate} – ${b.endDate}${b.source === 'partner' ? ' · partner booking' : ''}${bar.conflict ? ' · DOUBLE-BOOKED' : ''}`}>
                          <span className="truncate">{label}</span>
                        </div>
                      )
                      cells.push(
                        <td key={d} colSpan={bar.span} className="h-[42px] p-0 align-middle">
                          {b.href ? (b.source === 'partner' ? <a href={b.href} className="block no-underline">{el}</a> : <Link href={b.href} className="block no-underline">{el}</Link>) : el}
                        </td>,
                      )
                      i += bar.span - 1
                      continue
                    }
                    cells.push(<td key={d} className={`h-[42px] ${weekend(d) ? 'bg-[#fafbfc]' : ''} ${d === cal.today ? 'shadow-[inset_2px_0_0_var(--hq-accent)]' : ''}`} />)
                  }
                  return (
                    <tr key={`${r.unitId ?? 'other'}-${lane}`} className={lane === r.laneCount - 1 ? 'border-b border-[#eef0f3] last:border-b-0' : ''}>
                      {lane === 0 && (
                        <td rowSpan={r.laneCount} className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-b border-[#eef0f3] align-middle">
                          {r.unitId ? (
                            <Link href={`${base}/fleet/${r.unitId}`} className="font-semibold text-[13px] text-[#111827] no-underline hover:text-[var(--hq-accent)]">{r.unitName}</Link>
                          ) : (
                            <span className="font-semibold text-[13px] text-[#6b7280]">{r.unitName}</span>
                          )}
                          {r.vehicleType && <div className="text-[11px] text-[#6b7280]">{r.vehicleType}</div>}
                          {r.bars.some((b) => b.conflict) && <div className="text-[11px] font-bold text-[#dc2626]">Double-booked</div>}
                        </td>
                      )}
                      {cells}
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
