'use client'

/**
 * MergeCompanyModal — fold a duplicate client record into this one.
 *
 * Written after the 2026-09-18 High Horse / High Horses pair, which had
 * to be merged from a laptop with a tsx script because HQ had no way to
 * do it. The system makes these itself: changing the production company
 * on a job moves the job, orders, bookings and COIs to another Company
 * row and leaves the cards and contacts behind, so a client ends up half
 * on each record with nobody able to see why.
 *
 * Three steps, deliberately:
 *   1. WHICH record — suggestions first (plural-tolerant name match, so
 *      "High Horses" offers "High Horse"), then free search.
 *   2. WHICH SURVIVES — the surviving record keeps its own NAME, so this
 *      is the decision that matters and it is never made by default.
 *      Picking the other record posts to the other record's route.
 *   3. WHAT MOVES — a server-computed dry run, shown before anything is
 *      written. The same plan the CLI prints.
 *
 * Nothing here decides anything: the preview is re-planned server-side
 * at apply time, and the button is only rendered for the dedup
 * allowlist (enforced again in the route).
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Loader2, Search, X } from 'lucide-react'

interface CompanyHit {
  id: string
  name: string
  tier: string
  billingEmail: string | null
  createdAt: string
  rentalworksCustomerId: string | null
}

interface MergePreview {
  keeper: { id: string; name: string }
  duplicates: { id: string; name: string }[]
  counts: { model: string; rows: number }[]
  totalRows: number
  affiliationsDeleted: number
  backfillFields: string[]
}

/** Prisma model names → what a person calls them. */
const MODEL_LABEL: Record<string, string> = {
  Affiliation: 'contact links',
  Activity: 'activity notes',
  Booking: 'bookings',
  CoiCheck: 'insurance certificates',
  CompanyCard: 'cards on file',
  CompanyDiscount: 'standing discounts',
  CompanyRate: 'negotiated rates',
  ContractReview: 'contract reviews',
  Inquiry: 'inquiries',
  Invoice: 'invoices',
  Job: 'jobs',
  JobMessage: 'job messages',
  Order: 'orders',
  PaperworkRequest: 'paperwork requests',
  PortalAccess: 'portal logins',
  SignedAgreement: 'signed agreements',
}

const label = (model: string, rows: number) => {
  const l = MODEL_LABEL[model]
  if (l) return rows === 1 ? l.replace(/s$/, '') : l
  // Unknown model — spell the Prisma name out rather than hide the row.
  return model
}

