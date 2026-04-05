'use client'

import { useState, useEffect } from 'react'

function fmt(d: string) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-100 text-blue-700',
  hold: 'bg-amber-100 text-amber-700',
  inquiry: 'bg-sky-100 text-sky-700',
  booked: 'bg-emerald-100 text-emerald-700',
}

export default function DispatchPage() {
  const [unlinked, setUnlinked] = useState<any[]>([])
  const [rwOrders, setRwOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState<Set<string>>(new Set())
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/planyo/unlinked').then(r => r.json()).catch(() => ({})),
      fetch('/api/rentalworks?pageSize=200').then(r => r.json()).catch(() => ({})),
    ]).then(([planyoData, rwData]) => {
      if (planyoData.ok) setUnlinked(planyoData.unlinked || [])
      if (rwData?.orders?.Rows) {
        const cols = rwData.orders.ColumnIndex
        const rows = rwData.orders.Rows.map((r: any[]) => ({
          orderId:     r[cols.OrderId],
          orderNumber: r[cols.OrderNumber],
          customer:    r[cols.Customer],
          description: r[cols.Description],
          agent:       (r[cols.Agent] || '').split(',').reverse().join(' ').trim(),
          status:      r[cols.Status],
          startDate:   r[cols.EstimatedStartDate] || '',
          endDate:     r[cols.EstimatedStopDate] || '',
          total:       Number(r[cols.Total]) || 0,
        })).filter((o: any) => !['CLOSED','CANCELLED'].includes(o.status))
        setRwOrders(rows)
      }
    }).finally(() => setLoading(false))
  }, [])

  const filteredRw = rwOrders.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      o.customer?.toLowerCase().includes(q) ||
      o.orderNumber?.includes(q) ||
      o.description?.toLowerCase().includes(q) ||
      o.agent?.toLowerCase().includes(q)
    )
  })

  const linkOrder = async (rwOrder: any) => {
    if (!selected) return
    setLinking(true)
    try {
      const res = await fetch('/api/planyo/link-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservationId: selected.reservationId,
          rwOrderNumber: rwOrder.orderNumber,
          existingNotes: selected.userNotes,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setLinked(prev => new Set([...prev, selected.reservationId]))
        setSuccessMsg(`Linked R${selected.reservationId} → RW #${rwOrder.orderNumber} (${rwOrder.customer})`)
        setSelected(null)
        setTimeout(() => setSuccessMsg(''), 4000)
      }
    } finally { setLinking(false) }
  }

  const displayUnlinked = unlinked.filter(r => !linked.has(r.reservationId))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Planyo → RentalWorks Linker</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Match unlinked Planyo reservations to their RentalWorks orders
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {successMsg && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-700 font-semibold">
              ✅ {successMsg}
            </div>
          )}
          <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
            {displayUnlinked.length} unlinked reservations
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 h-[calc(100vh-180px)]">

        {/* Left: Unlinked Planyo reservations */}
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Planyo — Unlinked Reservations
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">Click a reservation to link it to an RW order</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
            ) : displayUnlinked.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <div className="text-3xl mb-2">✅</div>
                All reservations are linked!
              </div>
            ) : (
              displayUnlinked.map((r, i) => (
                <div key={i}
                  onClick={() => setSelected(selected?.reservationId === r.reservationId ? null : r)}
                  className={`px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors ${
                    selected?.reservationId === r.reservationId
                      ? 'bg-blue-50 border-l-2 border-l-blue-500'
                      : 'hover:bg-gray-50'
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-bold text-gray-900 truncate">{r.unit}</div>
                      <div className="text-[10px] text-gray-500 truncate">{r.resourceName}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {fmt(r.start)} – {fmt(r.end)}
                      </div>
                      {r.company && (
                        <div className="text-[10px] text-gray-600 font-medium mt-0.5">{r.company}</div>
                      )}
                      {r.jobName && (
                        <div className="text-[10px] text-gray-400 truncate">{r.jobName}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-500'}`}>
                        {r.status.toUpperCase()}
                      </span>
                      {r.agent && <div className="text-[9px] text-gray-400">{r.agent}</div>}
                      <div className="text-[9px] text-gray-300">R{r.reservationId}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: RW order search */}
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              RentalWorks Orders
              {selected && (
                <span className="ml-2 font-normal text-blue-600">— linking R{selected.reservationId} ({selected.unit})</span>
              )}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by client, order #, or agent..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selected ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <div className="text-3xl mb-2">←</div>
                Select a Planyo reservation first
              </div>
            ) : filteredRw.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No orders found</div>
            ) : (
              filteredRw.map((o, i) => (
                <div key={i}
                  onClick={() => !linking && linkOrder(o)}
                  className="px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-emerald-50 hover:border-l-2 hover:border-l-emerald-500 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-bold text-gray-900 truncate">{o.customer}</div>
                      <div className="text-[10px] text-gray-500 truncate">{o.description}</div>
                      <div className="text-[10px] text-gray-400">
                        {fmt(o.startDate)} – {fmt(o.endDate)}
                      </div>
                      {o.agent && <div className="text-[10px] text-gray-400">{o.agent}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <div className="text-[11px] font-bold text-gray-900">#{o.orderNumber}</div>
                      <div className="text-[10px] font-semibold text-emerald-600">${o.total.toLocaleString()}</div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        o.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
                        o.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-500'}`}>
                        {o.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
