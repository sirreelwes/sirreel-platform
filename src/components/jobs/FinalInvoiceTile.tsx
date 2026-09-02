'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The Final Invoice tile on the job's paperwork strip (Wes 2026-09-02).
 *
 * The other five tiles answer "can this job go out". This one answers the
 * question at the other end — has the client been billed, and do they know
 * how to pay. That state existed (JobFinalInvoice carries `emailedAt`, and
 * `rwInvoiceId` when it settles a RentalWorks invoice) but lived only in the
 * panel further down the page and in the Collections queue, so the paperwork
 * strip stopped short of the money.
 *
 * Three states, and the distinction that matters is the middle one: an
 * invoice that exists but has NOT been sent looks finished from across the
 * room and is the one that quietly ages.
 */

interface FinalInvoice {
  id: string
  invoiceNumber: string | null
  amount: number
  status: string
  pdfUrl: string | null
  uploadedAt: string
  emailedAt: string | null
  emailedTo: string | null
  rwInvoiceId: string | null
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** An invoice HQ itself cut, from the job payload the page already holds. */
export interface HqInvoice {
  id: string
  invoiceNumber: string
  status: string
  total: number
  sentAt: string | null
}

export function FinalInvoiceTile({
  jobId,
  hqInvoices = [],
  onUpload,
}: {
  jobId: string
  /**
   * Invoices generated in HQ against this job's orders. A job can be billed
   * two ways and the tile has to know both, or it says "Not yet" on a job
   * that was invoiced this morning — which is what it did on Peacoat /
   * SR-INV-30004 before this prop existed.
   */
  hqInvoices?: HqInvoice[]
  /**
   * Open the upload form on the panel below. A bare `#final-invoice` link
   * was NOT enough (Wes 2026-09-02): on a job with no HQ order and no linked
   * RW order the whole Billing section is folded away, so the anchor didn't
   * exist and the click did nothing at all — and even when it did exist it
   * only scrolled, leaving the form collapsed behind its own button.
   */
  onUpload?: () => void
}) {
  const [rows, setRows] = useState<FinalInvoice[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/jobs/${jobId}/final-invoice`, { cache: 'no-store' })
      if (!r.ok) return setRows([])
      const j = (await r.json()) as { finalInvoices?: FinalInvoice[] }
      setRows(j.finalInvoices ?? [])
    } catch {
      setRows([])
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  // Newest wins; the panel below lists the rest.
  const inv = rows && rows.length ? rows[0] : null
  // A JobFinalInvoice is the explicit "this is the final number" record and
  // outranks an HQ invoice, which may still be one of several.
  const hq = !inv && hqInvoices.length ? hqInvoices[0] : null
  const sent = inv ? !!inv.emailedAt : !!hq?.sentAt

  const send = async () => {
    if ((!inv && !hq) || busy) return
    setBusy(true)
    setMsg(null)
    try {
      if (!inv && hq) {
        // The HQ invoice path has its own already-sent guard; a deliberate
        // resend has to say so.
        const r = await fetch(`/api/invoices/${hq.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hq.sentAt ? { resend: true } : {}),
        })
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        setMsg(r.ok && j.ok !== false ? 'Sent' : j.error || 'Did not send')
        setBusy(false)
        return
      }
      // Same endpoint Collections uses — one send path, so a resend from
      // here stamps emailedAt exactly as Ana's does.
      const r = await fetch(`/api/collections/final-invoices/${inv!.id}/send`, { method: 'POST' })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      setMsg(r.ok && j.ok !== false ? 'Sent' : j.error || 'Did not send')
      await load()
    } catch {
      setMsg('Did not send')
    } finally {
      setBusy(false)
    }
  }

  // Match the sibling tiles: don't render a skeleton, just arrive.
  if (rows === null) return null

  const tone = !inv && !hq
    ? { dot: 'bg-zinc-300', text: 'text-zinc-600', label: 'Not yet' }
    : sent
      ? { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Sent' }
      : { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Not sent' }

  return (
    <div className="group rounded-lg border border-zinc-200 bg-zinc-50 hover:border-amber-400 p-3.5 transition-colors">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
        Final Invoice
      </div>

      <div className={`mt-2.5 flex items-center gap-2 text-[15px] font-bold ${tone.text}`}>
        <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
        {tone.label}
      </div>

      <div className="mt-1.5 text-[12px] text-zinc-700">
        {inv ? (
          <>
            {inv.invoiceNumber ? `${inv.invoiceNumber} · ` : ''}
            {inv.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            <span className="text-zinc-600">
              {' · '}
              {inv.rwInvoiceId ? 'from RW' : 'uploaded'}
            </span>
          </>
        ) : hq ? (
          <>
            {hq.invoiceNumber} ·{' '}
            {hq.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            <span className="text-zinc-600"> · created in HQ</span>
          </>
        ) : (
          'Upload one, or import from RW'
        )}
      </div>

      {(inv || hq) && (
        <div className="mt-1 text-[11px] text-zinc-600">
          {inv
            ? inv.emailedAt
              ? `Client emailed ${shortDate(inv.emailedAt)}${inv.emailedTo ? ` · ${inv.emailedTo}` : ''}`
              : 'The client has not been told how to pay'
            : hq && hq.sentAt
              ? `Sent to the client ${shortDate(hq.sentAt)}`
              : 'Not sent to the client yet'}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {inv || hq ? (
          <button
            onClick={() => void send()}
            disabled={busy}
            className="text-[11px] font-semibold px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 text-zinc-800"
          >
            {busy ? 'Sending…' : sent ? 'Send again' : 'Send to client'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => (onUpload ? onUpload() : (window.location.hash = 'final-invoice'))}
          className="text-[11px] font-semibold text-amber-700 hover:text-amber-800"
        >
          {inv || hq ? 'Upload another →' : 'Upload →'}
        </button>
        {inv?.pdfUrl && (
          <a
            href={inv.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-zinc-600 hover:text-zinc-900"
          >
            PDF →
          </a>
        )}
      </div>

      {msg && <div className="mt-1.5 text-[11px] text-zinc-700">{msg}</div>}
    </div>
  )
}
