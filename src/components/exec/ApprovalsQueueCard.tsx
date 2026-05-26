'use client'

/**
 * Card A — Approvals queue.
 *
 * Renders the four buckets returned by GET /api/exec/approvals:
 *   - ContractReview pending
 *   - CoiCheck pending (with aiRiskLevel pill)
 *   - ReviewChangeDecision pending
 *   - Renewals due (annual agreement + annual COI)
 *
 * Visual register matches FollowUpsDuePanel / SalesSignalsStrip — no new
 * card primitive, just composed inline. Each row links to the canonical
 * existing detail/review UI for that item type.
 */

import Link from 'next/link'

export interface ApprovalsData {
  now: string
  renewalWindowDays: number
  totalCount: number
  contractReviews: {
    count: number
    items: Array<{
      id: string
      createdAt: string
      originalFilename: string
      aiRiskLevel: string | null
      aiRecommendation: string | null
      company: { id: string; name: string } | null
      job: { id: string; jobCode: string; name: string } | null
    }>
  }
  coiChecks: {
    count: number
    items: Array<{
      id: string
      createdAt: string
      originalFilename: string
      aiRiskLevel: string | null
      aiRecommendation: string | null
      policyExpiryDate: string | null
      company: { id: string; name: string } | null
      job: { id: string; jobCode: string; name: string } | null
    }>
  }
  changeDecisions: {
    count: number
    items: Array<{
      id: string
      createdAt: string
      clauseRef: string
      changeType: string
      review: {
        id: string
        originalFilename: string
        aiRiskLevel: string | null
        company: { id: string; name: string } | null
        job: { id: string; jobCode: string; name: string } | null
      }
    }>
  }
  renewals: {
    count: number
    items: Array<{
      companyId: string
      companyName: string
      kind: 'agreement' | 'coi'
      expiresAt: string
      daysFromNow: number
      defaultAgent: { id: string; name: string } | null
    }>
  }
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function riskPill(level: string | null | undefined): JSX.Element | null {
  if (!level) return null
  const l = level.toLowerCase()
  const cls =
    l === 'high'
      ? 'bg-red-900/40 text-red-200 border-red-800'
      : l === 'medium'
        ? 'bg-amber-900/40 text-amber-200 border-amber-800'
        : 'bg-zinc-800 text-zinc-300 border-zinc-700'
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${cls}`}
    >
      {l}
    </span>
  )
}

export function ApprovalsQueueCard({ data }: { data: ApprovalsData | null }) {
  if (!data) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-bold text-white">Approvals queue</h2>
        <p className="text-xs text-zinc-500 mt-2">Loading…</p>
      </section>
    )
  }

  if (data.totalCount === 0) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-white">Approvals queue</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Contract reviews, COIs, change decisions, and annual renewals waiting on a call.
            </p>
          </div>
          <span className="text-[11px] font-semibold text-emerald-300 bg-emerald-900/40 border border-emerald-800 px-2 py-0.5 rounded-full">
            All clear
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white">Approvals queue</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Contract reviews, COIs, change decisions, and annual renewals waiting on a call.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-amber-200 bg-amber-900/40 border border-amber-800 px-2 py-0.5 rounded-full">
          {data.totalCount} pending
        </span>
      </div>

      {data.contractReviews.count > 0 && (
        <Subsection title="Contract reviews" count={data.contractReviews.count}>
          {data.contractReviews.items.map((it) => (
            <Link
              key={it.id}
              href={`/tools/contract-review/${it.id}`}
              className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">
                      {it.company?.name ?? it.originalFilename}
                    </span>
                    {riskPill(it.aiRiskLevel)}
                    {it.aiRecommendation && (
                      <span className="text-[10px] text-zinc-500">
                        AI: {it.aiRecommendation}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {it.job ? `${it.job.jobCode} · ${it.job.name}` : 'Unlinked review'}
                    {' · '}
                    {daysAgo(it.createdAt)}d waiting
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </Subsection>
      )}

      {data.coiChecks.count > 0 && (
        <Subsection title="COI checks" count={data.coiChecks.count}>
          {data.coiChecks.items.map((it) => (
            <Link
              key={it.id}
              href={`/tools/coi-check`}
              className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">
                      {it.company?.name ?? it.originalFilename}
                    </span>
                    {riskPill(it.aiRiskLevel)}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {it.job ? `${it.job.jobCode} · ${it.job.name}` : 'Unlinked COI'}
                    {' · '}
                    {daysAgo(it.createdAt)}d waiting
                    {it.policyExpiryDate && (
                      <> · policy expires {new Date(it.policyExpiryDate).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </Subsection>
      )}

      {data.changeDecisions.count > 0 && (
        <Subsection title="Contract change decisions" count={data.changeDecisions.count}>
          {data.changeDecisions.items.map((it) => (
            <Link
              key={it.id}
              href={`/tools/contract-review/${it.review.id}`}
              className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">
                      {it.review.company?.name ?? it.review.originalFilename}
                    </span>
                    {riskPill(it.review.aiRiskLevel)}
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {it.clauseRef} · {it.changeType}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {it.review.job ? `${it.review.job.jobCode} · ${it.review.job.name}` : 'Unlinked'}
                    {' · '}
                    {daysAgo(it.createdAt)}d waiting
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </Subsection>
      )}

      {data.renewals.count > 0 && (
        <Subsection title={`Renewals (next ${data.renewalWindowDays}d)`} count={data.renewals.count}>
          {data.renewals.items.map((it) => {
            const expired = it.daysFromNow < 0
            const tone = expired
              ? 'text-red-300'
              : it.daysFromNow <= 7
                ? 'text-amber-300'
                : 'text-zinc-400'
            return (
              <Link
                key={`${it.companyId}-${it.kind}`}
                href={`/crm/${it.companyId}`}
                className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white truncate">
                        {it.companyName}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        {it.kind === 'agreement' ? 'Annual agreement' : 'Annual COI'}
                      </span>
                    </div>
                    <div className={`text-[11px] truncate ${tone}`}>
                      {expired
                        ? `Expired ${Math.abs(it.daysFromNow)}d ago`
                        : `Expires in ${it.daysFromNow}d`}
                      {' · '}
                      {new Date(it.expiresAt).toLocaleDateString()}
                      {it.defaultAgent && <span className="text-zinc-500"> · {it.defaultAgent.name}</span>}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </Subsection>
      )}
    </section>
  )
}

function Subsection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{title}</h3>
        <span className="text-[10px] text-zinc-500">{count}</span>
      </div>
      <div className="divide-y divide-zinc-800">{children}</div>
    </div>
  )
}
