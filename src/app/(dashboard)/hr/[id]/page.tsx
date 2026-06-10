'use client'

/**
 * Per-employee HR dossier. Filed mail grouped by category, attachments
 * list, basic profile. Allowlist-gated through the API (403 → Forbidden
 * fallback).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { HrCategory, HrDisposition } from '@prisma/client'

interface Employee {
  id: string
  fullName: string
  workEmail: string | null
  personalEmails: string[]
  title: string | null
  department: string | null
  isActive: boolean
  startedOn: string | null
  leftOn: string | null
  notes: string | null
  user: { id: string; name: string; email: string; role: string } | null
}

interface MailRow {
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
  hrEmail: {
    id: string
    fromAddress: string
    subject: string
    sentAt: string
    attachmentCount: number
  }
}

interface AttachmentRow {
  id: string
  category: HrCategory
  title: string
  fileUrl: string
  mimeType: string | null
  sizeBytes: number | null
  createdAt: string
  typeSource: 'EMAIL_INGEST' | 'USER' | 'AI_SUGGESTED' | null
  typeConfidence: number | null
}

const CATEGORY_LABEL: Record<HrCategory, string> = {
  TIMESHEET: 'Timesheets',
  PTO_LEAVE: 'PTO / Leave',
  MEDICAL: 'Medical',
  PAYROLL: 'Payroll',
  BENEFITS: 'Benefits',
  DISCIPLINE: 'Discipline',
  COMPLAINT: 'Complaints',
  ONBOARDING: 'Onboarding',
  RESIGNATION: 'Resignation',
  OTHER: 'Other',
}

const CATEGORY_ORDER: HrCategory[] = [
  'DISCIPLINE', 'COMPLAINT', 'MEDICAL', 'PAYROLL', 'BENEFITS',
  'PTO_LEAVE', 'TIMESHEET', 'ONBOARDING', 'RESIGNATION', 'OTHER',
]

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HrEmployeePage() {
  const params = useParams()
  const id = params.id as string
  const [forbidden, setForbidden] = useState(false)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [mail, setMail] = useState<MailRow[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/hr/employees/${id}`)
      if (res.status === 403) { setForbidden(true); return }
      if (res.status === 404) { setError('Employee not found'); return }
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      const data = await res.json()
      setEmployee(data.employee)
      setMail(data.mail ?? [])
      setAttachments(data.attachments ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const mailByCategory = useMemo(() => {
    const m = new Map<HrCategory, MailRow[]>()
    for (const row of mail) {
      if (row.disposition !== 'FILED') continue
      const list = m.get(row.category) ?? []
      list.push(row)
      m.set(row.category, list)
    }
    return m
  }, [mail])

  if (forbidden) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <div className="max-w-2xl mx-auto bg-lt-card border border-lt-hairline rounded-xl p-8">
          <h1 className="text-xl font-semibold text-lt-fg">Forbidden</h1>
          <p className="text-sm text-lt-fg2 mt-2">HR data is restricted to a small allowlist.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <p className="text-sm text-lt-fg2">Loading…</p>
      </div>
    )
  }

  if (error || !employee) {
    return (
      <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
        <p className="text-sm text-chip-bad-fg">{error ?? 'Not found'}</p>
      </div>
    )
  }

  return (
    <div className="bg-lt-page -m-6 p-6 min-h-[calc(100vh-3rem)]">
      <div className="max-w-[1100px] mx-auto space-y-6">
        <div className="flex items-baseline gap-4">
          <Link href="/hr" className="text-xs text-lt-fg3 hover:text-lt-fg">← All employees</Link>
        </div>

        {/* Profile */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-6">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-lt-fg">{employee.fullName}</h1>
              <p className="text-sm text-lt-fg2 mt-1">
                {employee.title ?? 'No title'}
                {employee.department && <> · {employee.department}</>}
                {!employee.isActive && <span className="ml-2 text-xs uppercase text-chip-bad-fg">inactive</span>}
              </p>
            </div>
            <div className="text-xs text-lt-fg3 space-y-0.5 text-right">
              {employee.workEmail && <div className="font-mono">{employee.workEmail}</div>}
              {employee.startedOn && <div>Started {fmtDate(employee.startedOn)}</div>}
              {employee.leftOn && <div>Left {fmtDate(employee.leftOn)}</div>}
            </div>
          </div>
        </div>

        {/* Filed mail grouped by category */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl">
          <div className="px-4 py-3 border-b border-lt-hairline text-sm font-semibold text-lt-fg">
            Filed mail ({mail.filter((m) => m.disposition === 'FILED').length})
          </div>
          {mailByCategory.size === 0 ? (
            <div className="px-4 py-6 text-sm text-lt-fg2 text-center">No filed HR mail yet.</div>
          ) : (
            <div className="divide-y divide-lt-hairline">
              {CATEGORY_ORDER.filter((c) => mailByCategory.has(c)).map((cat) => {
                const rows = mailByCategory.get(cat)!
                return (
                  <div key={cat} className="px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-lt-fg3 mb-2">
                      {CATEGORY_LABEL[cat]} ({rows.length})
                    </div>
                    <ul className="space-y-1.5">
                      {rows.map((m) => (
                        <li key={m.id} className="text-xs">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-lt-fg truncate flex-1 min-w-0">{m.hrEmail.subject}</span>
                            <span className="text-lt-fg3 shrink-0">{fmtDate(m.hrEmail.sentAt)}</span>
                          </div>
                          <div className="text-lt-fg3 truncate">from {m.hrEmail.fromAddress}</div>
                          {m.parse?.summary && (
                            <div className="text-lt-fg2 mt-0.5">{m.parse.summary}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="bg-lt-card border border-lt-hairline rounded-xl">
          <div className="px-4 py-3 border-b border-lt-hairline text-sm font-semibold text-lt-fg">
            Documents ({attachments.length})
          </div>
          {attachments.length === 0 ? (
            <div className="px-4 py-6 text-sm text-lt-fg2 text-center">No documents yet.</div>
          ) : (
            <ul className="divide-y divide-lt-hairline">
              {attachments.map((a) => (
                <li key={a.id} className="px-4 py-2 flex items-baseline justify-between gap-3 text-xs">
                  <a href={a.fileUrl} target="_blank" rel="noreferrer" className="text-lt-fg hover:text-black hover:underline truncate flex-1 min-w-0">
                    {a.title}
                  </a>
                  <span className="text-[10px] uppercase tracking-wider text-lt-fg3 shrink-0">
                    {CATEGORY_LABEL[a.category]}
                  </span>
                  <span className="text-lt-fg3 shrink-0">{fmtDate(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
