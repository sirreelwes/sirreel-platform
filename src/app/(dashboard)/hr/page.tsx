'use client'

/**
 * HR landing page — employee list + triage strip.
 *
 * Server-allowlisted: every API call hits a getServerSession + email
 * check; this page reads from those APIs and renders a "Forbidden"
 * fallback if any return 403. The nav sidebar also hides the entry
 * for non-allowlisted users — but defense in depth, the page itself
 * doesn't trust the nav gate.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { HrCategory, HrDisposition } from '@prisma/client'

interface EmployeeRow {
  id: string
  fullName: string
  workEmail: string | null
  title: string | null
  department: string | null
  isActive: boolean
  startedOn: string | null
  leftOn: string | null
  userId: string | null
  pendingReview: number
  _count: { hrMail: number; hrAttachments: number }
}

interface TriageRow {
  id: string
  category: HrCategory
  disposition: HrDisposition
  parse: {
    employeeNameGuess: string | null
    summary: string | null
    confidence: number
    reasoning: string | null
  } | null
  reason: string | null
  dismissed: boolean
  reviewedAt: string | null
  createdAt: string
  employee: { id: string; fullName: string } | null
  hrEmail: {
    id: string
    fromAddress: string
    subject: string
    sentAt: string
    attachmentCount: number
  }
}

const CATEGORY_LABEL: Record<HrCategory, string> = {
  TIMESHEET: 'Timesheet',
  PTO_LEAVE: 'PTO / Leave',
  MEDICAL: 'Medical',
  PAYROLL: 'Payroll',
  BENEFITS: 'Benefits',
  DISCIPLINE: 'Discipline',
  COMPLAINT: 'Complaint',
  ONBOARDING: 'Onboarding',
  RESIGNATION: 'Resignation',
  OTHER: 'Other',
}

const ALL_CATEGORIES: HrCategory[] = [
  'TIMESHEET', 'PTO_LEAVE', 'MEDICAL', 'PAYROLL', 'BENEFITS',
  'DISCIPLINE', 'COMPLAINT', 'ONBOARDING', 'RESIGNATION', 'OTHER',
]

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const diffMin = (Date.now() - d.getTime()) / 60_000
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function HrPage() {
  const [forbidden, setForbidden] = useState(false)
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)
  const [triage, setTriage] = useState<TriageRow[] | null>(null)
  const [pendingTotal, setPendingTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [empRes, triRes] = await Promise.all([
        fetch('/api/hr/employees'),
        fetch('/api/hr/mail-triage'),
      ])
      if (empRes.status === 403 || triRes.status === 403) {
        setForbidden(true)
        return
      }
      if (!empRes.ok) { setError(`employees HTTP ${empRes.status}`); return }
      if (!triRes.ok) { setError(`triage HTTP ${triRes.status}`); return }
      const empData = await empRes.json()
      const triData = await triRes.json()
      setEmployees(empData.employees ?? [])
      setPendingTotal(empData.pendingTotal ?? 0)
      setTriage(triData.rows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (forbidden) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-2xl mx-auto bg-lt-card border border-lt-hairline rounded-xl p-8">
          <h1 className="text-xl font-semibold text-lt-fg">Forbidden</h1>
          <p className="text-sm text-lt-fg2 mt-2">
            HR data is restricted to a small allowlist. If you need access,
            contact Wes — adding a name requires a code review + deploy by
            design.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-lt-fg">HR</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            {employees == null
              ? 'Loading…'
              : `${employees.length} employees · ${pendingTotal} item${pendingTotal === 1 ? '' : 's'} need review`}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/30 text-chip-bad-fg text-sm px-4 py-2">
            {error}
          </div>
        )}

        {triage && triage.length > 0 && employees && (
          <TriageStrip
            rows={triage}
            employees={employees}
            onChanged={load}
          />
        )}

        <EmployeeList employees={employees} />
      </div>
    </div>
  )
}

// ── Employee list ─────────────────────────────────────────────────

function EmployeeList({ employees }: { employees: EmployeeRow[] | null }) {
  if (employees == null) return null
  if (employees.length === 0) {
    return (
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-6 text-sm text-lt-fg2">
        No employees yet. Run <code className="font-mono text-xs">scripts/seed-hr-employees.ts</code> to seed.
      </div>
    )
  }
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-lt-hairline text-lt-fg3 text-left text-xs uppercase tracking-wide">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Department</th>
            <th className="px-4 py-3 font-medium text-right">Mail</th>
            <th className="px-4 py-3 font-medium text-right">Docs</th>
            <th className="px-4 py-3 font-medium text-right">Needs review</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr
              key={e.id}
              className={`border-b border-lt-hairline/50 hover:bg-lt-inner/40 ${e.isActive ? '' : 'opacity-60'}`}
            >
              <td className="px-4 py-3">
                <Link href={`/hr/${e.id}`} className="text-lt-fg hover:text-black hover:underline font-medium">
                  {e.fullName}
                </Link>
                {!e.isActive && (
                  <span className="ml-2 text-[10px] uppercase text-lt-fg3">inactive</span>
                )}
                {e.workEmail && (
                  <div className="text-xs text-lt-fg3 font-mono">{e.workEmail}</div>
                )}
              </td>
              <td className="px-4 py-3 text-lt-fg2">{e.title ?? '—'}</td>
              <td className="px-4 py-3 text-lt-fg2">{e.department ?? '—'}</td>
              <td className="px-4 py-3 text-right text-lt-fg2 font-mono">{e._count.hrMail}</td>
              <td className="px-4 py-3 text-right text-lt-fg2 font-mono">{e._count.hrAttachments}</td>
              <td className="px-4 py-3 text-right">
                {e.pendingReview > 0 ? (
                  <span className="text-[11px] font-semibold bg-chip-warn-bg text-chip-warn-fg px-2 py-0.5 rounded-full font-mono">
                    {e.pendingReview}
                  </span>
                ) : (
                  <span className="text-lt-fg3">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Triage strip ──────────────────────────────────────────────────

function TriageStrip({
  rows, employees, onChanged,
}: {
  rows: TriageRow[]
  employees: EmployeeRow[]
  onChanged: () => void
}) {
  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl">
      <div className="px-4 py-3 border-b border-lt-hairline flex items-center justify-between">
        <div className="text-sm font-semibold text-lt-fg">Needs review</div>
        <div className="text-xs text-lt-fg3">{rows.length} item{rows.length === 1 ? '' : 's'}</div>
      </div>
      <div className="divide-y divide-lt-hairline">
        {rows.map((r) => (
          <TriageRowItem key={r.id} row={r} employees={employees} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function TriageRowItem({
  row, employees, onChanged,
}: {
  row: TriageRow
  employees: EmployeeRow[]
  onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [employeeId, setEmployeeId] = useState<string>(row.employee?.id ?? '')
  const [category, setCategory] = useState<HrCategory>(row.category)

  const patch = async (body: Record<string, unknown>) => {
    setPending(true)
    try {
      const res = await fetch(`/api/hr/mail-triage/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) onChanged()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-lt-fg truncate">{row.hrEmail.subject}</div>
          <div className="text-xs text-lt-fg3">
            from {row.hrEmail.fromAddress.slice(0, 60)} · {fmtTime(row.hrEmail.sentAt)}
            {row.hrEmail.attachmentCount > 0 && (
              <> · {row.hrEmail.attachmentCount} attachment{row.hrEmail.attachmentCount === 1 ? '' : 's'}</>
            )}
          </div>
          {row.parse?.summary && (
            <div className="text-xs text-lt-fg2 mt-1">{row.parse.summary}</div>
          )}
          {row.parse?.employeeNameGuess && !row.employee && (
            <div className="text-xs text-lt-fg3 mt-0.5 italic">AI guess: {row.parse.employeeNameGuess}</div>
          )}
          {row.reason && (
            <div className="text-[11px] text-lt-fg3 italic mt-0.5">{row.reason}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 text-xs">
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value)
              void patch({ employeeId: e.target.value || null })
            }}
            disabled={pending}
            className="px-2 py-1 border border-lt-hairline rounded bg-lt-card text-lt-fg"
          >
            <option value="">— assign employee —</option>
            {employees.filter((e) => e.isActive).map((e) => (
              <option key={e.id} value={e.id}>{e.fullName}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <select
              value={category}
              onChange={(e) => {
                const c = e.target.value as HrCategory
                setCategory(c)
                void patch({ category: c })
              }}
              disabled={pending}
              className="px-2 py-1 border border-lt-hairline rounded bg-lt-card text-lt-fg"
            >
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
            <button
              onClick={() => void patch({ dismiss: true })}
              disabled={pending}
              className="px-2 py-1 text-lt-fg3 hover:text-lt-fg hover:bg-lt-inner rounded"
              title="File (with current employee + category) and remove from triage"
            >
              Dismiss
            </button>
            <button
              onClick={() => void patch({ dismiss: true, disposition: 'IGNORED' })}
              disabled={pending}
              className="px-2 py-1 text-lt-fg3 hover:text-chip-bad-fg hover:bg-chip-bad-bg/40 rounded"
              title="Mark as not-HR / noise"
            >
              Ignore
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
