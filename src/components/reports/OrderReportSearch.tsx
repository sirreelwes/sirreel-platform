'use client'

/**
 * The top of Check In/Out Reports: find an order by job or company, and — on
 * the check-in side — scan a unit's barcode to open the order it is out on.
 *
 * Wes 2026-09-16, from the warehouse: "a search bar at the top of the page
 * so they can search the job name or company name and it pulls up the
 * order", and "On Check In … a barcode search bar, where they can scan a
 * barcode and it pulls up the whole order that the barcode is on."
 *
 * A scan opens that order's check-in sheet with the code handed over, so the
 * unit that was just scanned is recorded back straight away — the person is
 * holding it.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ScanLine, Search } from 'lucide-react'

interface Hit {
  orderId: string
  orderNumber: string
  status: string
  jobName: string | null
  jobCode: string | null
  company: string | null
  startDate: string | null
  endDate: string | null
  outFiled: boolean
  inFiled: boolean
}

const fmtDay = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'

export function OrderReportSearch() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits(null)
      return
    }
    let cancelled = false
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/reports/orders/search?q=${encodeURIComponent(term)}`)
        const j = await r.json().catch(() => ({}))
        if (!cancelled) setHits(j.orders ?? [])
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  return (
    <div className="mb-4">
      <div className="relative">
        <Search size={17} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-lt-fg3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a job, company or order number"
          className="w-full rounded-xl border border-lt-hairline bg-lt-card pl-10 pr-10 py-3 text-[16px] text-lt-fg placeholder:text-lt-fg3 focus:border-amber-600 focus:outline-none"
        />
        {busy && <Loader2 size={16} aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-lt-fg3" />}
      </div>
      {hits && (
        <div className="mt-2 rounded-xl border border-lt-hairline bg-lt-card divide-y divide-lt-hairline">
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-[14px] text-lt-fg2">No order matches &ldquo;{q.trim()}&rdquo;.</p>
          ) : (
            hits.map((h) => (
              <div key={h.orderId} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-lt-fg truncate">
                    {h.jobName ?? '—'}
                    <span className="ml-2 font-mono text-[13px] font-normal text-lt-fg3">{h.orderNumber}</span>
                  </div>
                  <div className="text-[13px] text-lt-fg2 truncate">
                    {h.company ?? '—'} · {fmtDay(h.startDate)} – {fmtDay(h.endDate)}
                  </div>
                </div>
                <a
                  href={`/reports/orders/${h.orderId}?edge=OUT`}
                  className="min-h-[40px] inline-flex items-center rounded-lg border border-lt-hairline px-3 text-[14px] font-semibold text-lt-fg hover:border-amber-600"
                >
                  Check out{h.outFiled ? ' ✓' : ''}
                </a>
                <a
                  href={`/reports/orders/${h.orderId}?edge=IN`}
                  className="min-h-[40px] inline-flex items-center rounded-lg border border-lt-hairline px-3 text-[14px] font-semibold text-lt-fg hover:border-amber-600"
                >
                  Check in{h.inFiled ? ' ✓' : ''}
                </a>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Check-in: scan a label → the order that unit is out on. */
export function CheckInBarcodeJump() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function go(raw: string) {
    const c = raw.trim()
    if (!c || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(`/api/warehouse/units/lookup?code=${encodeURIComponent(c)}`)
      const j = await r.json().catch(() => ({}))
      if (j.out?.orderId) {
        router.push(`/reports/orders/${j.out.orderId}?edge=IN&scan=${encodeURIComponent(c)}`)
        return
      }
      setMsg(
        j.unit
          ? `${j.unit.barcode}${j.unit.description ? ` ${j.unit.description}` : ''} isn't out on any order right now. Search the job above instead.`
          : `No unit with barcode ${c}.`,
      )
      setCode('')
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-lt-hairline bg-lt-card p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void go(code)
        }}
        className="flex items-center gap-2"
      >
        <ScanLine size={18} aria-hidden className="flex-none text-lt-fg2" />
        <input
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scan a barcode to open its order"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="flex-1 min-w-0 rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2.5 text-[16px] font-mono text-lt-fg placeholder:font-sans placeholder:text-lt-fg3 focus:border-amber-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="min-h-[44px] rounded-lg bg-amber-600 px-4 text-[14px] font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? '…' : 'Find'}
        </button>
      </form>
      {msg && <p className="mt-2 text-[13px] text-chip-warn-fg">{msg}</p>}
    </div>
  )
}
