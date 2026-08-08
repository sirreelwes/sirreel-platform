'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * "Upload final invoice" on the job page — the handoff from sales to
 * collections.
 *
 * The agent lands on a final number after back and forth with the client;
 * recording it here queues it on /collections so Ana can charge it without
 * having to ask which of the open RW invoices is actually agreed.
 *
 * The PDF is optional on purpose. The number is often settled on a call
 * before the document exists, and blocking on the file would push people back
 * to email — which is the behaviour this replaces.
 *
 * Interim: when billing moves into HQ this becomes a "finalize" button next
 * to the HQ invoice and the upload disappears.
 */

interface FinalInvoice {
  id: string
  invoiceNumber: string | null
  amount: number
  status: string
  pdfUrl: string | null
  note: string | null
  uploadedAt: string
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function JobFinalInvoicePanel({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<FinalInvoice[]>([])
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    fetch(`/api/jobs/${jobId}/final-invoice`)
      .then((r) => r.json())
      .then((d) => d.ok && setRows(d.finalInvoices ?? []))
      .catch(() => {})
  }, [jobId])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setMsg({ ok: false, text: 'Enter the final amount.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('amount', String(n))
      if (invoiceNumber) fd.append('invoiceNumber', invoiceNumber)
      if (note) fd.append('note', note)
      if (file) fd.append('file', file)
      const r = await fetch(`/api/jobs/${jobId}/final-invoice`, { method: 'POST', body: fd })
      const d = await r.json()
      setMsg({ ok: !!d.ok, text: d.message || d.error || 'Unknown response' })
      if (d.ok) {
        setAmount('')
        setInvoiceNumber('')
        setNote('')
        setFile(null)
        setOpen(false)
        load()
      }
    } catch {
      setMsg({ ok: false, text: 'Request failed.' })
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-amber-600'

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white">Final invoice</h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-amber-600 hover:bg-amber-500 text-zinc-900 font-bold px-3 py-1.5 text-xs transition-colors"
        >
          {open ? 'Cancel' : 'Upload final invoice'}
        </button>
      </div>

      {open && (
        <div className="space-y-3 mb-4 border-b border-zinc-800 pb-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
              Final amount agreed
            </label>
            <input
              className={input}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
              RW invoice # (optional)
            </label>
            <input
              className={input}
              placeholder="e.g. 404105"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
              Invoice PDF (optional)
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-zinc-600"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block">
              Note (optional)
            </label>
            <input
              className={input}
              placeholder="e.g. agreed with Dana after credit for the late truck"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-zinc-900 font-bold px-4 py-2 text-sm transition-colors"
          >
            {busy ? 'Saving…' : 'Send to Collections'}
          </button>
        </div>
      )}

      {msg && (
        <p className={`text-sm mb-3 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No final invoice recorded yet. Upload one once the number is agreed and it will queue for
          collection.
        </p>
      ) : (
        <div className="divide-y divide-zinc-800">
          {rows.map((r) => (
            <div key={r.id} className="py-2.5 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">
                  {money(r.amount)}
                  {r.invoiceNumber ? (
                    <span className="text-zinc-400 font-normal"> · {r.invoiceNumber}</span>
                  ) : null}
                </div>
                {r.note && <div className="text-xs text-zinc-400 mt-0.5">{r.note}</div>}
                <div className="text-xs text-zinc-500 mt-0.5">
                  {new Date(r.uploadedAt).toLocaleDateString()}
                  {r.pdfUrl && (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-amber-500 underline"
                    >
                      PDF
                    </a>
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-bold px-2 py-1 rounded whitespace-nowrap ${
                  r.status === 'COLLECTED'
                    ? 'bg-green-900/40 text-green-400'
                    : 'bg-amber-900/40 text-amber-400'
                }`}
              >
                {r.status === 'COLLECTED' ? 'Collected' : 'Awaiting collection'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
