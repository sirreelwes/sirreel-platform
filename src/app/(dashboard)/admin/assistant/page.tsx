'use client'

import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { VISIT_GAP_MINUTES } from '@/lib/assistant/usageSummary'
import { LEVEL_CAPABILITIES } from '@/lib/assistant/access'
import { HqAssistantPanel } from '@/components/admin/HqAssistantPanel'

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
  phone: string | null
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
type RecognizedNumber = {
  tier: 'staff' | 'contact' | 'driver' | 'grant' | 'blocked'
  level: 'blocked' | 'public' | 'contact' | 'staff' | 'admin'
  tail: string
  phone: string
  name: string
  reason: string
  grants: string
  manageHref: string
  manageLabel: string
  until: string | null
  jobCode?: string | null
  jobName?: string | null
  unit?: string | null
  grantId?: string | null
  note?: string | null
}
type Me = { level: string; firstName: string | null; isAdmin: boolean }
type Data = {
  gateCode: string
  gateCodeUpdatedAt: string | null
  gateCodeUpdatedBy: string | null
  containerCode: string
  containerCodeUpdatedAt: string | null
  jobs: Job[]
  audit: AuditRow[]
  usage: Usage
  smsConfigured?: boolean
  smsProblem?: string | null
  emergencyContacts: EmergencyContact[]
  recognized?: RecognizedNumber[]
  me?: Me
}

/**
 * Every section on this page is a disclosure. Wes (2026-09-10): "I don't
 * need all the AHA data in a window" — the recognised-numbers table alone
 * ran to several screens. Only the codes open by default; everything else
 * shows its count in the header and opens on demand. Native <details>, so
 * nothing is remembered between visits (no browser storage in components).
 */
function Panel({ title, summary, defaultOpen, children }: { title: string; summary?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group mt-4 rounded-xl border border-zinc-700 bg-zinc-900 text-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
          {title}
        </span>
        {summary != null && <span className="text-right text-xs text-zinc-500">{summary}</span>}
      </summary>
      <div className="border-t border-zinc-800 px-5 pb-5 pt-3">{children}</div>
    </details>
  )
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
    return `Emergency escalation — released ${String(v.released ?? '?')} number(s)`
  }
  return a.action
}

/**
 * Outcome-first. A count of "uses" would have read as healthy traffic while
 * most of that traffic was people failing to get in — so the lockout rate
 * leads, and the reasons sit next to it because they are the fixable part.
 */
