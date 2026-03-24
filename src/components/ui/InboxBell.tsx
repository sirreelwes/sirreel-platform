"use client"
import { useState, useEffect } from "react"

type EmailAlert = {
  id: string; fromAddress: string; subject: string
  snippet: string; category: string; priority: number; sentAt: string
}
type InboxData = {
  alerts: number; urgent: EmailAlert[]; unassigned: EmailAlert[]
  summary: { category: string; count: number }[]; message: string
}
const CAT: Record<string, string> = {
  BOOKING_INQUIRY: "Booking", RENTAL_REQUEST: "Rental", COMPLAINT: "Complaint",
  FLEET_ISSUE: "Fleet", BILLING: "Billing", SUPPORT: "Support", GENERAL: "General", SPAM: "Spam",
}
export default function InboxBell() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<InboxData | null>(null)
  const [loading, setLoading] = useState(false)
  const loadAlerts = async () => {
    setLoading(true)
    try { const r = await fetch("/api/gmail/check-replies"); const j = await r.json(); if (j.ok) setData(j) } catch {}
    setLoading(false)
  }
  useEffect(() => { loadAlerts(); const t = setInterval(loadAlerts, 60000); return () => clearInterval(t) }, [])
  const n = data?.alerts || 0
  return (
    <div className="relative">
      <button onClick={() => { setOpen(prev => !prev); loadAlerts() }}
        className="relative px-2 py-1.5 rounded-md bg-white border border-gray-200 text-gray-500 hover:border-gray-300">
        <span className="text-sm">📬</span>
        {n > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{n > 9 ? "9+" : n}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <div className="text-[11px] font-bold text-gray-700">📬 Inbox Alerts</div>
            {loading && <span className="text-[10px] text-gray-400">Refreshing...</span>}
            {n === 0 && !loading && <span className="text-[10px] text-green-600">All clear ✓</span>}
          </div>
          {data?.summary && data.summary.length > 0 && (
            <div className="px-3 py-1.5 border-b border-gray-100 flex flex-wrap gap-1">
              {data.summary.map(s => <span key={s.category} className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 text-gray-600">{CAT[s.category] || s.category} {s.count}</span>)}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {data?.urgent && data.urgent.length > 0 && <>
              <div className="px-3 py-1 text-[9px] font-bold text-red-600 uppercase tracking-wider bg-red-50">Urgent</div>
              {data.urgent.map(e => (
                <div key={e.id} className="px-3 py-2 border-b border-gray-50 hover:bg-gray-50">
                  <div className="text-[11px] font-semibold text-gray-800 truncate">{e.subject}</div>
                  <div className="text-[10px] text-gray-500 truncate">{e.fromAddress}</div>
                  <div className="text-[9px] px-1 py-0.5 rounded bg-red-50 text-red-700 inline-block mt-0.5">{CAT[e.category] || e.category}</div>
                </div>
              ))}
            </>}
            {data?.unassigned && data.unassigned.length > 0 && <>
              <div className="px-3 py-1 text-[9px] font-bold text-amber-600 uppercase tracking-wider bg-amber-50">Needs Assignment</div>
              {data.unassigned.map(e => (
                <div key={e.id} className="px-3 py-2 border-b border-gray-50 hover:bg-gray-50">
                  <div className="text-[11px] font-semibold text-gray-800 truncate">{e.subject}</div>
                  <div className="text-[10px] text-gray-500 truncate">{e.fromAddress}</div>
                </div>
              ))}
            </>}
            {n === 0 && !loading && (
              <div className="px-3 py-6 text-center text-[11px] text-gray-400">No alerts right now</div>
            )}
          </div>
          <div className="px-3 py-2 border-t border-gray-100">
            <a href="/inbox" className="text-[10px] text-blue-600 hover:underline">View full inbox →</a>
          </div>
        </div>
      )}
    </div>
  )
}
