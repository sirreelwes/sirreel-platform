'use client'

/**
 * +Hold modal — Chunk 4 of native-scheduling-v1-brief.md.
 *
 * Submits to POST /api/scheduling/holds with the same category /
 * dates / bufferDays already chosen on the parent page. Three server
 * outcomes the modal handles:
 *
 *   201 ok                              → success, close + notify
 *   409 { error: 'over-capacity' }     → red banner, no override
 *   409 { error: 'buffer-encroachment',
 *         needsOverride: true }        → yellow banner with "Force" button
 *
 * V1 scope: requires an existing Company + Person in CRM. Inline
 * create comes later. Agent defaults from session on the server side.
 */

import { useState } from 'react'
import { CompanyPicker } from '@/components/orders/CompanyPicker'
import { ContactPicker, type ContactPickerValue } from '@/components/shared/ContactPicker'
import { JobPicker, EMPTY_JOB_PICKER_VALUE, type JobPickerValue } from '@/components/shared/JobPicker'

interface AvailabilitySummary {
  serviceableCount: number
  freeCount: number
  bufferCount: number
  bookedCount: number
  availableToHold: number
}

interface CreatedHold {
  booking: { id: string; bookingNumber: string; jobName: string; startDate: string; endDate: string }
  bookingItem: { id: string; quantity: number; status: string; holdRank?: number }
  bufferOverrideUsed: boolean
  isBackup?: boolean
  holdRank?: number
  /** Set iff the modal was opened with an `asset` prop AND the
   *  follow-on assign call succeeded. NULL on category-only holds
   *  or when the hold was created but the assign step failed
   *  (BookingItem is left as REQUESTED for manual assignment). */
  assignedAsset?: { id: string; unitName: string } | null
}

interface NewHoldModalProps {
  categoryId: string
  categoryName: string
  startDate: string // YYYY-MM-DD
  endDate: string   // YYYY-MM-DD
  bufferDays: number
  /** When true, the modal posts isBackup=true and skips the
   *  capacity/buffer warning path — backup holds are explicitly
   *  allowed to overlap an at-capacity category. */
  asBackup?: boolean
  /** Optional asset binding. When provided, the modal chains a
   *  POST /api/scheduling/booking-items/[id]/assign call after a
   *  successful /holds POST so the new BookingItem lands bound to
   *  this specific unit (the gantt "click a free Cube row" gesture).
   *  Omit for category-only holds ("+ New Hold" top-bar button —
   *  agent assigns the unit later). */
  asset?: { id: string; unitName: string }
  /** Optional pre-seed company. Lets a parent that already knows the
   *  client (saved Order/Job context) avoid forcing the agent to
   *  re-pick. Existing internal state behavior preserved when unset. */
  defaultCompany?: { id: string; name: string }
  /** Optional pre-seed Job (existing). When set, the modal opens
   *  with the JobPicker already in selected_existing mode bound to
   *  this Job. Used by the top-bar QuickCreate flow when the agent
   *  invokes "+ New Hold" from a saved Order/Job page. */
  defaultJob?: { id: string; jobCode: string; name: string; companyId: string; companyName: string }
  /** Optional pre-seed quantity. Used by the QuickCreate flow when
   *  the source order line item already specifies qty (e.g. an
   *  order with `Cube Truck × 2` → modal opens with quantity=2).
   *  Falls back to the existing default of 1 when unset. */
  defaultQuantity?: number
  onClose: () => void
  onCreated: (hold: CreatedHold) => void
}

const EMPTY_CONTACT: ContactPickerValue = {
  personId: null,
  name: '',
  phone: '',
  email: '',
  mode: 'searching',
  company: null,
  originalPhone: '',
}

