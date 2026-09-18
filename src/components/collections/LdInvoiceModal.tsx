'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The L&D desk — tell the production first, bill second.
 *
 * Ana, 2026-09-14: *"a way to bill L&D on a separate invoice. That would be a
 * game changer for me."* Then Wes, 2026-09-18, once Albert's returned-order
 * report existed: *"this is the most straightforward way for Ana to create an
 * L&D invoice. She will start from the returned order instead of having to
 * read it and create her own response. It should be cued up for her to first
 * notify the production with those replacement items if they're lost, and
 * what that would cost, or to be able to write in something about damage and
 * the cost that that would be."*
 *
 * Hence TWO steps, in that order, and the order is the whole design:
 *
 *   1. Tell the production. What did not come back and what replacing it
 *      costs — no invoice number, no due date, no payment link. A short
 *      count is evidence, not a verdict (ldCandidates.ts): the case is
 *      often in a production office, and leading with a bill turns a
 *      recoverable conversation into an argument. It also lets them
 *      source a replacement themselves, which is frequently cheaper for
 *      everyone.
 *   2. Raise the invoice, for whatever is still outstanding — pre-filled
 *      from exactly what was noticed, so Ana never retypes her damage
 *      write-ins.
 *
 * Everything still arrives UNTICKED, and the invoice is still a DRAFT she
 * has to send. Step 1 can be skipped (an order that is plainly a write-off
 * does not need a conversation) and step 2 is where the old single-step
 * composer's behaviour lives unchanged.
 *
 * The notice route is gated on the collections desk, since it prices things
 * and the yard cannot see rates. Opened by someone without that access —
 * the order page is reachable by sales — step 1 simply is not offered.
 */

interface LdCandidate {
  key: string
  /** Open set on purpose: the check-in sheet grew CHECK_IN_DAMAGED
   *  separately. An unknown source must render, not crash. */
  source: string
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

interface StoredNoticeLine {
  key: string
  description: string
  qty: number
  unitPrice: number
  kind: 'MISSING' | 'DAMAGE'
  note: string | null
  damageItemId?: string
}

interface NoticeComposition {
  checkedInAt: string | null
  lines: StoredNoticeLine[]
  to: { id: string; name: string; email: string } | null
  cc: string[]
  lastNotice: {
    id: string
    sentAt: string | null
    sentToAddress: string | null
    subtotal: number
    lineCount: number
  } | null
}

type Step = 'notify' | 'invoice'

interface Row {
  key: string
  checked: boolean
  description: string
  category: string | null
  qty: string
  unitPrice: string
  damageItemId?: string
  source: string
  priceBasis: LdCandidate['priceBasis']
  note: string | null
  kind: 'MISSING' | 'DAMAGE'
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A candidate's kind. Anything that is not an outright shortfall is damage
 *  — same rule the notice email groups on (lib/invoices/ldNotice.ts). */
const kindOf = (source: string): Row['kind'] =>
  source === 'CHECK_IN_SHORT' ? 'MISSING' : 'DAMAGE'

const SOURCE_LABEL: Record<string, string> = {
  CHECK_IN_SHORT: 'check-in sheet',
  CHECK_IN_DAMAGED: 'check-in sheet · damaged',
  VEHICLE_DAMAGE: 'vehicle damage',
}

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
  kind: kindOf(c.source),
})

/** Step 2 starts from what the client was actually told, ticked, so the
 *  invoice bills the conversation rather than re-deriving beside it. */
