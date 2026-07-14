'use client'

/**
 * Reusable Job picker — typeahead + inline "create new" option.
 *
 * Mirrors ContactPicker's three-mode pattern: `searching` →
 * `selected_existing` | `creating_new`. The picker itself never
 * writes; it just signals intent. The parent form is responsible for
 * passing either `jobId` (existing) or `newJobName` (create) to its
 * downstream endpoint, which does the Job-create inside a
 * transaction.
 *
 * Scope: by default, searches existing OPEN Jobs (status IN NEW,
 * QUOTED, ACTIVE, HOLD) for the given company.
 *
 * Job-as-root step 2: this picker is now a thin sibling of the full
 * JobResolverModal (components/shared/JobResolverModal) — same value
 * contract, and flows that have richer context (dates, contact,
 * thread) should open the modal instead; its outcome maps 1:1 onto
 * JobPickerValue (created jobs come back as selected_existing). Falls back to "all open jobs"
 * when no company is selected yet — so the picker still works in
 * flows that haven't bound a company. WRAPPED + LOST are excluded
 * (the user doesn't want to attach a new hold to a wrapped show).
 */

import { useEffect, useRef, useState } from 'react'

export interface JobPickerValue {
  /** id of the selected existing Job, when mode === 'selected_existing'. */
  jobId: string | null
  /** Free-text name. In creating_new mode, the new Job's name. In
   *  selected_existing mode, the picked Job's display name. */
  name: string
  /** Picked Job's code (display-only). NULL in other modes. */
  jobCode: string | null
  /** What the parent should do on form submit. */
  mode: 'searching' | 'selected_existing' | 'creating_new'
  /** Picked Job's company (display-only). NULL in other modes. */
  company?: { id: string; name: string } | null
}

interface JobHit {
  id: string
  jobCode: string
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  company: { id: string; name: string } | null
}

interface JobPickerProps {
  value: JobPickerValue
  onChange: (v: JobPickerValue) => void
  /** When set, scopes search to this company's jobs. Otherwise the
   *  picker searches all open jobs (no companyId param). */
  companyId?: string | null
  placeholder?: string
  /** Show a small "Change" affordance on selected/creating pills. */
  allowReset?: boolean
}

const EMPTY: JobPickerValue = {
  jobId: null,
  name: '',
  jobCode: null,
  mode: 'searching',
  company: null,
}

// NEW leads are exactly the jobs you'd attach work to — include them.
const OPEN_STATUSES = 'NEW,QUOTED,ACTIVE,HOLD'

export function JobPicker({
  value,
  onChange,
  companyId,
  placeholder = 'Search jobs by name or code…',
  allowReset = true,
}: JobPickerProps) {
  const [query, setQuery] = useState(value.name)
  const [hits, setHits] = useState<JobHit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Debounced typeahead against /api/jobs. Min 1 char.
  useEffect(() => {
    if (value.mode !== 'searching') return
    if (query.trim().length < 1) {
      setHits([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          search: query.trim(),
          statuses: OPEN_STATUSES,
        })
        if (companyId) params.set('companyId', companyId)
        const res = await fetch(`/api/jobs?${params.toString()}`)
        const data = await res.json()
        setHits(Array.isArray(data.jobs) ? data.jobs.slice(0, 8) : [])
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, value.mode, companyId])

  // Click-outside collapses the dropdown.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pickExisting = (j: JobHit) => {
    onChange({
      jobId: j.id,
      name: j.name,
      jobCode: j.jobCode,
      mode: 'selected_existing',
      company: j.company,
    })
    setQuery(j.name)
    setOpen(false)
  }

  const startCreatingNew = () => {
    const typed = query.trim()
    if (!typed) return
    onChange({
      jobId: null,
      name: typed,
      jobCode: null,
      mode: 'creating_new',
      company: null,
    })
    setOpen(false)
  }

  const reset = () => {
    onChange({ ...EMPTY })
    setQuery('')
    setHits([])
  }

  // Selected-existing pill
  if (value.mode === 'selected_existing') {
    return (
      <div className="flex items-center justify-between border border-emerald-300 bg-emerald-50 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {value.jobCode ? `[${value.jobCode}] ` : ''}{value.name}
          </div>
          <div className="text-[11px] text-emerald-700">
            Existing job{value.company ? ` · ${value.company.name}` : ''}
          </div>
        </div>
        {allowReset && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-gray-500 hover:text-gray-700 ml-2 flex-shrink-0"
          >
            Change
          </button>
        )}
      </div>
    )
  }

  // Creating-new pill
  if (value.mode === 'creating_new') {
    return (
      <div className="flex items-center justify-between border border-blue-300 bg-blue-50 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{value.name}</div>
          <div className="text-[11px] text-blue-700">New job — will be created on submit</div>
        </div>
        {allowReset && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-gray-500 hover:text-gray-700 ml-2 flex-shrink-0"
          >
            Change
          </button>
        )}
      </div>
    )
  }

  // Searching mode — text input + dropdown
  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        autoComplete="off"
        name=""
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => query.length >= 1 && setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
          {searching && hits.length === 0 ? (
            <div className="px-4 py-2.5 text-xs text-gray-400">Searching…</div>
          ) : null}
          {hits.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => pickExisting(j)}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <div className="text-sm font-semibold text-gray-900 truncate">
                [{j.jobCode}] {j.name}
              </div>
              <div className="text-[10px] text-gray-400">
                {j.company?.name || '(no company)'} · {j.status.toLowerCase()}
                {j.startDate ? ` · ${j.startDate.slice(0, 10)}` : ''}
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={startCreatingNew}
            className="w-full text-left px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
          >
            <div className="text-sm font-semibold text-blue-700">
              + Create new job: &ldquo;{query.trim()}&rdquo;
            </div>
            <div className="text-[10px] text-gray-500">
              Creates a new Job when this form is submitted
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

export const EMPTY_JOB_PICKER_VALUE: JobPickerValue = EMPTY
