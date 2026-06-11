'use client'

/**
 * FollowUpsDueModal — drill-down for the FOLLOW-UPS DUE strip card.
 * Lists every open follow-up (Activity + OutreachActivity merged,
 * newest-due first) with one-tap "Done" and "Log outreach" actions.
 *
 * "My outreach" toggle (`scope=mine`) limits to follow-ups created
 * by the session user. Admins get the unfiltered list by default.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { OutreachQuickLogModal } from './OutreachQuickLogModal'

type Kind = 'activity' | 'outreach'

interface Row {
  kind: Kind
  id: string
  due: string
  notes: string
  createdBy: { id: string; name: string }
  person: { id: string; firstName: string; lastName: string; email: string } | null
  company: { id: string; name: string } | null
  type: string | null
  activityType: string | null
}

const TYPE_ICONS: Record<string, string> = {
  VISIT: '🏢', CALL: '📞', EMAIL: '✉️', TEXT: '💬', EVENT: '🎬', DROP_IN: '🚪',
}

function fmtDue(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const overdue = d.getTime() < now.getTime()
  const dayMs = 86_400_000
  const diffDays = Math.floor((now.getTime() - d.getTime()) / dayMs)
  if (overdue) {
    if (diffDays === 0) return 'today'
    return `${diffDays}d overdue`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function FollowUpsDueModal({
  onClose,
  onChanged,
}: {
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [counts, setCounts] = useState<{ activity: number; outreach: number; total: number } | null>(null)
  const [scopeMine, setScopeMine] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Outreach quick-log for a specific row's target.
  const [logTarget, setLogTarget] = useState<{
    person: Row['person']
    company: Row['company']
  } | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const url = scopeMine ? '/api/crm/follow-ups?scope=mine' : '/api/crm/follow-ups'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      setRows(data.rows as Row[])
      setCounts(data.counts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [scopeMine])

  useEffect(() => { load() }, [load])

  const markDone = async (row: Row) => {
    const before = rows
    setRows((rs) => rs?.filter((r) => r.id !== row.id) ?? null)
    setPendingId(row.id)
    try {
      const url = row.kind === 'outreach'
        ? `/api/crm/outreach/${row.id}`
        : `/api/crm/activities/${row.id}`
      const payload = row.kind === 'outreach'
        ? { followUpDone: true }
        : { completed: true }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        setRows(before)
        const d = await res.json().catch(() => ({}))
        setErr(d?.error || 'mark-done failed')
      } else {
        onChanged()
      }
    } catch {
      setRows(before)
      setErr('mark-done failed')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/70 md:px-4 md:py-8">
      <div className="bg-lt-card w-full h-full md:h-auto md:max-h-[90vh] md:max-w-2xl md:rounded-xl md:border md:border-lt-hairline flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-lt-hairline shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-lt-fg">Follow-ups due</h3>
            {counts && (
              <span className="text-xs text-lt-fg3">
                {counts.total} total · {counts.activity} activity · {counts.outreach} outreach
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-lt-fg2 hover:text-lt-fg px-2 py-1"
          >
            Close ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-lt-hairline shrink-0">
          <label className="flex items-center gap-2 text-sm text-lt-fg">
            <input
              type="checkbox"
              checked={scopeMine}
              onChange={(e) => setScopeMine(e.target.checked)}
            />
            My outreach only
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {err && (
            <div className="px-5 py-2 text-sm text-chip-bad-fg bg-chip-bad-bg/30">{err}</div>
          )}
          {rows == null && <div className="px-5 py-4 text-sm text-lt-fg2">Loading…</div>}
          {rows && rows.length === 0 && (
            <div className="px-5 py-6 text-sm text-lt-fg3 text-center">
              No follow-ups due. Nice work.
            </div>
          )}
          {rows && rows.length > 0 && (
            <div className="divide-y divide-lt-hairline">
              {rows.map((r) => (
                <div key={`${r.kind}:${r.id}`} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {r.kind === 'outreach' && r.type && (
                      <span className="text-base">{TYPE_ICONS[r.type] ?? ''}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      new Date(r.due) < new Date()
                        ? 'bg-chip-warn-bg text-chip-warn-fg'
                        : 'bg-lt-inner text-lt-fg2'
                    }`}>
                      {fmtDue(r.due)}
                    </span>
                    <span className="text-xs text-lt-fg3">
                      {r.kind === 'outreach' ? `${r.type?.toLowerCase()} · ` : ''}
                      {r.createdBy.name}
                    </span>
                  </div>
                  <div className="text-sm text-lt-fg mb-1">
                    {r.person && (
                      <Link href={`/crm/people/${r.person.id}`} className="hover:underline">
                        {r.person.firstName} {r.person.lastName}
                      </Link>
                    )}
                    {r.person && r.company && <span className="text-lt-fg3"> · </span>}
                    {r.company && (
                      <Link href={`/crm/${r.company.id}`} className="hover:underline">
                        {r.company.name}
                      </Link>
                    )}
                    {!r.person && !r.company && <span className="text-lt-fg3">(unlinked)</span>}
                  </div>
                  <div className="text-sm text-lt-fg2 mb-2 whitespace-pre-wrap break-words">{r.notes}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => markDone(r)}
                      disabled={pendingId === r.id}
                      className="px-3 py-1.5 text-xs bg-lt-fg hover:bg-black text-white rounded disabled:opacity-50"
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogTarget({ person: r.person, company: r.company })}
                      disabled={pendingId === r.id}
                      className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
                    >
                      + Log outreach
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {logTarget && (
        <OutreachQuickLogModal
          presetPerson={logTarget.person}
          presetCompany={logTarget.company}
          onClose={() => setLogTarget(null)}
          onSaved={() => { load(); onChanged(); }}
        />
      )}
    </div>
  )
}
