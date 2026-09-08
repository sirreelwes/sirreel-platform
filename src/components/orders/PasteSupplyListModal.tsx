'use client'

/**
 * Paste a supply list onto an order that already exists.
 *
 * Oliver, 2026-09-08: "big supply orders that come a day after we make
 * their vehicle quote." The quote screen has had the parser since the
 * start; the edit screen had a one-line-at-a-time form, so a forty-item
 * expendables list arriving the next morning was forty trips through it.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not touch the order's dates, client or contacts. The order
 *    has all three already, and a pasted note that happens to mention
 *    "the shoot on the 22nd" must not re-date a booked rental. The
 *    server anchors every parsed line to the ORDER's window.
 *  - It does not write the lines itself. Each accepted line is POSTed
 *    through the same /line-items endpoint the manual form uses, so the
 *    client rate card, the Lankershim double-billing guard, capacity
 *    conflicts, hold sync and the audit row all still apply. Adding a
 *    bulk insert beside them would mean reimplementing every one.
 */

import { useState } from 'react'
import { X, Sparkles, Loader2, AlertTriangle, Check } from 'lucide-react'

type ParsedItem = {
  description: string
  quantity: number
  catalogProductId: string | null
  catalogType: 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE' | null
  department: string
  qualifier: string | null
  rateType: 'DAILY' | 'WEEKLY'
  pickupDate: string
  returnDate: string
  billableDays: number
  rate: number
  matchedProduct: { id: string; name: string } | null
  /** Resolved server-side — never guessed here. */
  lineType: 'VEHICLE' | 'EQUIPMENT' | 'EXPENDABLE' | 'LABOR' | 'FEE' | 'DISCOUNT'
  matchSource: 'AI' | 'ALIAS_FALLBACK' | 'AUTO_KIT' | null
  warnings: string[]
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export function PasteSupplyListModal({
  orderId, orderNumber, onClose, onAdded,
}: {
  orderId: string
  orderNumber: string
  onClose: () => void
  /** Added N lines — the page refetches. */
  onAdded: (added: number) => void
}) {
  const [text, setText] = useState('')
  const [reading, setReading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ParsedItem[] | null>(null)
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [window_, setWindow] = useState<{ start: string | null; end: string | null } | null>(null)
  const [failures, setFailures] = useState<string[]>([])

  /* An AUTO_KIT line is an accessory the catalog hangs off its parent.
     The /line-items endpoint runs syncOrderKitPieces on every add, so
     posting these too would put a charger on the order twice — once flat
     and unmanaged, once with real provenance. Shown, never sent. */
  const isAuto = (it: ParsedItem) => it.matchSource === 'AUTO_KIT'
  const sendable = (items ?? []).map((it, i) => ({ it, i })).filter(({ it }) => !isAuto(it))
  const chosen = sendable.filter(({ i }) => !skip.has(i))
  const unpriced = chosen.filter(({ it }) => it.rate === 0).length

  async function read() {
    if (!text.trim()) return
    setReading(true); setError(null); setFailures([])
    try {
      const res = await fetch(`/api/orders/${orderId}/parse-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Could not read that list (${res.status}).`); return }
      setItems(data.items ?? [])
      setWindow(data.window ?? null)
      setSkip(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that list.')
    } finally {
      setReading(false)
    }
  }

  async function addAll() {
    if (chosen.length === 0) return
    setAdding(true); setError(null)
    const failed: string[] = []
    let added = 0

    for (const { it } of chosen) {
      const body: Record<string, unknown> = {
        type: it.lineType,
        description: it.description,
        inventoryItemId: it.catalogType === 'INVENTORY' ? it.catalogProductId : null,
        assetCategoryId: it.catalogType === 'ASSET_CATEGORY' ? it.catalogProductId : null,
        department: it.department,
        rateType: it.rateType,
        rate: it.rate,
        quantity: it.quantity,
        billableDays: it.billableDays,
      }
      const post = (extra?: Record<string, unknown>) =>
        fetch(`/api/orders/${orderId}/line-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, ...(extra ?? {}) }),
        })

      let res = await post()
      // Capacity conflict. Ask per line rather than blanket-overriding a
      // whole pasted list — the rep should see whose booking each one
      // steps on, same as the manual add does.
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        if (data?.requiresConfirmation && Array.isArray(data.conflicts)) {
          const lines = (data.conflicts as Array<{ bookingNumber: string; jobName: string | null; startDate: string; endDate: string; quantity: number }>)
            .map((c) => `  • ${c.bookingNumber}${c.jobName ? ' · ' + c.jobName : ''} · ${c.startDate}–${c.endDate} · qty ${c.quantity}`)
            .join('\n')
          const go = confirm(
            `${it.description}\n\n${data.reason}\n\nConflicting bookings:\n${lines}\n\nOverride and add it anyway?`,
          )
          if (!go) { failed.push(`${it.description} — skipped (conflict)`); continue }
          res = await post({ confirmConflict: true })
        }
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        failed.push(`${it.description} — ${data?.reason || data?.error || `HTTP ${res.status}`}`)
        continue
      }
      added++
    }

    setAdding(false)
    setFailures(failed)
    // Anything that landed is on the order whether or not the rest did,
    // so refresh either way rather than leaving a stale grid behind.
    if (added > 0) onAdded(added)
    if (failed.length === 0) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-lt-card w-full max-w-3xl rounded-2xl border border-lt-hairline my-8">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-lt-hairline">
          <Sparkles size={18} aria-hidden className="text-amber-600 flex-none mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lt-fg text-[17px] font-semibold">Paste a supply list</h2>
            <p className="text-lt-fg2 text-[13px] mt-0.5">
              Reads it the same way the quote parser does, and adds the lines to {orderNumber}.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-lt-fg3 hover:text-lt-fg p-1">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="px-5 py-4">
          {error && (
            <p className="mb-3 text-[14px] text-chip-bad-fg border border-chip-bad-fg/30 bg-chip-bad-bg rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {items === null ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                autoFocus
                placeholder={"Paste the client's email or supply list here.\n\nQuantities and item names are enough — it matches them against the catalog."}
                className="w-full bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2.5 text-[15px] text-lt-fg placeholder:text-lt-fg3 leading-relaxed"
              />
              <p className="mt-2 text-[13px] text-lt-fg3">
                Dates in the paste are ignored — every line is added on this order&rsquo;s own
                rental window. Nothing is added until you have looked at what it found.
              </p>
            </>
          ) : (
            <>
              {window_ && (
                <p className="mb-3 text-[13px] text-lt-fg2">
                  {items.length === 0
                    ? 'Nothing recognisable in that paste.'
                    : `Found ${items.length} line${items.length === 1 ? '' : 's'}`}
                  {window_.start && window_.end
                    ? `, priced on ${window_.start} → ${window_.end}.`
                    : '. This order has no dates yet, so lines carry the days the parser worked out.'}
                </p>
              )}

              <ul className="space-y-1.5 max-h-[52vh] overflow-y-auto">
                {items.map((it, i) => {
                  const auto = isAuto(it)
                  const off = skip.has(i)
                  return (
                    <li
                      key={i}
                      className={`border border-lt-hairline rounded-lg px-3 py-2.5 flex items-start gap-3 ${
                        auto ? 'bg-lt-inner' : off ? 'bg-lt-inner opacity-60' : 'bg-lt-card'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 flex-none"
                        checked={!auto && !off}
                        disabled={auto}
                        onChange={(e) =>
                          setSkip((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.delete(i)
                            else next.add(i)
                            return next
                          })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-lt-fg text-[15px] font-semibold truncate">
                          {it.quantity}× {it.description}
                        </div>
                        <div className="text-lt-fg2 text-[13px]">
                          {it.matchedProduct ? (
                            <span className="text-chip-good-fg">✓ {it.matchedProduct.name}</span>
                          ) : (
                            <span className="text-chip-warn-fg">No catalog match — goes on as typed</span>
                          )}
                          <span className="text-lt-fg3">
                            {' · '}{money(it.rate)} {it.rateType.toLowerCase()} · {it.billableDays}d · {it.department.replace(/_/g, ' ').toLowerCase()}
                          </span>
                        </div>
                        {/* An unmatched line has no catalog rate, so it
                            lands at $0. That is a silent under-bill if it
                            goes out unnoticed — say it on the row, not in
                            a summary the rep scrolls past. */}
                        {!auto && it.rate === 0 && (
                          <div className="text-[12px] font-semibold text-chip-bad-fg mt-0.5">
                            No rate — goes on at $0. Price it before this quote goes out.
                          </div>
                        )}
                        {auto && (
                          <div className="text-[12px] text-lt-fg3 mt-0.5">
                            Included accessory — added automatically with its parent line, so it is
                            not sent from here.
                          </div>
                        )}
                        {it.warnings.length > 0 && (
                          <div className="text-[12px] text-chip-warn-fg mt-0.5">
                            {it.warnings.join(' · ')}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {failures.length > 0 && (
                <div className="mt-3 border border-chip-bad-fg/30 bg-chip-bad-bg rounded-lg px-3 py-2">
                  <p className="text-[13px] font-semibold text-chip-bad-fg flex items-center gap-1.5">
                    <AlertTriangle size={14} aria-hidden />
                    {failures.length} line{failures.length === 1 ? '' : 's'} did not go on:
                  </p>
                  <ul className="mt-1 text-[13px] text-chip-bad-fg space-y-0.5">
                    {failures.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center gap-3 px-5 py-4 border-t border-lt-hairline">
          {items === null ? (
            <button
              onClick={() => void read()}
              disabled={reading || !text.trim()}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
            >
              {reading ? <><Loader2 size={15} className="animate-spin" aria-hidden />Reading…</> : 'Read the list'}
            </button>
          ) : (
            <button
              onClick={() => void addAll()}
              disabled={adding || chosen.length === 0}
              className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
            >
              {adding
                ? <><Loader2 size={15} className="animate-spin" aria-hidden />Adding…</>
                : <><Check size={15} aria-hidden />Add {chosen.length} line{chosen.length === 1 ? '' : 's'} to the order</>}
            </button>
          )}
          {items !== null && unpriced > 0 && (
            <span className="text-[13px] font-semibold text-chip-bad-fg">
              {unpriced} with no rate
            </span>
          )}
          {items !== null && !adding && (
            <button
              onClick={() => { setItems(null); setFailures([]) }}
              className="text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg"
            >
              Back to the paste
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg">
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}
