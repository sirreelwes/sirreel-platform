'use client'

/**
 * OutreachQuickLogModal — mobile-first "+ Log outreach" sheet for the
 * outside-sales flow. Four taps + notes = saved.
 *
 *   1. Tap a type chip (VISIT / CALL / EMAIL / TEXT / EVENT / DROP_IN)
 *   2. Pick a person (typeahead) — or company-only if just a contact
 *      drop-by — or "Quick add" an inline new contact when not in CRM
 *   3. Type notes
 *   4. Optional: tap a follow-up preset (Tomorrow / 3 days / 1 week /
 *      2 weeks) or pick a date
 *   5. Save
 *
 * Layout:
 *   - Below md (phone): full-screen sheet, big tap targets
 *   - md+ (desktop): centered modal, max-w-lg
 *
 * Pre-link mode: when `presetPerson` or `presetCompany` is passed
 * (from the person/company detail pages), the typeahead is skipped
 * and the target is locked. Frees the rep to skip step 2.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

type OutreachType = 'VISIT' | 'CALL' | 'EMAIL' | 'TEXT' | 'EVENT' | 'DROP_IN'

const TYPE_OPTIONS: { value: OutreachType; label: string; icon: string }[] = [
  { value: 'VISIT', label: 'Visit', icon: '🏢' },
  { value: 'CALL', label: 'Call', icon: '📞' },
  { value: 'EMAIL', label: 'Email', icon: '✉️' },
  { value: 'TEXT', label: 'Text', icon: '💬' },
  { value: 'EVENT', label: 'Event', icon: '🎬' },
  { value: 'DROP_IN', label: 'Drop-in', icon: '🚪' },
]

interface PersonHit {
  id: string
  firstName: string
  lastName: string
  email: string
}
interface CompanyHit {
  id: string
  name: string
}

const PRESETS: { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]

function toInputDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toInputDate(d)
}

export function OutreachQuickLogModal({
  presetPerson,
  presetCompany,
  onClose,
  onSaved,
}: {
  presetPerson?: { id: string; firstName: string; lastName: string; email: string } | null
  presetCompany?: { id: string; name: string } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [type, setType] = useState<OutreachType | null>(null)
  const [notes, setNotes] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Target picker state.
  const [personHits, setPersonHits] = useState<PersonHit[]>([])
  const [companyHits, setCompanyHits] = useState<CompanyHit[]>([])
  const [personQuery, setPersonQuery] = useState('')
  const [companyQuery, setCompanyQuery] = useState(presetCompany?.name ?? '')
  const [pickedPerson, setPickedPerson] = useState<PersonHit | null>(presetPerson ?? null)
  const [pickedCompany, setPickedCompany] = useState<CompanyHit | null>(presetCompany ?? null)

  // Quick-add person form (shown when typeahead returns zero hits and
  // user taps "Quick add").
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [qaFirst, setQaFirst] = useState('')
  const [qaLast, setQaLast] = useState('')
  const [qaEmail, setQaEmail] = useState('')
  const [qaSaving, setQaSaving] = useState(false)

  const locked = !!presetPerson || !!presetCompany

  // Debounced person typeahead.
  useEffect(() => {
    if (locked || pickedPerson) {
      setPersonHits([])
      return
    }
    const q = personQuery.trim()
    if (q.length < 1) {
      setPersonHits([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/persons?q=${encodeURIComponent(q)}`)
        if (!res.ok) return
        const data = await res.json()
        setPersonHits((data.persons ?? []) as PersonHit[])
      } catch {
        /* swallow */
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [personQuery, locked, pickedPerson])

  // Debounced company typeahead.
  useEffect(() => {
    if (locked || pickedCompany) {
      setCompanyHits([])
      return
    }
    const q = companyQuery.trim()
    if (q.length < 2) {
      setCompanyHits([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/companies?search=${encodeURIComponent(q)}`)
        if (!res.ok) return
        const data = await res.json()
        setCompanyHits((data.companies ?? []) as CompanyHit[])
      } catch {
        /* swallow */
      }
    }, 200)
    return () => clearTimeout(handle)
  }, [companyQuery, locked, pickedCompany])

  const canSave = useMemo(() => {
    if (!type) return false
    if (!notes.trim()) return false
    if (!pickedPerson && !pickedCompany) return false
    return true
  }, [type, notes, pickedPerson, pickedCompany])

  const doQuickAdd = useCallback(async () => {
    if (!qaFirst.trim() || !qaLast.trim() || !qaEmail.trim()) {
      setErr('first, last, email required')
      return
    }
    setQaSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/crm/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: qaFirst.trim(),
          lastName: qaLast.trim(),
          email: qaEmail.trim().toLowerCase(),
          role: 'OTHER',
          tier: 'NEW',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error || `quick-add HTTP ${res.status}`)
        return
      }
      setPickedPerson({
        id: data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
      })
      setQuickAddOpen(false)
      setQaFirst(''); setQaLast(''); setQaEmail('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'quick-add failed')
    } finally {
      setQaSaving(false)
    }
  }, [qaFirst, qaLast, qaEmail])

  const save = async () => {
    if (!canSave || !type) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/crm/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          personId: pickedPerson?.id ?? null,
          companyId: pickedCompany?.id ?? null,
          notes: notes.trim(),
          followUpAt: followUp ? new Date(followUp).toISOString() : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      onSaved()
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
          <h3 className="text-base font-semibold text-lt-fg">Log outreach</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-lt-fg2 hover:text-lt-fg px-2 py-1"
          >
            Close ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Type chips */}
          <div>
            <div className="text-xs text-lt-fg3 mb-2">Type</div>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`min-h-[3rem] px-3 py-2 rounded text-sm flex items-center justify-center gap-2 border transition-colors ${
                    type === opt.value
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-lt-inner text-lt-fg border-lt-hairline hover:border-amber-600'
                  }`}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div>
            <div className="text-xs text-lt-fg3 mb-2">Who</div>

            {locked && (
              <div className="text-sm text-lt-fg bg-lt-inner border border-lt-hairline rounded px-3 py-2">
                {presetPerson && (
                  <span>
                    {presetPerson.firstName} {presetPerson.lastName} · {presetPerson.email}
                  </span>
                )}
                {!presetPerson && presetCompany && <span>{presetCompany.name}</span>}
              </div>
            )}

            {!locked && (
              <>
                {/* Person row */}
                <div className="mb-2">
                  {pickedPerson ? (
                    <div className="flex items-center justify-between text-sm bg-lt-inner border border-lt-hairline rounded px-3 py-2">
                      <span className="text-lt-fg">
                        {pickedPerson.firstName} {pickedPerson.lastName}
                        <span className="text-lt-fg3 ml-1">· {pickedPerson.email}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => { setPickedPerson(null); setPersonQuery('') }}
                        className="text-xs text-lt-fg2 hover:text-lt-fg"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={personQuery}
                        onChange={(e) => setPersonQuery(e.target.value)}
                        placeholder="Search person…"
                        className="w-full bg-lt-inner border border-lt-hairline rounded px-3 py-2 text-sm text-lt-fg"
                        autoComplete="off"
                      />
                      {personHits.length > 0 && (
                        <div className="mt-1 border border-lt-hairline rounded bg-lt-card divide-y divide-lt-hairline max-h-64 overflow-y-auto">
                          {personHits.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => { setPickedPerson(p); setPersonQuery('') }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-lt-inner"
                            >
                              <div className="text-lt-fg">{p.firstName} {p.lastName}</div>
                              <div className="text-xs text-lt-fg3">{p.email}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {personQuery.trim().length > 0 && personHits.length === 0 && !quickAddOpen && (
                        <button
                          type="button"
                          onClick={() => {
                            // Seed the quick-add form from the typeahead query.
                            const parts = personQuery.trim().split(/\s+/)
                            setQaFirst(parts[0] ?? '')
                            setQaLast(parts.slice(1).join(' '))
                            setQuickAddOpen(true)
                          }}
                          className="mt-1 text-xs text-amber-500 hover:text-amber-400"
                        >
                          + Quick add &ldquo;{personQuery}&rdquo;
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Quick-add inline form */}
                {quickAddOpen && (
                  <div className="border border-lt-hairline rounded p-3 mb-2 bg-lt-inner/40 space-y-2">
                    <div className="text-xs text-lt-fg3">Quick add new contact</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={qaFirst}
                        onChange={(e) => setQaFirst(e.target.value)}
                        placeholder="First"
                        className="bg-lt-inner border border-lt-hairline rounded px-2 py-1.5 text-sm text-lt-fg"
                      />
                      <input
                        value={qaLast}
                        onChange={(e) => setQaLast(e.target.value)}
                        placeholder="Last"
                        className="bg-lt-inner border border-lt-hairline rounded px-2 py-1.5 text-sm text-lt-fg"
                      />
                    </div>
                    <input
                      value={qaEmail}
                      onChange={(e) => setQaEmail(e.target.value)}
                      placeholder="Email"
                      type="email"
                      className="w-full bg-lt-inner border border-lt-hairline rounded px-2 py-1.5 text-sm text-lt-fg"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setQuickAddOpen(false)}
                        disabled={qaSaving}
                        className="px-2 py-1 text-xs text-lt-fg2"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={doQuickAdd}
                        disabled={qaSaving}
                        className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
                      >
                        {qaSaving ? 'Adding…' : 'Add contact'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Company row */}
                <div>
                  {pickedCompany ? (
                    <div className="flex items-center justify-between text-sm bg-lt-inner border border-lt-hairline rounded px-3 py-2">
                      <span className="text-lt-fg">{pickedCompany.name}</span>
                      <button
                        type="button"
                        onClick={() => { setPickedCompany(null); setCompanyQuery('') }}
                        className="text-xs text-lt-fg2 hover:text-lt-fg"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={companyQuery}
                        onChange={(e) => setCompanyQuery(e.target.value)}
                        placeholder="Search company (optional)…"
                        className="w-full bg-lt-inner border border-lt-hairline rounded px-3 py-2 text-sm text-lt-fg"
                        autoComplete="off"
                      />
                      {companyHits.length > 0 && (
                        <div className="mt-1 border border-lt-hairline rounded bg-lt-card divide-y divide-lt-hairline max-h-64 overflow-y-auto">
                          {companyHits.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setPickedCompany(c); setCompanyQuery('') }}
                              className="w-full text-left px-3 py-2 text-sm text-lt-fg hover:bg-lt-inner"
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Notes */}
          <div>
            <div className="text-xs text-lt-fg3 mb-2">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="What did you cover?"
              className="w-full bg-lt-inner border border-lt-hairline rounded px-3 py-2 text-sm text-lt-fg resize-none"
            />
          </div>

          {/* Follow-up */}
          <div>
            <div className="text-xs text-lt-fg3 mb-2">Follow up (optional)</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setFollowUp(todayPlusDays(p.days))}
                  className={`min-h-[2.5rem] px-3 py-1.5 rounded text-sm border transition-colors ${
                    followUp === todayPlusDays(p.days)
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-lt-inner text-lt-fg border-lt-hairline hover:border-amber-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFollowUp('')}
                className={`min-h-[2.5rem] px-3 py-1.5 rounded text-sm border ${
                  followUp ? 'text-lt-fg2 border-lt-hairline hover:text-lt-fg' : 'opacity-50 border-lt-hairline'
                }`}
              >
                None
              </button>
            </div>
            <input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="w-full bg-lt-inner border border-lt-hairline rounded px-3 py-2 text-sm text-lt-fg"
            />
          </div>

          {err && (
            <div className="text-sm text-chip-bad-fg bg-chip-bad-bg/30 px-3 py-2 rounded">{err}</div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-lt-hairline flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || saving}
            className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
