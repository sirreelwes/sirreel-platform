'use client';

/**
 * NewInboundColumn — Pipeline's first column.
 *
 * Phase 6.5b — folds the standalone /inquiries tab into the
 * Sales Pipeline. Merges two streams the operator used to read on
 * separate surfaces:
 *
 *   1. Persistent NEW Inquiry rows (GET /api/inquiries?status=NEW)
 *      — all sources: MANUAL, GMAIL, WEB_FORM. Honors per-user data
 *      scope from Phase 6.5 server-side.
 *   2. Gmail suggestions (GET /api/sales/suggested-inquiries) —
 *      the transient blank-slate stream of inbound emails that
 *      LOOK like inquiries but haven't been captured yet. This is
 *      a separate surface from the persistent backlog and stays
 *      separate by design (operator-explicit capture, not auto).
 *
 * Both streams render as cards in one column with source-badge
 * distinction. Card actions:
 *   - Open  → /inquiries/[id] for persistent rows; ThreadDrawer
 *             for suggestion cards (existing pattern).
 *   - Capture & Quote → for suggestions: existing POST
 *             /api/sales/suggested-inquiries/capture then redirect
 *             to /orders/new-quote?inquiryId=…
 *             for persistent rows: redirect directly to
 *             /orders/new-quote?inquiryId=…
 *   - Dismiss → for suggestions: existing POST
 *             /api/sales/suggested-inquiries/dismiss (records the
 *             decision against the email so it stops surfacing).
 *             for persistent rows: PATCH /api/inquiries/[id] with
 *             status=DISMISSED.
 *
 * The /inquiries route stays accessible by deep-link — only the nav
 * entry goes away. Inquiry detail page is unaffected.
 *
 * "+ Inquiry" manual-entry surface lives on the Pipeline header
 * (passed in as onNewInquiry); this component focuses on the list.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ThreadDrawer } from './ThreadDrawer'
import { QuickReplyLauncher } from './QuickReplyLauncher'
import { FormTypeBadge, type FormType } from './FormTypeBadge'
import { JobPicker, EMPTY_JOB_PICKER_VALUE, type JobPickerValue } from '@/components/shared/JobPicker'

// ─── Types ────────────────────────────────────────────────────────

type Source = 'MANUAL' | 'GMAIL' | 'WEB_FORM'
type Status = 'NEW' | 'CONVERTED' | 'DISMISSED'

interface PersistentInquiry {
  id: string
  title: string
  source: Source
  status: Status
  estimatedValue: number | null
  preferredStartDate: string | null
  preferredEndDate: string | null
  createdAt: string
  company: { id: string; name: string } | null
  person: { id: string; firstName: string; lastName: string; email: string } | null
  assignedTo: { id: string; name: string } | null
  // Phase 2 — present on inquiries created via /api/portal/add-on-request.
  // When sourceMetadata.kind === 'portal-add-on', the inquiry card shows
  // a "Portal" pill and the add-on modal pre-selects the targeted job.
  sourceMetadata: PortalAddOnMetadata | OtherSourceMetadata | null
}

interface PortalAddOnMetadata {
  kind: 'portal-add-on'
  targetJobId: string
  targetJobCode: string
  targetJobName: string
  requesterName?: string
  requesterEmail?: string
  notes?: string | null
}

// Catch-all so the parser doesn't trip on other inquiry shapes
// (`intake`, the supply-request payload, AI-extracted email metadata,
// etc.) — we only special-case the portal-add-on case.
type OtherSourceMetadata = { kind?: string } & Record<string, unknown>

interface SuggestionRecord {
  emailId: string
  fromAddress: string
  subject: string
  snippet: string | null
  sentAt: string
  category: 'BOOKING_INQUIRY' | 'RENTAL_REQUEST' | null
  inferredFormType: FormType | null
  company: { id: string; name: string } | null
  person: { id: string; firstName: string; lastName: string; email: string } | null
  threadMessageCount?: number
}

const SOURCE_LABEL: Record<Source, string> = {
  MANUAL: 'Manual',
  GMAIL: 'Gmail',
  WEB_FORM: 'Web form',
}

const SOURCE_BADGE: Record<Source, string> = {
  MANUAL: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  GMAIL: 'bg-blue-50 text-blue-700 border-blue-200',
  WEB_FORM: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const ms = Date.now() - then
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 90) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtMoney(n: number | null): string | null {
  if (n == null) return null
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ─── Component ────────────────────────────────────────────────────

export function NewInboundColumn({
  onChange,
}: {
  /** Fired after a Capture or Dismiss so the parent can refetch
   *  metrics / open-quotes if it wants to. The column refreshes
   *  itself either way. */
  onChange?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [inquiries, setInquiries] = useState<PersistentInquiry[] | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestionRecord[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drawerEmailId, setDrawerEmailId] = useState<string | null>(null)
  // Quick Reply launched straight from a suggestion row (same modal the
  // inquiry-mode ThreadDrawer opens — shared launcher, no duplicated logic).
  const [quickReplyEmailId, setQuickReplyEmailId] = useState<string | null>(null)
  // Add-on triage state. When set, the modal is open against this
  // persistent inquiry; the rep picks an existing Job, then confirm
  // hits POST /api/inquiries/[id]/add-on and redirects to the new
  // order. Phase 1b: persistent inquiries only — suggestion cards
  // would need a 2-step capture-then-pick flow that's out of scope.
  const [addOnInquiry, setAddOnInquiry] = useState<PersistentInquiry | null>(null)

  const load = useCallback(() => {
    // Both streams in parallel.
    Promise.all([
      fetch('/api/inquiries?status=NEW').then((r) => r.json()).catch(() => ({})),
      fetch('/api/sales/suggested-inquiries').then((r) => r.json()).catch(() => ({})),
    ]).then(([inqData, sugData]) => {
      setInquiries((inqData?.inquiries ?? []) as PersistentInquiry[])
      // Suggested-inquiries endpoint returns { newInquiries | suggestions, followUps, hidden }.
      // Same convention as InquiriesSection.
      const sug = (sugData?.newInquiries ?? sugData?.suggestions ?? []) as SuggestionRecord[]
      setSuggestions(sug)
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Deep-link support: /sales/pipeline?thread=<emailId> opens the
  // drawer just like the legacy InquiriesSection.
  useEffect(() => {
    const t = searchParams?.get('thread') || null
    setDrawerEmailId(t)
  }, [searchParams])

  // ─── Card actions ───────────────────────────────────────────────

  const capturePersistent = (inquiryId: string) => {
    // Persistent inquiry already has an Inquiry row; no API call
    // needed — go straight to new-quote with the inquiryId.
    router.push(`/orders/new-quote?inquiryId=${encodeURIComponent(inquiryId)}`)
  }

  const captureSuggestion = async (emailId: string) => {
    setBusyId(emailId)
    try {
      const res = await fetch('/api/sales/suggested-inquiries/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error || `Failed to capture (HTTP ${res.status})`)
        return
      }
      const data = await res.json()
      const inquiryId = data.inquiry?.id
      if (inquiryId) {
        router.push(`/orders/new-quote?inquiryId=${encodeURIComponent(inquiryId)}`)
        return
      }
      load()
      onChange?.()
    } catch (err) {
      alert(`Failed to capture: ${err instanceof Error ? err.message : 'network error'}`)
    } finally {
      setBusyId(null)
    }
  }

  const submitAddOn = async (inquiryId: string, jobId: string) => {
    setBusyId(inquiryId)
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/add-on`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        alert(data?.error || `Failed to add-on (HTTP ${res.status})`)
        return
      }
      setAddOnInquiry(null)
      if (data.redirectTo) {
        router.push(data.redirectTo)
        return
      }
      load()
      onChange?.()
    } catch (err) {
      alert(`Failed to add-on: ${err instanceof Error ? err.message : 'network error'}`)
    } finally {
      setBusyId(null)
    }
  }

  const dismissPersistent = async (inquiryId: string) => {
    setBusyId(inquiryId)
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DISMISSED' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error || `Failed to dismiss (HTTP ${res.status})`)
        return
      }
      load()
      onChange?.()
    } catch (err) {
      alert(`Failed to dismiss: ${err instanceof Error ? err.message : 'network error'}`)
    } finally {
      setBusyId(null)
    }
  }

  const dismissSuggestion = async (emailId: string) => {
    setBusyId(emailId)
    try {
      const res = await fetch('/api/sales/suggested-inquiries/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error || `Failed to dismiss (HTTP ${res.status})`)
        return
      }
      load()
      onChange?.()
    } catch (err) {
      alert(`Failed to dismiss: ${err instanceof Error ? err.message : 'network error'}`)
    } finally {
      setBusyId(null)
    }
  }

  // ─── Render ────────────────────────────────────────────────────

  const totalCount = (inquiries?.length ?? 0) + (suggestions?.length ?? 0)
  const isLoading = inquiries === null || suggestions === null

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <header className="px-5 py-4 border-b border-gray-100 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">New inbound</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Untriaged leads — inquiries (manual, web, Gmail) and inbox suggestions waiting on a capture decision.
          </p>
        </div>
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          {isLoading ? '…' : `${totalCount} pending`}
        </span>
      </header>

      <div className="p-3">
        {isLoading ? (
          <div className="text-xs text-gray-500 px-2 py-6 text-center">Loading…</div>
        ) : totalCount === 0 ? (
          <div className="text-xs text-gray-500 px-2 py-6 text-center border border-dashed border-gray-200 rounded-xl">
            Inbox is clear. New leads land here as they arrive.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Merge both streams and sort newest-first across kinds.
                Until this change, persistent NEW Inquiries rendered
                in a block ABOVE suggestion cards — so old triage
                backlog (oldest persistent rows from ~3 weeks ago)
                pushed today's suggestion cards out of sight. Now the
                column reads in true reverse-chronological order:
                today's lead — persistent or suggestion — is the
                first card every time. */}
            {(() => {
              type MergedItem =
                | { kind: 'persistent'; row: PersistentInquiry; sortKey: string }
                | { kind: 'suggestion'; row: SuggestionRecord; sortKey: string };
              const merged: MergedItem[] = [
                ...(inquiries ?? []).map(
                  (row) => ({ kind: 'persistent' as const, row, sortKey: row.createdAt }),
                ),
                ...(suggestions ?? []).map(
                  (row) => ({ kind: 'suggestion' as const, row, sortKey: row.sentAt }),
                ),
              ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
              return merged.map((item) =>
                item.kind === 'persistent' ? (
                  <PersistentCard
                    key={`inq-${item.row.id}`}
                    inquiry={item.row}
                    busy={busyId === item.row.id}
                    onCapture={() => capturePersistent(item.row.id)}
                    onAddOn={() => setAddOnInquiry(item.row)}
                    onDismiss={() => dismissPersistent(item.row.id)}
                  />
                ) : (
                  <SuggestionCard
                    key={`sug-${item.row.emailId}`}
                    suggestion={item.row}
                    busy={busyId === item.row.emailId}
                    onOpen={() => setDrawerEmailId(item.row.emailId)}
                    onCapture={() => captureSuggestion(item.row.emailId)}
                    onQuickReply={() => setQuickReplyEmailId(item.row.emailId)}
                    onDismiss={() => dismissSuggestion(item.row.emailId)}
                  />
                ),
              );
            })()}
          </div>
        )}
      </div>

      {drawerEmailId && (
        <ThreadDrawer
          emailId={drawerEmailId}
          onClose={() => setDrawerEmailId(null)}
          onCapture={async (emailId) => {
            await captureSuggestion(emailId)
            setDrawerEmailId(null)
          }}
          onDismiss={async (emailId) => {
            await dismissSuggestion(emailId)
            setDrawerEmailId(null)
          }}
          busy={busyId === drawerEmailId}
        />
      )}

      {quickReplyEmailId && (
        <QuickReplyLauncher
          emailId={quickReplyEmailId}
          onClose={() => setQuickReplyEmailId(null)}
          onSent={() => { setQuickReplyEmailId(null); load() }}
        />
      )}

      {addOnInquiry && (
        <AddOnModal
          inquiry={addOnInquiry}
          busy={busyId === addOnInquiry.id}
          onCancel={() => setAddOnInquiry(null)}
          onConfirm={(jobId) => submitAddOn(addOnInquiry.id, jobId)}
        />
      )}
    </section>
  )
}

function isPortalAddOnMeta(m: unknown): m is PortalAddOnMetadata {
  if (!m || typeof m !== 'object') return false
  const r = m as Record<string, unknown>
  return r.kind === 'portal-add-on' && typeof r.targetJobId === 'string'
}

// ─── Add-on modal ─────────────────────────────────────────────────

function AddOnModal({
  inquiry,
  busy,
  onCancel,
  onConfirm,
}: {
  inquiry: PersistentInquiry
  busy: boolean
  onCancel: () => void
  onConfirm: (jobId: string) => void
}) {
  // The shared JobPicker supports both pick-existing AND create-new
  // modes; the add-on flow only wants existing. We just gate the
  // confirm button on mode === 'selected_existing' so the create
  // path is inert. Scope the picker to the inquiry's company when
  // we have one — falls back to all-open-jobs search otherwise.
  //
  // Phase 2 — when the inquiry was created via portal-add-on, the
  // client already named the target job. Pre-seed the picker so the
  // rep only needs to confirm (or override) rather than re-search.
  const portalHint = isPortalAddOnMeta(inquiry.sourceMetadata)
    ? inquiry.sourceMetadata
    : null
  const [job, setJob] = useState<JobPickerValue>(EMPTY_JOB_PICKER_VALUE)

  // Resolve the hinted job's display info on open so the picker
  // mounts in selected_existing mode. The picker needs the job's
  // companyId+name for its display invariants — a bare id alone
  // would render an empty selection chip.
  useEffect(() => {
    if (!portalHint) return
    let cancelled = false
    fetch(`/api/jobs/${encodeURIComponent(portalHint.targetJobId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.id) return
        setJob({
          jobId: j.id,
          name: j.name,
          jobCode: j.jobCode,
          mode: 'selected_existing',
          company: j.company ? { id: j.company.id, name: j.company.name } : null,
        })
      })
      .catch(() => {
        // Hint lookup failed — leave the picker empty so the rep can
        // search manually. The hint is convenience, not authority.
      })
    return () => {
      cancelled = true
    }
  }, [portalHint])

  const canConfirm = job.mode === 'selected_existing' && !!job.jobId && !busy

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <h3 className="text-base font-semibold text-gray-900">Add on to an existing job</h3>
          <p className="mt-1 text-xs text-gray-500">
            Picks a job and creates a new order on it for this inquiry. The new order will
            be marked as an add-on.
          </p>
        </div>

        <div className="mt-2 text-[11px] uppercase tracking-wider text-gray-500 mb-1">
          Inquiry
        </div>
        <div className="text-sm text-gray-900 line-clamp-2 mb-3">{inquiry.title}</div>

        {portalHint && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="font-semibold">
              Portal client requested {portalHint.targetJobCode}
            </div>
            {portalHint.notes && (
              <div className="mt-1 whitespace-pre-wrap text-amber-800">{portalHint.notes}</div>
            )}
          </div>
        )}

        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Job</div>
        <JobPicker
          value={job}
          onChange={setJob}
          companyId={inquiry.company?.id ?? null}
          placeholder="Search open jobs by name or code…"
          allowReset
        />

        {job.mode === 'creating_new' && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            Add-ons attach to an EXISTING job. To create a new job, use Capture & Quote instead.
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs font-semibold border border-gray-200 text-gray-600 hover:border-gray-400 disabled:opacity-50 px-3 py-1.5 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canConfirm && job.jobId && onConfirm(job.jobId)}
            disabled={!canConfirm}
            className="text-xs font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg"
          >
            {busy ? 'Adding…' : 'Add to job →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Persistent-inquiry card ──────────────────────────────────────

function PersistentCard({
  inquiry,
  busy,
  onCapture,
  onAddOn,
  onDismiss,
}: {
  inquiry: PersistentInquiry
  busy: boolean
  onCapture: () => void
  onAddOn: () => void
  onDismiss: () => void
}) {
  const contactName = inquiry.person
    ? `${inquiry.person.firstName} ${inquiry.person.lastName}`.trim()
    : null
  const value = fmtMoney(inquiry.estimatedValue)
  const portalAddOn = isPortalAddOnMeta(inquiry.sourceMetadata)
    ? inquiry.sourceMetadata
    : null

  return (
    <div className="border border-gray-200 rounded-xl px-3.5 py-3 bg-white hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
            SOURCE_BADGE[inquiry.source]
          }`}
        >
          {SOURCE_LABEL[inquiry.source]}
        </span>
        {portalAddOn && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200"
            title={`Portal client requested an add-on to ${portalAddOn.targetJobCode}`}
          >
            Portal add-on
          </span>
        )}
        <span className="text-[11px] text-gray-500">{relativeAge(inquiry.createdAt)}</span>
        {inquiry.assignedTo && (
          <span className="text-[11px] text-gray-500 ml-auto">
            · {inquiry.assignedTo.name}
          </span>
        )}
      </div>
      <a
        href={`/inquiries/${inquiry.id}`}
        className="block mt-1.5 text-sm font-semibold text-gray-900 leading-tight hover:underline underline-offset-2 decoration-gray-300"
      >
        {inquiry.title}
      </a>
      <div className="mt-1 text-[12px] text-gray-600">
        {inquiry.company?.name ?? 'No company'}
        {contactName ? <span className="text-gray-400"> · {contactName}</span> : null}
      </div>
      {value && (
        <div className="mt-1 text-[11px] text-gray-500">Est. value {value}</div>
      )}

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <button
          onClick={onCapture}
          disabled={busy}
          className="text-xs font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg"
        >
          {busy ? '…' : 'Capture & Quote →'}
        </button>
        <button
          onClick={onAddOn}
          disabled={busy}
          title="Create a new order on an existing job instead of a new one"
          className="text-xs font-semibold border border-gray-300 text-gray-700 hover:border-gray-500 hover:text-gray-900 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          Add on to existing job
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="text-xs font-semibold border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          Dismiss
        </button>
        <a
          href={`/inquiries/${inquiry.id}`}
          className="text-[11px] text-gray-500 hover:text-gray-900 ml-auto"
        >
          Detail →
        </a>
      </div>
    </div>
  )
}

// ─── Gmail-suggestion card ────────────────────────────────────────

function SuggestionCard({
  suggestion,
  busy,
  onOpen,
  onCapture,
  onQuickReply,
  onDismiss,
}: {
  suggestion: SuggestionRecord
  busy: boolean
  onOpen: () => void
  onCapture: () => void
  onQuickReply: () => void
  onDismiss: () => void
}) {
  const contactName = suggestion.person
    ? `${suggestion.person.firstName} ${suggestion.person.lastName}`.trim()
    : null
  return (
    <div className="border border-gray-200 rounded-xl px-3.5 py-3 bg-white hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${SOURCE_BADGE.GMAIL}`}
        >
          {SOURCE_LABEL.GMAIL}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
          Suggested
        </span>
        {suggestion.inferredFormType && (
          <FormTypeBadge type={suggestion.inferredFormType} size="xs" />
        )}
        <span className="text-[11px] text-gray-500">{relativeAge(suggestion.sentAt)}</span>
        {(suggestion.threadMessageCount ?? 0) > 1 && (
          <span className="text-[11px] text-gray-500 ml-auto">
            {suggestion.threadMessageCount} msgs
          </span>
        )}
      </div>
      <button
        onClick={onOpen}
        className="block w-full text-left mt-1.5 text-sm font-semibold text-gray-900 leading-tight hover:underline underline-offset-2 decoration-gray-300"
      >
        {suggestion.subject || '(no subject)'}
      </button>
      <div className="mt-1 text-[12px] text-gray-600">
        {suggestion.fromAddress}
      </div>
      {(suggestion.company?.name || contactName) && (
        <div className="mt-0.5 text-[11px] text-gray-500">
          {suggestion.company?.name ?? 'Unknown company'}
          {contactName ? ` · ${contactName}` : ''}
        </div>
      )}
      {suggestion.snippet && (
        <div className="mt-1 text-[11px] text-gray-500 line-clamp-2">{suggestion.snippet}</div>
      )}

      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <button
          onClick={onCapture}
          disabled={busy}
          className="text-xs font-semibold bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg"
        >
          {busy ? '…' : 'Capture & Quote →'}
        </button>
        {/* Quick Reply — secondary/outline so Capture & Quote stays primary.
            Opens the SAME QuickReplyModal as the inquiry-mode ThreadDrawer
            (suggestion rows open that drawer in inquiry mode). */}
        <button
          onClick={onQuickReply}
          disabled={busy}
          className="text-xs font-semibold border border-gray-300 text-gray-700 hover:border-gray-400 hover:text-gray-900 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          Quick Reply
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="text-xs font-semibold border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          Dismiss
        </button>
        <button
          onClick={onOpen}
          className="text-[11px] text-gray-500 hover:text-gray-900 ml-auto"
        >
          Open thread →
        </button>
      </div>
    </div>
  )
}
