'use client'

import { useEffect, useState } from 'react'
import { VISIT_GAP_MINUTES } from '@/lib/assistant/usageSummary'

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
type Usage = {
  totals: { attempts: number; released: number; denied: number; escalations: number; lockoutRate: number | null }
  last30Days: { attempts: number; released: number; denied: number }
  denialReasons: { reason: string; label: string; count: number }[]
  factorFailures: { factor: string; failed: number; checked: number }[]
  visits: {
    startedAt: string
    endedAt: string
    attempts: number
    outcome: 'released' | 'denied' | 'escalated'
    reasons: string[]
    vehicle: string | null
    jobName: string | null
  }[]
  byHour: number[]
  firstUsedAt: string | null
  lastUsedAt: string | null
}
type Data = {
  gateCode: string
  gateCodeUpdatedAt: string | null
  gateCodeUpdatedBy: string | null
  jobs: Job[]
  audit: AuditRow[]
  usage: Usage
  smsConfigured?: boolean
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

/**
 * Outcome-first. A count of "uses" would have read as healthy traffic while
 * most of that traffic was people failing to get in — so the lockout rate
 * leads, and the reasons sit next to it because they are the fixable part.
 */
function UsageSection({ usage }: { usage: Usage }) {
  const { totals, last30Days, denialReasons, factorFailures, visits, byHour } = usage
  const lockoutPct = totals.lockoutRate == null ? null : Math.round(totals.lockoutRate * 100)
  const peak = Math.max(1, ...byHour)
  const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`)

  return (
    <section className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Assistant usage</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Grouped into visits — repeated tries within {VISIT_GAP_MINUTES} minutes are one person, not
        several. Times
        are Pacific.
      </p>

      {totals.attempts === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">No one has used the assistant yet.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div
              className={`rounded-lg border p-3 ${
                lockoutPct != null && lockoutPct >= 50
                  ? 'border-red-600 bg-red-950/40'
                  : 'border-zinc-700 bg-zinc-950'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">Turned away</div>
              <div
                className={`mt-1 text-2xl font-semibold ${
                  lockoutPct != null && lockoutPct >= 50 ? 'text-red-300' : 'text-white'
                }`}
              >
                {lockoutPct == null ? '—' : `${lockoutPct}%`}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">of visits ended without access</div>
            </div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">Visits</div>
              <div className="mt-1 text-2xl font-semibold">{visits.length}</div>
              <div className="mt-1 text-[11px] text-zinc-500">{totals.attempts} attempts total</div>
            </div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">Released</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-400">{totals.released}</div>
              <div className="mt-1 text-[11px] text-zinc-500">{totals.denied} denials</div>
            </div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">Last 30 days</div>
              <div className="mt-1 text-2xl font-semibold">{last30Days.attempts}</div>
              <div className="mt-1 text-[11px] text-zinc-500">
                {last30Days.released} in · {last30Days.denied} denied
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">Why people were denied</div>
              {denialReasons.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No denials.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {denialReasons.map((r) => (
                    <li key={r.reason} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-zinc-300">{r.label}</span>
                      <span className="font-mono text-zinc-400">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              {factorFailures.length > 0 && (
                <>
                  <div className="mt-4 text-[11px] uppercase tracking-wider text-zinc-400">
                    Which detail they could not give
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {factorFailures.map((f) => (
                      <li key={f.factor} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-zinc-300">{f.factor}</span>
                        <span className="font-mono text-zinc-400">
                          {f.failed}/{f.checked} wrong
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">
                When it is used (Pacific)
              </div>
              <div className="mt-2 flex h-24 items-end gap-[2px]">
                {byHour.map((n, h) => (
                  <div key={h} className="flex-1" title={`${hourLabel(h)} — ${n} attempt${n === 1 ? '' : 's'}`}>
                    <div
                      className={`w-full rounded-sm ${n > 0 ? 'bg-amber-600' : 'bg-zinc-800'}`}
                      style={{ height: `${Math.max(n > 0 ? 8 : 2, (n / peak) * 96)}px` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
                <span>12a</span>
                <span>6a</span>
                <span>12p</span>
                <span>6p</span>
                <span>11p</span>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">Recent visits</div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {visits.slice(0, 10).map((v) => (
                    <tr key={v.startedAt} className="border-t border-zinc-800">
                      <td className="py-2 pr-3 text-zinc-400 whitespace-nowrap">{fmt(v.startedAt)}</td>
                      <td className="py-2 pr-3">
                        {v.outcome === 'released' ? (
                          <span className="text-emerald-400">Got in</span>
                        ) : v.outcome === 'escalated' ? (
                          <span className="text-amber-300">Escalated</span>
                        ) : (
                          <span className="text-red-300">Turned away</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-zinc-400">
                        {v.attempts} {v.attempts === 1 ? 'try' : 'tries'}
                      </td>
                      <td className="py-2 pr-3 text-zinc-400">{v.vehicle || v.jobName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
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
          {/* Nobody on call means every escalation silently degrades to an
              email to hq@ that no one reads at 1am. The assistant can only
              hand a stranded driver a person if a person is reachable. */}
          {data.emergencyContacts.filter((c) => c.isEmergencyContact && c.emergencyPhone).length === 0 && (
            <div className="mt-6 rounded-xl border border-red-600 bg-red-950/40 p-4">
              <div className="text-sm font-semibold text-red-200">No on-call contact is set</div>
              <p className="mt-1 text-xs text-red-200/80">
                A driver stuck at the lot cannot be put through to anyone. Escalations fall back to
                an email to hq@ instead of a text. Set someone as an emergency contact with a mobile
                number below.
              </p>
            </div>
          )}

          {/* Text messaging is the whole delivery mechanism. Without Twilio
              the alert degrades to an email nobody reads at 1am, and the
              assistant still tells the driver the team "has been texted". */}
          {data.smsConfigured === false && (
            <div className="mt-6 rounded-xl border border-amber-600 bg-amber-950/30 p-4">
              <div className="text-sm font-semibold text-amber-200">Text messaging is not set up</div>
              <p className="mt-1 text-xs text-amber-200/80">
                On-call alerts fall back to email to hq@ — nobody gets a text. Add
                TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in Vercel to turn on
                SMS.
              </p>
            </div>
          )}

          {/* Usage — placed first because it answers the question the log
              below cannot: whether people who try this actually get in. */}
          {data.usage && <UsageSection usage={data.usage} />}

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
                    {/* On-call with no number is the silent half-state: the row
                        reads as covered while the alert query skips them. */}
                    {u.isEmergencyContact && !u.emergencyPhone ? (
                      <div className="text-[10px] uppercase tracking-wider text-red-300">
                        {u.role} · no number — will not be texted
                      </div>
                    ) : (
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{u.role}</div>
                    )}
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
