'use client'

/**
 * The check in/out report — a paper pull sheet, typed in.
 *
 * The whole design follows from what the person doing this is actually
 * holding: a marked-up sheet, a pen, and forty lines of which two are
 * wrong. So:
 *
 *   - Every line arrives pre-filled with what the order says. Doing
 *     nothing and hitting Submit records "it all went as written",
 *     which is the truth on most days and should take one tap.
 *   - A line only opens its exchange/note fields when its count differs
 *     or the supervisor asks for them. The sheet stays scannable.
 *   - The consequences are stated on screen BEFORE submitting, not
 *     discovered afterwards: a check-out that differs says, in words,
 *     that it will change the order and tell the agent.
 *
 * Hugo, 2026-09-03: "there are last minute exchanges and modifications
 * that will need to be done to the order based on the check out report.
 * This should be done and modify the order and flag back to the sales
 * agent."
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, AlertTriangle, Check } from 'lucide-react'
import type { ReportDraft, DraftLine } from '@/lib/orders/checkReports'

type Row = DraftLine & { open: boolean }
type Extra = { key: string; description: string; actualQty: number; note: string }

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function CheckReportForm({ draft }: { draft: ReportDraft }) {
  const router = useRouter()
  const isOut = draft.edge === 'OUT'

  const [rows, setRows] = useState<Row[]>(() =>
    draft.lines.map((l) => ({
      ...l,
      // A line a previous report marked up opens already expanded, so a
      // correction shows what was said rather than hiding it.
      open: l.actualQty !== l.expectedQty || !!l.substituteFor || !!l.note,
    })),
  )
  const [extras, setExtras] = useState<Extra[]>(() =>
    draft.extras.map((e, i) => ({
      key: `prior-${i}`,
      description: e.description,
      actualQty: e.actualQty,
      note: e.note ?? '',
    })),
  )
  const [preppedBy, setPreppedBy] = useState(draft.preppedBy)
  const [notes, setNotes] = useState(draft.notes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ changedOrder: boolean; changes: string[] } | null>(null)

  const patch = (id: string, next: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.orderLineItemId === id ? { ...r, ...next } : r)))

  const diffs = useMemo(
    () =>
      rows.filter((r) => r.actualQty !== r.expectedQty || (r.substituteFor ?? '').trim()).length +
      extras.filter((e) => e.description.trim()).length,
    [rows, extras],
  )

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${draft.orderId}/check-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edge: draft.edge,
          preppedBy,
          notes,
          lines: [
            ...rows.map((r) => ({
              orderLineItemId: r.orderLineItemId,
              description: r.description,
              actualQty: r.actualQty,
              substituteFor: (r.substituteFor ?? '').trim() || null,
              note: (r.note ?? '').trim() || null,
            })),
            ...extras
              .filter((e) => e.description.trim())
              .map((e) => ({
                orderLineItemId: null,
                description: e.description.trim(),
                actualQty: e.actualQty,
                note: e.note.trim() || null,
              })),
          ],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.reason || data.error || `Could not file the report (${res.status}).`)
        return
      }
      setDone({ changedOrder: !!data.changedOrder, changes: data.changes ?? [] })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file the report.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-1 py-8">
        <div className="border border-zinc-800 rounded-xl p-6 bg-zinc-900/40 text-center">
          <Check size={28} aria-hidden className="mx-auto mb-3 text-emerald-400" />
          <h1 className="text-white text-lg font-semibold mb-1">
            {isOut ? 'Check-out report filed' : 'Check-in report filed'}
          </h1>
          {done.changedOrder ? (
            <>
              <p className="text-zinc-400 text-sm max-w-[52ch] mx-auto">
                The order has been updated and {draft.agentName || 'the agent'} has been flagged to
                review what changed.
              </p>
              <ul className="mt-3 text-[13px] text-amber-300 space-y-0.5">
                {done.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </>
          ) : (
            <p className="text-zinc-400 text-sm">
              {isOut
                ? 'Everything went out as ordered — nothing to change.'
                : 'Everything came back as expected.'}
            </p>
          )}
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link
              href="/reports/orders"
              className="text-[12px] font-bold px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              Back to reports
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-1 py-2">
      <Link
        href="/reports/orders"
        className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-amber-500 mb-3"
      >
        <ArrowLeft size={13} aria-hidden />
        All reports
      </Link>

      <header className="mb-5">
        <div className="text-amber-500 text-xs font-semibold uppercase tracking-wide mb-1">
          {isOut ? 'Check out' : 'Check in'}
        </div>
        <h1 className="text-white text-2xl font-bold">{draft.jobName}</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          <span className="font-mono">{draft.orderNumber}</span>
          <span> · {draft.company}</span>
          <span> · {fmtDay(draft.startDate)} – {fmtDay(draft.endDate)}</span>
          {draft.agentName && <span> · agent {draft.agentName}</span>}
        </p>
        {draft.filed && (
          <p className="text-[12px] text-zinc-500 mt-2 border border-zinc-800 rounded-lg px-3 py-2">
            Already filed {new Date(draft.filed.submittedAt).toLocaleString('en-US')}
            {draft.filed.preppedBy ? ` · prepped by ${draft.filed.preppedBy}` : ''}. Submitting again
            replaces it.
          </p>
        )}
      </header>

      {/* Who prepped it — the name on the paper. */}
      <div className="mb-4">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">
            Prepped &amp; loaded by
          </span>
          <input
            value={preppedBy}
            onChange={(e) => setPreppedBy(e.target.value)}
            placeholder="The associate who pulled it"
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
        </label>
      </div>

      <div className="border border-zinc-800 rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold">
            {isOut ? 'What actually went out' : 'What actually came back'}
          </span>
          <span className="text-[11px] text-zinc-500">{rows.length} lines · pre-filled from the order</span>
        </div>

        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">This order has no line items.</p>
        )}

        {rows.map((r) => {
          const differs = r.actualQty !== r.expectedQty || !!(r.substituteFor ?? '').trim()
          return (
            <div
              key={r.orderLineItemId}
              className={`px-3 py-2.5 border-b border-zinc-800 last:border-b-0 ${differs ? 'bg-amber-950/20' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-white text-[14px] truncate">{r.description}</div>
                  <div className="text-zinc-500 text-[12px] truncate">
                    {r.qualifier && <span>{r.qualifier} · </span>}
                    ordered {r.expectedQty}
                    {r.lane && <span className="text-zinc-600"> · {r.lane.toLowerCase()}</span>}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 flex-none">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wide">
                    {isOut ? 'Out' : 'In'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={r.actualQty}
                    onChange={(e) => patch(r.orderLineItemId, { actualQty: Math.max(0, Number(e.target.value) || 0) })}
                    className={`w-16 text-center bg-zinc-800 border rounded-lg px-2 py-1.5 text-sm text-white ${
                      differs ? 'border-amber-600' : 'border-zinc-700'
                    }`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => patch(r.orderLineItemId, { open: !r.open })}
                  className="text-[11px] font-semibold text-zinc-400 hover:text-amber-500 px-2 py-1.5 flex-none"
                >
                  {r.open ? 'Hide' : 'Swap / note'}
                </button>
              </div>

              {r.open && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
                      Sent something else instead
                    </span>
                    <input
                      value={r.substituteFor ?? ''}
                      onChange={(e) => patch(r.orderLineItemId, { substituteFor: e.target.value })}
                      placeholder="What this replaced"
                      className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[13px] text-white placeholder:text-zinc-600"
                    />
                    {/* The order line is RENAMED, not deleted — it keeps
                        its rate and dates, and the report holds the
                        original wording. */}
                    <span className="text-[10px] text-zinc-600 mt-0.5 block">
                      Put the swapped-in item in the line name above; this field records what it replaced.
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">Note</span>
                    <input
                      value={r.note ?? ''}
                      onChange={(e) => patch(r.orderLineItemId, { note: e.target.value })}
                      placeholder="Anything the agent should know"
                      className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[13px] text-white placeholder:text-zinc-600"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
                      Line name
                    </span>
                    <input
                      value={r.description}
                      onChange={(e) => patch(r.orderLineItemId, { description: e.target.value })}
                      className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[13px] text-white"
                    />
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Things that went that were never on the order. Recorded and
          flagged, never priced here — the yard cannot see rates, and a
          line added at $0 would silently under-bill the job. */}
      <div className="border border-zinc-800 rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400 font-semibold">
            Not on the order
          </span>
          <span className="text-[11px] text-zinc-500 ml-2">
            Flagged to the agent to price — nothing is added to the order here.
          </span>
        </div>
        {extras.map((e, i) => (
          <div key={e.key} className="px-3 py-2.5 border-b border-zinc-800 last:border-b-0 flex items-center gap-2">
            <input
              value={e.description}
              onChange={(ev) =>
                setExtras((prev) => prev.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))
              }
              placeholder="What went out that isn't on the order"
              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[13px] text-white placeholder:text-zinc-600"
            />
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={e.actualQty}
              onChange={(ev) =>
                setExtras((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, actualQty: Math.max(0, Number(ev.target.value) || 0) } : x)),
                )
              }
              className="w-16 text-center bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white flex-none"
            />
            <button
              type="button"
              onClick={() => setExtras((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Remove this row"
              className="text-zinc-500 hover:text-rose-400 px-1.5 py-1.5 flex-none"
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setExtras((prev) => [...prev, { key: `new-${Date.now()}`, description: '', actualQty: 1, note: '' }])
          }
          className="w-full px-3 py-2.5 text-[12px] font-semibold text-zinc-400 hover:text-amber-500 inline-flex items-center justify-center gap-1.5"
        >
          <Plus size={13} aria-hidden />
          Add a row
        </button>
      </div>

      <label className="block mb-4">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">
          Notes on the sheet
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything written on the paper that doesn't belong to one line."
          className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 leading-relaxed"
        />
      </label>

      {/* Say what Submit will do before it does it. */}
      {diffs > 0 && (
        <p className="mb-3 text-[13px] text-amber-300 border border-amber-900 bg-amber-950/40 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>
            {diffs} line{diffs === 1 ? '' : 's'} differ from the order.
            {isOut
              ? ` Filing this updates the order and flags ${draft.agentName || 'the agent'} to review it.`
              : ' A check-in is recorded and flagged, but never changes what was rented — the agent decides what a shortfall costs.'}
          </span>
        </p>
      )}

      {error && <p className="mb-3 text-[13px] text-rose-400">{error}</p>}

      <div className="flex items-center gap-3 pb-8">
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          {saving ? 'Filing…' : draft.filed ? 'Replace the filed report' : 'File the report'}
        </button>
        <Link href="/reports/orders" className="text-[13px] text-zinc-500 hover:text-zinc-300">
          Cancel
        </Link>
      </div>
    </div>
  )
}
