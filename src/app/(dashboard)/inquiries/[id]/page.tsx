'use client'

/**
 * /inquiries/[id] — operator triage detail.
 *
 * Renders the full Inquiry payload with structured cart rendering for
 * WEB_FORM supply-orders (sourceMetadata.kind === 'supply-order') and
 * the three triage actions:
 *
 *   - Convert to quote → /orders/new-quote?inquiryId=… (existing flow;
 *     prefill from sourceMetadata.cart lands in a follow-on)
 *   - Dismiss        → PATCH status=DISMISSED, redirect /inquiries
 *   - Assign to me   → PATCH assignToMe=true (server resolves session)
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type InquiryStatus = 'NEW' | 'CONVERTED' | 'DISMISSED'
type InquirySource = 'MANUAL' | 'GMAIL' | 'WEB_FORM'

interface CartSnapshotLine {
  itemId: string
  code: string
  name: string
  type: string
  category: string
  unitPrice: number
  quantity: number
  days: number | null
  lineTotal: number
}
interface SupplyOrderMetadata {
  kind?: string
  contact?: { name?: string | null; email?: string | null; phone?: string | null }
  production?: { companyName?: string | null; productionName?: string | null }
  dates?: { start?: string | null; end?: string | null }
  cart?: CartSnapshotLine[]
  totals?: { units?: number; amount?: number }
  notes?: string | null
  submittedAt?: string
  ipAddress?: string | null
  userAgent?: string | null
}
interface Inquiry {
  id: string
  title: string
  description: string
  source: InquirySource
  status: InquiryStatus
  estimatedValue: number | null
  preferredStartDate: string | null
  preferredEndDate: string | null
  createdAt: string
  updatedAt: string
  company: { id: string; name: string } | null
  person: { id: string; firstName: string; lastName: string; email: string } | null
  assignedTo: { id: string; name: string } | null
  convertedJob: { id: string; jobCode: string; name: string } | null
  sourceMetadata: SupplyOrderMetadata | null
}

const SOURCE_LABEL: Record<InquirySource, string> = {
  MANUAL: 'Manual',
  GMAIL: 'Gmail',
  WEB_FORM: 'Web form',
}
const SOURCE_BADGE: Record<InquirySource, string> = {
  MANUAL: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  GMAIL: 'bg-blue-50 text-blue-700 border-blue-200',
  WEB_FORM: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const STATUS_BADGE: Record<InquiryStatus, string> = {
  NEW: 'bg-amber-50 text-amber-800 border-amber-200',
  CONVERTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISMISSED: 'bg-zinc-50 text-zinc-500 border-zinc-200',
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function InquiryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<null | 'dismiss' | 'assign'>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/inquiries/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error || !d.inquiry) throw new Error(d.error || 'not found')
        setInquiry(d.inquiry)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  async function dismiss() {
    if (!inquiry) return
    if (!confirm('Dismiss this inquiry? You can find it later via the All filter.')) return
    setActionPending('dismiss')
    setActionError(null)
    try {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DISMISSED' }),
      })
      if (!res.ok) throw new Error('Dismiss failed')
      router.push('/inquiries')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionPending(null)
    }
  }

  async function assignToMe() {
    if (!inquiry) return
    setActionPending('assign')
    setActionError(null)
    try {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignToMe: true }),
      })
      const json = await res.json()
      if (!res.ok || !json.inquiry) throw new Error(json.error || 'Assign failed')
      setInquiry(json.inquiry)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionPending(null)
    }
  }

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>
  if (error || !inquiry) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Link href="/inquiries" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Back to inquiries
        </Link>
        <div className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error || 'Inquiry not found'}
        </div>
      </div>
    )
  }

  const meta = inquiry.sourceMetadata ?? null
  const isSupplyOrder = meta?.kind === 'supply-order'
  const refCode = inquiry.id.slice(0, 8).toUpperCase()
  const cart = isSupplyOrder ? meta?.cart ?? [] : []
  const isClosed = inquiry.status !== 'NEW'

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Link href="/inquiries" className="text-xs text-zinc-500 hover:text-zinc-300">
        ← Back to inquiries
      </Link>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${SOURCE_BADGE[inquiry.source]}`}
              >
                {SOURCE_LABEL[inquiry.source]}
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${STATUS_BADGE[inquiry.status]}`}
              >
                {inquiry.status}
              </span>
              {isSupplyOrder && (
                <span className="text-[11px] font-mono text-zinc-500">ref {refCode}</span>
              )}
              <span className="text-[11px] text-zinc-500">submitted {fmtDateTime(inquiry.createdAt)}</span>
            </div>
            <h1 className="text-xl font-semibold text-white mt-2 break-words">{inquiry.title}</h1>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!isClosed && (
              <>
                {!inquiry.assignedTo && (
                  <button
                    onClick={assignToMe}
                    disabled={actionPending != null}
                    className="text-xs font-semibold border border-zinc-700 text-zinc-200 hover:border-zinc-500 px-3 py-1.5 rounded-lg disabled:opacity-40"
                  >
                    {actionPending === 'assign' ? 'Assigning…' : 'Assign to me'}
                  </button>
                )}
                <button
                  onClick={dismiss}
                  disabled={actionPending != null}
                  className="text-xs font-semibold border border-zinc-700 text-zinc-300 hover:border-rose-500 hover:text-rose-300 px-3 py-1.5 rounded-lg disabled:opacity-40"
                >
                  {actionPending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
                </button>
                <Link
                  href={`/orders/new-quote?inquiryId=${inquiry.id}`}
                  className="text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg"
                >
                  Convert to quote →
                </Link>
              </>
            )}
          </div>
        </div>

        {!isClosed && (
          <div className="mt-2 text-[11px] text-zinc-500 text-right">
            Converting creates a Job in the sales pipeline and moves this inquiry to Converted.
          </div>
        )}

        {actionError && (
          <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
            {actionError}
          </div>
        )}

        {inquiry.convertedJob && (
          <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5">
            Converted to{' '}
            <Link href={`/jobs/${inquiry.convertedJob.id}`} className="font-mono font-semibold hover:underline">
              {inquiry.convertedJob.jobCode}
            </Link>{' '}
            — {inquiry.convertedJob.name}
          </div>
        )}
      </div>

      {/* Meta grid */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Meta label="Contact" value={contactDisplay(inquiry)} />
        <Meta label="Email" value={contactEmail(inquiry)} />
        <Meta label="Phone" value={meta?.contact?.phone || '—'} />
        <Meta label="Company" value={meta?.production?.companyName || inquiry.company?.name || '—'} />
        <Meta label="Production" value={meta?.production?.productionName || '—'} />
        <Meta label="Pickup → Return" value={`${fmtDate(inquiry.preferredStartDate)} → ${fmtDate(inquiry.preferredEndDate)}`} />
        <Meta label="Est. value" value={fmtMoney(inquiry.estimatedValue)} />
        <Meta label="Assigned" value={inquiry.assignedTo?.name || '—'} />
      </div>

      {/* Cart for supply-order WEB_FORM submissions */}
      {isSupplyOrder && cart.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-white">Cart ({cart.length} line{cart.length === 1 ? '' : 's'})</h2>
            <span className="text-xs text-zinc-500">
              {meta?.totals?.units ?? 0} unit{(meta?.totals?.units ?? 0) === 1 ? '' : 's'} · {fmtMoney(meta?.totals?.amount)}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/40">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {cart.map((l) => (
                <tr key={l.itemId} className="text-zinc-300">
                  <td className="px-3 py-2">
                    <div className="text-zinc-100">{l.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{l.code}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{l.category}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono">{l.quantity}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono">{l.days ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono">{fmtMoney(l.unitPrice)}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-zinc-100">{fmtMoney(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes / description */}
      {(meta?.notes || (!isSupplyOrder && inquiry.description)) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-2">
            {isSupplyOrder ? 'Notes from client' : 'Description'}
          </h2>
          <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-300">
            {isSupplyOrder ? meta?.notes : inquiry.description}
          </pre>
        </div>
      )}

      {/* Raw description for supply orders — useful for triage at a glance */}
      {isSupplyOrder && inquiry.description && (
        <details className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-3">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
            Show queue-list rendering (description text)
          </summary>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-zinc-400 mt-3">{inquiry.description}</pre>
        </details>
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm text-zinc-100 mt-0.5 truncate">{value}</div>
    </div>
  )
}

function contactDisplay(i: Inquiry): string {
  const meta = i.sourceMetadata
  return (
    meta?.contact?.name ||
    (i.person ? `${i.person.firstName} ${i.person.lastName}`.trim() : '') ||
    '—'
  )
}
function contactEmail(i: Inquiry): string {
  return i.sourceMetadata?.contact?.email || i.person?.email || '—'
}
