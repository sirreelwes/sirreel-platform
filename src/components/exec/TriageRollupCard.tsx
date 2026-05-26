'use client'

/**
 * "Needs a decision" — triage roll-up.
 *
 * Composes from the existing /api/exec/approvals + /api/exec/sales-hygiene
 * responses (no third endpoint). Unions the decision-blocking exception
 * items into one flat, ranked list:
 *
 *   Tier 1 — pending approvals (contract reviews, COIs, change decisions,
 *            annual renewals). Intra-tier: high risk > medium > low > none,
 *            then oldest-waiting first.
 *   Tier 2 — overdue follow-ups (Mode A cadence currently-due). Oldest
 *            quoteSentAt first.
 *   Tier 3 — quotes nearing expiry. Soonest-to-expire / already-expired
 *            first.
 *
 * Stale deals and drafted-unsent live in Card B only — they're hygiene,
 * not decision-blocking, so they don't bubble into the triage.
 */

import Link from 'next/link'
import type { ApprovalsData } from './ApprovalsQueueCard'
import type { SalesHygieneData } from './SalesHygieneCard'

const RISK_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }
const ITEM_LIMIT = 12

interface TriageItem {
  key: string
  tier: 1 | 2 | 3
  /** Sort key within the tier — lower number = more urgent. */
  intraTierRank: number
  kind: string
  label: string
  sublabel: string
  href: string
  /** Visual tone for the row indicator dot. */
  tone: 'red' | 'amber' | 'zinc'
}

function riskRank(level: string | null | undefined): number {
  if (!level) return 3
  return RISK_RANK[level.toLowerCase()] ?? 3
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function daysFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

function buildItems(
  approvals: ApprovalsData | null,
  hygiene: SalesHygieneData | null,
): TriageItem[] {
  const out: TriageItem[] = []

  if (approvals) {
    // ── Tier 1a — ContractReview ────────────────────────────────
    for (const it of approvals.contractReviews.items) {
      const r = riskRank(it.aiRiskLevel)
      const age = ageDays(it.createdAt)
      out.push({
        key: `cr-${it.id}`,
        tier: 1,
        // risk-tier dominant (weight 100k), age modulates within risk band
        intraTierRank: r * 100_000 - age,
        kind: 'Contract review',
        label: it.company?.name ?? it.originalFilename,
        sublabel: `${it.job ? it.job.jobCode + ' · ' : ''}${age}d waiting${
          it.aiRiskLevel ? ` · ${it.aiRiskLevel.toLowerCase()} risk` : ''
        }`,
        href: `/tools/contract-review/${it.id}`,
        tone: r === 0 ? 'red' : r === 1 ? 'amber' : 'zinc',
      })
    }
    // ── Tier 1b — CoiCheck ──────────────────────────────────────
    for (const it of approvals.coiChecks.items) {
      const r = riskRank(it.aiRiskLevel)
      const age = ageDays(it.createdAt)
      out.push({
        key: `coi-${it.id}`,
        tier: 1,
        intraTierRank: r * 100_000 - age,
        kind: 'COI',
        label: it.company?.name ?? it.originalFilename,
        sublabel: `${it.job ? it.job.jobCode + ' · ' : ''}${age}d waiting${
          it.aiRiskLevel ? ` · ${it.aiRiskLevel.toLowerCase()} risk` : ''
        }`,
        href: '/tools/coi-check',
        tone: r === 0 ? 'red' : r === 1 ? 'amber' : 'zinc',
      })
    }
    // ── Tier 1c — ReviewChangeDecision ──────────────────────────
    for (const it of approvals.changeDecisions.items) {
      const r = riskRank(it.review.aiRiskLevel)
      const age = ageDays(it.createdAt)
      out.push({
        key: `cd-${it.id}`,
        tier: 1,
        intraTierRank: r * 100_000 - age,
        kind: 'Change decision',
        label: it.review.company?.name ?? it.review.originalFilename,
        sublabel: `${it.clauseRef} · ${it.changeType} · ${age}d waiting`,
        href: `/tools/contract-review/${it.review.id}`,
        tone: r === 0 ? 'red' : r === 1 ? 'amber' : 'zinc',
      })
    }
    // ── Tier 1d — Annual renewals ───────────────────────────────
    // Treat already-expired (negative daysFromNow) as highest-urgency
    // within the renewals sub-bucket; otherwise rank by proximity.
    // Sit at risk-rank 0 (treated as "high") if expired, 1 if within
    // a week, 2 otherwise — so expired renewals can beat low-risk
    // stale contract reviews on age alone.
    for (const it of approvals.renewals.items) {
      const expired = it.daysFromNow < 0
      const r = expired ? 0 : it.daysFromNow <= 7 ? 1 : 2
      out.push({
        key: `renew-${it.companyId}-${it.kind}`,
        tier: 1,
        // Use absolute time-to-expiry for intra-rank within the band;
        // larger negative daysFromNow (= more expired) sorts first.
        intraTierRank: r * 100_000 + it.daysFromNow,
        kind: it.kind === 'agreement' ? 'Annual agreement' : 'Annual COI',
        label: it.companyName,
        sublabel: expired
          ? `Expired ${Math.abs(it.daysFromNow)}d ago`
          : `Expires in ${it.daysFromNow}d${
              it.defaultAgent ? ` · ${it.defaultAgent.name}` : ''
            }`,
        href: `/crm/${it.companyId}`,
        tone: expired ? 'red' : it.daysFromNow <= 7 ? 'amber' : 'zinc',
      })
    }
  }

  if (hygiene) {
    // ── Tier 2 — Follow-ups overdue ─────────────────────────────
    for (const it of hygiene.followUpsOverdue.items) {
      const age = it.quoteSentAt ? ageDays(it.quoteSentAt) : 0
      out.push({
        key: `fu-${it.orderId}`,
        tier: 2,
        intraTierRank: -age, // oldest first
        kind: 'Follow-up due',
        label: it.job?.name ?? it.orderNumber,
        sublabel: `${it.company?.name ?? '—'}${
          it.agent ? ` · ${it.agent.name}` : ''
        } · sent ${age}d ago`,
        href: `/orders/${it.orderId}`,
        tone: 'amber',
      })
    }

    // ── Tier 3 — Nearing expiry ─────────────────────────────────
    for (const it of hygiene.nearingExpiry.items) {
      const dfn = it.expiresAt ? daysFromNow(it.expiresAt) : 0
      const expired = dfn < 0
      out.push({
        key: `exp-${it.id}`,
        tier: 3,
        intraTierRank: dfn, // most-expired (most negative) first
        kind: 'Quote expiring',
        label: it.job?.name ?? it.orderNumber,
        sublabel: expired
          ? `Expired ${Math.abs(dfn)}d ago · ${it.company?.name ?? '—'}`
          : `Expires in ${dfn}d · ${it.company?.name ?? '—'}`,
        href: `/orders/${it.id}`,
        tone: expired ? 'red' : 'amber',
      })
    }
  }

  out.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    return a.intraTierRank - b.intraTierRank
  })

  return out
}

