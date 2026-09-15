'use client'

/**
 * "Approved redlined agreements" — the filed masters, across all companies.
 *
 * Wes, 2026-09-15: "create a section at bottom of paperwork page where we file
 * all approved redlined agreements for production companies."
 *
 * The feed at the top of this page lists paperwork still waiting on US. This
 * lists the negotiations that are OVER: a client redlined our agreement, we
 * agreed it, and the result is on file.
 *
 * It reads BOTH registers — the standing-terms columns behind
 * /admin/negotiated-agreements, and the CompanyAgreement master that actually
 * papers a company's jobs — because nothing keeps them in step, and a company
 * approved in one but not the other is exactly what produced the 2026-09-15
 * email asking why the quote portal still served our standard agreement.
 * Those rows sort to the top with a warning; the list is read to find the
 * account that is set up wrong, not to browse. Nothing here reconciles
 * anything — the fix is a human call on the company's own page.
 *
 * Styling follows this page's existing gray/white cards rather than the
 * lt- and chip- tokens — mixing two palettes inside one screen reads worse
 * than either on its own, and this surface is already light.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Master {
  id: string
  contractType: string
  title: string | null
  autoCoverJobs: boolean
  covering: boolean
  lapsed: 'expired' | 'not-yet' | null
  effectiveDate: string | null
  expiryDate: string | null
  signerName: string | null
  standingLcdwDecision: string | null
  originalFilename: string
}

interface Row {
  companyId: string
  companyName: string | null
  registry: null | {
    approvedAt: string | null
    approvedBy: string | null
    url: string | null
    summary: string | null
    reviewDueDate: string | null
  }
  masters: Master[]
  covering: boolean
  gap: 'registered-not-covering' | 'covering-not-registered' | null
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function Chip({ tone, children }: { tone: 'good' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <span className={`inline-block rounded border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  )
}

const GAP_COPY: Record<NonNullable<Row['gap']>, string> = {
  'registered-not-covering':
    'Negotiated terms are approved for this company, but no agreement is papering their jobs — the portal still asks them to sign our standard agreement.',
  'covering-not-registered':
    'An agreement papers this company’s jobs, but the standing-terms registry is blank — the order and portal paths that read it will not know.',
}

export default function FiledAgreements() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/paperwork/negotiated-agreements')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setRows(d.companies || []))
      .catch(() => live && setError('Could not load filed agreements.'))
    return () => {
      live = false
    }
  }, [])

  if (error) return <p className="text-[12px] text-gray-500">{error}</p>
  if (!rows) return <p className="text-[12px] text-gray-400">Loading…</p>

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-gray-500 rounded-xl border border-dashed border-gray-300 bg-white px-5 py-4">
        No negotiated agreements on file yet. When a client&apos;s redline is agreed, file it on their
        company page and it appears here.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.companyId}
          className={`rounded-xl border bg-white px-5 py-4 ${row.gap ? 'border-amber-300' : 'border-gray-200'}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <Link href={`/crm/${row.companyId}`} className="text-[15px] font-semibold text-gray-900 hover:underline">
              {row.companyName || 'Unnamed company'}
            </Link>
            <div className="flex items-center gap-1.5 shrink-0">
              {row.covering ? <Chip tone="good">Papers their jobs</Chip> : <Chip tone="neutral">On file</Chip>}
              {row.gap && <Chip tone="warn">Needs attention</Chip>}
            </div>
          </div>

          {row.gap && <p className="text-[12px] text-amber-800 mt-1.5 leading-relaxed">{GAP_COPY[row.gap]}</p>}

          {row.registry && (
            <p className="text-[12px] text-gray-500 mt-1.5">
              Standing terms approved {fmt(row.registry.approvedAt)}
              {row.registry.approvedBy ? ` by ${row.registry.approvedBy}` : ''}
              {row.registry.reviewDueDate ? ` · review due ${fmt(row.registry.reviewDueDate)}` : ''}
              {row.registry.url && (
                <>
                  {' · '}
                  <a
                    href={row.registry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gray-700 underline hover:text-gray-900"
                  >
                    filed document
                  </a>
                </>
              )}
            </p>
          )}

          {row.masters.length > 0 ? (
            <ul className="divide-y divide-gray-100 mt-2">
              {row.masters.map((m) => (
                <li key={m.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-gray-900 font-medium truncate">
                      {m.title || m.originalFilename}
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      {m.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'}
                      {' · '}
                      {fmt(m.effectiveDate)} → {fmt(m.expiryDate)}
                      {m.signerName ? ` · signed by ${m.signerName}` : ''}
                      {m.standingLcdwDecision ? ` · LCDW ${m.standingLcdwDecision.toLowerCase()}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {m.covering && <Chip tone="good">Auto-covers</Chip>}
                    {m.lapsed === 'expired' && <Chip tone="warn">Expired</Chip>}
                    {m.lapsed === 'not-yet' && <Chip tone="warn">Not yet in effect</Chip>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-gray-500 mt-2 italic">No agreement document filed for this company.</p>
          )}
        </div>
      ))}
    </div>
  )
}
