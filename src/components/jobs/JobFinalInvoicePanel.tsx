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
 * When the job is linked to an RW order, the RW invoice is PICKED rather than
 * typed. The old free-text "RW invoice #" wrote only `invoiceNumber`, so
 * `rwInvoiceId` was never set from anywhere in the app — the job page's Final
 * Invoice tile read "uploaded" on invoices taken straight off RentalWorks, and
 * collections lost the mirror-balance hint and the double-charge guard it
 * shares with the RW-invoice list. Typing still works (and the server still
 * tries to match it); the picker is just the path that can't miss.
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

/** An invoice on an RW order linked to this job, from /api/jobs/[id]/rw-orders. */
interface RwInvoice {
  rwInvoiceId: string
  invoiceNumber: string | null
  invoiceTotal: number
  remainingTotal: number
}

/** Sentinel for "the number I have isn't in that list" — reveals the text field. */
const MANUAL = '__manual__'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function JobFinalInvoicePanel({
  jobId,
  openSignal = 0,
}: {
  jobId: string
  /**
   * Bumped by the Final Invoice tile's "Upload →". The tile used to be a
   * plain `#final-invoice` link, which scrolled here and left the form shut —
   * so from the strip the button looked dead.
   */
  openSignal?: number
}) {
  const [rows, setRows] = useState<FinalInvoice[]>([])
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [rwInvoices, setRwInvoices] = useState<RwInvoice[]>([])
  const [rwLoaded, setRwLoaded] = useState(false)
  const [rwPick, setRwPick] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
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

  // Opened from the paperwork strip: reveal the form and bring it into view.
  useEffect(() => {
    if (!openSignal) return
    setOpen(true)
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById('final-invoice')?.scrollIntoView({ block: 'start' }),
      ),
    )
  }, [openSignal])

  // The job's RW invoices, for the picker. Empty whenever no RW order is
  // linked, which is the common case — the panel falls back to typing.
  //
  // Deferred until the form is opened. /rw-orders scores every candidate
  // order for the client, and JobRwBillingPanel already calls it on this same
  // page — fetching it again on mount would double that work on every job
  // view to populate a control almost nobody opens.
  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`/api/jobs/${jobId}/rw-orders`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { invoices?: RwInvoice[] } | null) => {
        if (!live) return
        if (d?.invoices) setRwInvoices(d.invoices)
        setRwLoaded(true)
      })
      .catch(() => {
        if (live) setRwLoaded(true)
      })
    return () => {
      live = false
    }
  }, [jobId, open])

  async function submit() {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setMsg({ ok: false, text: 'Enter the final amount.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const picked = rwPick && rwPick !== MANUAL
        ? rwInvoices.find((i) => i.rwInvoiceId === rwPick)
        : undefined
      const fd = new FormData()
      fd.append('amount', String(n))
      // A picked invoice carries its own number; the server re-verifies the id
      // either way and stores null if it doesn't check out.
      if (picked) {
        fd.append('rwInvoiceId', picked.rwInvoiceId)
        if (picked.invoiceNumber) fd.append('invoiceNumber', picked.invoiceNumber)
      } else if (invoiceNumber) {
        fd.append('invoiceNumber', invoiceNumber)
      }
      if (note) fd.append('note', note)
      if (file) fd.append('file', file)
      const r = await fetch(`/api/jobs/${jobId}/final-invoice`, { method: 'POST', body: fd })
      const d = await r.json()
      setMsg({ ok: !!d.ok, text: d.message || d.error || 'Unknown response' })
      if (d.ok) {
        setAmount('')
        setInvoiceNumber('')
        setRwPick('')
        setNote('')
        setFile(null)
        setFileError(null)
        setDragging(false)
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
    'w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 outline-none focus:border-amber-600'

  return (
    <div id="final-invoice" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Final invoice</h2>
          {/* Recording a number here EMAILS the client — worth knowing
              before the first click, and the guide is where that is said. */}
          <a
            href="/guides/finishing-a-job"
            className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 underline underline-offset-2 decoration-zinc-300"
          >
            How to finish a job
          </a>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-amber-600 hover:bg-amber-500 text-zinc-900 font-bold px-3 py-1.5 text-xs transition-colors"
        >
          {open ? 'Cancel' : 'Upload final invoice'}
        </button>
      </div>

      {open && (
        <div className="space-y-3 mb-4 border-b border-zinc-200 pb-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 block">
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
            <label
              htmlFor="final-invoice-rw"
              className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 block"
            >
              RW invoice (optional)
            </label>
            {rwInvoices.length > 0 && (
              <select
                id="final-invoice-rw"
                className={`${input} mb-2`}
                value={rwPick}
                onChange={(e) => {
                  const v = e.target.value
                  setRwPick(v)
                  // Leaving the manual option hides the text field; keeping
                  // its value would submit a number nobody can see.
                  if (v !== MANUAL) setInvoiceNumber('')
                  const hit = rwInvoices.find((i) => i.rwInvoiceId === v)
                  // Prefill the balance, but never over a figure already
                  // typed — the agreed number is often NOT what RW shows,
                  // which is the entire reason this panel exists.
                  if (hit && !amount.trim()) {
                    setAmount(String(hit.remainingTotal > 0 ? hit.remainingTotal : hit.invoiceTotal))
                  }
                }}
              >
                <option value="">Not settling an RW invoice</option>
                {rwInvoices.map((i) => (
                  <option key={i.rwInvoiceId} value={i.rwInvoiceId}>
                    {i.invoiceNumber || '(no number)'} · {money(i.invoiceTotal)}
                    {i.remainingTotal > 0.005 ? ` · ${money(i.remainingTotal)} due` : ' · paid'}
                  </option>
                ))}
                <option value={MANUAL}>Type a number instead…</option>
              </select>
            )}
            {(rwInvoices.length === 0 || rwPick === MANUAL) && (
              <input
                className={input}
                placeholder="e.g. 404105"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            )}
            {(rwInvoices.length > 0 || rwLoaded) && (
              <p className="mt-1.5 text-[11px] text-zinc-500">
                {rwInvoices.length > 0
                  ? 'Picking the invoice links this to RentalWorks, so Collections can see its balance and any charge already taken against it.'
                  : 'No RW order is linked to this job — link one under RentalWorks billing to pick the invoice instead of typing it.'}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="final-invoice-pdf"
              className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 block"
            >
              Invoice PDF (optional)
            </label>
            {/* Drop zone, not a bare "Choose File" (Wes 2026-09-01). The PDF
                is nearly always already open or sitting in a folder next to
                the browser, and a file picker makes you navigate back to
                somewhere you were already looking at. The input is still
                there and still labelled — clicking works, the keyboard works,
                and the drop target is the same element. */}
            <label
              onDragOver={(e) => {
                e.preventDefault()
                if (!dragging) setDragging(true)
              }}
              onDragLeave={(e) => {
                // Ignore the dragleave fired when the pointer crosses onto a
                // CHILD of the zone — without this the outline flickers as
                // the cursor moves over the label text.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                setDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                setFileError(null)
                const dropped = Array.from(e.dataTransfer.files)
                if (dropped.length === 0) return
                const pdf = dropped.find(
                  (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
                )
                if (!pdf) {
                  setFileError(
                    dropped.length === 1
                      ? `"${dropped[0].name}" is not a PDF.`
                      : 'None of those are PDFs.',
                  )
                  return
                }
                if (dropped.length > 1) {
                  setFileError(`Took ${pdf.name} — drop one file at a time.`)
                }
                setFile(pdf)
              }}
              htmlFor="final-invoice-pdf"
              className={`flex flex-col items-center justify-center gap-1 w-full rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition ${
                dragging
                  ? 'border-amber-500 bg-amber-50'
                  : file
                    ? 'border-emerald-600/60 bg-emerald-50 hover:border-emerald-500'
                    : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100'
              }`}
            >
              {file ? (
                <>
                  <span className="text-sm text-zinc-900 font-semibold break-all">{file.name}</span>
                  <span className="text-[11px] text-zinc-600">
                    {(file.size / 1024).toFixed(0)} KB · drop another to replace
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      // The zone is a <label>, so a click anywhere inside it
                      // reopens the picker. Remove has to stop that.
                      e.preventDefault()
                      e.stopPropagation()
                      setFile(null)
                      setFileError(null)
                    }}
                    className="mt-1 text-[11px] font-semibold text-zinc-600 hover:text-zinc-900 underline"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm text-zinc-700">
                    {dragging ? 'Drop the PDF' : 'Drag a PDF here'}
                  </span>
                  <span className="text-[11px] text-zinc-600">or click to choose a file</span>
                </>
              )}
            </label>
            <input
              id="final-invoice-pdf"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                setFileError(null)
                setFile(e.target.files?.[0] ?? null)
              }}
              className="sr-only"
            />
            {fileError && <div className="mt-1.5 text-[11px] text-amber-700">{fileError}</div>}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 block">
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
        <p className={`text-sm mb-3 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-600">
          No final invoice recorded yet. Upload one once the number is agreed and it will queue for
          collection.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200">
          {rows.map((r) => (
            <div key={r.id} className="py-2.5 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  {money(r.amount)}
                  {r.invoiceNumber ? (
                    <span className="text-zinc-600 font-normal"> · {r.invoiceNumber}</span>
                  ) : null}
                </div>
                {r.note && <div className="text-xs text-zinc-600 mt-0.5">{r.note}</div>}
                <div className="text-xs text-zinc-600 mt-0.5">
                  {new Date(r.uploadedAt).toLocaleDateString()}
                  {r.pdfUrl && (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-amber-700 underline"
                    >
                      PDF
                    </a>
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-bold px-2 py-1 rounded whitespace-nowrap ${
                  r.status === 'COLLECTED'
                    ? 'bg-green-50 text-green-600'
                    : 'bg-amber-50 text-amber-700'
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
