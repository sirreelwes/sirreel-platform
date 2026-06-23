'use client'

/**
 * /admin/negotiated-agreements — registry of every Company with a
 * recorded standing (negotiated) agreement.
 *
 * Reads from GET /api/admin/negotiated-agreements. Each row links
 * to the Company file for editing and exposes a direct download
 * link for the stored PDF (no rendering — Vercel Blob serves it).
 *
 * Reuses the light-theme tokens.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface RegistryRow {
  id: string
  name: string
  tier: string
  negotiatedTermsUrl: string | null
  negotiatedTermsSummary: string | null
  negotiatedTermsNegotiatedAt: string | null
  negotiatedTermsApprovedBy: string | null
  negotiatedTermsApprovedAt: string | null
  negotiatedTermsActiveAsOf: string | null
  negotiatedTermsReviewDueDate: string | null
}

const TIER_STYLES: Record<string, string> = {
  VIP: 'bg-chip-warn-bg text-chip-warn-fg',
  PREFERRED: 'bg-cadence-booked-bg text-cadence-booked-fg',
  STANDARD: 'bg-chip-neutral-bg text-chip-neutral-fg',
  NEW: 'bg-chip-good-bg text-chip-good-fg',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function NegotiatedAgreementsRegistryPage() {
  const [rows, setRows] = useState<RegistryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/admin/negotiated-agreements')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setRows(d.companies || [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const now = Date.now()
  const pastReviewCount = rows.filter(
    (r) => r.negotiatedTermsReviewDueDate && new Date(r.negotiatedTermsReviewDueDate).getTime() < now,
  ).length

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1200px] mx-auto">
        <Link
          href="/admin/paperwork"
          className="text-sm text-lt-fg2 hover:text-lt-fg mb-4 inline-block"
        >
          ← Paperwork tools
        </Link>
        <header className="flex items-end justify-between gap-3 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-lt-fg">Negotiated agreements</h1>
            <p className="text-sm text-lt-fg2 mt-0.5">
              Every client with a recorded standing agreement — the PDF auto-presents on new orders for that company instead of the SirReel baseline.
            </p>
          </div>
          {pastReviewCount > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-chip-bad-bg text-chip-bad-fg">
              {pastReviewCount} past review · re-paper soon
            </span>
          )}
        </header>

        <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-lt-fg3 text-sm">Loading…</div>
          ) : error ? (
            <div className="px-4 py-12 text-center text-chip-bad-fg text-sm">{error}</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-lt-fg3 text-sm">
              No companies have a recorded standing agreement yet. Record one from a Company file via Clients → open a company → Edit → Negotiated standing agreement.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-[10px] font-semibold uppercase tracking-wider bg-lt-inner">
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Established</th>
                  <th className="px-4 py-3">Review due</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lt-hairline">
                {rows.map((r) => {
                  const reviewDue = r.negotiatedTermsReviewDueDate
                    ? new Date(r.negotiatedTermsReviewDueDate)
                    : null
                  const pastReview = reviewDue ? reviewDue.getTime() < now : false
                  return (
                    <tr key={r.id} className="hover:bg-lt-inner transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/crm/${r.id}`}
                            className="text-lt-fg font-medium hover:text-black"
                          >
                            {r.name}
                          </Link>
                          {r.tier && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_STYLES[r.tier] ?? 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
                              {r.tier}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-lt-fg2 text-xs whitespace-nowrap">
                        {fmtDate(r.negotiatedTermsApprovedAt)}
                        {r.negotiatedTermsApprovedBy && (
                          <div className="text-lt-fg3">by {r.negotiatedTermsApprovedBy}</div>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${pastReview ? 'text-chip-bad-fg font-semibold' : 'text-lt-fg2'}`}>
                        {fmtDate(r.negotiatedTermsReviewDueDate)}
                        {pastReview && <div className="text-[10px] uppercase tracking-wider">Past due</div>}
                      </td>
                      <td className="px-4 py-3 text-lt-fg2 text-xs max-w-[360px]">
                        <p className="line-clamp-3 whitespace-pre-wrap">
                          {r.negotiatedTermsSummary || <span className="text-lt-fg3">—</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          <Link
                            href={`/crm/${r.id}`}
                            className="text-xs text-lt-fg hover:text-black"
                          >
                            Open
                          </Link>
                          {r.negotiatedTermsUrl ? (
                            <a
                              href={`/api/crm/companies/${r.id}/standing-agreement/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-lt-fg hover:text-black"
                              title="Download the negotiated PDF"
                            >
                              Download ↓
                            </a>
                          ) : (
                            <span className="text-xs text-lt-fg3">No PDF</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