export function MergeCompanyModal({
  companyId,
  companyName,
  onClose,
  onMerged,
}: {
  companyId: string
  companyName: string
  onClose: () => void
  /** Called with the surviving company's id once the merge is committed. */
  onMerged: (survivingId: string) => void
}) {
  const [q, setQ] = useState('')
  const [suggested, setSuggested] = useState<CompanyHit[]>([])
  const [matches, setMatches] = useState<CompanyHit[]>([])
  const [loadingList, setLoadingList] = useState(true)

  const [other, setOther] = useState<CompanyHit | null>(null)
  /** Which record survives. 'this' = the page we're on. */
  const [survivor, setSurvivor] = useState<'this' | 'other' | null>(null)

  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadList = useCallback(async (needle: string) => {
    setLoadingList(true)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/merge?q=${encodeURIComponent(needle)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load companies')
      setSuggested(data.suggested || [])
      setMatches(data.matches || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load companies')
    } finally {
      setLoadingList(false)
    }
  }, [companyId])

  useEffect(() => { loadList('') }, [loadList])

  // Debounced search.
  useEffect(() => {
    if (!q.trim()) return
    const t = setTimeout(() => { loadList(q.trim()) }, 250)
    return () => clearTimeout(t)
  }, [q, loadList])

  const keeperId = survivor === 'other' && other ? other.id : companyId
  const loserId = survivor === 'other' ? companyId : other?.id
  const keeperName = survivor === 'other' && other ? other.name : companyName
  const loserName = survivor === 'other' ? companyName : other?.name

  // Dry run whenever the pair or the direction changes.
  useEffect(() => {
    if (!other || !survivor || !loserId) { setPreview(null); return }
    let cancelled = false
    setPreviewing(true)
    setError(null)
    fetch(`/api/crm/companies/${keeperId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicateId: loserId }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not build the preview')
        if (!cancelled) setPreview(data)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed') })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [keeperId, loserId, other, survivor])

  const apply = async () => {
    if (!loserId || !survivor) return
    setApplying(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${keeperId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateId: loserId, apply: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      onMerged(keeperId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
      setApplying(false)
    }
  }

  const row = (c: CompanyHit, isSuggested: boolean) => (
    <button
      key={c.id}
      type="button"
      onClick={() => { setOther(c); setSurvivor(null); setPreview(null); setError(null) }}
      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
        other?.id === c.id
          ? 'border-amber-600 bg-lt-inner'
          : 'border-lt-hairline hover:bg-lt-inner'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-lt-fg font-medium">{c.name}</span>
        {isSuggested && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg font-semibold">
            Near match
          </span>
        )}
        <span className="text-[11px] text-lt-fg3">{c.tier}</span>
        {c.rentalworksCustomerId && <span className="text-[11px] text-lt-fg3">· in RentalWorks</span>}
      </div>
      <div className="text-[11px] text-lt-fg3 mt-0.5">
        {c.billingEmail || 'no billing email'} · added{' '}
        {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4" role="dialog" aria-modal="true">
      <div className="bg-lt-card md:rounded-2xl border border-lt-hairline w-full max-w-2xl max-h-[100vh] md:max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-lt-hairline flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold">Merge duplicate client</div>
            <div className="text-sm font-semibold text-lt-fg mt-0.5 truncate">{companyName}</div>
          </div>
          <button type="button" onClick={onClose} className="text-lt-fg3 hover:text-lt-fg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {/* ── 1. Which record ─────────────────────────────────── */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold mb-2">
              1 · Which record is the same client?
            </div>
            <div className="relative mb-2">
              <Search className="w-4 h-4 text-lt-fg3 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search clients by name or billing email…"
                className="w-full pl-9 pr-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
              />
            </div>
            {loadingList ? (
              <p className="text-sm text-lt-fg3 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Looking…
              </p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {suggested.map((c) => row(c, true))}
                {matches.map((c) => row(c, false))}
                {!suggested.length && !matches.length && (
                  <p className="text-sm text-lt-fg3 py-3">
                    {q.trim() ? 'No client matches that.' : 'No near-matching names. Search to pick one.'}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── 2. Which survives ───────────────────────────────── */}
          {other && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold mb-1">
                2 · Which record survives?
              </div>
              <p className="text-xs text-lt-fg2 mb-2">
                The surviving record keeps its own <strong className="font-semibold">name</strong> — everything else
                moves onto it. Certificates of insurance are checked against this name, so pick the one the client
                actually papers under.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  { key: 'this' as const, name: companyName, note: 'the record you are on' },
                  { key: 'other' as const, name: other.name, note: 'the one you just picked' },
                ]).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSurvivor(opt.key)}
                    className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${
                      survivor === opt.key
                        ? 'border-amber-600 bg-lt-inner'
                        : 'border-lt-hairline hover:bg-lt-inner'
                    }`}
                  >
                    <div className="text-sm text-lt-fg font-medium truncate">Keep “{opt.name}”</div>
                    <div className="text-[11px] text-lt-fg3 mt-0.5">{opt.note}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 3. What moves ───────────────────────────────────── */}
          {other && survivor && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold mb-2">
                3 · What this will do
              </div>
              {previewing ? (
                <p className="text-sm text-lt-fg3 py-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Working out what moves…
                </p>
              ) : preview ? (
                <div className="bg-lt-inner border border-lt-hairline rounded-lg p-4">
                  <div className="flex items-center gap-2 text-sm text-lt-fg flex-wrap mb-3">
                    <span className="line-through text-lt-fg3 truncate">{loserName}</span>
                    <ArrowRight className="w-4 h-4 text-lt-fg3 shrink-0" aria-hidden />
                    <span className="font-semibold truncate">{keeperName}</span>
                  </div>
                  {preview.counts.length ? (
                    <ul className="text-sm text-lt-fg2 space-y-1">
                      {preview.counts.map((c) => (
                        <li key={c.model}>
                          <span className="font-mono text-lt-fg">{c.rows}</span> {label(c.model, c.rows)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-lt-fg2">
                      Nothing is attached to “{loserName}” — it is an empty duplicate.
                    </p>
                  )}
                  {preview.affiliationsDeleted > 0 && (
                    <p className="text-xs text-chip-warn-fg bg-chip-warn-bg rounded px-2 py-1.5 mt-3">
                      {preview.affiliationsDeleted} duplicate contact link
                      {preview.affiliationsDeleted === 1 ? '' : 's'} will collapse — the same person is linked to
                      both records, so the richer link is kept and the other removed.
                    </p>
                  )}
                  {preview.backfillFields.length > 0 && (
                    <p className="text-xs text-lt-fg3 mt-2">
                      Blank fields filled in from the duplicate: {preview.backfillFields.join(', ')}.
                    </p>
                  )}
                  <p className="text-xs text-lt-fg3 mt-2">
                    “{loserName}” is then deleted. The merge is written to the audit log with every row it moved,
                    so it can be reversed.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {error && (
            <p className="text-sm text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-lt-hairline flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!preview || previewing || applying}
            className="px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {applying
              ? 'Merging…'
              : preview
                ? `Merge into “${keeperName}”`
                : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}
