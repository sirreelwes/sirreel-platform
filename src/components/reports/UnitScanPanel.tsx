'use client'

/**
 * The scanner box on the check in/out report — barcode phase 3.
 *
 * Wes, 2026-09-11: "it makes checking out the orders so much quicker if
 * they can just simply scan the barcode." So the box is the first thing
 * on the sheet that takes focus, a wedge scanner's Enter submits it, and
 * focus comes straight back for the next label. Nothing else on the
 * screen has to be touched between scans.
 *
 * Every answer is a sentence, not a beep: which line the unit landed on
 * and where the count stands, or exactly why it didn't and the one
 * button that pushes it through when the supervisor says so.
 */

import { useEffect, useRef, useState } from 'react'
import { ScanLine, Check, AlertTriangle, X, Undo2 } from 'lucide-react'
import type { UnitScanSummary, LineUnitSummary, UnitScanUnit } from '@/lib/warehouse/unitScanRules'

type Edge = 'OUT' | 'IN'

type Feed = {
  key: string
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  text: string
  /** Re-send the same code with this flag. */
  override?: { flag: 'allowOver' | 'closeOpen'; code: string; label: string }
  /** A landed scan with per-unit checks: the chips the desk can tap to
   *  mark one missing. The list IS the state — each tap PATCHes it. */
  checks?: { scanId: string; names: string[]; missing: string[] }
}

