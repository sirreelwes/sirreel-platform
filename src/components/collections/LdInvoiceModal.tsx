'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The L&D composer — bill loss and damage on its own invoice.
 *
 * Ana, 2026-09-14: *"a way to bill L&D on a separate invoice. That would be a
 * game changer for me."*
 *
 * It opens from the billing-queue row that already carries the "N short on
 * the sheet" chip, which is the moment she is looking at the problem. The
 * chip has been there since the queue shipped, purely as something to know
 * about; this is the chip becoming an action.
 *
 * Everything arrives UNTICKED. A short count is evidence, not a verdict —
 * missing gear turns up on the truck the next morning often enough that an
 * invoice which generated itself would bill clients for kit sitting in the
 * yard. Ana ticks what is really gone, prices what HQ could not price, and
 * the invoice is created as a DRAFT she still has to send.
 *
 * The result is a separate invoice with its own number (LD sequence), which
 * is the whole point: the rental bills the day after check-in on its own
 * schedule, and L&D settles behind it without holding it up.
 */

interface LdCandidate {
  key: string
  source: 'CHECK_IN_SHORT' | 'VEHICLE_DAMAGE'
  description: string
  category: string | null
  qty: number
  unitPrice: number
  priced: boolean
  priceBasis: 'replacement cost' | 'repair estimate' | null
  damageItemId?: string
  note: string | null
}

interface LdCandidateSet {
  orderId: string
  orderNumber: string
  jobName: string | null
  companyName: string | null
  candidates: LdCandidate[]
  existingLdInvoice: { id: string; invoiceNumber: string; status: string; total: number } | null
  hasCheckInReport: boolean
}

