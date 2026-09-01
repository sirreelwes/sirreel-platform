'use client'

/**
 * One fetch of /api/jobs for the whole /jobs surface.
 *
 * The list lives in the jobs LAYOUT (so it survives navigating from
 * one job to the next) while the overview panel lives in the page.
 * Both need the same rows, the same derived states, and the same
 * filter — so the fetch and the filter state sit in a context the
 * layout provides, and neither tree re-fetches when you click a job.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  STATE,
  URGENCY,
  keyDate,
  listDays,
  rowState,
  rowValue,
  type JobRow,
  type JobStatus,
  type RowState,
} from '@/lib/jobs/listRow'
import { readinessApplies } from '@/lib/jobs/readiness'

export type ListFilter = RowState | 'not-ready'

/** Outbound row with open blockers — what the "Not ready" chip shows. */
export function rowNotReady(j: JobRow, state: RowState): boolean {
  return readinessApplies(state) && j.readiness != null && !j.readiness.ready
}

export type StatusFilter = 'all' | JobStatus | 'orphans' | 'archived' | 'hq'
export type Sort = 'recent' | 'urgency' | 'dates' | 'value' | 'newest'

export interface ListedRow {
  job: JobRow
  state: RowState
  date: string | null
}

interface JobsListValue {
  rows: ListedRow[]          // filtered + sorted, what the list renders
  allRows: ListedRow[]       // before the color-key filter
  counts: Map<RowState, number>
  loading: boolean
  error: string | null
  today: string
  tomorrow: string
  // controls
  search: string; setSearch: (v: string) => void
  status: StatusFilter; setStatus: (v: StatusFilter) => void
  mine: boolean; setMine: (v: boolean) => void
  sort: Sort; setSort: (v: Sort) => void
  /** A rail state, or 'not-ready' — the readiness chip's filter: outbound
   *  rows (booked/picking) whose five-check rollup has open blockers. */
  stateFilter: ListFilter | null; setStateFilter: (v: ListFilter | null) => void
  /** Local patch after a row action, so the list doesn't re-fetch. */
  patchJob: (id: string, patch: Partial<JobRow>) => void
  /** Re-fetch the list — same thing `notifyJobsChanged()` triggers. */
  refresh: () => void
}

/**
 * Fired by anything that changes a job — the detail panel's mutations,
 * a new job created from the top bar. The list re-fetches when it
 * hears this, so archiving a job (or flipping its status, or moving
 * its dates) updates the index without a page refresh.
 *
 * It's a window event rather than a context call so that components
 * nested deep in the detail panel — order modals, the bookings
 * section — can signal without threading a callback down to them, and
 * so that callers OUTSIDE the provider (the global "+ New Job") work
 * too. Nothing listens when the list isn't mounted; that's fine.
 */
export const JOBS_CHANGED_EVENT = 'sirreel:jobs-changed'

export function notifyJobsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOBS_CHANGED_EVENT))
}

const Ctx = createContext<JobsListValue | null>(null)

export function useJobsList(): JobsListValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useJobsList must be used inside <JobsListProvider>')
  return v
}

/**
 * Valid ?state= values. Validated against STATE rather than cast — an
 * unknown value must land on the unfiltered list, not a rail that
 * silently matches nothing.
 */
function readStateParam(raw: string | null | undefined): ListFilter | null {
  if (!raw) return null
  if (raw === 'not-ready') return 'not-ready'
  return raw in STATE ? (raw as RowState) : null
}

