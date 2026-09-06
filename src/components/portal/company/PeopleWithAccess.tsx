'use client'

/**
 * "People with access" — who can open this account, and adding a colleague.
 *
 * Wes 2026-09-06: "even though there is no password, only Ding Ding can
 * currently access and if she wants to add people she can do so in her
 * portal."
 *
 * The list is the reassurance ("no password" needs "and here is exactly
 * who can get in" next to it); the form is the one action. Nobody can be
 * removed here — that stays with the rep, and the copy says so.
 *
 * `preview` renders the same thing for HQ's "see what they see" with the
 * form inert.
 */

import { useState } from 'react'
import { Check, Loader2, Plus, UserPlus, X } from 'lucide-react'
import { PORTAL } from '@/lib/brand/portalTokens'

export interface PortalPerson {
  accessId: string
  name: string
  email: string
  title: string | null
  role: string
  isYou: boolean
  addedByName: string | null
  invitedAt: string | null
  lastOpenedAt: string | null
}

const ROLE_LABEL: Record<string, string> = {
  EXECUTIVE: 'Executive',
  HEAD_OF_PRODUCTION: 'Head of Production',
  FINANCE: 'Finance',
  OTHER: 'Team',
}

interface Draft {
  email: string
  name: string
  title: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function PeopleWithAccess({
  companyId,
  initial,
  preview = false,
}: {
  companyId: string
  initial: PortalPerson[]
  preview?: boolean
}) {
  const [people, setPeople] = useState<PortalPerson[]>(initial)
  const [adding, setAdding] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([{ email: '', name: '', title: '' }])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valid = drafts.filter((d) => EMAIL_RE.test(d.email.trim()))

  async function submit() {
    if (preview || valid.length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/portal/company/${companyId}/people`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          people: valid.map((d) => ({
            email: d.email.trim(),
            name: d.name.trim() || null,
            title: d.title.trim() || null,
          })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || "That didn't go through.")
      setPeople(json.people || people)
      const bits: string[] = []
      if (json.added) bits.push(`${json.added} added`)
      if (json.invited) bits.push(`${json.invited} emailed an invite`)
      if (json.alreadyHad) bits.push(`${json.alreadyHad} already had access`)
      setNotice(bits.join(' · ') || 'Done.')
      setDrafts([{ email: '', name: '', title: '' }])
      setAdding(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-zinc-100 flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-zinc-600 leading-relaxed max-w-[58ch]">
          There&apos;s no password on this portal — access is by invitation. These are the only
          people who can open the account. Add a colleague and they&apos;ll get an email like the
          one you did; to remove someone, tell your rep.
        </p>
        {!adding && (
          <button
            type="button"
            onClick={() => !preview && setAdding(true)}
            disabled={preview}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: PORTAL.dark }}
            title={preview ? 'Disabled in preview' : undefined}
          >
            <UserPlus className="w-3.5 h-3.5" /> Add a colleague
          </button>
        )}
      </div>

      {adding && (
        <div className="p-5 border-b border-zinc-100 bg-zinc-50">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase font-semibold tracking-wider text-zinc-400">
              Add people — name and title optional
            </div>
            <button
              type="button"
              onClick={() => {
                setDrafts([{ email: '', name: '', title: '' }])
                setAdding(false)
              }}
              className="text-zinc-400 hover:text-zinc-900"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={d.email}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))
                  }
                  placeholder="name@yourcompany.com"
                  type="email"
                  className="text-sm border border-zinc-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-zinc-900"
                />
                <input
                  value={d.name}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                  }
                  placeholder="Name (optional)"
                  className="text-sm border border-zinc-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-zinc-900"
                />
                <input
                  value={d.title}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))
                  }
                  placeholder="Title (optional)"
                  className="text-sm border border-zinc-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-zinc-900"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <button
              type="button"
              onClick={() => setDrafts((prev) => [...prev, { email: '', name: '', title: '' }])}
              className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-black"
            >
              <Plus className="w-3.5 h-3.5" /> Another
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || valid.length === 0}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40"
              style={{ backgroundColor: PORTAL.dark }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {busy ? 'Adding…' : valid.length > 1 ? `Add ${valid.length} people` : 'Add and send invite'}
            </button>
            <span className="text-xs text-zinc-500">They&apos;ll be emailed right away.</span>
          </div>
          {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
        </div>
      )}

      {notice && (
        <p className="px-5 py-2 text-sm text-emerald-700 inline-flex items-center gap-1.5 border-b border-zinc-100 w-full">
          <Check className="w-4 h-4" /> {notice}
        </p>
      )}
      {error && !adding && <p className="px-5 py-2 text-sm text-red-700 border-b border-zinc-100">{error}</p>}

      <div className="divide-y divide-zinc-100">
        {people.map((p) => (
          <div key={p.accessId} className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 truncate">
                {p.name}
                {p.isYou && (
                  <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-900 text-white align-middle">
                    YOU
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 truncate">
                {p.email}
                {' · '}
                {p.title || ROLE_LABEL[p.role] || p.role}
              </div>
            </div>
            <div className="text-[11px] text-zinc-400 text-right shrink-0">
              {p.addedByName ? <div>added by {p.addedByName}</div> : null}
              <div>
                {p.lastOpenedAt
                  ? `opened ${new Date(p.lastOpenedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : p.invitedAt
                    ? 'invited, not opened yet'
                    : 'not yet invited'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
