'use client'

/**
 * "Finish this reservation" — the completion panel for a call-in hold.
 *
 * Origin (Wes, 2026-08-24): a client phones in a reservation before the
 * production company or the job/show name exist. NewHoldModal lets the
 * hold be created anyway (the unit has to come off the board NOW), and
 * the gantt bar carries a ⚠ triangle until an agent fills the blanks in
 * — which happens here, in the reservation pop-up.
 *
 * Three to-dos, all defined by src/lib/scheduling/infoGaps.ts:
 *   Company   — CompanyPicker, or "+ New company" via /api/crm/companies
 *   Job name  — JobResolverModal (needs the company first; a Job carries
 *               its own, so resolving one also settles the company)
 *   Order     — "an order will be attached", the agent's own declaration;
 *               clears itself once an Order lands on the job
 *
 * Writes go to POST /api/scheduling/bookings/[id]/info, which enforces
 * the amend rules (fill blanks, don't re-point a live booking).
 *
 * The panel stays visible once everything is filled in — collapsed to a
 * single "Complete" line with the order toggle still reachable, so the
 * agent can flag a late-breaking order on any reservation.
 */

import { useEffect, useState } from 'react'
import { CompanyPicker } from '@/components/orders/CompanyPicker'
import { ClientDetailSuggestion, type ClientDetailReply } from '@/components/intake/ClientDetailSuggestion'
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal'
import { bookingInfoGaps, type BookingInfoGap } from '@/lib/scheduling/infoGaps'

export interface ReservationInfoState {
  companyId: string | null
  companyName: string | null
  jobId: string | null
  jobCode: string | null
  jobName: string
  expectsOrder: boolean
}

interface Props {
  bookingId: string
  /** Current values, as read off the selected gantt bar. */
  value: ReservationInfoState
  /** Non-cancelled Orders on this reservation's job — an attached order
   *  retires the "Order" to-do regardless of the expectsOrder flag. */
  orderCount: number
  /** Dates of the reservation — seeds the Job resolver's overlap ranking. */
  dates?: { start: string; end: string } | null
  /** Caller-side permission (canCreateBooking). Read-only when false. */
  canEdit: boolean
  /** Fired after a successful save with the server's fresh state, so the
   *  caller can patch the open pop-up and refresh the board. */
  onSaved: (next: ReservationInfoState, gaps: BookingInfoGap[]) => void
}

