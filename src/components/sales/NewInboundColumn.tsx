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
 *             to /orders/new?inquiryId=…
 *             for persistent rows: redirect directly to
 *             /orders/new?inquiryId=…
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ThreadDrawer } from './ThreadDrawer'
import { QuickReplyLauncher } from './QuickReplyLauncher'
import { ClientDetailSuggestion, type ClientDetailReply } from '@/components/intake/ClientDetailSuggestion'
import { FormTypeBadge, type FormType } from './FormTypeBadge'
import { JobPicker, EMPTY_JOB_PICKER_VALUE, type JobPickerValue } from '@/components/shared/JobPicker'
import { JobResolverModal } from '@/components/shared/JobResolverModal'
import { EmailReviewModal, type EmailReviewTarget } from '@/components/email/EmailReviewModal'
import { inquiryPastResponseSla, inquiryWaitHours } from '@/lib/sales/inquirySla'

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
  // First staff reply on the inquiry's thread (Gmail ingest or Quick
  // Reply). Non-null moves the card into the muted "Responded" block
  // below the pending list, with "Replied by … · time" attribution.
  respondedAt: string | null
  respondedBy: string | null
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
  // Present only on rows from the `responded` stream — the latest
  // outbound on the thread (Quick Reply or Gmail-synced staff reply).
  // Drives the emerald "Replied by … · when" marker.
  repliedBy?: string | null
  repliedAt?: string | null
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
  // Hours, not "today": in a queue with a 3-hour response SLA, a card
  // that has waited 12h must not read the same as one from 12min ago.
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000)
    if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`
    return `${hours}h ago`
  }
  if (days < 30) return `${days}d ago`
  if (days < 90) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtMoney(n: number | null): string | null {
  if (n == null) return null
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// "jose@sirreel.com" → "Jose". Shared inboxes read fine too ("hello@" →
// "Hello") — good enough for card attribution without a User join.
function staffFirstName(email: string): string {
  const local = email.split('@')[0] || email
  return local.charAt(0).toUpperCase() + local.slice(1)
}

function repliedAtLabel(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay
    ? time
    : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`
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
  // Suggestion threads the team already replied to — kept visible in the
  // muted "Responded" block with attribution instead of vanishing.
  const [respondedSuggestions, setRespondedSuggestions] = useState<SuggestionRecord[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drawerEmailId, setDrawerEmailId] = useState<string | null>(null)
  // Quick Reply launched straight from a suggestion row (same modal the
  // inquiry-mode ThreadDrawer opens — shared launcher, no duplicated logic).
  const [quickReplyEmailId, setQuickReplyEmailId] = useState<string | null>(null)
  // Client answers keyed by inquiry id — see the details link in the Quick
  // Reply email (src/lib/intake/detailsToken.ts).
  const [detailReplies, setDetailReplies] = useState<Record<string, ClientDetailReply>>({})
  // Add-on triage state. When set, the modal is open against this
  // persistent inquiry; the rep picks an existing Job, then confirm
  // hits POST /api/inquiries/[id]/add-on and redirects to the new
  // order. Phase 1b: persistent inquiries only — suggestion cards
  // would need a 2-step capture-then-pick flow that's out of scope.
  const [addOnInquiry, setAddOnInquiry] = useState<PersistentInquiry | null>(null)
  // Quick Respond — write back to whoever sent the inquiry without
  // committing to a quote (Wes 2026-08-25: "some are just inquiries").
  // Same two-step the detail page runs: resolve the Job, then compose.
  // The composer opens EMPTY; the rep writes the message.
  const [respondInquiry, setRespondInquiry] = useState<PersistentInquiry | null>(null)
  const [respondContact, setRespondContact] = useState<
    { email: string | null; name: string | null; phone: string | null } | null
  >(null)
  const [respondTarget, setRespondTarget] = useState<EmailReviewTarget | null>(null)
  // Clock time of the last successful list refresh — surfaced as a subtle
  // "updated HH:MM" so the user can see the auto-refresh is live.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

  const openQuickRespond = useCallback(async (row: PersistentInquiry) => {
    setRespondContact(null)
    try {
      const res = await fetch(`/api/inquiries/${row.id}/resolve-contact`, { method: 'POST' })
      if (res.ok) {
        const d = await res.json()
        setRespondContact({ email: d.email ?? null, name: d.name ?? null, phone: d.phone ?? null })
      }
    } catch {
      /* prefill is a convenience, not a precondition */
    }
    setRespondInquiry(row)
  }, [])

  const load = useCallback(() => {
    // Both streams in parallel. We replace state in place (never reset to
    // null), so a refresh doesn't flash an empty list or reset scroll.
    Promise.all([
      fetch('/api/inquiries?status=NEW').then((r) => r.json()).catch(() => ({})),
      fetch('/api/sales/suggested-inquiries').then((r) => r.json()).catch(() => ({})),
    ]).then(([inqData, sugData]) => {
      const rows = (inqData?.inquiries ?? []) as PersistentInquiry[]
      setInquiries(rows)
      // Client answers to the emailed details link, batched for the whole
      // column — one request per refresh, not one per row on a 60s poll.
      const ids = rows.map((r) => r.id).filter(Boolean)
      if (ids.length) {
        fetch(`/api/client-details?inquiryIds=${encodeURIComponent(ids.join(','))}`)
          .then((r) => r.json())
          .then((d) => {
            if (!d?.ok) return
            const byInquiry: Record<string, ClientDetailReply> = {}
            for (const reply of (d.replies ?? []) as ClientDetailReply[]) {
              if (reply.inquiryId && !byInquiry[reply.inquiryId]) byInquiry[reply.inquiryId] = reply
            }
            setDetailReplies(byInquiry)
          })
          .catch(() => {})
      } else {
        setDetailReplies({})
      }
      // Suggested-inquiries endpoint returns { newInquiries | suggestions, followUps, hidden }.
      // Same convention as InquiriesSection.
      const sug = (sugData?.newInquiries ?? sugData?.suggestions ?? []) as SuggestionRecord[]
      setSuggestions(sug)
      setRespondedSuggestions((sugData?.responded ?? []) as SuggestionRecord[])
      setLastUpdatedAt(new Date())
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Defer auto-refresh while something is in flight so we never clobber an
  // open modal/drawer or a row action mid-flight. A ref (not a dep) lets the
  // interval/focus handlers read the latest value without re-subscribing.
  const blockRefreshRef = useRef(false)
  blockRefreshRef.current = !!(busyId || drawerEmailId || quickReplyEmailId || addOnInquiry)

  // Auto-refresh: poll every 60s + refetch when the tab regains focus /
  // becomes visible, so an open or backgrounded tab self-updates as new
  // inquiries land. Skips while an action is in flight (the action's own
  // load() or the next tick catches up). load() replaces data in place →
  // non-disruptive (no scroll reset, no flash).
  useEffect(() => {
    const maybeRefresh = () => { if (!blockRefreshRef.current) load() }
    const onVisibility = () => { if (document.visibilityState === 'visible') maybeRefresh() }
    const interval = setInterval(maybeRefresh, 60_000)
    window.addEventListener('focus', maybeRefresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', maybeRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
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
    router.push(`/orders/new?inquiryId=${encodeURIComponent(inquiryId)}`)
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
        router.push(`/orders/new?inquiryId=${encodeURIComponent(inquiryId)}`)
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

  // Responded inquiries (team already replied on the thread) drop out of
  // the pending stream into a muted block below — visibly separated, not
  // hidden, since they're still open leads awaiting capture/convert.
  const pendingInquiries = (inquiries ?? []).filter((i) => !i.respondedAt)
  const respondedInquiries = (inquiries ?? []).filter((i) => !!i.respondedAt)
  const respondedCount = respondedInquiries.length + respondedSuggestions.length
  const pendingCount = pendingInquiries.length + (suggestions?.length ?? 0)
  const totalCount = pendingCount + respondedCount
  // Inquiries (web form or email) past the first-response SLA — a
  // client is actively waiting on these; they pin above everything
  // else and the header calls them out in red.
  const overdueCount = pendingInquiries.filter((i) => inquiryPastResponseSla(i)).length
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
        <div className="text-right">
          <span className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            {isLoading ? (
              '…'
            ) : (
              <>
                {overdueCount > 0 && (
                  <span className="text-red-600">
                    {overdueCount} awaiting response ·{' '}
                  </span>
                )}
                {`${pendingCount} pending${respondedCount > 0 ? ` · ${respondedCount} responded` : ''}`}
              </>
            )}
          </span>
          {lastUpdatedAt && (
            <span className="block text-[10px] text-gray-400 mt-0.5 normal-case tracking-normal font-normal">
              Updated {lastUpdatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · auto-refreshes
            </span>
          )}
        </div>
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
              // Overdue inquiries pin ABOVE the reverse-chronological
              // stream — longest-waiting first, since that client has
              // been waiting past the SLA. Everything else stays
              // newest-first (see the block comment above).
              const isOverdue = (m: MergedItem) =>
                m.kind === 'persistent' && inquiryPastResponseSla(m.row)
              const merged: MergedItem[] = [
                ...pendingInquiries.map(
                  (row) => ({ kind: 'persistent' as const, row, sortKey: row.createdAt }),
                ),
                ...(suggestions ?? []).map(
                  (row) => ({ kind: 'suggestion' as const, row, sortKey: row.sentAt }),
                ),
              ].sort((a, b) => {
                const ao = isOverdue(a) ? 1 : 0
                const bo = isOverdue(b) ? 1 : 0
                if (ao !== bo) return bo - ao
                if (ao && bo) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
                return a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0
              });
              return merged.map((item) =>
                item.kind === 'persistent' ? (
                  <PersistentCard
                    key={`inq-${item.row.id}`}
                    inquiry={item.row}
                    busy={busyId === item.row.id}
                    detailReply={detailReplies[item.row.id] ?? null}
                    onDetailReplyResolved={load}
                    onCapture={() => capturePersistent(item.row.id)}
                    onAddOn={() => setAddOnInquiry(item.row)}
                    onQuickRespond={() => openQuickRespond(item.row)}
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

            {/* Responded — team replied on the thread; still open leads.
                Muted block below pending, mirroring the pending/muted
                split the suggested-inquiries stream uses for follow-ups. */}
            {respondedCount > 0 && (
              <>
                <div className="pt-2 pb-0.5 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Responded
                  </span>
                  <span className="text-[10px] text-gray-400">
                    team replied — awaiting next step
                  </span>
                  <div className="flex-1 border-t border-gray-100" />
                </div>
                {(() => {
                  type RespondedItem =
                    | { kind: 'persistent'; row: PersistentInquiry; sortKey: string }
                    | { kind: 'suggestion'; row: SuggestionRecord; sortKey: string };
                  const merged: RespondedItem[] = [
                    ...respondedInquiries.map((row) => ({
                      kind: 'persistent' as const, row, sortKey: row.respondedAt ?? row.createdAt,
                    })),
                    ...respondedSuggestions.map((row) => ({
                      kind: 'suggestion' as const, row, sortKey: row.repliedAt ?? row.sentAt,
                    })),
                  ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
                  return merged.map((item) =>
                    item.kind === 'persistent' ? (
                      <PersistentCard
                        key={`inq-${item.row.id}`}
                        inquiry={item.row}
                        busy={busyId === item.row.id}
                        detailReply={detailReplies[item.row.id] ?? null}
                        onDetailReplyResolved={load}
                        onCapture={() => capturePersistent(item.row.id)}
                        onAddOn={() => setAddOnInquiry(item.row)}
                        onQuickRespond={() => openQuickRespond(item.row)}
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
              </>
            )}
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

      {/* Quick Respond, step 1 — which Job does this belong to? Same
          Job-as-root resolution the detail page runs, so a reply from
          the queue lands on a real Job rather than floating free. */}
      {respondInquiry && (
        <JobResolverModal
          context={{
            companyId: respondInquiry.company?.id ?? null,
            companyName: respondInquiry.company?.name ?? null,
            contactEmail: respondContact?.email ?? respondInquiry.person?.email ?? null,
            contactName:
              respondContact?.name ??
              (respondInquiry.person
                ? `${respondInquiry.person.firstName} ${respondInquiry.person.lastName}`.trim()
                : null),
            contactPhone: respondContact?.phone ?? null,
            jobNameHint: respondInquiry.title,
            dates:
              respondInquiry.preferredStartDate && respondInquiry.preferredEndDate
                ? {
                    start: respondInquiry.preferredStartDate.slice(0, 10),
                    end: respondInquiry.preferredEndDate.slice(0, 10),
                  }
                : null,
            sourceRef: 'sales:welcome',
          }}
          draftExtras={
            respondInquiry.estimatedValue != null
              ? { estimatedValue: respondInquiry.estimatedValue }
              : undefined
          }
          onResolved={(r) => {
            const inquiryId = respondInquiry.id
            setRespondInquiry(null)
            setRespondTarget({ kind: 'welcome', inquiryId, jobId: r.id })
          }}
          onClose={() => setRespondInquiry(null)}
        />
      )}

      {/* Quick Respond, step 2 — compose. Opens blank on purpose. */}
      <EmailReviewModal
        target={respondTarget}
        quickRespond
        onClose={() => setRespondTarget(null)}
        onSent={() => { setRespondTarget(null); load() }}
      />
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
  detailReply,
  onDetailReplyResolved,
  onCapture,
  onAddOn,
  onQuickRespond,
  onDismiss,
}: {
  inquiry: PersistentInquiry
  busy: boolean
  /** The client's own answer to the Quick Reply email's "what's the
   *  production company and project name?" ask, typed on /details/<token>.
   *  Fetched once for the whole column, not per row. */
  detailReply?: ClientDetailReply | null
  onDetailReplyResolved?: () => void
  onCapture: () => void
  onAddOn: () => void
  onQuickRespond: () => void
  onDismiss: () => void
}) {
  const contactName = inquiry.person
    ? `${inquiry.person.firstName} ${inquiry.person.lastName}`.trim()
    : null
  const value = fmtMoney(inquiry.estimatedValue)
  const portalAddOn = isPortalAddOnMeta(inquiry.sourceMetadata)
    ? inquiry.sourceMetadata
    : null
  // An inquiry past the first-response SLA — a client wrote in and
  // nobody has replied on any tracked channel. Red ring + wait badge.
  const overdue = inquiryPastResponseSla(inquiry)
  const waitHours = inquiryWaitHours(inquiry)

  return (
    <div
      className={`border rounded-xl px-3.5 py-3 bg-white transition-colors ${
        overdue
          ? 'border-red-300 ring-1 ring-red-200 hover:border-red-400'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
            SOURCE_BADGE[inquiry.source]
          }`}
        >
          {SOURCE_LABEL[inquiry.source]}
        </span>
        {overdue && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
            No response · {waitHours >= 48 ? `${Math.floor(waitHours / 24)}d` : `${waitHours}h`}
          </span>
        )}
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
      {inquiry.respondedAt && (
        <div className="mt-1 text-[11px] font-medium text-emerald-700">
          Replied by {inquiry.respondedBy ? staffFirstName(inquiry.respondedBy) : 'team'} ·{' '}
          {repliedAtLabel(inquiry.respondedAt)}
        </div>
      )}
      {value && (
        <div className="mt-1 text-[11px] text-gray-500">Est. value {value}</div>
      )}

      {/* The client filled in the details link we emailed. Read-only here —
          the values are applied when the inquiry is captured/quoted, which
          is where the company and job actually get resolved. Dismiss clears
          it from the queue. */}
      {detailReply && (
        <div className="mt-2">
          <ClientDetailSuggestion reply={detailReply} onResolved={onDetailReplyResolved} compact />
        </div>
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
        {/* Quick Respond (Wes 2026-08-25) — reply to the person who wrote
            in, without committing to a quote. Same flow the detail page
            ran under the "Send Welcome" label; renamed because most of
            this queue is still just an inquiry, and it opens with an
            EMPTY body rather than templated prose. */}
        <button
          onClick={onQuickRespond}
          disabled={busy}
          title="Write back to this contact — you compose the message"
          className="text-xs font-semibold border border-gray-300 text-gray-700 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50 px-3 py-1.5 rounded-lg"
        >
          Quick Respond
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
      {suggestion.repliedAt && (
        <div className="mt-1 text-[11px] font-medium text-emerald-700">
          Replied by {suggestion.repliedBy ? staffFirstName(suggestion.repliedBy) : 'team'} ·{' '}
          {repliedAtLabel(suggestion.repliedAt)}
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
