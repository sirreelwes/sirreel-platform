'use client'

/**
 * Payment-info inquiry action panel. Replaces the sales-lead buttons
 * (Send Welcome / Convert to quote) for "Payment info request"
 * inquiries with a real "Send payment details" action.
 *
 * SECURITY (Wes's fast-send): the operator is the identity gate, so the
 * "no qualifying job on file" flag is surfaced PROMINENTLY next to the
 * button — not hidden — and nothing sends until the explicit click.
 * Company/Job attach are optional (searchable), and if set, associate
 * the request so future ones qualify.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface Eligibility {
  submittedEmail: string | null
  qualifies: boolean
  personName: string | null
  paymentConfigured: boolean
  status: string
}
interface Hit {
  id: string
  label: string
  sub?: string
}

function useTypeahead(kind: 'company' | 'job') {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 1) {
      setHits([])
      return
    }
    timer.current = setTimeout(async () => {
      try {
        if (kind === 'company') {
          const r = await fetch(`/api/companies?q=${encodeURIComponent(q)}`).then((x) => x.json())
          setHits((r.companies || []).map((c: any) => ({ id: c.id, label: c.name })))
        } else {
          const r = await fetch(`/api/jobs?search=${encodeURIComponent(q)}`).then((x) => x.json())
          setHits(
            (r.jobs || [])
              .slice(0, 10)
              .map((j: any) => ({ id: j.id, label: j.name, sub: `${j.jobCode}${j.company?.name ? ` · ${j.company.name}` : ''}` })),
          )
        }
      } catch {
        setHits([])
      }
    }, 220)
  }, [kind])

  return { query, setQuery, hits, open, setOpen, search, setHits }
}

export function PaymentDetailsSendPanel({
  inquiryId,
  onSent,
}: {
  inquiryId: string
  onSent: () => void
}) {
  const [elig, setElig] = useState<Eligibility | null>(null)
  const [company, setCompany] = useState<Hit | null>(null)
  const [job, setJob] = useState<Hit | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const co = useTypeahead('company')
  const jb = useTypeahead('job')

  useEffect(() => {
    fetch(`/api/inquiries/${inquiryId}/send-payment-details`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setElig(d) })
      .catch(() => {})
  }, [inquiryId])

  const send = async () => {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/inquiries/${inquiryId}/send-payment-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company?.id ?? null, jobId: job?.id ?? null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Send failed')
        return
      }
      setDone(
        `Payment details emailed to ${json.sentTo}` +
          (json.attachmentsSent ? ` · ${json.attachmentsSent} attachment(s)` : '') +
          (json.jobContactLinked ? ' · linked to job' : ''),
      )
      onSent()
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2.5 text-[12px] text-emerald-300">
        ✓ {done}
      </div>
    )
  }
  if (!elig) return <div className="text-[11px] text-zinc-500">Loading…</div>

  const canSend = !!elig.submittedEmail && elig.paymentConfigured && !sending

  return (
    <div className="rounded-xl border border-amber-600/40 bg-amber-950/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[13px] font-semibold text-amber-200">💳 Payment details request</div>
        <div className="text-[11px] text-zinc-400">
          Requester: <span className="font-mono text-zinc-200">{elig.submittedEmail || 'unknown'}</span>
        </div>
      </div>

      {/* PROMINENT identity flag — the operator is the gate. */}
      {elig.qualifies ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-[12px] text-emerald-300">
          ✓ On file{elig.personName ? ` — ${elig.personName}` : ''}, currently on a qualifying job.
        </div>
      ) : (
        <div className="rounded-lg border-2 border-rose-500/60 bg-rose-950/40 px-3 py-2.5">
          <div className="text-[12px] font-bold text-rose-300">⚠ No qualifying job on file</div>
          <div className="text-[11px] text-rose-200/90 mt-0.5">
            This address is not attached to an active job. <b>Verify the requester&rsquo;s identity</b> before
            sending — payment details go straight to this inbox.
          </div>
        </div>
      )}

      {!elig.paymentConfigured && (
        <div className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-[11px] text-zinc-400">
          Payment details aren&rsquo;t configured yet — set them in{' '}
          <a href="/admin/payment-info" className="text-amber-400 hover:underline">/admin/payment-info</a> before sending.
        </div>
      )}

      {/* Optional attach — company + job typeaheads. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <AttachField
          label="Attach company (optional)"
          picked={company}
          onClear={() => setCompany(null)}
          ta={co}
          onPick={(h) => { setCompany(h); co.setQuery(''); co.setHits([]); }}
        />
        <AttachField
          label="Attach job (optional)"
          picked={job}
          onClear={() => setJob(null)}
          ta={jb}
          onPick={(h) => { setJob(h); jb.setQuery(''); jb.setHits([]); }}
        />
      </div>

      {error && <div className="text-[11px] text-rose-300">{error}</div>}

      <button
        onClick={() => void send()}
        disabled={!canSend}
        className="w-full text-[13px] font-bold bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-lg disabled:opacity-40"
      >
        {sending ? 'Sending…' : 'Send payment details →'}
      </button>
      <div className="text-[10px] text-zinc-500 text-center">
        Sends the branded email with the current saved details + attachments and the standing fraud warning. No auto-send — this click only.
      </div>
    </div>
  )
}

function AttachField({
  label,
  picked,
  onClear,
  onPick,
  ta,
}: {
  label: string
  picked: Hit | null
  onClear: () => void
  onPick: (h: Hit) => void
  ta: ReturnType<typeof useTypeahead>
}) {
  return (
    <div className="relative">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">{label}</div>
      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-600 bg-zinc-900 px-2.5 py-1.5">
          <span className="text-[12px] text-zinc-200 truncate">{picked.label}</span>
          <button onClick={onClear} className="text-[11px] text-zinc-500 hover:text-zinc-300 flex-shrink-0">clear</button>
        </div>
      ) : (
        <>
          <input
            value={ta.query}
            onChange={(e) => { ta.setQuery(e.target.value); ta.search(e.target.value); ta.setOpen(true); }}
            onFocus={() => ta.setOpen(true)}
            placeholder="Search…"
            className="w-full rounded-lg border border-zinc-600 bg-zinc-900 px-2.5 py-1.5 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
          />
          {ta.open && ta.hits.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-auto">
              {ta.hits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => onPick(h)}
                  className="block w-full text-left px-2.5 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-800"
                >
                  {h.label}
                  {h.sub && <span className="text-zinc-500 ml-1.5 text-[10px]">{h.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
