'use client'

/**
 * BulkOutreachModal — log one touch against every selected contact.
 *
 * The after-a-mixer flow: back from an event having met fifteen people,
 * log it once instead of opening the quick-log sheet fifteen times.
 *
 * Deliberately the same four inputs as OutreachQuickLogModal (type,
 * notes, optional follow-up) minus the target picker, since the target
 * is the selection. Kept as its own component rather than a mode flag on
 * the quick-log sheet: that sheet is mobile-first and built around
 * picking ONE person, and threading "or fifteen" through its typeahead,
 * quick-add and preset-lock paths would make both flows harder to read.
 */

import { useEffect, useState } from 'react'

type OutreachType = 'VISIT' | 'CALL' | 'EMAIL' | 'TEXT' | 'EVENT' | 'DROP_IN'

const TYPE_OPTIONS: { value: OutreachType; label: string; icon: string }[] = [
  { value: 'EVENT', label: 'Event', icon: '🎬' },
  { value: 'VISIT', label: 'Visit', icon: '🏢' },
  { value: 'CALL', label: 'Call', icon: '📞' },
  { value: 'EMAIL', label: 'Email', icon: '✉️' },
  { value: 'TEXT', label: 'Text', icon: '💬' },
  { value: 'DROP_IN', label: 'Drop-in', icon: '🚪' },
]

const PRESETS: { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toInputDate(d)
}

export function BulkOutreachModal({
  personIds,
  onClose,
  onSaved,
}: {
  personIds: string[]
  onClose: () => void
  onSaved: (logged: number) => void
}) {
  // EVENT leads the list and is the default: bulk logging exists almost
  // entirely because of mixers and wrap parties.
  const [type, setType] = useState<OutreachType>('EVENT')
  const [notes, setNotes] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const count = personIds.length

  const save = async () => {
    if (!notes.trim() || saving) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/crm/outreach/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          personIds,
          notes: notes.trim(),
          followUpAt: followUp ? new Date(followUp).toISOString() : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      onSaved(data.logged ?? count)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/70 md:px-4 md:py-8">
      <div className="bg-lt-card w-full h-full md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-xl md:border md:border-lt-hairline flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-lt-hairline shrink-0">
          <div>
            <h3 className="text-base font-semibold text-lt-fg">Log outreach</h3>
            <p className="text-xs text-lt-fg3 mt-0.5">
              One entry on each of {count} contact{count === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} disabled={saving}
            className="text-lt-fg3 hover:text-lt-fg text-xl leading-none disabled:opacity-50"
            aria-label="Close">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <p className="text-xs text-lt-fg3 mb-2">What happened?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setType(o.value)}
                  className={`py-2.5 rounded-lg border text-sm transition-colors ${
                    type === o.value
                      ? 'bg-lt-fg border-lt-fg text-white'
                      : 'bg-lt-inner border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
                  }`}
                >
                  <span className="mr-1">{o.icon}</span>{o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="bulk-notes" className="block text-xs text-lt-fg3 mb-1">
              Notes — these go on every selected contact
            </label>
            <textarea
              id="bulk-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Met at the AFCI mixer — walked through stage availability for Q4."
              className="w-full px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg placeholder:text-lt-fg3"
            />
            <p className="text-[11px] text-lt-fg3 mt-1">
              Write what is true of the whole group. Anything specific to one person is better logged on them.
            </p>
          </div>

          <div>
            <p className="text-xs text-lt-fg3 mb-2">Follow up (optional)</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESETS.map((p) => {
                const value = todayPlusDays(p.days)
                const active = followUp === value
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setFollowUp(active ? '' : value)}
                    className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                      active
                        ? 'bg-lt-fg border-lt-fg text-white'
                        : 'bg-lt-inner border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="px-3 py-2 bg-lt-inner border border-lt-hairline rounded-lg text-sm text-lt-fg"
            />
            {followUp && (
              <p className="text-[11px] text-lt-fg3 mt-1">
                {count} follow-up{count === 1 ? '' : 's'} will come due on this date.
              </p>
            )}
          </div>

          {err && <p className="text-xs text-chip-bad-fg">{err}</p>}
        </div>

        <div className="px-5 py-4 border-t border-lt-hairline shrink-0 flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 rounded-lg border border-lt-hairline text-sm text-lt-fg2 hover:bg-lt-inner disabled:opacity-50">
            Cancel
          </button>
          <button onClick={save} disabled={!notes.trim() || saving}
            className="flex-1 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-lt-inner disabled:text-lt-fg3 text-white text-sm font-medium">
            {saving ? 'Logging…' : `Log on ${count}`}
          </button>
        </div>
      </div>
    </div>
  )
}