const TIER_LABEL: Record<RecognizedNumber['tier'], { label: string; chip: string; blurb: string }> = {
  grant: { label: 'Added by hand', chip: 'bg-violet-600/20 text-violet-300 border-violet-600/40', blurb: 'A person put on the list here' },
  blocked: { label: 'Blocked', chip: 'bg-red-600/20 text-red-300 border-red-600/40', blurb: 'Taken off the list here' },
  staff: { label: 'HQ user', chip: 'bg-amber-600/20 text-amber-300 border-amber-600/40', blurb: 'Level follows their HQ role' },
  contact: { label: 'Production contact', chip: 'bg-sky-600/20 text-sky-300 border-sky-600/40', blurb: 'Own job, message to agent, that job’s truck codes' },
  driver: { label: 'Checkout driver', chip: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40', blurb: 'That truck’s codes' },
}

const LEVEL_CHIP: Record<RecognizedNumber['level'], string> = {
  admin: 'bg-amber-600/20 text-amber-200 border-amber-500/50',
  staff: 'bg-amber-600/10 text-amber-300 border-amber-600/30',
  contact: 'bg-sky-600/20 text-sky-300 border-sky-600/40',
  public: 'bg-zinc-700/40 text-zinc-300 border-zinc-600',
  blocked: 'bg-red-600/20 text-red-300 border-red-600/40',
}

/**
 * Put a person on the list by hand, or take one off. Admin only. A number
 * that already has a hand-made row is replaced (one active row per number);
 * an HQ user or job contact can be BLOCKED the same way — the block wins.
 */
function AddNumberForm({ onDone, preset }: { onDone: () => void; preset?: { name: string; phone: string; level: string } | null }) {
  const [name, setName] = useState(preset?.name ?? '')
  const [phone, setPhone] = useState(preset?.phone ?? '')
  const [level, setLevel] = useState(preset?.level ?? 'STAFF')
  const [jobCode, setJobCode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (preset) { setName(preset.name); setPhone(preset.phone); setLevel(preset.level) }
  }, [preset])

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-grant', name, phone, level, jobCode: jobCode || undefined, note: note || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'Could not save.'); return }
      setName(''); setPhone(''); setJobCode(''); setNote('')
      onDone()
    } finally { setBusy(false) }
  }

  const input = 'rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none'
  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="text-[11px] uppercase tracking-wider text-zinc-400">Add a person · or block one</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${input} w-44`} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" className={`${input} w-40 font-mono`} />
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={`${input} w-48`}>
          <option value="ADMIN">Admin — everything, incl. platform memory</option>
          <option value="STAFF">Staff — fleet + job lookups</option>
          <option value="CONTACT">Production contact — one job</option>
          <option value="BLOCKED">Blocked — nothing</option>
        </select>
        {level === 'CONTACT' && <input value={jobCode} onChange={(e) => setJobCode(e.target.value)} placeholder="Job code (SR-JOB-0231)" className={`${input} w-44 font-mono`} />}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" className={`${input} w-56`} />
        <button
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !phone.trim()}
          className={`rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 ${level === 'BLOCKED' ? 'bg-red-700 hover:bg-red-600' : 'bg-amber-600 hover:bg-amber-500'}`}
        >
          {level === 'BLOCKED' ? 'Block' : 'Add'}
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}
      <div className="mt-2 text-[11px] text-zinc-600">
        HQ users get their level from their role automatically — add them here only to give a different level or to block. Every change is audited.
      </div>
    </div>
  )
}

function fmtDay(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return '—' }
}

function fmtTail(tail: string): string {
  return `(${tail.slice(0, 3)}) ${tail.slice(3, 6)}-${tail.slice(6)}`
}

/**
 * Who AHA recognises, by number — read from the same facts the live checks
 * use, so this list IS the access. Nothing is granted here; each row says
 * where the number lives and links there.
 */
function RecognizedSection({ rows, isAdmin, onChanged }: { rows: RecognizedNumber[]; isAdmin: boolean; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<'all' | RecognizedNumber['tier']>('all')
  const [preset, setPreset] = useState<{ name: string; phone: string; level: string } | null>(null)
  const [rowErr, setRowErr] = useState<string | null>(null)

  async function revoke(grantId: string) {
    setRowErr(null)
    const res = await fetch('/api/admin/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke-grant', grantId }),
    })
    if (!res.ok) { const j = await res.json().catch(() => ({})); setRowErr(j.error || 'Could not remove.'); return }
    onChanged()
  }
  const digits = q.replace(/\D/g, '')
  const needle = q.trim().toLowerCase()
  const shown = rows.filter((r) => {
    if (tier !== 'all' && r.tier !== tier) return false
    if (!needle) return true
    if (digits.length >= 3 && r.tail.includes(digits)) return true
    return r.name.toLowerCase().includes(needle) || (r.jobCode ?? '').toLowerCase().includes(needle) || (r.jobName ?? '').toLowerCase().includes(needle) || (r.unit ?? '').toLowerCase().includes(needle)
  })
  const counts = { grant: 0, blocked: 0, staff: 0, contact: 0, driver: 0 } as Record<RecognizedNumber['tier'], number>
  for (const r of rows) counts[r.tier]++
  const distinct = new Set(rows.map((r) => r.tail)).size

  return (
    <Panel
      title="Who AHA recognises"
      summary={`${distinct} number${distinct === 1 ? '' : 's'}${counts.blocked ? ` · ${counts.blocked} blocked` : ''}`}
    >
      <p className="max-w-3xl text-xs text-zinc-500">
        Every number AHA treats as more than the public, right now, its level, and why. HQ users get the level
        of their HQ role; contacts and drivers follow their job; anyone else is Public. To change a person’s
        level or take them off, add a row by hand below — it wins over the automatic ones. STOP only stops our
        texts to a number; Blocked here is what stops AHA answering it.
      </p>

      {/* The per-level capability legend used to be five always-on cards AND a
          "Can ask for" column repeating the same text on every row. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">What each level can ask for</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-5">
          {(['admin', 'staff', 'contact', 'public', 'blocked'] as const).map((l) => (
            <div key={l} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${LEVEL_CHIP[l]}`}>{LEVEL_CAPABILITIES[l].label}</span>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-400">
                {LEVEL_CAPABILITIES[l].can.map((c) => <li key={c}>· {c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {isAdmin ? <AddNumberForm onDone={() => { setPreset(null); onChanged() }} preset={preset} /> : (
        <div className="mt-3 text-[11px] text-zinc-600">Only an admin can add or remove people here.</div>
      )}
      {rowErr && <div className="mt-2 text-xs text-red-300">{rowErr}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['all', 'grant', 'blocked', 'staff', 'contact', 'driver'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`rounded-full border px-3 py-1 text-xs ${tier === t ? 'border-amber-500 bg-amber-600/20 text-amber-200' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {t === 'all' ? `All · ${rows.length}` : `${TIER_LABEL[t].label} · ${counts[t]}`}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Number, name, job or unit"
          className="ml-auto w-56 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* One line per row, scrolling inside a capped box. The level chip
          carries the words; the tier (how AHA knows the number) is a short
          note next to the reason — it used to be a second chip that read
          identically to the first on every contact row. */}
      <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-800">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="w-[7.5rem] px-2 py-1.5 font-medium">Number</th>
              <th className="px-2 py-1.5 font-medium">Who</th>
              <th className="w-[8.5rem] px-2 py-1.5 font-medium">Level</th>
              <th className="w-[30%] px-2 py-1.5 font-medium">Why AHA knows it</th>
              <th className="w-[4.5rem] px-2 py-1.5 font-medium">Until</th>
              <th className="w-[11rem] px-2 py-1.5 font-medium">Change it</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.tier}:${r.tail}:${r.jobCode ?? ''}:${r.unit ?? ''}:${i}`} className="border-t border-zinc-800 align-middle">
                <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs text-zinc-200" title={r.phone}>{fmtTail(r.tail)}</td>
                <td className="truncate px-2 py-1.5 text-zinc-100" title={`${r.name}${r.jobCode ? ` · ${r.jobCode}` : ''}${r.jobName ? ` · ${r.jobName}` : ''}`}>
                  {r.name}
                  {r.jobCode && <span className="ml-2 text-[11px] text-zinc-500">{r.jobCode}</span>}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${LEVEL_CHIP[r.level]}`}>{LEVEL_CAPABILITIES[r.level].label}</span>
                </td>
                <td className="truncate px-2 py-1.5 text-xs text-zinc-300" title={`${TIER_LABEL[r.tier].label} — ${r.reason}${r.note ? ` · “${r.note}”` : ''} · Can ask for: ${r.grants}`}>
                  {r.tier !== 'contact' && <span className="mr-1.5 text-zinc-500">{TIER_LABEL[r.tier].label} ·</span>}
                  {r.reason}
                  {r.note && <span className="ml-1.5 text-zinc-500">“{r.note}”</span>}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap text-xs text-zinc-400" title={r.until ? 'Lapses on its own after this date' : 'Until removed'}>
                  {r.until ? fmtDay(r.until) : '—'}
                </td>
                <td className="truncate px-2 py-1.5 text-xs">
                  {r.grantId && isAdmin ? (
                    <button onClick={() => void revoke(r.grantId!)} className="font-semibold text-red-300 hover:text-red-200">Remove</button>
                  ) : (
                    <>
                      <a href={r.manageHref} className="font-semibold text-amber-300 hover:text-amber-200">{r.manageLabel} →</a>
                      {isAdmin && r.level !== 'blocked' && (
                        <button onClick={() => setPreset({ name: r.name, phone: r.phone, level: 'BLOCKED' })} className="ml-3 text-[11px] text-zinc-500 hover:text-red-300">Block</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-zinc-500">
                  {rows.length === 0 ? 'AHA recognises no numbers yet — add staff mobiles above, and contacts follow their jobs.' : 'Nothing matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function UsageSection({ usage }: { usage: Usage }) {
  const { totals, last30Days, denialReasons, factorFailures, visits, byHour } = usage
  const lockoutPct = totals.lockoutRate == null ? null : Math.round(totals.lockoutRate * 100)
  const peak = Math.max(1, ...byHour)
  const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`)

  return (
    <Panel
      title="Assistant usage"
      summary={totals.attempts === 0 ? 'No attempts yet' : `${visits.length} visit${visits.length === 1 ? '' : 's'}${lockoutPct == null ? '' : ` · ${lockoutPct}% locked out`}`}
    >
      <p className="text-xs text-zinc-500">
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
    </Panel>
  )
}

export default function AssistantAdminPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gateInput, setGateInput] = useState('')
  const [savingGate, setSavingGate] = useState(false)
  const [containerInput, setContainerInput] = useState('')
  const [savingContainer, setSavingContainer] = useState(false)
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
      setContainerInput(d.containerCode || '')
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

  async function saveContainer() {
    if (
      !confirm(
        'This only RECORDS the storage-container code — it does NOT reprogram the keypad. Save this value?',
      )
    )
      return
    setSavingContainer(true)
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-container-code', containerCode: containerInput }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      await load()
    } catch (e) {
      alert('Save failed: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setSavingContainer(false)
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

  const onCallCount = (data?.emergencyContacts || []).filter((c) => c.isEmergencyContact && c.emergencyPhone).length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-lt-fg">AHA — After Hours Assistant</h1>
      <p className="mt-1 text-sm text-lt-fg2">
        Manage the standing lot gate code, the per-job access codes clients use to verify after
        hours, and review the release log.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}
      {loading && <div className="mt-6 text-sm text-lt-fg2">Loading…</div>}

      {data && !loading && (
        <>
          {/* Nobody on call means every escalation silently degrades to an
              email to hq@ that no one reads at 1am. The assistant can only
              hand a stranded driver a person if a person is reachable. */}
          {onCallCount === 0 && (
            <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4">
              <div className="text-sm font-semibold text-red-900">No on-call contact is set</div>
              <p className="mt-1 text-xs text-red-800">
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
            <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">
                {data.smsProblem ? 'Text messaging is misconfigured' : 'Text messaging is not set up'}
              </div>
              <p className="mt-1 text-xs text-amber-800">
                On-call alerts fall back to email to hq@ — nobody gets a text.{' '}
                {data.smsProblem ? (
                  <span className="font-medium text-amber-900">{data.smsProblem}</span>
                ) : (
                  <>
                    Set TWILIO_ACCOUNT_SID and TWILIO_FROM_NUMBER in Vercel, plus either
                    TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Usage — placed first because it answers the question the log
              below cannot: whether people who try this actually get in. */}
          {data.usage && <UsageSection usage={data.usage} />}

          {/* Standing gate code */}
          <Panel
            title="Lot gate + container codes"
            summary={`Gate ${data.gateCode ? 'set' : 'not set'} · container ${data.containerCode ? 'set' : 'not set'}`}
            defaultOpen
          >
            <p className="text-xs text-zinc-500">
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

            {/* The container keypad. Same recording semantics, same section,
                because they are one arrangement: the gate gets a driver onto
                the lot and this opens the box their gear is in. Read by the
                client-facing after-hours page (/portal/job/[slug]/after-hours)
                once an agent releases it for a job. */}
            <div className="mt-5 border-t border-zinc-800 pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Storage container code
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                The keypad on the after-hours container inside Gate 1. Shown to clients on a
                released after-hours page, and to nobody else.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  value={containerInput}
                  onChange={(e) => setContainerInput(e.target.value)}
                  placeholder="e.g. 1580"
                  className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-lg tracking-widest text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
                <button
                  onClick={saveContainer}
                  disabled={savingContainer || containerInput === (data.containerCode || '')}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingContainer ? 'Saving…' : 'Save container code'}
                </button>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                Last recorded {fmt(data.containerCodeUpdatedAt)}.
              </div>
            </div>
          </Panel>

          {/* Per-job codes */}
          <Panel title="Per-job access codes" summary={`${data.jobs.length} job${data.jobs.length === 1 ? '' : 's'}`}>
            <div className="flex items-center justify-end gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search job, code…"
                className="w-56 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
            {/* Same shape as the recognised-numbers list: one line per job,
                capped box, sticky header. 200 jobs at two lines each was the
                tallest thing left on the page once the panels collapsed. */}
            <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="px-2 py-1.5 font-medium">Job</th>
                    <th className="w-[7rem] px-2 py-1.5 font-medium">Status</th>
                    <th className="w-[7rem] px-2 py-1.5 font-medium">Code</th>
                    <th className="w-[7.5rem] px-2 py-1.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-zinc-800 align-middle">
                      <td className="truncate px-2 py-1.5 text-white" title={`${j.name} · ${j.jobCode}`}>
                        {j.name}
                        <span className="ml-2 text-[11px] text-zinc-500">{j.jobCode}</span>
                      </td>
                      <td className="truncate px-2 py-1.5 text-xs text-zinc-400">{j.status}</td>
                      <td className="px-2 py-1.5 font-mono text-xs tracking-widest text-amber-300">
                        {j.assistantAuthCode || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => regen(j)}
                          disabled={regenId === j.id}
                          className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-amber-500 hover:text-amber-300 disabled:opacity-40"
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
          </Panel>

          {/* Emergency contacts */}
          <Panel
            title="Emergency contacts"
            summary={`${onCallCount} on call`}
          >
            <p className="text-xs text-zinc-500">
              On-call staff the assistant <span className="text-zinc-300">texts</span> when a caller declares a genuine
              emergency — so they can review the request and decide whether to call back. Toggle a person on and add
              their emergency (cell) number. Numbers are never shown to callers; every alert is logged below.
              <span className="block mt-1 text-zinc-600">SMS needs Twilio env keys; until then, alerts go out by email.</span>
            </p>
            {/* Same shape as the other lists: one line per person, capped box,
                sticky header. The switch and both phone fields keep their
                handlers — only the card chrome went. */}
            <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="w-[4.5rem] px-2 py-1.5 font-medium">On call</th>
                    <th className="px-2 py-1.5 font-medium">Who</th>
                    <th className="w-[12rem] px-2 py-1.5 font-medium">Mobile</th>
                    <th className="w-[12rem] px-2 py-1.5 font-medium">Emergency phone</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.emergencyContacts || []).map((u) => (
                    <tr key={u.id} className="border-t border-zinc-800 align-middle">
                      <td className="px-2 py-1.5">
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
                          className={`relative block h-5 w-9 rounded-full transition-colors ${u.isEmergencyContact ? 'bg-amber-600' : 'bg-zinc-700'}`}
                          title="On-call for emergencies"
                        >
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${u.isEmergencyContact ? 'left-[18px]' : 'left-0.5'}`} />
                        </button>
                      </td>
                      <td className="truncate px-2 py-1.5 text-white" title={`${u.name} · ${u.role}`}>
                        {u.name}
                        {/* On-call with no number is the silent half-state: the row
                            reads as covered while the alert query skips them. */}
                        {u.isEmergencyContact && !u.emergencyPhone ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-red-300">{u.role} · no number — will not be texted</span>
                        ) : (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">{u.role}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          defaultValue={u.phone ?? ''}
                          placeholder="Texts AHA as staff"
                          title="Texts from this number are recognised as staff: AHA answers fleet and job questions for it"
                          onBlur={(e) =>
                            fetch('/api/admin/assistant', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'set-staff-phone', userId: u.id, phone: e.target.value }),
                            })
                          }
                          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-2 py-1.5">
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
                          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                  {(data.emergencyContacts || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-zinc-500">No eligible staff.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <RecognizedSection rows={data.recognized ?? []} isAdmin={Boolean(data.me?.isAdmin)} onChanged={load} />

          <HqAssistantPanel level={data.me?.level ?? 'staff'} firstName={data.me?.firstName ?? null} />

          {/* Release log */}
          <Panel title="Recent access log" summary={`${data.audit.length} event${data.audit.length === 1 ? '' : 's'}`}>
            {/* Same shape as the other two lists: one line per event, capped
                box, sticky header. */}
            <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="w-[11rem] px-2 py-1.5 font-medium">When</th>
                    <th className="px-2 py-1.5 font-medium">Event</th>
                    <th className="w-[9rem] px-2 py-1.5 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.id} className="border-t border-zinc-800 align-middle">
                      <td className="truncate px-2 py-1.5 text-xs text-zinc-400">{fmt(a.createdAt)}</td>
                      <td className="truncate px-2 py-1.5 text-zinc-200" title={auditLabel(a)}>{auditLabel(a)}</td>
                      <td className="truncate px-2 py-1.5 font-mono text-xs text-zinc-500">{a.ipAddress || '—'}</td>
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
          </Panel>
        </>
      )}
    </div>
  )
}
