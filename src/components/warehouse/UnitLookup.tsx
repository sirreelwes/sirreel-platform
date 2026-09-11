'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ScanLine, AlertTriangle } from 'lucide-react'
import type { UnitLookup as Lookup } from '@/lib/warehouse/unitScans'

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(new Date(iso))

const money = (s: string) => `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export function UnitLookup() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Lookup | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function go(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/warehouse/units/lookup?code=${encodeURIComponent(trimmed)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.reason || data.error || `Lookup failed (${res.status}).`)
        return
      }
      setResult(data as Lookup)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed.')
    } finally {
      setBusy(false)
      setCode('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void go(code)
        }}
        className="flex items-center gap-2 mb-4"
      >
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scan a label, or type SR004674"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy}
          className="flex-1 min-w-0 bg-lt-card border border-lt-hairline rounded-lg px-3 py-2.5 text-[16px] font-mono text-lt-fg placeholder:text-lt-fg3 placeholder:font-sans focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="flex-none inline-flex items-center gap-1.5 text-[14px] font-semibold rounded-lg px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
        >
          <ScanLine size={15} aria-hidden />
          {busy ? '…' : 'Look up'}
        </button>
      </form>

      {error && (
        <p className="text-[13px] text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2 mb-4 flex items-start gap-1.5">
          <AlertTriangle size={13} aria-hidden className="flex-none mt-0.5" />
          {error}
        </p>
      )}

      {result && !result.unit && (
        <p className="text-[15px] text-lt-fg2 bg-lt-card border border-lt-hairline rounded-xl px-4 py-5">
          {result.resolution === 'catalog'
            ? `${result.scanned} is a catalog code, not a unit label — it names the product, not one piece of it.`
            : `${result.scanned} isn't a barcode in the register. Check the label; the register is mirrored from RentalWorks nightly.`}
        </p>
      )}

      {result?.unit && (
        <div className="space-y-4">
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
            <div className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1">Unit</div>
            <div className="text-lt-fg text-[18px] font-semibold">
              {result.unit.catalogName ?? result.unit.description ?? result.unit.barcode}
            </div>
            <div className="text-lt-fg2 text-[13px] mt-0.5">
              <span className="font-mono text-lt-fg">{result.unit.barcode}</span>
              {result.unit.serialNumber && <span> · serial {result.unit.serialNumber}</span>}
              {result.unit.description && result.unit.catalogName && <span> · RW: {result.unit.description}</span>}
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mt-3 text-[13px]">
              <div>
                <dt className="text-lt-fg3">RW status</dt>
                <dd className="text-lt-fg">{result.unit.rwStatus ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-lt-fg3">Shelf</dt>
                <dd className="text-lt-fg">{result.unit.shelf ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-lt-fg3">Warehouse</dt>
                <dd className="text-lt-fg">{result.unit.warehouse ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-lt-fg3">Replacement</dt>
                <dd className="text-lt-fg">{result.unit.replacementCost ? money(result.unit.replacementCost) : '—'}</dd>
              </div>
            </dl>
            <p className="text-[12px] text-lt-fg3 mt-2">Register last synced {fmt(result.unit.lastSeenAt)}.</p>
          </div>

          <div
            className={`border rounded-xl p-4 ${
              result.out ? 'bg-chip-warn-bg border-chip-warn-fg/20' : 'bg-chip-good-bg border-chip-good-fg/20'
            }`}
          >
            <div className={`text-[12px] uppercase tracking-wide font-semibold mb-1 ${result.out ? 'text-chip-warn-fg' : 'text-chip-good-fg'}`}>
              Right now
            </div>
            {!result.tracked ? (
              <p className="text-[15px] text-lt-fg2">
                Scan tracking isn’t switched on yet — the scan table has not been created.
              </p>
            ) : result.out ? (
              <div className="text-[15px] text-chip-warn-fg">
                Out on{' '}
                <Link href={`/reports/orders/${result.out.orderId}?edge=IN`} className="font-semibold underline">
                  {result.out.orderNumber}
                </Link>
                {result.out.jobName && <span> · {result.out.jobName}</span>}
                {result.out.company && <span className="text-lt-fg2"> · {result.out.company}</span>}
                <div className="text-[13px] mt-0.5">
                  since {fmt(result.out.since)}
                  {result.out.lineDescription && <span> · counted on “{result.out.lineDescription}”</span>}
                </div>
              </div>
            ) : (
              <p className="text-[15px] text-chip-good-fg">
                Not out on any order, as far as the scanners know.
              </p>
            )}
          </div>

          {result.history.length > 0 && (
            <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-lt-inner border-b border-lt-hairline text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
                Recent trips
              </div>
              <ul>
                {result.history.map((h) => (
                  <li
                    key={h.scanId}
                    className={`px-4 py-2 border-b border-lt-hairline last:border-b-0 text-[13px] flex flex-wrap items-center gap-x-3 gap-y-0.5 ${
                      h.voided ? 'text-lt-fg3 line-through' : 'text-lt-fg'
                    }`}
                  >
                    <Link href={`/orders/${h.orderId}`} className="font-semibold hover:text-amber-600">
                      {h.orderNumber}
                    </Link>
                    {h.jobName && <span className="text-lt-fg2 truncate">{h.jobName}</span>}
                    <span className="text-lt-fg2 ml-auto">
                      {h.outAt ? `out ${fmt(h.outAt)}` : 'no out scan'}
                      {' · '}
                      {h.inAt ? `back ${fmt(h.inAt)}${h.inImplied ? ' (implied)' : ''}` : 'not back'}
                      {h.voided ? ' · withdrawn' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