const TONE_DOT: Record<TriageItem['tone'], string> = {
  red: 'bg-red-400',
  amber: 'bg-amber-400',
  zinc: 'bg-zinc-500',
}

const KIND_BADGE: Record<string, string> = {
  'Contract review': 'bg-zinc-800 text-zinc-300 border-zinc-700',
  COI: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  'Change decision': 'bg-zinc-800 text-zinc-300 border-zinc-700',
  'Annual agreement': 'bg-zinc-800 text-zinc-300 border-zinc-700',
  'Annual COI': 'bg-zinc-800 text-zinc-300 border-zinc-700',
  'Follow-up due': 'bg-amber-900/40 text-amber-200 border-amber-800',
  'Quote expiring': 'bg-amber-900/40 text-amber-200 border-amber-800',
}

export function TriageRollupCard({
  approvals,
  hygiene,
}: {
  approvals: ApprovalsData | null
  hygiene: SalesHygieneData | null
}) {
  if (!approvals && !hygiene) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-sm font-bold text-white">Needs a decision</h2>
        <p className="text-xs text-zinc-500 mt-2">Loading…</p>
      </section>
    )
  }

  const items = buildItems(approvals, hygiene)
  const total = items.length
  const visible = items.slice(0, ITEM_LIMIT)
  const overflow = total - visible.length

  if (total === 0) {
    return (
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-white">Needs a decision</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Nothing waiting on you right now.
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
    <section className="bg-zinc-900 border border-amber-900/60 rounded-xl p-6 ring-1 ring-amber-500/10">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-sm font-bold text-white">Needs a decision</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Approvals, overdue follow-ups, and expiring quotes — ranked by urgency.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-amber-200 bg-amber-900/40 border border-amber-800 px-2 py-0.5 rounded-full">
          {total} item{total === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="divide-y divide-zinc-800">
        {visible.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="block py-2.5 hover:bg-zinc-800/60 -mx-2 px-2 rounded transition"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      aria-hidden
                      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT[it.tone]}`}
                    />
                    <span className="text-sm font-semibold text-white truncate">{it.label}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${
                        KIND_BADGE[it.kind] ?? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {it.kind}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate mt-0.5">{it.sublabel}</div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <div className="mt-3 text-[11px] text-zinc-500">
          + {overflow} more in the cards below.
        </div>
      )}
    </section>
  )
}
