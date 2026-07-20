'use client'

import { useEffect, useState } from 'react'

type Job = {
  id: string
  jobCode: string
  name: string
  assistantAuthCode: string | null
  status: string
  startDate: string | null
  endDate: string | null
}
type AuditRow = {
  id: string
  action: string
  createdAt: string
  ipAddress: string | null
  newValues: Record<string, unknown> | null
}
type EmergencyContact = {
  id: string
  name: string
  role: string
  isEmergencyContact: boolean
  emergencyPhone: string | null
}
type Data = {
  gateCode: string
  gateCodeUpdatedAt: string | null
  gateCodeUpdatedBy: string | null
  jobs: Job[]
  audit: AuditRow[]
  emergencyContacts: EmergencyContact[]
}

function fmt(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return '—'
  }
}

function auditLabel(a: AuditRow): string {
  if (a.action === 'public.access_released') {
    const v = a.newValues || {}
    const gate = v.releasedGate ? 'gate' : null
    const lock = v.releasedLockbox ? `lockbox (${v.vehicle ?? '?'})` : null
    return `Released ${[gate, lock].filter(Boolean).join(' + ') || 'nothing'} · ${v.jobName ?? ''}`
  }
  if (a.action === 'public.access_denied') {
    const v = a.newValues || {}
    return `Denied — ${String(v.reason ?? 'unknown')}`
  }
  if (a.action === 'public.emergency_escalation') {
    const v = a.newValues || {}
    return `⚠ Emergency escalation — released ${String(v.released ?? '?')} number(s)`
  }
  return a.action
}

export default function AssistantAdminPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gateInput, setGateInput] = useState('')
  const [savingGate, setSavingGate] = useState(false)
  const [query, setQuery] = useState('')
  const [regenId, setRegenId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/assistant')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      const d: Data = await res.json()
      setData(d)
      setGateInput(d.gateCode || '')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function saveGate() {
    if (
      !confirm(
        'This only RECORDS the gate code so the assistant can share it with verified drivers — it does NOT reprogram the physical gate. Save this value?',
      )
    )
      return
    setSavingGate(true)
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-gate-code', gateCode: gateInput }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      await load()
    } catch (e) {
      alert('Save failed: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setSavingGate(false)
    }
  }

  async function regen(job: Job) {
    if (
      !confirm(
        `Generate a NEW after-hours code for ${job.jobCode} (${job.name})?\n\nThe old code stops working immediately, and the client will see the new one on their job page.`,
      )
    )
      return
    setRegenId(job.id)
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate-job-code', jobId: job.id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      await load()
    } catch (e) {
      alert('Regenerate failed: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setRegenId(null)
    }
  }

  const jobs = (data?.jobs || []).filter((j) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      j.name.toLowerCase().includes(q) ||
      j.jobCode.toLowerCase().includes(q) ||
      (j.assistantAuthCode || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 max-w-5xl mx-auto text-white">
      <h1 className="text-2xl font-semibold">After-Hours Assistant</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Manage the standing lot gate code, the per-job access codes clients use to verify after
        hours, and review the release log.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-zinc-400">Loading…</div>}

      {data && !loading && (
        <>
          {/* Standing gate code */}
          <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Standing lot gate code
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              This <span className="text-zinc-300">records</span> the code the assistant releases to
              verified drivers. It does <span className="text-zinc-300">not</span> change the gate —
              reprogram the opener at the gate, then update this to match.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                value={gateInput}
                onChange={(e) => setGateInput(e.target.value)}
                placeholder="e.g. 4827#"
                className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-lg tracking-widest text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
              <button
                onClick={saveGate}
                disabled={savingGate || gateInput === (data.gateCode || '')}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingGate ? 'Saving…' : 'Save gate code'}
              </button>
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              Last recorded {fmt(data.gateCodeUpdatedAt)}
              {data.gateCodeUpdatedBy ? ` by ${data.gateCodeUpdatedBy}` : ''}.
            </div>
          </section>

          {/* Per-job codes */}
          <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Per-job access codes
              </h2>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search job, code…"
                className="w-56 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                    <th className="py-2 pr-3 font-medium">Job</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Code</th>
                    <th className="py-2 pr-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-zinc-800">
                      <td className="py-2 pr-3">
                        <div className="text-white">{j.name}</div>
                        <div className="text-xs text-zinc-500">{j.jobCode}</div>
                      </td>
                      <td className="py-2 pr-3 text-zinc-400">{j.status}</td>
                      <td className="py-2 pr-3 font-mono tracking-widest text-amber-300">
                        {j.assistantAuthCode || '—'}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <button
                          onClick={() => regen(j)}
                          disabled={regenId === j.id}
                          className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300 disabled:opacity-40"
                        >
                          {regenId === j.id ? '…' : 'Regenerate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-zinc-500">
                        No jobs match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Emergency contacts */}
          <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Emergency contacts</h2>
            <p className="mt-1 text-xs text-zinc-500">
              On-call staff the assistant <span className="text-zinc-300">texts</span> when a caller declares a genuine
              emergency — so they can review the request and decide whether to call back. Toggle a person on and add
              their emergency (cell) number. Numbers are never shown to callers; every alert is logged below.
              <span className="block mt-1 text-zinc-600">SMS needs Twilio env keys; until then, alerts go out by email.</span>
            </p>
            <div className="mt-3 space-y-2">
              {(data.emergencyContacts || []).map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                  <button
                    role="switch"
                    aria-checked={u.isEmergencyContact}
                    onClick={async () => {
                      await fetch('/api/admin/assistant', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'set-emergency-contact', userId: u.id, isEmergencyContact: !u.isEmergencyContact }),
                      })
                      load()
                    }}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${u.isEmergencyContact ? 'bg-amber-600' : 'bg-zinc-700'}`}
                    title="On-call for emergencies"
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${u.isEmergencyContact ? 'left-6' : 'left-1'}`} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white">{u.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">{u.role}</div>
                  </div>
                  <input
                    defaultValue={u.emergencyPhone ?? ''}
                    placeholder="Emergency phone"
                    onBlur={(e) =>
                      fetch('/api/admin/assistant', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'set-emergency-contact', userId: u.id, emergencyPhone: e.target.value }),
                      })
                    }
                    className="w-44 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm font-mono text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              ))}
              {(data.emergencyContacts || []).length === 0 && <div className="text-sm text-zinc-500">No eligible staff.</div>}
            </div>
          </section>

          {/* Release log */}
          <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Recent access log
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Event</th>
                    <th className="py-2 pr-3 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.id} className="border-t border-zinc-800">
                      <td className="py-2 pr-3 whitespace-nowrap text-zinc-400">{fmt(a.createdAt)}</td>
                      <td className="py-2 pr-3 text-zinc-200">{auditLabel(a)}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{a.ipAddress || '—'}</td>
                    </tr>
                  ))}
                  {data.audit.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-zinc-500">
                        No access requests yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
