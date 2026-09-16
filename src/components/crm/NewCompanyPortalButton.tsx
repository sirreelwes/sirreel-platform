'use client'

/**
 * "New portal" on /crm/portals — open an account portal without a session
 * running scripts (Wes 2026-09-16).
 *
 * One form: the company, the people who get a seat, and optionally "same
 * deal as <another account>". Nothing is emailed from here. On success the
 * page reloads with the new row OPEN, where the existing panels file the
 * logo (upload or From website) and send the reviewed invite.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { CompanyPicker } from '@/components/orders/CompanyPicker'

const ROLES: { value: string; label: string }[] = [
  { value: 'HEAD_OF_PRODUCTION', label: 'Head of Production' },
  { value: 'EXECUTIVE', label: 'Executive' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'OTHER', label: 'Other' },
]

export interface DealSource {
  companyId: string
  name: string
  rates: number
  discounts: number
}

interface PersonDraft {
  name: string
  email: string
  title: string
  role: string
}

const blankPerson = (): PersonDraft => ({ name: '', email: '', title: '', role: 'HEAD_OF_PRODUCTION' })

const input =
  'w-full bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-lt-fg3'

export function NewCompanyPortalButton({ dealSources }: { dealSources: DealSource[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null)
  const [people, setPeople] = useState<PersonDraft[]>([blankPerson()])
  const [copyFrom, setCopyFrom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setCompany(null)
    setPeople([blankPerson()])
    setCopyFrom('')
    setError(null)
  }
  const close = () => {
    if (saving) return
    setOpen(false)
    reset()
  }

  const setPerson = (i: number, patch: Partial<PersonDraft>) =>
    setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const validPeople = people.filter((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()))
  const canSubmit = !!company && validPeople.length > 0 && !saving

  const submit = async () => {
    if (!company) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/portals/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          grants: validPeople.map((p) => ({
            email: p.email.trim(),
            name: p.name.trim() || null,
            title: p.title.trim() || null,
            role: p.role,
          })),
          copyDealFrom: copyFrom || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.reason || data.error || 'Could not create the portal.')
        setSaving(false)
        return
      }
      setOpen(false)
      reset()
      setSaving(false)
      router.push(`/crm/portals?open=${company.id}#company`)
      router.refresh()
    } catch {
      setError('Network error — nothing may have saved. Reload before trying again.')
      setSaving(false)
    }
  }

  const source = dealSources.find((d) => d.companyId === copyFrom)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold"
      >
        <Plus className="w-4 h-4" />
        New portal
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/70 md:px-4 md:py-8">
          <div className="bg-lt-card w-full h-full md:h-auto md:max-h-[90vh] md:max-w-xl md:rounded-xl md:border md:border-lt-hairline flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-lt-hairline shrink-0">
              <h3 className="text-base font-semibold text-lt-fg">New production company portal</h3>
              <button type="button" onClick={close} disabled={saving} className="text-sm text-lt-fg2 hover:text-lt-fg px-2 py-1">
                Close
              </button>
            </div>

            <div className="px-5 py-4 space-y-5 overflow-y-auto">
              <section>
                <label className="block text-[11px] uppercase font-semibold tracking-[1.4px] text-lt-fg3 mb-1.5">
                  Production company
                </label>
                <CompanyPicker
                  tone="light"
                  value={company?.id ?? null}
                  selectedName={company?.name ?? null}
                  onChange={(id, name) => setCompany(id ? { id, name } : null)}
                />
                <p className="text-xs text-lt-fg3 mt-1.5">
                  If the company shows up twice, merge the records at /admin/dedup first. The portal only shows jobs on the record you pick.
                </p>
              </section>

              <section>
                <label className="block text-[11px] uppercase font-semibold tracking-[1.4px] text-lt-fg3 mb-1.5">
                  Who gets access
                </label>
                <div className="space-y-3">
                  {people.map((p, i) => (
                    <div key={i} className="border border-lt-hairline rounded-lg p-3 bg-lt-inner space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className={input} placeholder="Name" value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
                        <input
                          className={input}
                          placeholder="Email"
                          type="email"
                          value={p.email}
                          onChange={(e) => setPerson(i, { email: e.target.value })}
                        />
                        <input className={input} placeholder="Title (optional)" value={p.title} onChange={(e) => setPerson(i, { title: e.target.value })} />
                        <div className="flex gap-2">
                          <select className={input} value={p.role} onChange={(e) => setPerson(i, { role: e.target.value })}>
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          {people.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}
                              className="text-lt-fg3 hover:text-chip-bad-fg px-1"
                              title="Remove"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setPeople((ps) => [...ps, blankPerson()])}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-lt-fg2 hover:text-lt-fg"
                >
                  <Plus className="w-3.5 h-3.5" /> Add another person
                </button>
              </section>

              <section>
                <label className="block text-[11px] uppercase font-semibold tracking-[1.4px] text-lt-fg3 mb-1.5">
                  Deal
                </label>
                <select className={input} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                  <option value="">No deal yet (set rates later on the portal)</option>
                  {dealSources.map((d) => (
                    <option key={d.companyId} value={d.companyId} disabled={d.companyId === company?.id}>
                      Same deal as {d.name} ({d.rates} rate{d.rates === 1 ? '' : 's'}, {d.discounts} discount{d.discounts === 1 ? '' : 's'})
                    </option>
                  ))}
                </select>
                {source && (
                  <p className="text-xs text-lt-fg3 mt-1.5">
                    Copies {source.name}&apos;s rates and discounts as they stand today. Anything this company already has on the same item or department is kept.
                  </p>
                )}
              </section>

              <p className="text-xs text-lt-fg2 bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2">
                Nothing is emailed. Next, the new portal opens below so you can add the logo and send the invite when you&apos;re ready.
              </p>

              {error && <p className="text-sm text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2">{error}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-lt-hairline shrink-0">
              <button type="button" onClick={close} disabled={saving} className="px-3 py-2 text-sm text-lt-fg2 hover:text-lt-fg">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Create portal
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
