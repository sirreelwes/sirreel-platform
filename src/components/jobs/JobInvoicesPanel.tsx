'use client'

/**
 * The job's HQ invoices — view, send, void, generate, without opening the
 * order.
 *
 * Wes 2026-09-01: "that Invoice should be available to view and send from
 * the Job detail page, it shouldn't be necessary to go inside the order."
 *
 * The job page already listed invoice numbers, but as read-only text nested
 * inside an expanded order row: no PDF link, no send, no way to see that the
 * figure had drifted from the order, and nothing to do about it. Every
 * action lived one level down on the order page. The document the client
 * actually receives is a job-level concern — this is where someone looks
 * when a client asks "what do I owe on Catastrophe?".
 *
 * Not to be confused with JobFinalInvoicePanel, which is the RentalWorks-era
 * MANUAL upload (an agent records a number agreed on a call so collections
 * can chase it). This one is the HQ invoice: generated, rendered, sent, and
 * paid inside the platform.
 *
 * Drift is called out here for the same reason the order page calls it out.
 * An invoice is a snapshot and does not follow later edits to the order, so
 * a discount applied after issue leaves the client holding the wrong number
 * — silently, unless something says so.
 */

import { useState } from 'react'

export interface JobPanelInvoice {
  id: string
  invoiceNumber: string
  type: string
  status: string
  total: number
  amountPaid: number
  balanceDue: number
  sentAt: string | null
  dueDate: string | null
}

