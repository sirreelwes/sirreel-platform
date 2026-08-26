'use client'

/**
 * /admin/cardpointe-calls — what SirReel actually sent CardPointe.
 *
 * Built after Fiserv's validation review reported a CVV on a merchant-
 * initiated charge and incomplete stored-credential fields. Both were
 * invisible here: nothing persisted the gateway payloads, so the only party
 * who could see our traffic was Fiserv.
 *
 * Ordered around the compliance question rather than the log. The flags come
 * first, because "is anything wrong right now" is what someone opens this
 * page to learn; the raw payloads are underneath for when the answer is yes.
 *
 * Everything shown is redacted at write time — tokens masked to last 4, CVV
 * and track data dropped. `cvvresp` is a response code, not a CVV.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CallFlag } from '@/lib/cardpointe/callFlags'

interface Call {
  id: string
  operation: string
  merchid: string | null
  retref: string | null
  respstat: string | null
  respcode: string | null
  resptext: string | null
  amount: string | null
  cvvresp: string | null
  avsresp: string | null
  httpStatus: number | null
  createdAt: string
  approved: boolean | null
  request: unknown
  response: unknown
  flags: CallFlag[]
}

interface Summary {
  total: number
  lastCallAt: string | null
  byOperation: Record<string, number>
  flagCounts: Record<string, number>
  flagWindow: number
}

const FLAG_TITLES: Record<string, string> = {
  cvv_on_mit: 'CVV on merchant-initiated charge',
  missing_cof_fields: 'Incomplete stored-credential fields',
  cnp_no_postal: 'CNP auth with no postal code',
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function CardpointeCallsPage() {
  const [calls, setCalls] = useState<Call[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const [operation, setOperation] = useState('')
  const [retref, setRetref] = useState('')
  const [flagged, setFlagged] = useState(false)
  const [declined, setDeclined] = useState(false)

  const load = useCallback(
    async (append: boolean, nextCursor?: string | null) => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams()
        if (operation) qs.set('operation', operation)
        if (retref.trim()) qs.set('retref', retref.trim())
        if (flagged) qs.set('flagged', '1')
        if (declined) qs.set('declined', '1')
        if (append && nextCursor) qs.set('cursor', nextCursor)
        const res = await fetch(`/api/admin/cardpointe-calls?${qs}`)
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        setCalls((prev) => (append ? [...prev, ...data.calls] : data.calls))
        setSummary(data.summary)
        setCursor(data.nextCursor)
        setHasMore(!!data.hasMore)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load gateway calls.')
      } finally {
        setLoading(false)
      }
    },
    [operation, retref, flagged, declined],
  )

  useEffect(() => {
    load(false)
  }, [load])

  const criticalCount = summary?.flagCounts?.cvv_on_mit ?? 0
  const warningCount = Object.entries(summary?.flagCounts ?? {})
    .filter(([k]) => k !== 'cvv_on_mit')
    .reduce((sum, [, n]) => sum + n, 0)

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-lt-fg">CardPointe gateway calls</h1>
        <p className="text-sm text-lt-fg2 mt-1">
          Every request SirReel makes to the payment gateway, with the response. Tokens are
          masked to last 4 and CVV/track data is never stored — <code className="text-lt-fg">cvvresp</code>{' '}
          is the network&apos;s verdict, not a card number.
        </p>
      </div>

      {/* Compliance first: the reason this page exists. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div
          className={`rounded-lg border p-4 text-white ${
            criticalCount > 0 ? 'border-red-600 bg-red-950' : 'border-zinc-700 bg-zinc-900'
          }`}
        >
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">PCI violations</div>
          <div className={`text-2xl font-semibold mt-1 ${criticalCount > 0 ? 'text-red-300' : 'text-emerald-400'}`}>
            {criticalCount}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">CVV sent on a merchant-initiated charge</div>
        </div>
        <div
          className={`rounded-lg border p-4 text-white ${
            warningCount > 0 ? 'border-amber-600 bg-amber-950' : 'border-zinc-700 bg-zinc-900'
          }`}
        >
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Warnings</div>
          <div className={`text-2xl font-semibold mt-1 ${warningCount > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
            {warningCount}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Missing COF fields or postal code</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-white">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Calls recorded</div>
          <div className="text-2xl font-semibold mt-1">{summary?.total ?? '—'}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {summary
              ? Object.entries(summary.byOperation)
                  .map(([op, n]) => `${op} ${n}`)
                  .join(' · ') || 'nothing yet'
              : ''}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-white">
          <div className="text-[11px] uppercase tracking-wider text-zinc-400">Last call</div>
          <div className="text-lg font-semibold mt-1">
            {summary?.lastCallAt ? timeLabel(summary.lastCallAt) : '—'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {summary && summary.total > summary.flagWindow
              ? `flags scanned over the last ${summary.flagWindow}`
              : 'flags scanned over all calls'}
          </div>
        </div>
      </div>

      {/* Recording started when the log shipped; nothing before it exists. */}
      {summary?.total === 0 && !loading && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-6 mb-6 text-sm text-zinc-400">
          No gateway calls recorded yet. Logging began 2026-08-14 — transactions before that,
          including the Fiserv validation set, were never persisted and cannot be shown here.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
        >
          <option value="">All operations</option>
          <option value="auth">auth</option>
          <option value="void">void</option>
          <option value="refund">refund</option>
          <option value="inquire">inquire</option>
        </select>
        <input
          value={retref}
          onChange={(e) => setRetref(e.target.value)}
          placeholder="Search retref…"
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-52 text-white placeholder:text-zinc-500"
        />
        <button
          onClick={() => setFlagged((v) => !v)}
          className={`px-3 py-2 rounded text-sm border ${
            flagged ? 'bg-amber-600 border-amber-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300'
          }`}
        >
          Flagged only
        </button>
        <button
          onClick={() => setDeclined((v) => !v)}
          className={`px-3 py-2 rounded text-sm border ${
            declined ? 'bg-amber-600 border-amber-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300'
          }`}
        >
          Not approved
        </button>
        <button
          onClick={() => load(false)}
          className="px-3 py-2 rounded text-sm bg-zinc-800 border border-zinc-700 text-zinc-300"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 mb-4">{error}</div>
      )}

      <div className="rounded-lg border border-zinc-700 bg-zinc-900 text-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-800 text-zinc-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Op</th>
                <th className="text-left px-3 py-2 font-medium">Retref</th>
                <th className="text-left px-3 py-2 font-medium">Result</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">CVV</th>
                <th className="text-left px-3 py-2 font-medium">AVS</th>
                <th className="text-left px-3 py-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  className={`border-t border-zinc-800 cursor-pointer hover:bg-zinc-800/50 ${
                    c.flags.some((f) => f.severity === 'critical') ? 'bg-red-950/30' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{timeLabel(c.createdAt)}</td>
                  <td className="px-3 py-2 text-zinc-300">{c.operation}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{c.retref || '—'}</td>
                  <td className="px-3 py-2">
                    {c.approved === null ? (
                      <span className="text-zinc-500">—</span>
                    ) : c.approved ? (
                      <span className="text-emerald-400">Approved</span>
                    ) : (
                      <span className="text-red-300">{c.resptext || 'Declined'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">{c.amount ? `$${c.amount}` : '—'}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.cvvresp || '—'}</td>
                  <td className="px-3 py-2 text-zinc-400">{c.avsresp || '—'}</td>
                  <td className="px-3 py-2">
                    {c.flags.length === 0 ? (
                      <span className="text-zinc-600">clean</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {c.flags.map((f) => (
                          <span
                            key={f.code}
                            title={f.detail}
                            className={`px-1.5 py-0.5 rounded text-[11px] ${
                              f.severity === 'critical'
                                ? 'bg-red-900 text-red-200'
                                : 'bg-amber-900/60 text-amber-200'
                            }`}
                          >
                            {FLAG_TITLES[f.code] || f.code}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {calls.map((c) =>
                expanded === c.id ? (
                  <tr key={`${c.id}-detail`} className="border-t border-zinc-800 bg-zinc-950">
                    <td colSpan={8} className="px-3 py-3">
                      {c.flags.length > 0 && (
                        <div className="mb-3 space-y-1.5">
                          {c.flags.map((f) => (
                            <div
                              key={f.code}
                              className={`rounded border px-3 py-2 text-xs ${
                                f.severity === 'critical'
                                  ? 'border-red-700 bg-red-950/50 text-red-200'
                                  : 'border-amber-700 bg-amber-950/40 text-amber-200'
                              }`}
                            >
                              <span className="font-semibold">{f.label}</span> — {f.detail}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                            Request sent
                          </div>
                          <pre className="text-[11px] bg-zinc-900 border border-zinc-800 rounded p-2 overflow-x-auto text-zinc-300">
                            {JSON.stringify(c.request, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                            Response received {c.httpStatus ? `(HTTP ${c.httpStatus})` : ''}
                          </div>
                          <pre className="text-[11px] bg-zinc-900 border border-zinc-800 rounded p-2 overflow-x-auto text-zinc-300">
                            {JSON.stringify(c.response, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              )}
              {calls.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">
                    {summary?.total === 0 ? 'No calls recorded yet.' : 'No calls match these filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        {hasMore && (
          <button
            onClick={() => load(true, cursor)}
            disabled={loading}
            className="px-4 py-2 rounded text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
          >
            Load more
          </button>
        )}
        {loading && <span className="text-sm text-lt-fg2">Loading…</span>}
      </div>
    </div>
  )
}
