'use client'

/**
 * CRM auto-capture review widget. Sits above the People list on /crm.
 * Mirror of ClaimMailTriage in structure: collapsible card, counts
 * header, per-row actions with optimistic UI.
 *
 *   Header line: N captured this week · M need review · K skipped
 *   Mode toggle: Needs review (default) ↔ Auto-captured (audit) ↔ Skipped
 *   NEEDS_REVIEW row: Add (pre-fill modal) / Dismiss
 *   AUTO_CAPTURED row: Person Link + Undo (refuses if Person has any
 *     downstream rows — server returns 409)
 *   SKIPPED row: muted, parsed payload visible for audit, no action
 *
 * The Add modal takes the parsed fields and lets the rep edit name,
 * email, role, etc. before POSTing — captures whatever cleanup the
 * rep wants without re-typing the obvious bits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Verdict = 'AUTO_CAPTURED' | 'NEEDS_REVIEW' | 'SKIPPED'
type Resolution =
  | 'PENDING'
  | 'AUTO_FILED'
  | 'AUTO_ENRICHED'
  | 'AUTO_SKIPPED'
  | 'ADDED'
  | 'DISMISSED'

const PERSON_ROLES = [
  'UPM',
  'PRODUCER',
  'LINE_PRODUCER',
  'PRODUCTION_COORDINATOR',
  'PRODUCTION_SUPERVISOR',
  'TRANSPORTATION_COORDINATOR',
  'ART_COORDINATOR',
  'COORDINATOR',
  'OWNER',
  'OTHER',
] as const
type PersonRole = (typeof PERSON_ROLES)[number]

interface CaptureRow {
  id: string
  verdict: Verdict
  resolution: Resolution
  verdictReason: string
  signals: string[] | null
  inbox: string
  parsedName: string | null
  parsedEmail: string | null
  parsedPhone: string | null
  parsedTitle: string | null
  parsedCompanyString: string | null
  parsedProject: string | null
  personId: string | null
  companyId: string | null
  createdAt: string
  person: { id: string; firstName: string; lastName: string; email: string } | null
  company: { id: string; name: string } | null
  emailMessage: {
    id: string
    subject: string
    fromAddress: string
    sentAt: string
  }
}

interface Counts {
  capturedThisWeek: number
  needsReview: number
  skippedThisWeek: number
}

const VERDICT_CHIP: Record<Verdict, string> = {
  AUTO_CAPTURED: 'bg-chip-good-bg text-chip-good-fg',
  NEEDS_REVIEW: 'bg-chip-warn-bg text-chip-warn-fg',
  SKIPPED: 'bg-lt-inner text-lt-fg3',
}
const VERDICT_LABEL: Record<Verdict, string> = {
  AUTO_CAPTURED: 'Captured',
  NEEDS_REVIEW: 'Needs review',
  SKIPPED: 'Skipped',
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const diffMin = (Date.now() - d.getTime()) / 60_000
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function splitName(full: string | null): { first: string; last: string } {
  if (!full) return { first: '', last: '' }
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function titleToRole(title: string | null): PersonRole {
  if (!title) return 'OTHER'
  const t = title.toLowerCase()
  if (/unit production manager|\bupm\b/.test(t)) return 'UPM'
  if (/line producer/.test(t)) return 'LINE_PRODUCER'
  if (/production coordinator|prod\.? coord/.test(t)) return 'PRODUCTION_COORDINATOR'
  if (/production supervisor/.test(t)) return 'PRODUCTION_SUPERVISOR'
  if (/transp(o(rt(ation)?)?)? coordinator|transp(o)? captain/.test(t)) return 'TRANSPORTATION_COORDINATOR'
  if (/art coordinator/.test(t)) return 'ART_COORDINATOR'
  if (/coordinator/.test(t)) return 'COORDINATOR'
  if (/executive producer|\bep\b|producer/.test(t)) return 'PRODUCER'
  if (/owner|founder|ceo|president/.test(t)) return 'OWNER'
  return 'OTHER'
}

type Mode = 'NEEDS_REVIEW' | 'AUTO_CAPTURED' | 'SKIPPED'

export function CaptureReviewWidget({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<CaptureRow[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [mode, setMode] = useState<Mode>('NEEDS_REVIEW')
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Editing-a-row state for the Add modal.
  const [editing, setEditing] = useState<CaptureRow | null>(null)
  const [eFirst, setEFirst] = useState('')
  const [eLast, setELast] = useState('')
  const [eEmail, setEEmail] = useState('')
  const [ePhone, setEPhone] = useState('')
  const [eRole, setERole] = useState<PersonRole>('OTHER')
  const [eTitle, setETitle] = useState('')
  const [eProject, setEProject] = useState('')
  const [eSaving, setESaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/crm/captures?verdict=${mode}&days=30`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error || `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      setRows((data.rows ?? []) as CaptureRow[])
      setCounts(data.counts as Counts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }, [mode])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = (r: CaptureRow) => {
    const n = splitName(r.parsedName)
    setEFirst(n.first)
    setELast(n.last)
    setEEmail(r.parsedEmail ?? '')
    setEPhone(r.parsedPhone ?? '')
    setERole(titleToRole(r.parsedTitle))
    setETitle(r.parsedTitle ?? '')
    setEProject(r.parsedProject ?? '')
    setEditing(r)
  }

  const closeEdit = () => {
    setEditing(null)
    setESaving(false)
  }

  const submitAdd = async () => {
    if (!editing) return
    if (!eFirst.trim() || !eLast.trim() || !eEmail.trim()) {
      setError('first name, last name, email all required')
      return
    }
    setESaving(true)
    try {
      const res = await fetch(`/api/crm/captures/${editing.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          firstName: eFirst.trim(),
          lastName: eLast.trim(),
          email: eEmail.trim(),
          phone: ePhone.trim() || null,
          role: eRole,
          rawTitle: eTitle.trim() || null,
          lastKnownProject: eProject.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        setESaving(false)
        return
      }
      closeEdit()
      load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'add failed')
      setESaving(false)
    }
  }

  const dismiss = async (r: CaptureRow) => {
    const before = rows
    setRows((rs) => rs?.filter((x) => x.id !== r.id) ?? null)
    setPendingId(r.id)
    try {
      const res = await fetch(`/api/crm/captures/${r.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setRows(before)
        setError(d?.error || 'dismiss failed')
      } else {
        onChanged?.()
      }
    } catch {
      setRows(before)
      setError('dismiss failed')
    } finally {
      setPendingId(null)
    }
  }

  const undo = async (r: CaptureRow) => {
    setPendingId(r.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/captures/${r.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error || `HTTP ${res.status}`)
        return
      }
      load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'undo failed')
    } finally {
      setPendingId(null)
    }
  }

  const counters = useMemo(() => counts ?? { capturedThisWeek: 0, needsReview: 0, skippedThisWeek: 0 }, [counts])

  // Empty render: nothing captured ever AND nothing needs review.
  if (rows && rows.length === 0 && counters.needsReview === 0 && counters.capturedThisWeek === 0 && mode === 'NEEDS_REVIEW') {
    return null
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-lt-inner transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-lt-fg">CRM auto-capture</span>
          <span className="text-xs text-lt-fg2">
            <span className="text-chip-good-fg font-medium">{counters.capturedThisWeek}</span> captured this week
            {' · '}
            <span className={counters.needsReview > 0 ? 'text-chip-warn-fg font-medium' : ''}>
              {counters.needsReview} need{counters.needsReview === 1 ? 's' : ''} review
            </span>
            {' · '}
            <span className="text-lt-fg3">{counters.skippedThisWeek} skipped</span>
          </span>
        </div>
        <span className="text-xs text-lt-fg2">{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-lt-hairline">
          <div className="px-4 py-2 flex items-center gap-2 text-xs">
            {(['NEEDS_REVIEW', 'AUTO_CAPTURED', 'SKIPPED'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded ${
                  mode === m
                    ? 'bg-amber-600 text-white'
                    : 'bg-lt-inner text-lt-fg2 hover:bg-lt-card'
                }`}
              >
                {VERDICT_LABEL[m]}
              </button>
            ))}
          </div>

          {error && (
            <div className="px-4 py-2 text-xs text-chip-bad-fg bg-chip-bad-bg/30">{error}</div>
          )}

          {rows == null && (
            <div className="px-4 py-3 text-sm text-lt-fg2">Loading…</div>
          )}
          {rows && rows.length === 0 && (
            <div className="px-4 py-3 text-sm text-lt-fg3">No rows in this view.</div>
          )}
          {rows && rows.length > 0 && (
            <div className="divide-y divide-lt-hairline">
              {rows.map((r) => (
                <CaptureRowView
                  key={r.id}
                  row={r}
                  pending={pendingId === r.id}
                  onAdd={() => openEdit(r)}
                  onDismiss={() => dismiss(r)}
                  onUndo={() => undo(r)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold text-lt-fg mb-1">Add contact</h3>
            <p className="text-xs text-lt-fg2 mb-4">
              Pre-filled from <span className="text-lt-fg">{editing.emailMessage.fromAddress}</span>{' '}
              · {editing.inbox}
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" required>
                  <input
                    value={eFirst}
                    onChange={(e) => setEFirst(e.target.value)}
                    className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                  />
                </Field>
                <Field label="Last name" required>
                  <input
                    value={eLast}
                    onChange={(e) => setELast(e.target.value)}
                    className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                  />
                </Field>
              </div>
              <Field label="Email" required>
                <input
                  value={eEmail}
                  onChange={(e) => setEEmail(e.target.value)}
                  className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                />
              </Field>
              <Field label="Phone">
                <input
                  value={ePhone}
                  onChange={(e) => setEPhone(e.target.value)}
                  className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                />
              </Field>
              <Field label="Role">
                <select
                  value={eRole}
                  onChange={(e) => setERole(e.target.value as PersonRole)}
                  className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                >
                  {PERSON_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Verbatim title">
                <input
                  value={eTitle}
                  onChange={(e) => setETitle(e.target.value)}
                  className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                />
              </Field>
              <Field label="Last known project / show">
                <input
                  value={eProject}
                  onChange={(e) => setEProject(e.target.value)}
                  className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1 text-sm text-lt-fg"
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={eSaving}
                className="px-3 py-1.5 text-sm text-lt-fg2 hover:text-lt-fg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAdd}
                disabled={eSaving}
                className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
              >
                {eSaving ? 'Adding…' : 'Add contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs text-lt-fg2 mb-1 block">
        {label}
        {required && <span className="text-chip-bad-fg ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

function CaptureRowView({
  row,
  pending,
  onAdd,
  onDismiss,
  onUndo,
}: {
  row: CaptureRow
  pending: boolean
  onAdd: () => void
  onDismiss: () => void
  onUndo: () => void
}) {
  const isReview = row.verdict === 'NEEDS_REVIEW'
  const isAuto = row.verdict === 'AUTO_CAPTURED'

  return (
    <div className="px-4 py-3 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded ${VERDICT_CHIP[row.verdict]}`}>
            {VERDICT_LABEL[row.verdict]}
          </span>
          <span className="text-xs text-lt-fg3">{row.inbox}</span>
          <span className="text-xs text-lt-fg3">{fmtTime(row.createdAt)}</span>
          {row.resolution !== 'PENDING' && (
            <span className="text-xs text-lt-fg3">· {row.resolution.toLowerCase().replace('_', ' ')}</span>
          )}
        </div>

        <div className="text-sm text-lt-fg truncate">
          <span className="font-medium">{row.parsedName || '(no name)'}</span>
          {row.parsedEmail && <span className="text-lt-fg2"> · {row.parsedEmail}</span>}
        </div>
        {(row.parsedTitle || row.parsedCompanyString || row.parsedProject) && (
          <div className="text-xs text-lt-fg2 truncate mt-0.5">
            {row.parsedTitle && <span>{row.parsedTitle}</span>}
            {row.parsedCompanyString && (
              <>
                {row.parsedTitle && <span> · </span>}
                <span>{row.parsedCompanyString}</span>
                {row.company && (
                  <span className="text-chip-good-fg"> ✓ linked</span>
                )}
                {!row.company && row.parsedCompanyString && (
                  <span className="text-lt-fg3"> · no CRM match</span>
                )}
              </>
            )}
            {row.parsedProject && (
              <>
                {(row.parsedTitle || row.parsedCompanyString) && <span> · </span>}
                <span>"{row.parsedProject}"</span>
              </>
            )}
          </div>
        )}
        <div className="text-xs text-lt-fg3 truncate mt-1" title={row.verdictReason}>
          subject: {row.emailMessage.subject || '(no subject)'} · {row.verdictReason}
        </div>
        {row.person && isAuto && (
          <div className="text-xs mt-1">
            <Link href={`/crm/people/${row.person.id}`} className="text-amber-500 hover:text-amber-400">
              {row.person.firstName} {row.person.lastName} →
            </Link>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isReview && (
          <>
            <button
              type="button"
              onClick={onAdd}
              disabled={pending}
              className="px-2.5 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={pending}
              className="px-2.5 py-1 text-xs text-lt-fg2 hover:text-lt-fg"
            >
              Dismiss
            </button>
          </>
        )}
        {isAuto && (
          <button
            type="button"
            onClick={onUndo}
            disabled={pending}
            className="px-2.5 py-1 text-xs text-lt-fg2 hover:text-lt-fg"
            title="Reverse the auto-capture (refuses if the person has any downstream activity)"
          >
            Undo
          </button>
        )}
      </div>
    </div>
  )
}