export function NewHoldModal({
  categoryId,
  categoryName,
  startDate,
  endDate,
  bufferDays,
  asBackup = false,
  asset,
  defaultCompany,
  defaultJob,
  defaultQuantity,
  onClose,
  onCreated,
}: NewHoldModalProps) {
  const [quantity, setQuantity] = useState(
    defaultQuantity != null && Number.isFinite(defaultQuantity) && defaultQuantity >= 1
      ? Math.floor(defaultQuantity)
      : 1,
  )
  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    defaultCompany ?? (defaultJob ? { id: defaultJob.companyId, name: defaultJob.companyName } : null),
  )
  const [contact, setContact] = useState<ContactPickerValue>(EMPTY_CONTACT)
  const [job, setJob] = useState<JobPickerValue>(
    defaultJob
      ? {
          jobId: defaultJob.id,
          jobCode: defaultJob.jobCode,
          name: defaultJob.name,
          mode: 'selected_existing',
          company: { id: defaultJob.companyId, name: defaultJob.companyName },
        }
      : EMPTY_JOB_PICKER_VALUE,
  )
  const [notes, setNotes] = useState('')
  // Dates start at the parent's pre-fill; the agent can extend / adjust
  // inside the modal (per the brief: "agent sets end + client/job in the modal").
  const [startDateInput, setStartDateInput] = useState(startDate)
  const [endDateInput, setEndDateInput] = useState(endDate)
  const [submitting, setSubmitting] = useState(false)
  const [hardError, setHardError] = useState<string | null>(null)
  const [bufferWarning, setBufferWarning] = useState<{ reason: string; availability: AvailabilitySummary } | null>(null)

  const datesValid =
    /^\d{4}-\d{2}-\d{2}$/.test(startDateInput) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDateInput) &&
    endDateInput >= startDateInput

  const jobReady =
    (job.mode === 'selected_existing' && !!job.jobId) ||
    (job.mode === 'creating_new' && job.name.trim().length > 0)

  const canSubmit =
    !!company &&
    contact.mode === 'selected_existing' &&
    contact.personId &&
    jobReady &&
    quantity > 0 &&
    datesValid &&
    !submitting

  async function submit(bufferOverride: boolean) {
    if (!company || contact.mode !== 'selected_existing' || !contact.personId) return
    if (!jobReady) return
    setSubmitting(true)
    setHardError(null)
    if (!bufferOverride) setBufferWarning(null)
    try {
      // Server side picks ONE of these two paths:
      //   jobId → attach Booking to existing Job (Booking.jobId = id)
      //   newJobName → create Job in same tx, stamp Booking.jobId
      // productionName intentionally omitted from new holds — it was
      // redundant with jobName; the column stays for legacy rows.
      const jobPayload =
        job.mode === 'selected_existing' && job.jobId
          ? { jobId: job.jobId, jobName: job.name }
          : { newJobName: job.name.trim(), jobName: job.name.trim() }

      const res = await fetch('/api/scheduling/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          startDate: startDateInput,
          endDate: endDateInput,
          quantity,
          companyId: company.id,
          personId: contact.personId,
          ...jobPayload,
          notes: notes.trim() || null,
          bufferDays,
          bufferOverride,
          isBackup: asBackup,
        }),
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        // Hold created. If we were opened with a specific asset
        // binding (gantt row-click), chain a /assign call so the
        // BookingItem lands bound to that unit in one user action.
        // Backups carry bufferOverride=true on assign — backups
        // are explicitly allowed to overlap the buffer state too.
        let assignedAsset: { id: string; unitName: string } | null = null
        if (asset) {
          try {
            const bookingItemId = (json.bookingItem as { id: string }).id
            const assignRes = await fetch(`/api/scheduling/booking-items/${bookingItemId}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assetId: asset.id, bufferDays, bufferOverride: asBackup }),
            })
            const assignJson = await assignRes.json()
            if (assignRes.ok && assignJson.ok) {
              assignedAsset = { id: asset.id, unitName: asset.unitName }
            } else {
              // BookingItem exists (REQUESTED) but the unit binding
              // failed. Don't undo the hold — surface the assign
              // error so the operator can pick a different unit
              // via the AssignUnitsModal flow.
              setHardError(
                `Hold created (${(json.bookingItem as { id: string }).id.slice(0, 8)}…) but binding to ${asset.unitName} failed: ${assignJson.reason || assignJson.error || `HTTP ${assignRes.status}`}`,
              )
              return
            }
          } catch (e) {
            setHardError(
              `Hold created but binding to ${asset.unitName} failed: ${e instanceof Error ? e.message : String(e)}`,
            )
            return
          }
        }
        onCreated({ ...(json as CreatedHold), assignedAsset })
        return
      }
      if (res.status === 409 && json.error === 'buffer-encroachment' && json.needsOverride) {
        setBufferWarning({ reason: json.reason, availability: json.availability })
        return
      }
      // Surface the server's real reason (the holds route puts the
      // underlying message in `detail`); never collapse to a generic
      // "create failed". Modal stays open + button re-enables (finally).
      setHardError(
        `Couldn't create hold — ${json.detail || json.reason || json.error || `HTTP ${res.status}`}`,
      )
    } catch (e) {
      setHardError(`Couldn't create hold — ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-start justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              {asBackup ? 'New backup hold' : 'New hold'}
              {asset ? ` on ${asset.unitName}` : ''}
            </h2>
            <p className="text-sm text-zinc-600 mt-0.5">
              {categoryName} · bufferDays={bufferDays}
              {asBackup ? ' · queues behind existing holds (rank assigned by server)' : ''}
              {asset ? ' · will bind to this specific unit on create' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none">×</button>
        </header>

        <div className="px-6 py-4 space-y-4">
          {/* Date range — editable per the brief. Pre-filled by the
              caller (gantt row click pre-fills the clicked date). */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-600">Start</span>
              <input
                type="date"
                value={startDateInput}
                onChange={(e) => {
                  const next = e.target.value
                  setStartDateInput(next)
                  // Keep end ≥ start: if the new start is past the
                  // current end, drag end with it.
                  if (next && endDateInput && endDateInput < next) setEndDateInput(next)
                }}
                className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-600">End</span>
              <input
                type="date"
                value={endDateInput}
                min={startDateInput}
                onChange={(e) => setEndDateInput(e.target.value)}
                className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5"
              />
            </label>
          </div>
          {!datesValid && (
            <div className="text-xs text-rose-700">End date must be on or after start date.</div>
          )}

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-600">
              Quantity{asset ? ' (locked to 1 — binding a specific unit)' : ''}
            </span>
            <input
              type="number"
              min={1}
              max={asset ? 1 : 50}
              value={asset ? 1 : quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
              disabled={!!asset}
              className="mt-1 block w-32 rounded border-zinc-300 text-sm px-2 py-1.5 disabled:bg-zinc-100 disabled:text-zinc-500"
            />
          </label>

          <div>
            <span className="text-xs uppercase tracking-wide text-zinc-600 block mb-1">Company</span>
            <CompanyPicker
              value={company?.id ?? null}
              selectedName={company?.name ?? null}
              onChange={(id, name) => setCompany(id ? { id, name } : null)}
            />
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-zinc-600 block mb-1">Contact (person)</span>
            <ContactPicker value={contact} onChange={setContact} />
            {contact.mode === 'creating_new' && (
              <p className="text-xs text-amber-700 mt-1">
                Inline-create of new contacts is not supported in the +Hold flow yet — pick an existing contact, or
                create the contact in CRM first.
              </p>
            )}
          </div>

          <div>
            <span className="text-xs uppercase tracking-wide text-zinc-600 block mb-1">Job</span>
            <JobPicker
              value={job}
              onChange={setJob}
              companyId={company?.id ?? null}
              placeholder="Search jobs by name or code, or type a new name…"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Pick an existing job for this client, or type a new name and choose
              &ldquo;Create new job&rdquo; to start fresh.
            </p>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-600">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5"
            />
          </label>

          {bufferWarning && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <div className="font-medium text-amber-900">Buffer encroachment</div>
              <div className="text-amber-800 mt-0.5">{bufferWarning.reason}</div>
              <div className="text-xs text-amber-700 mt-1">
                free {bufferWarning.availability.freeCount} · buffer {bufferWarning.availability.bufferCount} · booked{' '}
                {bufferWarning.availability.bookedCount} · capacity {bufferWarning.availability.availableToHold}
              </div>
            </div>
          )}

          {hardError && (
            <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{hardError}</div>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-zinc-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-zinc-600 hover:text-zinc-900 px-3 py-1.5">
            Cancel
          </button>
          {bufferWarning ? (
            <button
              onClick={() => submit(true)}
              disabled={submitting}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-medium px-4 py-1.5 rounded"
            >
              {submitting ? 'Forcing…' : 'Override buffer & create'}
            </button>
          ) : (
            <button
              onClick={() => submit(false)}
              disabled={!canSubmit}
              className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-medium px-4 py-1.5 rounded"
            >
              {submitting ? 'Creating…' : 'Create hold'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
