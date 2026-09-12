'use client'

/**
 * Recent paperwork submissions — the cross-job index.
 *
 * Every submission already lives on its job's detail page. This list
 * exists for the other direction: a COI/WC/contract landed and nobody
 * remembers which job it was for. Rows link straight to the right
 * section of the job page, where the document can actually be opened.
 *
 * A credit-card authorization row names the document and the signer and
 * stops there — no card type, no last4. Charging a card on file is
 * collections' surface, not this one.
 *
 * COI rows carry a Review button. A certificate could previously only be
 * signed off in the moment an agent uploaded it, so anything that arrived
 * through the client drop link sat PENDING with nowhere to judge it — and
 * this list, which is where the team already looks, was the natural place
 * to put the verdict. Rows also carry their own finding (a named insured
 * that doesn't match the production company), so the feed reads as a
 * triage queue rather than a log.
 *
 * Rows that still want a human carry a Skip. Wes, 2026-09-11: a good part
 * of the queue is resubmitted certificates and documents already handled
 * on the phone, and the only way to clear one used to be APPROVING it —
 * a statement about the insurance made to silence a badge. Skip writes a
 * dismissal beside the document (src/lib/paperwork/reviewQueue.ts): the
 * alert stops counting it, the document's own state is untouched, and
 * Undo puts it back.
 *
 * Agreement rows open the executed PDF. They used to send you to the job
 * page's #agreement section, which lists company-level standing agreements
 * and says nothing about an order-signed contract — so a rental agreement
 * you clicked in this feed simply could not be read from here. View opens
 * it, Download saves it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Undo2 } from 'lucide-react'
import { CoiReviewModal } from '@/components/coi/CoiReviewModal'
import { DISMISS_REASONS, PAPERWORK_QUEUE_EVENT } from '@/lib/paperwork/reviewQueueClient'

type SubmissionKind = 'COI' | 'WC' | 'CC_AUTH' | 'AGREEMENT' | 'CONTRACT_REVIEW' | 'REDLINE'

/** Kinds a human can rule on — the only ones that carry a Skip. */
const SKIPPABLE: SubmissionKind[] = ['COI', 'CONTRACT_REVIEW', 'REDLINE']

interface Submission {
  key: string
  sourceId: string
  kind: SubmissionKind
  label: string
  detail: string | null
  submittedAt: string
  submittedBy: string | null
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  companyName: string | null
  href: string | null
  documentHref: string | null
  downloadHref: string | null
  reviewState: 'PENDING' | 'APPROVED' | 'COUNTERED' | 'REJECTED' | null
  flag: { label: string; detail: string } | null
  needsReview: boolean
  dismissal: { at: string; by: string | null; reason: string | null; note: string | null } | null
}

const KIND_BADGE: Record<SubmissionKind, string> = {
  COI: 'bg-sky-100 text-sky-700',
  WC: 'bg-violet-100 text-violet-700',
  CC_AUTH: 'bg-emerald-100 text-emerald-700',
  AGREEMENT: 'bg-amber-100 text-amber-700',
  CONTRACT_REVIEW: 'bg-rose-100 text-rose-700',
  REDLINE: 'bg-red-100 text-red-700',
}

const KIND_SHORT: Record<SubmissionKind, string> = {
  COI: 'COI',
  WC: 'WC',
  CC_AUTH: 'Card auth',
  AGREEMENT: 'Agreement',
  CONTRACT_REVIEW: 'Redline',
  REDLINE: 'Redline',
}

/**
 * One collapsible group per type, in this order. The feed used to be a
 * flat 50-row list with filter pills on top; 39 COIs drowned the 7
 * agreements and 4 card auths, and the pills only ever showed one type
 * at a time. Grouping keeps every type one click away and the header
 * carries what you'd have scrolled for: how many, how many still need a
 * verdict, and when the latest one landed.
 */
const GROUPS: Array<{ kind: SubmissionKind; label: string }> = [
  { kind: 'COI', label: 'Certificates of Insurance' },
  { kind: 'CONTRACT_REVIEW', label: 'Client redlines' },
  { kind: 'WC', label: 'Workers\u2019 comp' },
  { kind: 'AGREEMENT', label: 'Rental agreements' },
  { kind: 'CC_AUTH', label: 'Card authorizations' },
  { kind: 'REDLINE', label: 'Portal redlines' },
]

const REASON_LABEL = new Map(DISMISS_REASONS.map((r) => [r.value as string, r.label]))

