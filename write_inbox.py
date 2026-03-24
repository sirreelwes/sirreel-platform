import os

os.makedirs('src/components/ui', exist_ok=True)
os.makedirs('src/app/(dashboard)/inbox', exist_ok=True)

# InboxBell component
bell = """\
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
            {n === 0 and not loading and (
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
"""

# Fix Python syntax in JSX (and -> &&)
bell = bell.replace("n === 0 and not loading and (", "n === 0 && !loading && (")

with open('src/components/ui/InboxBell.tsx', 'w') as f:
    f.write(bell)
print('InboxBell.tsx written')

# Inbox page
page = """\
"use client"
import { useState, useEffect } from "react"
const CAT: Record<string, string> = {
  BOOKING_INQUIRY: "📋 Booking", RENTAL_REQUEST: "🚐 Rental", COMPLAINT: "⚠️ Complaint",
  FLEET_ISSUE: "🔧 Fleet", BILLING: "💰 Billing", SUPPORT: "💬 Support", GENERAL: "📌 General", SPAM: "🗑 Spam",
}
export default function InboxPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch("/api/gmail/check-replies").then(r => r.json()).then(d => { setData(d); setLoading(false) }) }, [])
  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading inbox...</div>
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-900">📬 Inbox</h1>
        <div className="text-[11px] text-gray-500">{data?.message}</div>
      </div>
      {data?.summary?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {data.summary.map((s: any) => (
            <div key={s.category} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-[11px] font-semibold text-gray-600">
              {CAT[s.category] || s.category} <span className="text-red-500">{s.count}</span>
            </div>
          ))}
        </div>
      )}
      {data?.urgent?.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-2">Urgent</div>
          <div className="space-y-2">
            {data.urgent.map((e: any) => (
              <div key={e.id} className="bg-white border border-red-100 rounded-lg p-3">
                <div className="text-[12px] font-semibold text-gray-900">{e.subject}</div>
                <div className="text-[11px] text-gray-500">{e.fromAddress}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{e.snippet}</div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold mt-1 inline-block">{CAT[e.category] || e.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data?.unassigned?.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2">Unassigned</div>
          <div className="space-y-2">
            {data.unassigned.map((e: any) => (
              <div key={e.id} className="bg-white border border-amber-100 rounded-lg p-3">
                <div className="text-[12px] font-semibold text-gray-900">{e.subject}</div>
                <div className="text-[11px] text-gray-500">{e.fromAddress}</div>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold mt-1 inline-block">{CAT[e.category] || e.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data?.alerts === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-2">✅</div>
          <div className="text-sm font-medium">Inbox clear</div>
        </div>
      )}
    </div>
  )
}
"""

with open('src/app/(dashboard)/inbox/page.tsx', 'w') as f:
    f.write(page)
print('inbox/page.tsx written')

# Update layout
with open('src/app/(dashboard)/layout.tsx', 'r') as f:
    layout = f.read()

if "InboxBell" not in layout:
    layout = layout.replace(
        "import AIChat from '@/components/ai/AIChat'",
        "import AIChat from '@/components/ai/AIChat'\nimport InboxBell from '@/components/ui/InboxBell'"
    )
    layout = layout.replace(
        '<div className="flex gap-2 items-center">',
        '<div className="flex gap-2 items-center">\n            <InboxBell />'
    )
    with open('src/app/(dashboard)/layout.tsx', 'w') as f:
        f.write(layout)
    print('Layout updated with InboxBell')
else:
    print('InboxBell already in layout')

print('All done!')