interface Row {
  key: string
  checked: boolean
  description: string
  category: string | null
  qty: string
  unitPrice: string
  damageItemId?: string
  source: LdCandidate['source'] | 'MANUAL'
  priceBasis: LdCandidate['priceBasis']
  note: string | null
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const toRow = (c: LdCandidate): Row => ({
  key: c.key,
  checked: false,
  description: c.description,
  category: c.category,
  qty: String(c.qty),
  unitPrice: c.priced ? c.unitPrice.toFixed(2) : '',
  damageItemId: c.damageItemId,
  source: c.source,
  priceBasis: c.priceBasis,
  note: c.note,
})

export function LdInvoiceModal({
  orderId,
  orderNumber,
  onClose,
  onCreated,
}: {
  orderId: string
  orderNumber: string
  onClose: () => void
  onCreated?: (invoiceNumber: string) => void
}) {
  const [data, setData] = useState<LdCandidateSet | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ invoiceNumber: string; total: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders/${orderId}/ld-invoices`, { cache: 'no-store' })
      if (!r.ok) {
        setError('Could not load what there is to bill.')
        return
      }
      const j = (await r.json()) as LdCandidateSet
      setData(j)
      setRows(j.candidates.map(toRow))
    } catch {
      setError('Could not load what there is to bill.')
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addBlank = () =>
    setRows((prev) => [
      ...prev,
      {
        key: `manual:${Date.now()}`,
        checked: true,
        description: '',
        category: null,
        qty: '1',
        unitPrice: '',
        source: 'MANUAL',
        priceBasis: null,
        note: null,
      },
    ])

  const picked = rows.filter((r) => r.checked)
  const total = picked.reduce(
    (s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0),
    0,
  )
  const incomplete = picked.filter((r) => !r.description.trim() || !(Number(r.qty) > 0))

  const create = async () => {
    if (!picked.length || incomplete.length) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/ld-invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes.trim() || null,
          lines: picked.map((p) => ({
            description: p.description.trim(),
            category: p.category,
            qty: Number(p.qty),
            unitPrice: Number(p.unitPrice) || 0,
          })),
          damageItemIds: picked.map((p) => p.damageItemId).filter(Boolean),
        }),
      })
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        invoiceNumber?: string
        total?: string
      }
      if (!r.ok || !j.ok) {
        setError(j.error || 'That did not create.')
        return
      }
      setDone({ invoiceNumber: j.invoiceNumber ?? 'the invoice', total: j.total ?? total.toFixed(2) })
      onCreated?.(j.invoiceNumber ?? '')
    } catch {
      setError('That did not create.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-xl border border-lt-hairline bg-lt-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-lt-hairline px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-lt-fg">Bill L&amp;D separately</h2>
            <p className="text-[12px] text-lt-fg2">
              {orderNumber}
              {data?.jobName ? ` · ${data.jobName}` : ''}
              {data?.companyName ? ` · ${data.companyName}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-[12px] text-lt-fg3 hover:text-lt-fg">
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {done ? (
            <div className="rounded-lg bg-chip-good-bg px-3 py-3 text-[13px] text-chip-good-fg">
              <strong>{done.invoiceNumber}</strong> created for {usd(Number(done.total))}. It is a
              DRAFT — it does not reach the client until you send it, and it does not hold up the
              rental invoice.
            </div>
          ) : (
            <>
              {data?.existingLdInvoice ? (
                <div className="rounded-lg bg-chip-warn-bg px-3 py-2 text-[12px] text-chip-warn-fg">
                  This order already has an L&amp;D invoice ({data.existingLdInvoice.invoiceNumber},{' '}
                  {data.existingLdInvoice.status.toLowerCase()}, {usd(data.existingLdInvoice.total)}).
                  Void it before raising another.
                </div>
              ) : null}

              {!data ? (
                <p className="text-[13px] text-lt-fg3">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-[13px] text-lt-fg2">
                  {data.hasCheckInReport
                    ? 'The inbound sheet recorded nothing short and no damage was sent to L&D. You can still add a line by hand.'
                    : 'No inbound sheet has been typed in for this order, so nothing has been counted yet. Anything billed here will be a line you add by hand.'}
                </p>
              ) : (
                <div className="rounded-lg border border-lt-hairline overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-lt-inner text-[11px] uppercase tracking-wide text-lt-fg3">
                        <th className="px-2 py-2 w-8"></th>
                        <th className="px-2 py-2 text-left font-medium">What</th>
                        <th className="px-2 py-2 text-right font-medium w-16">Qty</th>
                        <th className="px-2 py-2 text-right font-medium w-28">Each</th>
                        <th className="px-2 py-2 text-right font-medium w-24">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const amount = (Number(r.qty) || 0) * (Number(r.unitPrice) || 0)
                        return (
                          <tr key={r.key} className="border-t border-lt-hairline align-top">
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={r.checked}
                                onChange={(e) => setRow(r.key, { checked: e.target.checked })}
                                aria-label={`Bill ${r.description || 'this line'}`}
                              />
                            </td>
                            <td className="px-2 py-2">
                              {r.source === 'MANUAL' ? (
                                <input
                                  value={r.description}
                                  onChange={(e) => setRow(r.key, { description: e.target.value })}
                                  placeholder="What are you billing for?"
                                  className="w-full rounded border border-lt-hairline px-2 py-1 text-[13px]"
                                />
                              ) : (
                                <>
                                  <div className="text-lt-fg">{r.description}</div>
                                  <div className="text-[11px] text-lt-fg3">
                                    {r.source === 'VEHICLE_DAMAGE' ? 'vehicle damage' : 'check-in sheet'}
                                    {r.note ? ` · ${r.note}` : ''}
                                    {r.priceBasis ? ` · priced at ${r.priceBasis}` : ''}
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                value={r.qty}
                                onChange={(e) => setRow(r.key, { qty: e.target.value })}
                                inputMode="numeric"
                                className="w-14 rounded border border-lt-hairline px-1.5 py-1 text-right text-[13px]"
                              />
                            </td>
                            <td className="px-2 py-2 text-right">
                              <input
                                value={r.unitPrice}
                                onChange={(e) => setRow(r.key, { unitPrice: e.target.value })}
                                inputMode="decimal"
                                placeholder="0.00"
                                className={`w-24 rounded border px-1.5 py-1 text-right text-[13px] ${
                                  r.checked && !(Number(r.unitPrice) > 0)
                                    ? 'border-chip-warn-fg/40 bg-chip-warn-bg'
                                    : 'border-lt-hairline'
                                }`}
                              />
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-lt-fg">
                              {amount > 0 ? usd(amount) : <span className="text-lt-fg3">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={addBlank}
                  className="text-[12px] font-semibold text-lt-fg2 hover:text-lt-fg"
                >
                  + Add a line
                </button>
                <div className="text-[13px] text-lt-fg2">
                  {picked.length} line{picked.length === 1 ? '' : 's'} ·{' '}
                  <strong className="text-lt-fg tabular-nums">{usd(total)}</strong>
                </div>
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note printed on the invoice (optional) — e.g. what was agreed with the client."
                rows={2}
                className="w-full rounded border border-lt-hairline px-2 py-1.5 text-[13px]"
              />

              {picked.some((r) => !(Number(r.unitPrice) > 0)) ? (
                <p className="text-[11px] text-chip-warn-fg">
                  A ticked line with no price bills at $0. Price it, or untick it.
                </p>
              ) : null}
              {error ? <p className="text-[12px] text-chip-bad-fg">{error}</p> : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-lt-hairline px-5 py-3">
          {done ? (
            <button
              onClick={onClose}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500"
            >
              Done
            </button>
          ) : (
            <>
              <button onClick={onClose} className="text-[12px] font-semibold text-lt-fg3 hover:text-lt-fg">
                Cancel
              </button>
              <button
                onClick={() => void create()}
                disabled={busy || !picked.length || incomplete.length > 0 || !!data?.existingLdInvoice}
                title={
                  data?.existingLdInvoice
                    ? 'Void the existing L&D invoice first'
                    : incomplete.length
                      ? 'Every ticked line needs a description and a quantity'
                      : undefined
                }
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {busy ? 'Creating…' : `Create L&D invoice${total > 0 ? ` · ${usd(total)}` : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