function fmtWhen(iso: string) {
  const d = new Date(iso)
  if (!d.getTime()) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (!d.getTime()) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function RecentSubmissions() {
  const [rows, setRows] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<SubmissionKind>>(() => new Set())
  const [q, setQ] = useState('')
  const [reviewingCoiId, setReviewingCoiId] = useState<string | null>(null)

  const [busyKey, setBusyKey] = useState<string | null>(null)

  // The nav badge counts the same thing this list does, so every load
  // hands the shell the number it just computed.
  const broadcast = useCallback((count: number) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(PAPERWORK_QUEUE_EVENT, { detail: count }))
  }, [])

  const load = useCallback(() => {
    return fetch('/api/paperwork/submissions?limit=50')
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setRows(d.submissions || [])
          if (typeof d.reviewCount === 'number') broadcast(d.reviewCount)
        } else setError(d?.error || 'Could not load submissions')
      })
      .catch(() => setError('Could not load submissions'))
  }, [broadcast])

  /**
   * Skip / un-skip. The row is updated in place from the response rather
   * than re-fetching the whole feed — a 50-row reload to grey out one line
   * loses the reader's scroll position mid-triage.
   */
  const setSkip = useCallback(
    async (r: Submission, reason: string | null) => {
      setBusyKey(r.key)
      try {
        const res = await fetch('/api/paperwork/dismiss', {
          method: reason ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: r.kind, sourceId: r.sourceId, reason }),
        })
        const d = await res.json()
        if (!d?.ok) {
          setError(d?.error || 'Could not update that row')
          return
        }
        setRows((prev) =>
          prev.map((row) =>
            row.key === r.key
              ? {
                  ...row,
                  dismissal: reason ? d.dismissal : null,
                  // Un-skipping restores whatever the row was asking for:
                  // a PENDING verdict or a stated finding.
                  needsReview: reason
                    ? false
                    : row.reviewState === 'PENDING' || !!row.flag,
                }
              : row,
          ),
        )
        if (typeof d.count === 'number') broadcast(d.count)
      } catch {
        setError('Could not update that row')
      } finally {
        setBusyKey(null)
      }
    },
    [broadcast],
  )

  useEffect(() => {
    let cancelled = false
    load().finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const needle = q.trim().toLowerCase()
  const searching = needle.length > 0

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (!needle) return true
      return [r.jobName, r.jobCode, r.companyName, r.submittedBy, r.label, r.detail, r.flag?.label]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle))
    })
  }, [rows, needle])

  const groups = useMemo(() => {
    return GROUPS.map((g) => {
      const items = filtered.filter((r) => r.kind === g.kind)
      return {
        ...g,
        items,
        pending: items.filter((r) => r.needsReview).length,
        latest: items[0]?.submittedAt ?? null,
      }
    }).filter((g) => g.items.length > 0)
  }, [filtered])

  // Across every group, unfiltered by the search box — this is the same
  // number the nav badge carries.
  const toReview = useMemo(() => rows.filter((r) => r.needsReview).length, [rows])

  const toggle = (k: SubmissionKind) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Recent submissions</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            The last 50 pieces of client paperwork to land — plus everything still waiting on a
            verdict, however old — across every job, grouped by type. Open a group, then click a row
            to open it on its job.
          </p>
        </div>
        {toReview > 0 && (
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-chip-warn-bg text-chip-warn-fg">
            {toReview} to review
          </span>
        )}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search job, client, signer…"
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-56 focus:outline-none focus:border-gray-400"
        />
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">Loading…</div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-xs text-red-600">{error}</div>
      ) : groups.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {rows.length === 0
            ? 'No paperwork has been submitted yet.'
            : 'No submissions match that search.'}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {groups.map((g) => {
            // A search opens every group that has a hit — a collapsed
            // match is the same as no match.
            const expanded = searching || open.has(g.kind)
            return (
              <section key={g.kind}>
                <button
                  type="button"
                  onClick={() => toggle(g.kind)}
                  aria-expanded={expanded}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <ChevronRight
                    size={14}
                    className={`shrink-0 text-gray-400 transition-transform ${
                      expanded ? 'rotate-90' : ''
                    }`}
                  />
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${KIND_BADGE[g.kind]}`}
                  >
                    {KIND_SHORT[g.kind]}
                  </span>
                  <span className="text-[13px] font-medium text-gray-900">{g.label}</span>
                  <span className="text-[11px] text-gray-400">{g.items.length}</span>
                  {g.pending > 0 && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-chip-warn-bg text-chip-warn-fg">
                      {g.pending} to review
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-gray-500">
                    {g.latest && (
                      <>
                        Latest {fmtWhen(g.latest)}
                        <span className="text-gray-400"> · {fmtTime(g.latest)}</span>
                      </>
                    )}
                  </span>
                </button>
                {expanded && (
                  <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-lt-inner/40">
                    {g.items.map((r) => (
                      <SubmissionRow
                        key={r.key}
                        r={r}
                        onReviewCoi={setReviewingCoiId}
                        onSkip={setSkip}
                        busy={busyKey === r.key}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {reviewingCoiId && (
        <CoiReviewModal
          coiId={reviewingCoiId}
          onClose={() => setReviewingCoiId(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

function SubmissionRow({
  r,
  onReviewCoi,
  onSkip,
  busy,
}: {
  r: Submission
  onReviewCoi: (coiId: string) => void
  onSkip: (r: Submission, reason: string | null) => void
  busy: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const body = (
    <div className="flex items-start gap-3 pl-10 pr-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-gray-900 truncate">
          {r.label}
          {r.detail && <span className="ml-2 font-normal text-gray-500">{r.detail}</span>}
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5 truncate">
          {r.jobId ? (
            <>
              <span className="font-semibold text-gray-700">{r.jobName}</span>
              {r.jobCode && <span className="text-gray-400"> · {r.jobCode}</span>}
            </>
          ) : (
            <span className="text-amber-700">
              Not attached to a job
              {r.companyName ? ` · ${r.companyName}` : ''}
            </span>
          )}
          {r.submittedBy && <span className="text-gray-400"> · {r.submittedBy}</span>}
        </div>
        {/* The finding, stated in the row. A mismatch nobody opens
            is a mismatch nobody fixes. */}
        {r.flag && (
          <div className="mt-1 text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2 py-1">
            <span className="font-semibold">{r.flag.label}</span>
            <span className="text-rose-600"> — {r.flag.detail}</span>
          </div>
        )}
        {/* A skipped row stays in the list, greyed and labelled: the
            document did not go anywhere, it just stopped asking. */}
        {r.dismissal && (
          <div className="mt-1 text-[11px] text-lt-fg3">
            Skipped
            {r.dismissal.reason && ` — ${REASON_LABEL.get(r.dismissal.reason) || r.dismissal.reason}`}
            {r.dismissal.by && ` · ${r.dismissal.by}`}
            <span className="text-lt-fg3"> · {fmtWhen(r.dismissal.at)}</span>
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] text-gray-600">{fmtWhen(r.submittedAt)}</div>
        <div className="text-[10px] text-gray-400">{fmtTime(r.submittedAt)}</div>
      </div>
    </div>
  )
  const skippable = SKIPPABLE.includes(r.kind)

  return (
    <li
      className={`flex items-stretch hover:bg-gray-50 transition-colors ${
        r.dismissal ? 'opacity-60' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        {r.href ? (
          <Link href={r.href} className="block">
            {body}
          </Link>
        ) : (
          <div className="opacity-80">{body}</div>
        )}
      </div>
      {/* Review lives OUTSIDE the link: the row still navigates to
          the job, but a COI can be judged without leaving here. */}
      <div className="shrink-0 flex items-center gap-2 pr-4 pl-1">
        {/* Skip — for the resubmits and the ones handled elsewhere. It
            writes a dismissal, never a verdict: the certificate stays
            PENDING everywhere else in HQ. */}
        {skippable &&
          (r.dismissal ? (
            <button
              onClick={() => onSkip(r, null)}
              disabled={busy}
              title="Put this back on the review queue"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <Undo2 size={12} />
              Undo
            </button>
          ) : r.needsReview ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                disabled={busy}
                aria-expanded={menuOpen}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Skip
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl border border-lt-hairline bg-white shadow-lg py-1">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-lt-fg3">
                    Needs nothing because…
                  </div>
                  {DISMISS_REASONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setMenuOpen(false)
                        onSkip(r, opt.value)
                      }}
                      className="block w-full text-left px-3 py-2 text-[12px] text-lt-fg hover:bg-lt-inner"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null)}
        {r.reviewState && r.reviewState !== 'PENDING' && (
          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
              r.reviewState === 'APPROVED'
                ? 'bg-emerald-100 text-emerald-700'
                : r.reviewState === 'COUNTERED'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-rose-100 text-rose-700'
            }`}
          >
            {r.reviewState === 'APPROVED'
              ? 'Approved'
              : r.reviewState === 'COUNTERED'
                ? 'Fix requested'
                : 'Rejected'}
          </span>
        )}
        {r.kind === 'COI' ? (
          <button
            onClick={() => onReviewCoi(r.sourceId)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              r.flag || r.reviewState === 'PENDING'
                ? 'bg-gray-900 text-white hover:bg-gray-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Review
          </button>
        ) : r.documentHref ? (
          // The document itself, not a page that mentions it.
          // `download` on the second link is belt-and-braces —
          // the API sets attachment disposition either way, but
          // a same-origin hint keeps the filename honest.
          <>
            <a
              href={r.documentHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              View
            </a>
            {r.downloadHref && (
              <a
                href={r.downloadHref}
                download
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Download
              </a>
            )}
          </>
        ) : r.href ? (
          <Link
            href={r.href}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Review
          </Link>
        ) : null}
      </div>
    </li>
  )
}
