'use client'

/**
 * Card B — Sales execution hygiene.
 *
 * Renders the four buckets returned by GET /api/exec/sales-hygiene:
 *   - Follow-ups overdue (Mode A cadence currently-due, not paused)
 *   - Stale deals (no updatedAt touch in N business days)
 *   - Drafted but never sent (DRAFT w/ line items aged past threshold)
 *   - Nearing expiry (SENT with expiresAt within warning window)
 *
 * Each row links to the order detail page.
 */

import Link from 'next/link'

type Stage = 'STAGE_1' | 'STAGE_2' | 'STAGE_3'

const STAGE_LABEL: Record<Stage, string> = {
  STAGE_1: 'Check-in #1',
  STAGE_2: 'Check-in #2',
  STAGE_3: 'Check-in #3',
}

export interface SalesHygieneData {
  now: string
  thresholds: {
    staleDealBusinessDays: number
    unsentDraftDays: number
    quoteExpiryWarningDays: number
  }
  totalCount: number
  followUpsOverdue: {
    count: number
    items: Array<{
      orderId: string
      orderNumber: string
      total: number
      quoteSentAt: string | null
      dueStage: Stage
      company: { id: string; name: string } | null
      agent: { id: string; name: string } | null
      job: { id: string; jobCode: string; name: string } | null
    }>
  }
  staleDeals: {
    count: number
    items: Array<{
      id: string
      orderNumber: string
      quoteStatus: string
      total: number
      updatedAt: string
      company: { id: string; name: string } | null
      agent: { id: string; name: string } | null
      job: { id: string; jobCode: string; name: string } | null
    }>
  }
  draftedUnsent: {
    count: number
    items: Array<{
      id: string
      orderNumber: string
      total: number
      createdAt: string
      company: { id: string; name: string } | null
      agent: { id: string; name: string } | null
      job: { id: string; jobCode: string; name: string } | null
    }>
  }
  nearingExpiry: {
    count: number
    items: Array<{
      id: string
      orderNumber: string
      total: number
      sentAt: string | null
      expiresAt: string | null
      company: { id: string; name: string } | null
      agent: { id: string; name: string } | null
      job: { id: string; jobCode: string; name: string } | null
    }>
  }
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export function SalesHygieneCard({ data }: { data: SalesHygieneData | null }) {
  if (!data) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-bold text-white">Sales execution hygiene</h2>
        <p className="text-xs text-zinc-500 mt-2">Loading…</p>
      </section>
    )
  }

  if (data.totalCount === 0) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-white">Sales execution hygiene</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Quote follow-ups, stalled deals, unsent drafts, expiring quotes.
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
          <h2 className="text-sm font-bold text-white">Sales execution hygiene</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Quote follow-ups, stalled deals, unsent drafts, expiring quotes.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-amber-200 bg-amber-900/40 border border-amber-800 px-2 py-0.5 rounded-full">
          {data.totalCount} flagged
        </span>
      </div>

      {data.followUpsOverdue.count > 0 && (
        <Subsection title="Follow-ups due" count={data.followUpsOverdue.count}>
          {data.followUpsOverdue.items.map((it) => {
            const days = daysAgo(it.quoteSentAt)
            return (
              <Link
                key={it.orderId}
                href={`/orders/${it.orderId}`}
                className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white truncate">
                        {it.job?.name ?? it.orderNumber}
                      </span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border bg-amber-900/40 text-amber-200 border-amber-800">
                        {STAGE_LABEL[it.dueStage]} due
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">
                      {it.company?.name ?? '—'}
                      {it.agent && <> · {it.agent.name}</>}
                      {days != null && <> · sent {days}d ago</>}
                      <> · {fmtMoney(it.total)}</>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </Subsection>
      )}

      {data.staleDeals.count > 0 && (
        <Subsection
          title={`Stale deals (no touch in ${data.thresholds.staleDealBusinessDays}+ biz days)`}
          count={data.staleDeals.count}
        >
          {data.staleDeals.items.map((it) => (
            <Link
              key={it.id}
              href={`/orders/${it.id}`}
              className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white truncate">
                      {it.job?.name ?? it.orderNumber}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">{it.quoteStatus}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {it.company?.name ?? '—'}
                    {it.agent && <> · {it.agent.name}</>}
                    <> · updated {daysAgo(it.updatedAt) ?? 0}d ago</>
                    <> · {fmtMoney(it.total)}</>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </Subsection>
      )}

      {data.draftedUnsent.count > 0 && (
        <Subsection
          title={`Drafted but never sent (${data.thresholds.unsentDraftDays}+ days old)`}
          count={data.draftedUnsent.count}
        >
          {data.draftedUnsent.items.map((it) => (
            <Link
              key={it.id}
              href={`/orders/${it.id}`}
              className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white truncate">
                    {it.job?.name ?? it.orderNumber}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {it.company?.name ?? '—'}
                    {it.agent && <> · {it.agent.name}</>}
                    <> · drafted {daysAgo(it.createdAt) ?? 0}d ago</>
                    <> · {fmtMoney(it.total)}</>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </Subsection>
      )}

      {data.nearingExpiry.count > 0 && (
        <Subsection
          title={`Nearing expiry (next ${data.thresholds.quoteExpiryWarningDays}d)`}
          count={data.nearingExpiry.count}
        >
          {data.nearingExpiry.items.map((it) => {
            const dfn = daysFromNow(it.expiresAt)
            const tone = dfn != null && dfn < 0 ? 'text-red-300' : 'text-amber-300'
            return (
              <Link
                key={it.id}
                href={`/orders/${it.id}`}
                className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {it.job?.name ?? it.orderNumber}
                    </div>
                    <div className={`text-[11px] truncate ${tone}`}>
                      {dfn != null && dfn < 0
                        ? `Expired ${Math.abs(dfn)}d ago`
                        : dfn != null
                          ? `Expires in ${dfn}d`
                          : 'Expires soon'}
                      {it.expiresAt && (
                        <span className="text-zinc-500">
                          {' · '}
                          {new Date(it.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      <span className="text-zinc-500">
                        {' · '}
                        {it.company?.name ?? '—'}
                        {' · '}
                        {fmtMoney(it.total)}
                      </span>
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
