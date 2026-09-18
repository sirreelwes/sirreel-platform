'use client'

import { useState } from 'react'
import type { BrokerListRow } from '@/lib/coi/brokerDirectory'

/**
 * The broker list, with the two edits a person actually makes: add one we
 * know, and correct one a certificate read wrong.
 *
 * A hand edit is the `MANUAL` source server-side — the only one allowed to
 * REPLACE a field rather than fill a blank, so a name someone fixes here
 * survives the next certificate whose producer box says "Certificates Dept".
 */

type Row = Omit<BrokerListRow, 'lastSeenAt' | 'lastContactedAt'> & {
  lastSeenAt: string | Date | null
  lastContactedAt: string | Date | null
}

const fmt = (d: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const SOURCE_LABEL: Record<string, string> = {
  CERTIFICATE: 'on their certificate',
  CONTACTED: 'we wrote to them',
  MANUAL: 'added by hand',
}

export function BrokerDirectory({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const [form, setForm] = useState({ email: '', name: '', agency: '', phone: '', notes: '' })

  const reload = async () => {
    const res = await fetch('/api/brokers?all=1')
    const d = await res.json().catch(() => ({}))
    if (d?.ok) setRows(d.brokers)
  }

  const save = async (body: Record<string, unknown>, method: 'POST' | 'PATCH') => {
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      const res = await fetch('/api/brokers', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d?.ok) {
        setError(d?.error || 'That did not save.')
        return false
      }
      await reload()
      setFlash(method === 'POST' ? (d.merged ? 'Already on the list — updated.' : 'Broker added.') : 'Saved.')
      return true
    } catch {
      setError('That did not save.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const visible = q.trim()
    ? rows.filter((r) =>
        [r.email, r.name, r.agency].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase()),
      )
    : rows

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, agency or email"
          className="flex-1 min-w-[220px] rounded-lg border border-lt-hairline bg-lt-card px-3 py-2 text-base text-lt-fg placeholder:text-lt-fg3"
        />
        <button
          onClick={() => {
            setAdding((v) => !v)
            setEditing(null)
            setForm({ email: '', name: '', agency: '', phone: '', notes: '' })
          }}
          className="rounded-lg bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-semibold text-white"
        >
          {adding ? 'Cancel' : 'Add a broker'}
        </button>
      </div>

      {error && <p className="text-sm text-chip-bad-fg bg-chip-bad-bg rounded-lg px-3 py-2">{error}</p>}
      {flash && <p className="text-sm text-chip-good-fg bg-chip-good-bg rounded-lg px-3 py-2">{flash}</p>}

      {adding && (
        <div className="rounded-lg border border-lt-hairline bg-lt-card p-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-lt-fg3">New broker</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Email (required)" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="agent@brokerage.com" />
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Barbara Wagner" />
            <Field label="Agency" value={form.agency} onChange={(v) => setForm({ ...form, agency: v })} placeholder="Leave blank unless you know it" />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="(555) 555-5555" />
          </div>
          <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} placeholder="Which client, who told us" />
          <p className="text-xs text-lt-fg3">
            The email is how a broker is identified &mdash; adding one we already hold updates it instead of
            making a second row. Which clients they act for is recorded automatically as certificates come in.
          </p>
          <button
            onClick={async () => {
              if (await save({ ...form }, 'POST')) {
                setAdding(false)
                setForm({ email: '', name: '', agency: '', phone: '', notes: '' })
              }
            }}
            disabled={busy || !form.email.trim()}
            className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
          >
            {busy ? 'Saving…' : 'Add to the list'}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-lt-fg2 border border-lt-hairline rounded-lg bg-lt-card px-4 py-6 text-center">
          {rows.length === 0
            ? 'No brokers on the list yet. One is recorded every time a certificate names their producer box, or you send a broker a review link.'
            : 'None match that search.'}
        </p>
      ) : (
        <div className="border border-lt-hairline rounded-lg overflow-x-auto bg-lt-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide bg-lt-inner/50">
                <th className="px-3 py-2 font-semibold">Broker</th>
                <th className="px-3 py-2 font-semibold">Clients</th>
                <th className="px-3 py-2 font-semibold">Last seen</th>
                <th className="px-3 py-2 font-semibold">We wrote</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr key={b.id} className={`border-b border-lt-hairline last:border-0 ${b.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-semibold text-lt-fg">{b.name || b.email}</div>
                    {b.agency && <div className="text-lt-fg2">{b.agency}</div>}
                    <a href={`mailto:${b.email}`} className="text-lt-fg2 underline">
                      {b.email}
                    </a>
                    {b.phone && <div className="text-lt-fg3">{b.phone}</div>}
                    {!b.isActive && <div className="text-xs text-lt-fg3 mt-0.5">Inactive</div>}
                    {b.notes && <div className="text-xs text-lt-fg3 mt-1 max-w-[36ch]">{b.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top text-lt-fg2">
                    {b.clients.length === 0 ? (
                      <span className="text-lt-fg3">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {b.clients.map((c) => (
                          <li key={c.companyId}>
                            {c.companyName ?? 'a client no longer on file'}
                            <span className="text-lt-fg3"> · {SOURCE_LABEL[c.source] ?? c.source}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-lt-fg2 whitespace-nowrap">{fmt(b.lastSeenAt)}</td>
                  <td className="px-3 py-2.5 align-top text-lt-fg2 whitespace-nowrap">
                    {fmt(b.lastContactedAt)}
                    {b.timesContacted > 0 && (
                      <span className="text-lt-fg3"> · {b.timesContacted}×</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                    <button
                      onClick={() => {
                        setAdding(false)
                        setEditing(editing === b.id ? null : b.id)
                        setForm({
                          email: b.email,
                          name: b.name ?? '',
                          agency: b.agency ?? '',
                          phone: b.phone ?? '',
                          notes: b.notes ?? '',
                        })
                      }}
                      className="text-sm font-semibold text-amber-700 hover:text-amber-600"
                    >
                      {editing === b.id ? 'Close' : 'Edit'}
                    </button>
                    {editing === b.id && (
                      <div className="mt-2 text-left space-y-2 border-t border-lt-hairline pt-2">
                        <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                        <Field label="Agency" value={form.agency} onChange={(v) => setForm({ ...form, agency: v })} />
                        <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                        <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={async () => {
                              if (
                                await save(
                                  { id: b.id, name: form.name, agency: form.agency, phone: form.phone, notes: form.notes },
                                  'PATCH',
                                )
                              )
                                setEditing(null)
                            }}
                            disabled={busy}
                            className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold text-white"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => save({ id: b.id, isActive: !b.isActive }, 'PATCH')}
                            disabled={busy}
                            className="rounded-lg border border-lt-hairline px-3 py-1.5 text-sm font-semibold text-lt-fg2 hover:bg-lt-inner"
                          >
                            {b.isActive ? 'Mark inactive' : 'Reactivate'}
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs text-lt-fg3 mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        /* 16px so iOS Safari doesn't zoom on focus — this gets read on a phone. */
        className="w-full rounded-lg border border-lt-hairline bg-lt-card px-3 py-2 text-base text-lt-fg placeholder:text-lt-fg3"
      />
    </label>
  )
}