export interface JobPanelOrder {
  id: string
  orderNumber: string
  total: number
  bookedTotal: number | null
  invoices: JobPanelInvoice[]
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function JobInvoicesPanel({
  orders,
  onChanged,
}: {
  orders: JobPanelOrder[]
  onChanged: () => void | Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // One row per order. An order with no live invoice still appears, so the
  // gap is visible and the "Generate" button has somewhere to live — that is
  // the other half of correcting a bad invoice (void, then re-cut), and
  // sending someone back into the order for it would defeat the point.
  const rows = orders
    .map((o) => ({
      order: o,
      live: o.invoices.filter((i) => i.status !== 'VOID'),
      voided: o.invoices.filter((i) => i.status === 'VOID'),
    }))
    .filter((r) => r.live.length > 0 || r.voided.length > 0 || r.order.bookedTotal != null)

  if (rows.length === 0) return null

  const act = async (
    key: string,
    url: string,
    body: Record<string, unknown> | null,
  ): Promise<boolean> => {
    setBusyId(key)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.reason || data.error || `Failed (HTTP ${res.status})`)
        return false
      }
      await onChanged()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      return false
    } finally {
      setBusyId(null)
    }
  }

  const voidInvoice = async (inv: JobPanelInvoice) => {
    const reason = window.prompt(
      `Void ${inv.invoiceNumber}?\n\n` +
        (inv.sentAt
          ? 'The client already has this invoice. Voiding withdraws it; the corrected bill goes out as a NEW invoice number.\n\n'
          : 'This invoice has not been sent.\n\n') +
        'Why is it being withdrawn? (recorded in the audit trail)',
      'Superseded — order was corrected after the invoice was issued',
    )
    if (reason == null || !reason.trim()) return
    await act(inv.id, `/api/invoices/${inv.id}/void`, { reason: reason.trim() })
  }

  /**
   * Rewrite the invoice from the order, keeping its number.
   *
   * The primary fix for a drifted invoice while HQ is not yet the
   * accounting book of record (Wes 2026-09-01) — the client keeps the
   * number they already have. Void + reissue stays for the cases where the
   * document really must be withdrawn.
   */
  const updateInvoice = async (inv: JobPanelInvoice) => {
    if (
      inv.sentAt &&
      !window.confirm(
        `Update ${inv.invoiceNumber} in place?\n\n` +
          `It keeps its number. The client already has the old figure — ` +
          `re-send it afterwards and tell them it was corrected.`,
      )
    ) {
      return
    }
    await act(inv.id, `/api/invoices/${inv.id}/regenerate`, null)
  }

  const sendInvoice = async (inv: JobPanelInvoice) => {
    if (
      inv.sentAt &&
      !window.confirm(
        `${inv.invoiceNumber} was already sent ${new Date(inv.sentAt).toLocaleString()}.\n\nSend it to the client again?`,
      )
    ) {
      return
    }
    await act(inv.id, `/api/invoices/${inv.id}/send`, null)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-white">Invoices</h2>
        <span className="text-[11px] text-zinc-500">
          The document the client receives — view, send, or withdraw it here
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {rows.map(({ order, live, voided }) => (
          <div key={order.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="font-mono text-[12px] text-zinc-300">{order.orderNumber}</span>
              <span className="text-[11px] text-zinc-500">order total {money(order.total)}</span>
            </div>

            {live.length === 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[12px] text-zinc-400">
                  {voided.length > 0
                    ? `No live invoice — ${voided.length} voided. Generate the corrected one.`
                    : 'No invoice yet.'}
                </span>
                <button
                  onClick={() => void act(order.id, `/api/orders/${order.id}/invoices`, null)}
                  disabled={busyId === order.id}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[12px] font-bold"
                >
                  {busyId === order.id ? 'Generating…' : 'Generate invoice'}
                </button>
              </div>
            )}

            {live.map((inv) => {
              const isDraft = inv.status === 'DRAFT'
              // Drift only means something for the RENTAL invoice: it is the
              // one anchored to the order's own total. An LD invoice bills
              // damages, which the order total never contained.
              const drift =
                inv.type === 'RENTAL'
                  ? Math.round((inv.total - order.total) * 100) / 100
                  : 0
              const drifts = Math.abs(drift) >= 0.01
              return (
                <div
                  key={inv.id}
                  className={`rounded border p-2.5 ${
                    drifts ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900'
                  }`}
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-[12px] text-white">{inv.invoiceNumber}</span>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">{inv.type}</span>
                    <span className="text-[10px] uppercase tracking-wider text-amber-300">{inv.status}</span>
                    <span className="text-[13px] font-bold text-white">{money(inv.total)}</span>
                    {inv.balanceDue > 0 && (
                      <span className="text-[11px] text-amber-300">{money(inv.balanceDue)} due</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {inv.sentAt
                      ? `Sent to the client ${new Date(inv.sentAt).toLocaleString()}`
                      : 'Not sent yet'}
                  </div>

                  {drifts && (
                    <div className="mt-2 text-[12px] text-amber-200">
                      <strong>This invoice no longer matches the order.</strong> The order is now{' '}
                      {money(order.total)} — {money(Math.abs(drift))}{' '}
                      {drift > 0 ? 'MORE on the invoice' : 'less on the invoice'}. An invoice is a
                      snapshot and does not follow later edits
                      {inv.sentAt ? ' — and the client already has this one.' : '.'}{' '}
                      <strong>Update to match order</strong> rewrites it and keeps the number; void
                      it instead if the document has to be withdrawn outright.
                    </div>
                  )}

                  <div className="mt-2 flex gap-2 flex-wrap">
                    <a
                      href={isDraft ? `/api/invoices/${inv.id}/pre-invoice-pdf` : `/api/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[12px] font-semibold"
                    >
                      {isDraft ? 'View pre-invoice' : 'View invoice PDF'}
                    </a>
                    {inv.type === 'RENTAL' && (
                      <button
                        onClick={() => void updateInvoice(inv)}
                        disabled={busyId === inv.id}
                        title="Rewrite this invoice from the order, keeping its number"
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 ${
                          drifts
                            ? 'bg-amber-600 hover:bg-amber-500 text-white'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                        }`}
                      >
                        {busyId === inv.id ? 'Working…' : 'Update to match order'}
                      </button>
                    )}
                    <button
                      onClick={() => void sendInvoice(inv)}
                      disabled={busyId === inv.id}
                      className={`px-3 py-1.5 rounded-lg disabled:opacity-50 text-[12px] font-bold ${
                        drifts
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-white'
                          : 'bg-amber-600 hover:bg-amber-500 text-white'
                      }`}
                    >
                      {busyId === inv.id ? 'Working…' : inv.sentAt ? 'Send again' : 'Send to client'}
                    </button>
                    <button
                      onClick={() => void voidInvoice(inv)}
                      disabled={busyId === inv.id}
                      title="Withdraw this invoice so a corrected one can be generated"
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50 ${
                        drifts
                          ? 'border-amber-500 text-amber-200 hover:bg-amber-500/15'
                          : 'border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      Void
                    </button>
                  </div>
                </div>
              )
            })}

            {voided.length > 0 && (
              <div className="mt-2 text-[11px] text-zinc-600">
                Voided:{' '}
                {voided.map((v) => (
                  <span key={v.id} className="font-mono mr-2 line-through">
                    {v.invoiceNumber}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