export function JobsListProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const [initialStateFilter] = useState(() => readStateParam(searchParams?.get('state')))
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [mine, setMine] = useState(false)
  // Newest first by default. Urgency-first sounded right and reads
  // wrong on the real book: ~90 Planyo-era rentals nobody ever marked
  // back pin themselves to the top as 'Not returned', burying the work
  // of the week. Recency is the honest default until those are closed.
  // 'recent', not 'newest'. Wes, 2026-08-29: he had just built and sent
  // a quote and the job sat thirty rows down, because 'newest' orders by
  // when the JOB was created and sending a quote touches the ORDER. The
  // list you look at all day should lead with what you just did.
  const [sort, setSort] = useState<Sort>('recent')
  // Seeded from ?state= so another page can deep-link into a narrowed
  // rail — /orders' "N not returned" line is the first caller. Read once
  // on mount rather than tracked: after landing, the chips own the
  // filter, and a URL that kept re-asserting itself would fight them.
  const [stateFilter, setStateFilter] = useState<ListFilter | null>(initialStateFilter)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const params = new URLSearchParams()
    if (status === 'orphans') params.set('orphans', '1')
    else if (status === 'archived') params.set('archived', '1')
    // 'hq' is not a server filter — origin is DERIVED per row (job cart
    // id ∪ its bookings' ∪ an RW link), not a column, so it cannot be a
    // where clause. Fetch normally and narrow below.
    else if (status === 'hq') { /* narrowed client-side */ }
    else if (status !== 'all') params.set('status', status)
    if (mine) params.set('mine', '1')
    if (debouncedSearch) params.set('search', debouncedSearch)

    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/jobs?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d.error) throw new Error(d.error)
        setJobs(d.jobs || [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, mine, debouncedSearch, reloadKey])

  useEffect(() => {
    window.addEventListener(JOBS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(JOBS_CHANGED_EVENT, refresh)
  }, [refresh])

  const { today, tomorrow } = useMemo(() => listDays(), [])

  const allRows = useMemo(() => {
    // 'hq' narrows to work HQ itself booked — see the fetch effect for
    // why this is not a server filter.
    const scoped = status === 'hq' ? jobs.filter((j) => j.origin === 'HQ') : jobs
    const withState: ListedRow[] = scoped.map((job) => {
      const state = rowState(job, today, tomorrow)
      return { job, state, date: keyDate(job, state) }
    })
    const byDate = (a: string | null, b: string | null) => {
      if (a === b) return 0
      if (!a) return 1
      if (!b) return -1
      return a < b ? -1 : 1
    }
    const sorted = [...withState]
    if (sort === 'recent') {
      // Newest of the job row and every order on it — see
      // lastActivityAt. Falls back to createdAt for any row an older
      // cached response served without it.
      const touched = (r: ListedRow) => r.job.lastActivityAt ?? r.job.createdAt
      sorted.sort((a, b) => (touched(a) < touched(b) ? 1 : touched(a) > touched(b) ? -1 : 0))
    } else if (sort === 'urgency') {
      sorted.sort((a, b) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state) || byDate(a.date, b.date))
    } else if (sort === 'dates') {
      sorted.sort((a, b) => byDate(a.date, b.date))
    } else if (sort === 'value') {
      sorted.sort((a, b) => (rowValue(b.job) ?? 0) - (rowValue(a.job) ?? 0))
    } else {
      sorted.sort((a, b) => (a.job.createdAt < b.job.createdAt ? 1 : -1))
    }
    return sorted
  }, [jobs, today, tomorrow, sort, status])

  // Counts come from the unfiltered set so the key's numbers don't
  // collapse to "1" the moment you click one of them.
  const counts = useMemo(() => {
    const m = new Map<RowState, number>()
    for (const r of allRows) m.set(r.state, (m.get(r.state) ?? 0) + 1)
    return m
  }, [allRows])

  const rows = useMemo(
    () =>
      stateFilter === 'not-ready'
        ? allRows.filter((r) => rowNotReady(r.job, r.state))
        : stateFilter
          ? allRows.filter((r) => r.state === stateFilter)
          : allRows,
    [allRows, stateFilter],
  )

  const value: JobsListValue = {
    rows,
    allRows,
    counts,
    loading,
    error,
    today,
    tomorrow,
    search, setSearch,
    status, setStatus,
    mine, setMine,
    sort, setSort,
    stateFilter, setStateFilter,
    patchJob: (id, patch) =>
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    refresh,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
