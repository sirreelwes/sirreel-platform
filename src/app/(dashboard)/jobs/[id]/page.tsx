'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

function fmt(d: string) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CAT_LABELS: Record<string, string> = {
  cube: 'Cube Truck', cargo: 'Cargo Van w/ LG', cargoNoLG: 'Cargo Van w/o LG',
  pass: 'Passenger Van', pop: 'PopVan', cam: 'Camera Cube',
  dlux: 'DLUX', scout: 'ProScout/VTR', stakebed: 'Stakebed', studio: 'Studio',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  booked: 'bg-blue-100 text-blue-700',
  hold: 'bg-amber-100 text-amber-700',
  quoted: 'bg-purple-100 text-purple-700',
  inquiry: 'bg-sky-100 text-sky-700',
  complete: 'bg-gray-100 text-gray-600',
}

const AVATAR_COLORS: Record<string, string> = {
  Wes: 'bg-blue-500', Jose: 'bg-emerald-500', Oliver: 'bg-purple-500',
  Dani: 'bg-pink-500', Ana: 'bg-amber-500', Julian: 'bg-cyan-500',
  Hugo: 'bg-red-500', Chris: 'bg-indigo-500',
}

function Avatar({ name }: { name: string }) {
  const first = name?.split(' ')[0] || '?'
  const color = AVATAR_COLORS[first] || 'bg-gray-400'
  return (
    <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0`}>
      {first[0]?.toUpperCase()}
    </div>
  )
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = params?.id as string;

  const [planyoJob, setPlanyoJob] = useState<any>(null);
  const [planyoVehicles, setPlanyoVehicles] = useState<any[]>([]);
  const [rwOrderData, setRwOrderData] = useState<any>(null);
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);


  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<number>(0);

  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [addCat, setAddCat] = useState('cube');
  const [addStart, setAddStart] = useState('');
  const [addEnd, setAddEnd] = useState('');
  const [addStatus, setAddStatus] = useState<'hold'|'confirmed'>('hold');
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState('');
  const [createError, setCreateError] = useState('');

  const activeTab = 'overview';
  const setActiveTab = (_: any) => {};
  const userEmail = session?.user?.email || ''

  // Fetch Planyo vehicles once job data is known
  useEffect(() => {
    if (!planyoJob) return
    const rwNum = planyoJob.rwOrderNumber || ''
    const company = encodeURIComponent(planyoJob.company || '')
    const start = planyoJob.startDate || ''
    const end = planyoJob.endDate || ''
    fetch(`/api/planyo/job-reservations?rwOrder=${rwNum}&company=${company}&start=${start}&end=${end}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setPlanyoVehicles(d.vehicles || []) })
      .catch(() => {})
  }, [planyoJob?.rwOrderNumber, planyoJob?.company])
  const rwOrder = planyoJob?.rwOrderNumber || id

  useEffect(() => {
    Promise.all([
      fetch('/api/timeline').then(r => r.json()).catch(() => ({})),
      fetch(`/api/bookings/by-rw-order?orderId=${id}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/rentalworks/order?id=${id}`).then(r => r.json()).catch(() => ({})),
    ]).then(([timeline, bookingData, rwData]) => {
      if (timeline.ok) {
        const found = timeline.jobs?.find((j: any) =>
          j.id === id || j.rwOrderNumber === id || j.jobNum === `#${id}` || j.jobNum === id
        )
        if (found) {
          setPlanyoJob(found)
          setAddStart(found.startDate || '')
          setAddEnd(found.endDate || '')
        }
      }
      if (bookingData.booking) setBooking(bookingData.booking)
      // Fall back to RW data if no Planyo match
      if (rwData?.order) {
        const o = rwData.order
        const agentRaw = o.Agent || ''
        const agentName = agentRaw.split(',').reverse().join(' ').trim()
        const startDate = o.EstimatedStartDate || ''
        const endDate = o.EstimatedStopDate || ''
        setPlanyoJob((prev: any) => prev || {
          company: o.Customer || '',
          jobName: o.Description || o.Deal || '',
          status: (o.Status || '').toLowerCase(),
          startDate,
          endDate,
          agent: agentName,
          rwOrderNumber: o.OrderNumber || id,
          jobNum: o.OrderNumber || id,
          items: [],
        })
        setAddStart(startDate)
        setAddEnd(endDate)
      }
    }).then(() => {
      // Fetch Planyo reservations for this RW order
      const orderNum = id.startsWith('A0') ? null : id
      const fetchOrder = orderNum || id
      fetch(`/api/planyo/job-reservations?rwOrder=${fetchOrder}`)
        .then(r => r.json())
        .then(d => { if (d.ok) setPlanyoVehicles(d.vehicles || []) })
        .catch(() => {})
    }).then(() => {
      // Also fetch RW order financials
      if (id) {
        fetch(`/api/rentalworks/order?id=${id}`)
          .then(r => r.json())
          .then(d => { if (d.order) setRwOrderData(d.order) })
          .catch(() => {})
      }
    }).finally(() => setLoading(false))
  }, [id])

  const fetchMessages = useCallback(() => {
    if (!rwOrder) return
    fetch(`/api/jobs/messages?rwOrder=${rwOrder}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setMessages(d.messages || [])
          if (true) {
            const newCount = (d.messages || []).filter((m: any) =>
              new Date(m.created_at).getTime() > lastReadRef.current
            ).length
            setUnreadCount(newCount)
          }
        }
      }).catch(() => {})
  }, [rwOrder, activeTab])

  useEffect(() => { fetchMessages() }, [fetchMessages])
  useEffect(() => {
    const interval = setInterval(fetchMessages, 15000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  useEffect(() => {
    if (false) {
      lastReadRef.current = Date.now()
      setUnreadCount(0)
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [activeTab, messages])

  useEffect(() => {
    if (!showAddVehicle || !addCat || !addStart || !addEnd) return
    setLoadingUnits(true)
    setSelectedUnit('')
    fetch(`/api/planyo/available-units?cat=${addCat}&start=${addStart}&end=${addEnd}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setAvailableUnits(d.units || [])
          const first = (d.units || []).find((u: any) => u.available)
          if (first) setSelectedUnit(first.name)
        }
      }).catch(() => {}).finally(() => setLoadingUnits(false))
  }, [showAddVehicle, addCat, addStart, addEnd])

  const sendMessage = async () => {
    if (!chatInput.trim() || !rwOrder) return
    setSending(true)
    try {
      await fetch('/api/jobs/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rwOrder,
          userName: session?.user?.name || 'Team',
          userEmail,
          content: chatInput.trim(),
        }),
      })
      setChatInput('')
      fetchMessages()
    } finally { setSending(false) }
  }

  const createReservation = async () => {
    if (!selectedUnit || !addStart || !addEnd) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/planyo/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cat: addCat, unit: selectedUnit,
          startDate: addStart, endDate: addEnd, status: addStatus,
          rwOrderNumber: planyoJob?.rwOrderNumber || id,
          companyName: planyoJob?.company || booking?.company?.name || '',
          jobName: planyoJob?.jobName || booking?.jobName || '',
          agentName: planyoJob?.agent || '',
          clientFirstName: (planyoJob?.contact || '').split(' ')[0] || '',
          clientLastName: (planyoJob?.contact || '').split(' ')[1] || '',
          clientEmail: '',
        }),
      })
      const data = await res.json()
      if (data.ok) {
        setCreateSuccess(`${selectedUnit} added as ${addStatus} — R${data.reservationId}`)
        setTimeout(() => { setShowAddVehicle(false); setCreateSuccess('') }, 2500)
      } else {
        setCreateError(data.error || 'Failed to create reservation')
      }
    } finally { setCreating(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>

  const company = planyoJob?.company || booking?.company?.name || 'Unknown Job'
  const jobName = planyoJob?.jobName || booking?.jobName || ''
  const status = planyoJob?.status || booking?.status || 'unknown'
  const statusColor = STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'
  const paperwork = booking?.paperworkRequests?.[0]
  const vehicles = planyoVehicles.length > 0 ? planyoVehicles : (planyoJob?.items || [])

  return (
    <div className="flex gap-4 h-[calc(100vh-80px)]">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3 flex-shrink-0">
        ← Back to Jobs
      </button>

      <div className="bg-gray-900 rounded-2xl p-5 text-white mb-4 flex-shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">{company}</h1>
            {jobName && <div className="text-gray-400 text-sm mt-0.5">{jobName}</div>}
            {planyoJob?.agent && <div className="text-gray-500 text-[11px] mt-0.5">Agent: {planyoJob.agent}</div>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusColor}`}>{status.toUpperCase()}</span>
            {planyoJob?.rwOrderNumber && (
              <a href={`https://sirreel.rentalworks.cloud/order/${planyoJob.rwOrderNumber}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-blue-300 hover:text-blue-200 underline">
                RW #{planyoJob.rwOrderNumber} ↗
              </a>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Start</div>
            <div className="text-sm font-semibold">{fmt(planyoJob?.startDate || booking?.startDate)}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">End</div>
            <div className="text-sm font-semibold">{fmt(planyoJob?.endDate || booking?.endDate)}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[9px] text-gray-400 uppercase font-bold mb-0.5">Contact</div>
            <div className="text-sm font-semibold truncate">{planyoJob?.contact || '—'}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-4 flex-shrink-0">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'vehicles', label: `Vehicles (${vehicles.length})` } as const,
          { id: 'paperwork', label: 'Paperwork' },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
              activeTab === tab.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}>
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setShowAddVehicle(true)}
          className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-blue-600 text-white hover:bg-blue-700">
          + Add Vehicle
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-6">

        {true && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Vehicles on Job</div>
              {vehicles.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-4">No vehicles assigned yet</div>
              ) : (
                <div className="space-y-2">
                  {vehicles.map((v: any, i: number) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{v.unit}</div>
                        <div className="text-[10px] text-gray-400">{v.resourceName} · {fmt(v.start)} – {fmt(v.end)}</div>
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-500'}`}>
                        {v.status?.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {paperwork && (
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Paperwork</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Rental Agreement', done: paperwork.rentalAgreement },
                    { label: 'LCDW', done: paperwork.lcdwAccepted },
                    { label: 'COI', done: paperwork.coiReceived },
                    { label: 'CC Auth', done: paperwork.creditCardAuth },
                  ].map(item => (
                    <div key={item.label} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${item.done ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
                      <span className={item.done ? 'text-emerald-500' : 'text-gray-300'}>{item.done ? '✓' : '○'}</span>
                      <span className={`text-sm font-medium ${item.done ? 'text-emerald-700' : 'text-gray-500'}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {true && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Vehicles · Planyo Live</div>
              <button onClick={() => setShowAddVehicle(true)} className="text-[11px] font-semibold text-blue-600 hover:underline">+ Add vehicle</button>
            </div>
            {vehicles.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm"><div className="text-3xl mb-2">🚛</div>No vehicles on this job yet.</div>
            ) : (
              <div className="space-y-2">
                {vehicles.map((v: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 border border-gray-100 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{v.unit}</div>
                      <div className="text-[11px] text-gray-400">{v.resourceName}</div>
                      <div className="text-[10px] text-gray-300">{fmt(v.start)} – {fmt(v.end)}</div>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-500'}`}>
                      {v.status?.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {true && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Paperwork</div>
            {!paperwork ? (
              <div className="text-sm text-gray-400">No paperwork request sent yet.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Rental Agreement', done: paperwork.rentalAgreement },
                  { label: 'LCDW', done: paperwork.lcdwAccepted },
                  { label: 'COI', done: paperwork.coiReceived },
                  { label: 'Workers Comp', done: paperwork.wcReceived },
                  { label: 'CC Auth', done: paperwork.creditCardAuth },
                  { label: 'Studio Contract', done: paperwork.studioContractSigned },
                ].map(item => (
                  <div key={item.label} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${item.done ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
                    <span className={item.done ? 'text-emerald-500' : 'text-gray-300'}>{item.done ? '✓' : '○'}</span>
                    <span className={`text-sm font-medium ${item.done ? 'text-emerald-700' : 'text-gray-500'}`}>{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}


      </div>

      </div>

      {/* Chat sidebar */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Job Chat</div>
            {unreadCount > 0 && <span className="text-[9px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
          </div>
          <div className="text-[10px] text-gray-300 mt-0.5">All team members · every 15s</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-[12px]">No messages yet.</div>
          ) : messages.map((msg: any, i: number) => {
            const isMe = msg.user_email === userEmail
            return (
              <div key={i} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                <Avatar name={msg.user_name} />
                <div className={`max-w-[85%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-1">
                    {!isMe && <span className="text-[10px] font-bold text-gray-500">{msg.user_name}</span>}
                    <span className="text-[9px] text-gray-300">{timeAgo(msg.created_at)}</span>
                  </div>
                  <div className={`px-3 py-2 rounded-2xl text-[12px] leading-relaxed ${
                    isMe ? 'bg-gray-900 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-900 rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={chatBottomRef} />
        </div>
        <div className="px-3 py-3 border-t border-gray-100 flex-shrink-0">
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="Message team..."
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:border-gray-400"
            />
            <button onClick={sendMessage} disabled={!chatInput.trim() || sending}
              className="px-3 py-2 bg-gray-900 text-white rounded-xl text-[12px] font-semibold hover:bg-gray-800 disabled:opacity-40">
              {sending ? '...' : '↑'}
            </button>
          </div>
        </div>
      </div>

      {showAddVehicle && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowAddVehicle(false)}>
          <div className="bg-white rounded-2xl w-[480px] max-w-[95vw] p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-gray-900">Add Vehicle to Job</h3>
              <button onClick={() => setShowAddVehicle(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {createSuccess ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">✅</div>
                <div className="text-sm font-semibold text-gray-900">{createSuccess}</div>
                <div className="text-xs text-gray-400 mt-1">Reservation created in Planyo</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 block">Vehicle Category</label>
                  <select value={addCat} onChange={e => setAddCat(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400">
                    {Object.entries(CAT_LABELS).map(([k,v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 block">Start Date</label>
                    <input type="date" value={addStart} onChange={e => setAddStart(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 block">End Date</label>
                    <input type="date" value={addEnd} onChange={e => setAddEnd(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 block">Status</label>
                  <div className="flex gap-2">
                    <button onClick={() => setAddStatus('hold')}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                        addStatus === 'hold' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}>
                      🟡 Hold
                    </button>
                    <button onClick={() => setAddStatus('confirmed')}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                        addStatus === 'confirmed' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}>
                      ✅ Confirmed
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-gray-400 uppercase mb-1.5 block">
                    Unit {loadingUnits && <span className="font-normal text-gray-300">checking availability...</span>}
                  </label>
                  {loadingUnits ? (
                    <div className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-400">Loading available units...</div>
                  ) : availableUnits.length === 0 ? (
                    <div className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-400">
                      {addStart && addEnd ? 'No units found — check dates' : 'Select dates to see availability'}
                    </div>
                  ) : (
                    <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400">
                      <option value="">Select a unit...</option>
                      {availableUnits.filter((u: any) => u.available).map((u: any) => (
                        <option key={u.name} value={u.name}>{u.name} — Available</option>
                      ))}
                      {availableUnits.filter((u: any) => !u.available).length > 0 && (
                        <optgroup label="— Already booked —">
                          {availableUnits.filter((u: any) => !u.available).map((u: any) => (
                            <option key={u.name} value={u.name}>{u.name} — {u.bookedBy || 'Booked'}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  )}
                </div>

                {createError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{createError}</div>
                )}

                <button onClick={createReservation}
                  disabled={creating || !selectedUnit || !addStart || !addEnd}
                  className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-40">
                  {creating ? 'Creating reservation...' : `Add ${selectedUnit || 'Vehicle'} as ${addStatus}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
