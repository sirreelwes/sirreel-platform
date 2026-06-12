'use client'

/**
 * ThankYousToSendWidget — dashboard queue for SUGGESTED
 * ThankYouSuggestion rows. Mirrors the claim-mail / capture-review
 * widget pattern: collapsible, counts header, click a row to open
 * the compose view (STEP 3 — `/orders/[id]/thank-you`).
 *
 * Rows show: client name, job/show, wrap date, age, photo status
 * chip, warn pill for open Incident or unresolved L&D. Rows that
 * are > 14 days old gray out + carry an "expired" tag — sendable
 * still, but the visual nudge is that a month-late thank-you is
 * worse than no thank-you.
 *
 * Mobile-first: the warehouse team triages from phones. List rows
 * stack vertically below md; tap targets are large.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Item {
  id: string
  status: 'SUGGESTED' | 'SENT' | 'DISMISSED'
  photoDocumentId: string | null
  photoDocument: { id: string; fileUrl: string; title: string } | null
  personalNote: string | null
  sentAt: string | null
  createdAt: string
  ageDays: number
  expired: boolean
  orderId: string
  orderNumber: string
  orderStatus: string
  wrapDate: string | null
  wrapDays: number | null
  company: { id: string; name: string } | null
  agent: { id: string; name: string; email: string; displayTitle: string | null } | null
  jobContact: { id: string; firstName: string; lastName: string; email: string } | null
  job: { id: string; jobCode: string; name: string } | null
  jobPhotos: { id: string; fileUrl: string }[]
  hasPhoto: boolean
  flags: {
    openIncident: boolean
    incidents: { id: string; incidentNumber: string; status: string; damageItemCount: number }[]
    unresolvedLd: boolean
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '--'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ThankYousToSendWidget({ scope = 'mine' }: { scope?: 'mine' | 'all' }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/orders/thank-yous?scope=${scope}&status=SUGGESTED`)
      const data = await res.json()
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      setItems(data.items as Item[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [scope])

  useEffect(() => { load() }, [load])

  if (items == null) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 text-[12px] text-gray-500">
        Loading thank-yous…
      </div>
    )
  }

  if (items.length === 0) return null

  const expiredCount = items.filter((i) => i.expired).length

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Thank-yous to send
          </span>
          <span className="text-[11px] text-gray-600">
            {items.length} {items.length === 1 ? 'job' : 'jobs'}
            {expiredCount > 0 && (
              <span className="text-amber-700"> · {expiredCount} expired</span>
            )}
          </span>
        </div>
        <span className="text-[11px] text-gray-400">{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>

      {err && <div className="px-4 py-2 text-[11px] text-red-700 bg-red-50">{err}</div>}

      {!collapsed && (
        <div className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/orders/${it.orderId}/thank-you`}
              className={`flex flex-col md:flex-row md:items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors ${it.expired ? 'opacity-60' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-gray-900">
                  {it.company?.name || '(no client)'}
                  {it.expired && (
                    <span className="text-[9px] uppercase font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">expired</span>
                  )}
                  {it.flags.openIncident && (
                    <span className="text-[9px] uppercase font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                      Open incident
                    </span>
                  )}
                  {it.flags.unresolvedLd && !it.flags.openIncident && (
                    <span className="text-[9px] uppercase font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      Unresolved L&amp;D
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-600 truncate">
                  {it.job?.name || it.orderNumber} · wrap {fmtDate(it.wrapDate)}
                  {' · '}
                  <span className="text-gray-400">
                    {it.wrapDays != null ? (
                      it.wrapDays === 0 ? 'today' : `${it.wrapDays}d ago`
                    ) : ''}
                  </span>
                  {it.agent && <span className="text-gray-400"> · {it.agent.name}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {it.hasPhoto ? (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    📷 {it.jobPhotos.length || (it.photoDocument ? 1 : 0)} photo
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                    no photo
                  </span>
                )}
                <span className="text-[10px] text-gray-400 font-bold">
                  {it.ageDays === 0 ? 'today' : `${it.ageDays}d`}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