const noticeLineToRow = (l: StoredNoticeLine): Row => ({
  key: l.key,
  checked: true,
  description: l.description,
  category: null,
  qty: String(l.qty),
  unitPrice: l.unitPrice > 0 ? l.unitPrice.toFixed(2) : '',
  damageItemId: l.damageItemId,
  source: l.key.startsWith('manual:') ? 'MANUAL' : 'NOTICED',
  priceBasis: null,
  note: l.note,
  kind: l.kind,
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
  const [notice, setNotice] = useState<NoticeComposition | null>(null)
  /** The notice desk is collections-only; sales opening this from the order
   *  page gets step 2 alone rather than a door that 403s. */
  const [canNotify, setCanNotify] = useState(true)
  const [step, setStep] = useState<Step>('notify')
  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ invoiceNumber: string; total: string } | null>(null)
  const [sentNotice, setSentNotice] = useState<{ sentTo: string; cc: string[]; subtotal: number } | null>(
    null,
  )

  const load = useCallback(async () => {
    try {
      const [cRes, nRes] = await Promise.all([
        fetch(`/api/orders/${orderId}/ld-invoices`, { cache: 'no-store' }),
        fetch(`/api/orders/${orderId}/ld-notice`, { cache: 'no-store' }),
      ])
      if (!cRes.ok) {
        setError('Could not load what there is to bill.')
        return
      }
      const c = (await cRes.json()) as LdCandidateSet
      setData(c)
      setRows(c.candidates.map(toRow))

      if (nRes.ok) {
        const n = (await nRes.json()) as NoticeComposition
        setNotice(n)
        // Already told them? Then the open question is the invoice.
        if (n.lastNotice?.sentAt) setStep('invoice')
      } else {
        setCanNotify(false)
        setStep('invoice')
      }
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
        // Writing a line in by hand is almost always damage the sheet could
        // not capture — a cracked lens, a repair quote.
        kind: 'DAMAGE',
      },
    ])

  const picked = rows.filter((r) => r.checked)
  const total = picked.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0)
  const incomplete = picked.filter((r) => !r.description.trim() || !(Number(r.qty) > 0))
  const notifying = step === 'notify'

  /** Step 2, opened after a notice: bill what was actually promised. */
  const goToInvoice = (fromNotice: StoredNoticeLine[] | null) => {
    if (fromNotice && fromNotice.length) setRows(fromNotice.map(noticeLineToRow))
    setNotes('')
    setError(null)
    setStep('invoice')
  }

  const sendNotice = async () => {
    if (!picked.length || incomplete.length) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/ld-notice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: notes.trim() || null,
          lines: picked.map((p) => ({
            key: p.key,
            description: p.description.trim(),
            qty: Number(p.qty),
            unitPrice: Number(p.unitPrice) || 0,
            kind: p.kind,
            note: p.note,
            damageItemId: p.damageItemId,
          })),
        }),
      })
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        sentTo?: string
        cc?: string[]
        subtotal?: number
      }
      if (!r.ok || !j.ok) {
        setError(j.error || 'That did not send.')
        return
      }
      setSentNotice({ sentTo: j.sentTo ?? '', cc: j.cc ?? [], subtotal: j.subtotal ?? total })
    } catch {
      setError('That did not send.')
    } finally {
      setBusy(false)
    }
  }

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

  const lastSent = notice?.lastNotice?.sentAt ?? null
  const finished = !!done || !!sentNotice

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-xl border border-lt-hairline bg-lt-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-lt-hairline px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-lt-fg">Loss &amp; damage</h2>
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

        {/* The two steps, in order. Tabs rather than a wizard: Ana may
            genuinely want to skip straight to the invoice (a write-off she
            has already discussed on the phone), and hiding that behind a
            "next" button would make the common case the slow one. */}
        {canNotify && !finished && (
          <div className="flex gap-1 border-b border-lt-hairline px-5 pt-2">
            {(
              [
                ['notify', '1 · Tell the production'],
                ['invoice', '2 · Raise the invoice'],
              ] as Array<[Step, string]>
            ).map(([s, label]) => (
              <button
                key={s}
                onClick={() => (s === 'invoice' ? goToInvoice(null) : setStep('notify'))}
                className={`rounded-t-lg px-3 py-1.5 text-[12px] font-semibold ${
                  step === s
                    ? 'bg-lt-inner text-lt-fg border-b-2 border-amber-600'
                    : 'text-lt-fg3 hover:text-lt-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="px-5 py-4 space-y-3">
          {done ? (
            <div className="rounded-lg bg-chip-good-bg px-3 py-3 text-[13px] text-chip-good-fg">
              <strong>{done.invoiceNumber}</strong> created for {usd(Number(done.total))}. It is a
              DRAFT — it does not reach the client until you send it, and it does not hold up the
              rental invoice.
            </div>
          ) : sentNotice ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-chip-good-bg px-3 py-3 text-[13px] text-chip-good-fg">
                Notice sent to <strong>{sentNotice.sentTo}</strong>
                {sentNotice.cc.length > 0 ? `, copying ${sentNotice.cc.length} other${sentNotice.cc.length === 1 ? '' : 's'}` : ''}
                . It lists {usd(sentNotice.subtotal)} of replacement cost and says plainly that
                nothing has been charged.
              </div>
              <p className="text-[13px] text-lt-fg2">
                Give them a chance to find it. When you are ready to bill what is still
                outstanding, the invoice starts from exactly these lines.
              </p>
            </div>
          ) : (
            <>
              {data?.existingLdInvoice && !notifying ? (
                <div className="rounded-lg bg-chip-warn-bg px-3 py-2 text-[12px] text-chip-warn-fg">
                  This order already has an L&amp;D invoice ({data.existingLdInvoice.invoiceNumber},{' '}
                  {data.existingLdInvoice.status.toLowerCase()}, {usd(data.existingLdInvoice.total)}).
                  Void it before raising another.
                </div>
              ) : null}

              {/* Already told them once. Sending a second notice is legal —
                  a re-count finds more — but it should be a decision. */}
              {notifying && lastSent ? (
                <div className="rounded-lg bg-chip-neutral-bg px-3 py-2 text-[12px] text-chip-neutral-fg">
                  A notice already went to {notice?.lastNotice?.sentToAddress} on{' '}
                  {new Date(lastSent).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                  covering {notice?.lastNotice?.lineCount} line
                  {notice?.lastNotice?.lineCount === 1 ? '' : 's'}.
                </div>
              ) : null}

              {notifying ? (
                <p className="text-[13px] text-lt-fg2">
                  Tick what did not come back, or came back broken, and check the figures. They get
                  a plain list and the replacement cost —{' '}
                  <strong className="text-lt-fg">no invoice, no due date, nothing charged</strong>{' '}
                  — so anything sitting in a production office can still turn up.
                </p>
              ) : null}

              {!data ? (
                <p className="text-[13px] text-lt-fg3">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-[13px] text-lt-fg2">
                  {data.hasCheckInReport
                    ? 'The inbound sheet recorded nothing short and no damage was sent to L&D. You can still add a line by hand.'
                    : 'No inbound sheet has been typed in for this order, so nothing has been counted yet. Anything listed here will be a line you add by hand.'}
                </p>
              ) : (
                <div className="rounded-lg border border-lt-hairline overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-lt-inner text-[11px] uppercase tracking-wide text-lt-fg3">
                        <th className="px-2 py-2 w-8"></th>
                        <th className="px-2 py-2 text-left font-medium">What</th>
                        <th className="px-2 py-2 text-right font-medium w-16">Qty</th>
                        <th className="px-2 py-2 text-right font-medium w-28">
                          {notifying ? 'Replacement' : 'Each'}
                        </th>
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
                                aria-label={`${notifying ? 'Notify about' : 'Bill'} ${r.description || 'this line'}`}
                              />
                            </td>
                            <td className="px-2 py-2">
                              {r.source === 'MANUAL' ? (
                                <>
                                  <input
                                    value={r.description}
                                    onChange={(e) => setRow(r.key, { description: e.target.value })}
                                    placeholder={
                                      notifying
                                        ? 'What was damaged, or what is missing?'
                                        : 'What are you billing for?'
                                    }
                                    className="w-full rounded border border-lt-hairline px-2 py-1 text-[13px]"
                                  />
                                  {notifying && (
                                    <div className="mt-1 flex gap-1">
                                      {(['DAMAGE', 'MISSING'] as const).map((k) => (
                                        <button
                                          key={k}
                                          type="button"
                                          onClick={() => setRow(r.key, { kind: k })}
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                            r.kind === k
                                              ? 'bg-chip-warn-bg text-chip-warn-fg'
                                              : 'text-lt-fg3 hover:text-lt-fg'
                                          }`}
                                        >
                                          {k === 'DAMAGE' ? 'Damaged' : 'Missing'}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <div className="text-lt-fg">{r.description}</div>
                                  <div className="text-[11px] text-lt-fg3">
                                    {SOURCE_LABEL[r.source] ??
                                      (r.source === 'NOTICED' ? 'on the notice' : 'check-in sheet')}
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
                                  r.checked && !(Number(r.unitPrice) > 0) && !notifying
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
                  {notifying ? '+ Write in damage' : '+ Add a line'}
                </button>
                <div className="text-[13px] text-lt-fg2">
                  {picked.length} line{picked.length === 1 ? '' : 's'} ·{' '}
                  <strong className="text-lt-fg tabular-nums">{usd(total)}</strong>
                </div>
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  notifying
                    ? 'A line to the production in your own words (optional) — e.g. "the cases went out full, we think the stinger box is still on the stage."'
                    : 'Note printed on the invoice (optional) — e.g. what was agreed with the client.'
                }
                rows={2}
                className="w-full rounded border border-lt-hairline px-2 py-1.5 text-[13px]"
              />

              {notifying ? (
                notice?.to ? (
                  <p className="text-[11px] text-lt-fg3">
                    Goes to <strong className="text-lt-fg2">{notice.to.name}</strong> ({notice.to.email})
                    {notice.cc.length > 0
                      ? `, copying ${notice.cc.length} other contact${notice.cc.length === 1 ? '' : 's'} and billing`
                      : ', copying billing'}
                    . A reply comes back to you.
                  </p>
                ) : (
                  <p className="text-[11px] text-chip-bad-fg">
                    There is no client contact on this order to notify — add a job contact first.
                  </p>
                )
              ) : picked.some((r) => !(Number(r.unitPrice) > 0)) ? (
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
          ) : sentNotice ? (
            <>
              <button onClick={onClose} className="text-[12px] font-semibold text-lt-fg3 hover:text-lt-fg">
                Close
              </button>
              <button
                onClick={() => {
                  const lines = notice?.lines ?? null
                  setSentNotice(null)
                  goToInvoice(
                    lines
                      ? picked.map((p) => ({
                          key: p.key,
                          description: p.description.trim(),
                          qty: Number(p.qty),
                          unitPrice: Number(p.unitPrice) || 0,
                          kind: p.kind,
                          note: p.note,
                          damageItemId: p.damageItemId,
                        }))
                      : null,
                  )
                }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500"
              >
                Raise the invoice
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="text-[12px] font-semibold text-lt-fg3 hover:text-lt-fg">
                Cancel
              </button>
              {notifying ? (
                <button
                  onClick={() => void sendNotice()}
                  disabled={busy || !picked.length || incomplete.length > 0 || !notice?.to}
                  title={
                    !notice?.to
                      ? 'No client contact on this order'
                      : incomplete.length
                        ? 'Every ticked line needs a description and a quantity'
                        : undefined
                  }
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
                >
                  {busy ? 'Sending…' : `Send notice${total > 0 ? ` · ${usd(total)}` : ''}`}
                </button>
              ) : (
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