export function UnitScanPanel({
  orderId,
  edge,
  trackedLines,
  summary,
  onSummary,
}: {
  orderId: string
  edge: Edge
  /** How many lines on the order a scanner can count. */
  trackedLines: number
  summary: UnitScanSummary
  onSummary: (s: UnitScanSummary) => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [feed, setFeed] = useState<Feed[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const isOut = edge === 'OUT'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function push(f: Omit<Feed, 'key'>) {
    setFeed((prev) => [{ ...f, key: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 6))
  }

  async function submit(raw: string, flags: { allowOver?: boolean; closeOpen?: boolean } = {}) {
    const trimmed = raw.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/unit-scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edge, code: trimmed, ...flags }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const flag = data.override as 'allowOver' | 'closeOpen' | null
        push({
          tone: 'bad',
          text: data.reason || data.error || `Scan failed (${res.status}).`,
          override: flag
            ? {
                flag,
                code: trimmed,
                label:
                  flag === 'closeOpen'
                    ? `Mark it back from ${data.openOn?.orderNumber ?? 'that order'} and ${isOut ? 'send it out here' : 'record it'}`
                    : isOut
                      ? 'Send it anyway'
                      : 'Record it anyway',
              }
            : undefined,
        })
        return
      }
      const names: string[] = Array.isArray(data.checks) ? data.checks : []
      const landed = data.outcome !== 'duplicate' && data.scanId && names.length > 0
      // The unit's current missing list, if the summary already knows it
      // (a re-scan of a unit marked earlier keeps its chips honest).
      const known = data.summary
        ? [...(data.summary.lines as LineUnitSummary[]).flatMap((l) => l.units), ...(data.summary.unlisted as UnitScanUnit[])]
            .find((u) => u.scanId === data.scanId)
        : undefined
      push({
        tone: data.outcome === 'duplicate' ? 'warn' : 'good',
        text: data.message,
        checks: landed
          ? { scanId: data.scanId, names, missing: known ? (isOut ? known.missingOut : known.missingIn) : [] }
          : undefined,
      })
      if (data.summary) onSummary(data.summary)
    } catch (e) {
      push({ tone: 'bad', text: e instanceof Error ? e.message : 'Scan failed.' })
    } finally {
      setBusy(false)
      setCode('')
      // Back to the box: the next label is already in the other hand.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const stillOut = summary.lines.reduce((n, l) => n + l.stillOut, 0) + summary.unlisted.filter((u) => u.outAt && !u.inAt).length

  /** Tap a chip: flip that check between present and missing. */
  async function toggleCheck(feedKey: string, scanId: string, name: string, current: string[]) {
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]
    // Optimistic — the chip flips at once; the server answer settles it.
    setFeed((prev) => prev.map((f) => (f.key === feedKey && f.checks ? { ...f, checks: { ...f.checks, missing: next } } : f)))
    try {
      const res = await fetch(`/api/orders/${orderId}/unit-scans/${scanId}/checks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edge, missing: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setFeed((prev) => prev.map((f) => (f.key === feedKey && f.checks ? { ...f, checks: { ...f.checks, missing: data.missing ?? next } } : f)))
        if (data.summary) onSummary(data.summary)
      } else {
        setFeed((prev) => prev.map((f) => (f.key === feedKey && f.checks ? { ...f, checks: { ...f.checks, missing: current } } : f)))
        push({ tone: 'bad', text: data.error || `Could not record that (${res.status}).` })
      }
    } catch {
      setFeed((prev) => prev.map((f) => (f.key === feedKey && f.checks ? { ...f, checks: { ...f.checks, missing: current } } : f)))
    } finally {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  return (
    <div className="border border-lt-hairline bg-lt-card rounded-xl p-3 mb-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold inline-flex items-center gap-1.5">
          <ScanLine size={14} aria-hidden />
          {isOut ? 'Scan units going out' : 'Scan units coming back'}
        </span>
        <span className="text-[12px] text-lt-fg3">
          {isOut
            ? `${summary.totalOut} scanned · ${trackedLines} line${trackedLines === 1 ? '' : 's'} with barcodes`
            : `${summary.totalBack} back · ${stillOut} still out`}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(code)
        }}
        className="flex items-center gap-2"
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
          className="flex-1 min-w-0 bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2.5 text-[16px] font-mono text-lt-fg placeholder:text-lt-fg3 placeholder:font-sans focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="flex-none text-[14px] font-semibold rounded-lg px-3 py-2.5 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
        >
          {busy ? '…' : 'Scan'}
        </button>
      </form>
      <p className="text-[12px] text-lt-fg3 mt-1.5">
        {trackedLines === 0
          ? 'Nothing on this order carries a unit barcode — count it by hand. A scanned unit that is not on the order is still recorded.'
          : isOut
            ? 'Each scan counts one unit against its line and sets that line’s Out number. Lines without barcodes are typed as before.'
            : 'Each scan marks that exact unit back. What is still out is listed on the line.'}
      </p>

      {feed.length > 0 && (
        <ul className="mt-2 space-y-1">
          {feed.map((f, i) => (
            <li
              key={f.key}
              className={`text-[13px] rounded-lg px-2.5 py-1.5 flex items-start gap-2 ${
                f.tone === 'good'
                  ? 'bg-chip-good-bg text-chip-good-fg'
                  : f.tone === 'warn'
                    ? 'bg-chip-warn-bg text-chip-warn-fg'
                    : f.tone === 'bad'
                      ? 'bg-chip-bad-bg text-chip-bad-fg'
                      : 'bg-lt-inner text-lt-fg2'
              } ${i > 0 ? 'opacity-70' : ''}`}
            >
              {f.tone === 'good' ? (
                <Check size={14} aria-hidden className="flex-none mt-0.5" />
              ) : (
                <AlertTriangle size={14} aria-hidden className="flex-none mt-0.5" />
              )}
              <span className="flex-1 min-w-0">
                {f.text}
                {f.checks && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider font-bold opacity-70">
                      {isOut ? 'With it' : 'Came back with'}
                    </span>
                    {f.checks.names.map((name) => {
                      const missing = f.checks!.missing.includes(name)
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => void toggleCheck(f.key, f.checks!.scanId, name, f.checks!.missing)}
                          title={missing ? `Mark ${name} present` : `Mark ${name} missing`}
                          className={`text-[12px] font-semibold rounded-full px-2 py-0.5 border ${
                            missing
                              ? 'bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/30'
                              : 'bg-lt-card text-chip-good-fg border-chip-good-fg/30'
                          }`}
                        >
                          {name} {missing ? '✕ missing' : '✓'}
                        </button>
                      )
                    })}
                  </span>
                )}
                {f.override && i === 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(f.override!.code, { [f.override!.flag]: true })}
                    className="ml-2 underline font-semibold hover:text-amber-700"
                  >
                    {f.override.label}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(new Date(iso))

/**
 * The per-line strip under a scannable line: where the count stands,
 * and the labels behind it. Voiding a scan takes the unit back off the
 * line (the row is kept, voided).
 */
export function LineUnitStrip({
  orderId,
  edge,
  expectedQty,
  line,
  onSummary,
}: {
  orderId: string
  edge: Edge
  expectedQty: number
  line: LineUnitSummary | null
  onSummary: (s: UnitScanSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const isOut = edge === 'OUT'

  const out = line?.out ?? 0
  const back = line?.back ?? 0
  const stillOut = line?.stillOut ?? 0
  const missingCount = (line?.units ?? []).filter((u) => (isOut ? u.missingOut : u.missingIn).length > 0).length

  let label: string
  let tone: 'good' | 'warn' | 'neutral' | 'bad'
  if (isOut) {
    if (out === 0) {
      label = 'scan to count'
      tone = 'neutral'
    } else {
      label = `${out} of ${expectedQty} scanned${missingCount ? ` · ${missingCount} missing parts` : ''}`
      tone = missingCount ? 'bad' : out === expectedQty ? 'good' : 'warn'
    }
  } else if (out === 0 && back === 0) {
    label = 'nothing scanned out'
    tone = 'neutral'
  } else {
    label = `${back} of ${out || expectedQty} back${stillOut ? ` · ${stillOut} still out` : ''}${missingCount ? ` · ${missingCount} missing parts` : ''}`
    tone = stillOut || missingCount ? 'bad' : 'good'
  }

  async function undo(u: UnitScanUnit) {
    if (busy) return
    if (!confirm(`Take ${u.barcode} back off this line? The scan stays on record as withdrawn.`)) return
    setBusy(u.scanId)
    try {
      const res = await fetch(`/api/orders/${orderId}/unit-scans/${u.scanId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'withdrawn on the report screen' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.summary) onSummary(data.summary)
    } finally {
      setBusy(null)
    }
  }

  const units = line?.units ?? []

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => units.length && setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-full px-2 py-0.5 border ${
          tone === 'good'
            ? 'bg-chip-good-bg text-chip-good-fg border-chip-good-fg/20'
            : tone === 'warn'
              ? 'bg-chip-warn-bg text-chip-warn-fg border-chip-warn-fg/20'
              : tone === 'bad'
                ? 'bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/20'
                : 'bg-lt-inner text-lt-fg3 border-lt-hairline'
        }`}
      >
        <ScanLine size={12} aria-hidden />
        {label}
        {units.length > 0 && <span className="opacity-70">{open ? '▾' : '▸'}</span>}
      </button>

      {open && units.length > 0 && (
        <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {units.map((u) => {
            const isBack = !!u.inAt
            const isOpenRow = !!u.outAt && !u.inAt
            return (
              <li
                key={u.scanId}
                className="flex items-center gap-2 text-[13px] bg-lt-inner border border-lt-hairline rounded-lg px-2 py-1"
              >
                <span className="font-mono text-lt-fg">{u.barcode}</span>
                <span className="text-lt-fg3 truncate flex-1 min-w-0">
                  {isOut
                    ? u.outAt ? `out ${fmtTime(u.outAt)}` : `back ${fmtTime(u.inAt!)} · never scanned out`
                    : isBack
                      ? `back ${fmtTime(u.inAt!)}${u.inImplied ? ' · implied' : ''}`
                      : isOpenRow
                        ? 'still out'
                        : ''}
                </span>
                {(isOut ? u.missingOut : u.missingIn).length > 0 && (
                  <span className="text-[11px] font-bold uppercase tracking-wider text-chip-bad-fg whitespace-nowrap">
                    no {(isOut ? u.missingOut : u.missingIn).join(', ')}
                  </span>
                )}
                {!isOut && isOpenRow && (
                  <span className="text-[11px] font-bold uppercase tracking-wider text-chip-bad-fg">
                    out
                  </span>
                )}
                <button
                  type="button"
                  title="Withdraw this scan"
                  disabled={busy === u.scanId}
                  onClick={() => void undo(u)}
                  className="text-lt-fg3 hover:text-chip-bad-fg flex-none"
                >
                  {busy === u.scanId ? <Undo2 size={13} aria-hidden /> : <X size={13} aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
