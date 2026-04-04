'use client';

import { useState, useEffect } from 'react';

function toDS(d: Date): string { return d.toISOString().split('T')[0]; }
function addDays(ds: string, n: number): string { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return toDS(d); }
function diffDays(a: string, b: string): number { return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000); }
function fDay(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }); }
function fMonth(ds: string): string { return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
const today = toDS(new Date());

const CAT_COLORS: Record<string, string> = {
  cube: '#3b82f6', cargo: '#8b5cf6', pass: '#06b6d4', pop: '#f59e0b',
  cam: '#ec4899', dlux: '#10b981', scout: '#f97316', studio: '#6366f1',
  stakebed: '#78716c', general: '#9ca3af',
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  booked:  { bg: 'bg-blue-400',   border: 'border-blue-500',   text: 'text-white' },
  active:  { bg: 'bg-emerald-400',border: 'border-emerald-500',text: 'text-white' },
  hold:    { bg: 'bg-amber-300',  border: 'border-amber-400',  text: 'text-amber-900' },
  inquiry: { bg: 'bg-sky-200',    border: 'border-sky-300',    text: 'text-sky-800' },
  quoted:  { bg: 'bg-purple-300', border: 'border-purple-400', text: 'text-purple-900' },
}

const CAT_LABELS: Record<string, string> = {
  cube: 'Cube', cargo: 'Cargo', pass: 'Pass Van', pop: 'PopVan',
  cam: 'Cam Cube', dlux: 'DLUX', scout: 'Scout', studio: 'Studio',
  stakebed: 'Stakebed', general: 'Other',
}

export default function GanttPage() {
  const [view, setView] = useState<'asset' | 'job'>('asset')
  const [weeks, setWeeks] = useState(2)
  const [catFilter, setCatFilter] = useState('all')
  const [jobs, setJobs] = useState<any[]>([])
  const [units, setUnits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)

  useEffect(() => {
    fetch('/api/timeline')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJobs(d.jobs || [])
          setUnits(d.units || [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const startDate = addDays(today, -3)
  const totalDays = weeks * 7
  const dates = Array.from({ length: totalDays }, (_, i) => addDays(startDate, i))
  const dayWidth = weeks <= 2 ? 48 : weeks <= 3 ? 36 : 28
  const todayOffset = diffDays(startDate, today)

  function getBar(start: string, end: string) {
    const s = Math.max(0, diffDays(startDate, start))
    const e = Math.min(totalDays - 1, diffDays(startDate, end))
    if (e < 0 || s >= totalDays) return null
    return { left: s * dayWidth, width: Math.max((e - s + 1) * dayWidth - 2, dayWidth - 2) }
  }

  const allCats = [...new Set(units.map(u => u.cat))].sort()
  const filteredUnits = catFilter === 'all' ? units : units.filter(u => u.cat === catFilter)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-gray-900">Timeline</h1>
          {loading && <span className="text-[11px] text-gray-400">Loading from Planyo...</span>}
          {!loading && <span className="text-[11px] text-gray-400">{units.length} units · {jobs.length} jobs · Live</span>}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('asset')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'asset' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Asset</button>
            <button onClick={() => setView('job')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${view === 'job' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By Job</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === 'asset' && (
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white">
              <option value="all">All Categories</option>
              {allCats.map(c => <option key={c} value={c}>{CAT_LABELS[c] || c}</option>)}
            </select>
          )}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[1,2,3,4].map(w => (
              <button key={w} onClick={() => setWeeks(w)} className={`px-2 py-1 rounded-md text-[10px] font-semibold ${weeks === w ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{w}W</button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-2 text-[10px] flex-wrap">
        {[
          { label: 'Booked', color: 'bg-blue-400' },
          { label: 'Active', color: 'bg-emerald-400' },
          { label: 'Hold', color: 'bg-amber-300' },
          { label: 'Inquiry', color: 'bg-sky-200' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-3 h-2 rounded-sm ${l.color}`} />
            <span className="text-gray-500">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Gantt */}
      <div className="flex border border-gray-200 rounded-lg overflow-hidden bg-white" style={{ height: 'calc(100vh - 210px)' }}>
        {/* Labels */}
        <div className="w-48 flex-shrink-0 border-r border-gray-200 bg-gray-50 z-10 overflow-y-auto">
          <div className="h-10 border-b border-gray-200 px-3 flex items-center text-[10px] font-bold text-gray-400 uppercase">
            {view === 'asset' ? 'Unit' : 'Client'}
          </div>

          {view === 'asset' ? (
            filteredUnits.map((unit, i) => (
              <div key={i} className="h-8 border-b border-gray-100 px-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAT_COLORS[unit.cat] || '#9ca3af' }} />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-gray-900 truncate">{unit.unitName}</div>
                  <div className="text-[9px] text-gray-400 truncate">{unit.resourceName}</div>
                </div>
              </div>
            ))
          ) : (
            jobs.map((job, i) => (
              <div key={i} className="h-8 border-b border-gray-100 px-3 flex items-center cursor-pointer hover:bg-gray-100" onClick={() => setSelected(job)}>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-gray-900 truncate">{job.company}</div>
                  <div className="text-[9px] text-gray-400 truncate">{job.items?.length} unit{job.items?.length !== 1 ? 's' : ''} · {fMonth(job.startDate)}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {/* Date header */}
          <div className="flex h-10 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
            {dates.map(ds => {
              const isToday = ds === today
              const isWeekend = [0,6].includes(new Date(ds + 'T12:00:00').getDay())
              return (
                <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }}
                  className={`flex-shrink-0 flex items-center justify-center text-[10px] border-r border-gray-100 ${isToday ? 'bg-blue-50 font-bold text-blue-600' : isWeekend ? 'bg-gray-100/50 text-gray-400' : 'text-gray-500'}`}>
                  {fDay(ds)}
                </div>
              )
            })}
          </div>

          <div className="relative">
            {/* Today line */}
            {todayOffset >= 0 && todayOffset < totalDays && (
              <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayOffset * dayWidth + dayWidth / 2, width: 2, background: '#3b82f6' }}>
                <div className="absolute -top-0 -left-[3px] w-2 h-2 rounded-full bg-blue-500" />
              </div>
            )}

            {view === 'asset' ? (
              filteredUnits.map((unit, i) => (
                <div key={i} className="relative h-8 border-b border-gray-100">
                  {/* Grid */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {dates.map(ds => (
                      <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }}
                        className={`flex-shrink-0 border-r border-gray-100/50 ${[0,6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`} />
                    ))}
                  </div>
                  {/* Booking bars */}
                  {unit.bookings.map((b: any, j: number) => {
                    const bar = getBar(b.start, b.end)
                    if (!bar) return null
                    const sc = STATUS_COLORS[b.status] || STATUS_COLORS.booked
                    return (
                      <div key={j}
                        className={`absolute top-1 h-6 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden`}
                        style={{ left: bar.left, width: bar.width }}
                        onClick={() => setSelected({ ...b, unitName: unit.unitName, isUnit: true })}>
                        <span className={`text-[9px] font-bold ${sc.text} truncate whitespace-nowrap`}>
                          {b.clientName} · {fMonth(b.start)}–{fMonth(b.end)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))
            ) : (
              jobs.map((job, i) => (
                <div key={i} className="relative h-8 border-b border-gray-100">
                  <div className="absolute inset-0 flex pointer-events-none">
                    {dates.map(ds => (
                      <div key={ds} style={{ width: dayWidth, minWidth: dayWidth }}
                        className={`flex-shrink-0 border-r border-gray-100/50 ${[0,6].includes(new Date(ds + 'T12:00:00').getDay()) ? 'bg-gray-50/50' : ''}`} />
                    ))}
                  </div>
                  {(() => {
                    const bar = getBar(job.startDate, job.endDate)
                    if (!bar) return null
                    const sc = STATUS_COLORS[job.status] || STATUS_COLORS.booked
                    return (
                      <div className={`absolute top-1 h-6 rounded-md ${sc.bg} border ${sc.border} flex items-center px-1.5 cursor-pointer hover:opacity-90 overflow-hidden`}
                        style={{ left: bar.left, width: bar.width }}
                        onClick={() => setSelected(job)}>
                        <span className={`text-[9px] font-bold ${sc.text} truncate whitespace-nowrap`}>
                          {job.company} · {job.items?.length} unit{job.items?.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-[95vw] p-5 shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                {selected.isUnit ? (
                  <>
                    <div className="text-[10px] text-gray-400 uppercase font-bold">{selected.resourceName}</div>
                    <h3 className="text-lg font-bold text-gray-900">{selected.unitName}</h3>
                    <div className="text-[13px] text-gray-500">{selected.clientName}</div>
                  </>
                ) : (
                  <>
                    <div className="text-[10px] text-gray-400 uppercase font-bold">{selected.status?.toUpperCase()} · {selected.jobNum}</div>
                    <h3 className="text-lg font-bold text-gray-900">{selected.company}</h3>
                    {selected.jobName && <div className="text-[13px] text-gray-500">{selected.jobName}</div>}
                  </>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            {selected.isUnit ? (
              <div className="space-y-1 text-[12px]">
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-400">Dates</span>
                  <span className="font-semibold">{fMonth(selected.start)} – {fMonth(selected.end)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-400">Status</span>
                  <span className="font-semibold capitalize">{selected.status}</span>
                </div>
                {selected.adminNotes && (
                  <div className="py-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 mt-2">{selected.adminNotes}</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Units on this job</div>
                {selected.items?.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-[12px]">
                    <div>
                      <div className="font-semibold text-gray-900">{item.unit}</div>
                      <div className="text-gray-400 text-[10px]">{item.resourceName}</div>
                    </div>
                    <div className="text-right text-gray-500">
                      <div>{fMonth(item.start)} – {fMonth(item.end)}</div>
                    </div>
                  </div>
                ))}
                {selected.items?.[0]?.adminNotes && (
                  <div className="py-2 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 mt-2">{selected.items[0].adminNotes}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