export function CompleteReservationPanel({
  bookingId,
  value,
  orderCount,
  dates,
  canEdit,
  onSaved,
}: Props) {
  const [resolverOpen, setResolverOpen] = useState(false)
  // The client's own answer, if they used the /details link in the Quick
  // Reply email. Shown verbatim above the fields — it is a suggestion the
  // agent accepts, never an applied value (see ClientDetailSuggestion).
  const [reply, setReply] = useState<ClientDetailReply | null>(null)
  // Seeds CompanyPicker's search box when the agent taps "Use these", so
  // the client's words go through the SAME near-match flow as anything an
  // agent types — no separate create path.
  const [companySeed, setCompanySeed] = useState('')
  // Same idea for the Job: the client's project name becomes the resolver's
  // search hint, so it ranks their wording against this client's open jobs
  // instead of creating a duplicate under a slightly different title.
  const [projectSeed, setProjectSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Inline "+ New company" mini-form — same near-match discipline as
  // NewHoldModal: the agent explicitly picks "use existing" or "create
  // anyway", never an auto-merge.
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [nearMatch, setNearMatch] = useState<{ id: string; name: string; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/client-details?bookingId=${encodeURIComponent(bookingId)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.ok) setReply(d.replies?.[0] ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [bookingId])

  const gaps = bookingInfoGaps({
    companyId: value.companyId,
    jobId: value.jobId,
    jobName: value.jobName,
    expectsOrder: value.expectsOrder,
    orderCount,
  })
  const complete = gaps.length === 0

  async function save(patch: { companyId?: string; jobId?: string; expectsOrder?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/scheduling/bookings/${bookingId}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Couldn't save — HTTP ${res.status}`)
        return false
      }
      onSaved(
        {
          companyId: json.booking.companyId,
          companyName: json.booking.companyName,
          jobId: json.booking.jobId,
          jobCode: json.booking.jobCode,
          jobName: json.booking.jobName,
          expectsOrder: json.booking.expectsOrder,
        },
        json.infoGaps ?? [],
      )
      return true
    } catch (e) {
      setError(`Couldn't save — ${e instanceof Error ? e.message : String(e)}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function createCompany(allowNearMatch: boolean) {
    const name = newCompanyName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    if (!allowNearMatch) setNearMatch(null)
    try {
      const res = await fetch('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, allowNearMatch }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json?.existing) {
        setNearMatch({
          id: json.existing.id,
          name: json.existing.name,
          message: json.message || 'A company with a similar name already exists.',
        })
        return
      }
      if (!res.ok || !json?.id) {
        setError(json?.error || 'Could not create the company.')
        return
      }
      setBusy(false)
      if (await save({ companyId: json.id })) {
        setCreatingCompany(false)
        setNewCompanyName('')
        setNearMatch(null)
      }
    } finally {
      setBusy(false)
    }
  }

  function onJobResolved(r: ResolvedJob) {
    setResolverOpen(false)
    void save({ jobId: r.id })
  }

  // ── Complete: one quiet line, order toggle still reachable. ──
  if (complete) {
    return (
      <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center justify-between gap-3">
        <span className="text-[11px] text-gray-500">
          <span className="text-green-600 font-bold">✓</span> Reservation details complete
        </span>
        {canEdit && (
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={value.expectsOrder}
              disabled={busy}
              onChange={(e) => void save({ expectsOrder: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            An order will be attached
          </label>
        )}
      </div>
    )
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden className="text-amber-600 text-base leading-none">⚠</span>
        <div className="text-[11px] font-bold text-amber-900 uppercase tracking-wide">
          Finish this reservation — {gaps.map((g) => g.label).join(', ')}
        </div>
      </div>

      {reply && canEdit && (
        <div className="mb-2.5">
          <ClientDetailSuggestion
            reply={reply}
            onUse={(v) => {
              // Seed, don't write — the agent still picks (or creates) the
              // real CRM rows through the pickers below.
              if (v.companyName) setCompanySeed(v.companyName)
              if (v.projectName) setProjectSeed(v.projectName)
            }}
            onResolved={() => setReply(null)}
            compact
          />
        </div>
      )}

      {!canEdit ? (
        <div className="text-[11px] text-amber-800">
          {gaps.map((g) => g.detail).join(' ')} A sales user can fill this in.
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* ── Company ── */}
          {!value.companyId && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-amber-800 font-semibold mb-1">Company</div>
              <CompanyPicker
                value={null}
                selectedName={null}
                initialQuery={companySeed || undefined}
                onChange={(id) => { if (id) void save({ companyId: id }) }}
              />
              {!creatingCompany ? (
                <button
                  type="button"
                  onClick={() => { setCreatingCompany(true); setError(null); setNearMatch(null) }}
                  className="text-[11px] font-medium text-amber-700 hover:text-amber-900 mt-1"
                >
                  + New company
                </button>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCompanyName}
                      onChange={(e) => { setNewCompanyName(e.target.value); setNearMatch(null); setError(null) }}
                      placeholder="New company name…"
                      autoFocus
                      className="flex-1 rounded border-zinc-300 text-sm px-2 py-1.5"
                    />
                    <button
                      type="button"
                      disabled={!newCompanyName.trim() || busy}
                      onClick={() => void createCompany(false)}
                      className="text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-white px-2.5 py-1.5 rounded disabled:opacity-50"
                    >
                      {busy ? '…' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingCompany(false); setNewCompanyName(''); setNearMatch(null) }}
                      className="text-[11px] text-zinc-500 hover:text-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                  {nearMatch && (
                    <div className="text-[11px] text-amber-900 space-y-1">
                      <div>{nearMatch.message}</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void save({ companyId: nearMatch.id }).then((ok) => {
                            if (ok) { setCreatingCompany(false); setNewCompanyName(''); setNearMatch(null) }
                          })}
                          className="font-semibold underline underline-offset-2 disabled:opacity-50"
                        >
                          Use “{nearMatch.name}”
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void createCompany(true)}
                          className="font-semibold underline underline-offset-2 disabled:opacity-50"
                        >
                          Create anyway
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Job ── */}
          {!value.jobId && !value.jobName.trim() && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-amber-800 font-semibold mb-1">Job / show name</div>
              <button
                type="button"
                onClick={() => setResolverOpen(true)}
                disabled={!value.companyId || busy}
                className="w-full text-left rounded border border-dashed border-amber-400 bg-white px-3 py-2 text-sm text-zinc-700 hover:border-amber-600 hover:text-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Find or create Job…
              </button>
              {!value.companyId && (
                <p className="text-[11px] text-amber-700 mt-1">Set the company first — jobs are matched per client.</p>
              )}
            </div>
          )}

          {/* ── Order expectation ── */}
          <label className="flex items-start gap-2 cursor-pointer border-t border-amber-200 pt-2">
            <input
              type="checkbox"
              checked={value.expectsOrder}
              disabled={busy}
              onChange={(e) => void save({ expectsOrder: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-sm text-amber-900">
              An order will be attached
              <span className="block text-[11px] text-amber-700 font-normal">
                {orderCount > 0
                  ? 'An order is already on this job — this reservation is covered.'
                  : 'Keeps this reservation flagged until an order lands on the job.'}
              </span>
            </span>
          </label>

          {error && <div className="text-[11px] text-rose-700 font-medium">{error}</div>}
        </div>
      )}

      {resolverOpen && (
        <JobResolverModal
          context={{
            companyId: value.companyId,
            companyName: value.companyName,
            contactEmail: null,
            contactName: null,
            contactPhone: null,
            jobNameHint: value.jobName || projectSeed || null,
            dates: dates ?? null,
            sourceRef: 'gantt:finish-reservation',
          }}
          onResolved={onJobResolved}
          onClose={() => setResolverOpen(false)}
        />
      )}
    </div>
  )
}
