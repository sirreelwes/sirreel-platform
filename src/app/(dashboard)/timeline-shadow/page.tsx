'use client'

/**
 * Timeline shadow — side-by-side Planyo vs. native Timeline.
 *
 * Loads /api/timeline (Planyo-backed, today's production source)
 * and /api/timeline-native (native, reads BookingAssignment). Pairs
 * jobs by RentalWorks order number when present, otherwise by
 * jobName + start date. Highlights the four interesting buckets:
 *
 *   - in-both        — Planyo & native agree on a job's window
 *   - native-only    — created via +Hold in HQ, hasn't synced back
 *                       to Planyo (yet — expected during cutover)
 *   - planyo-only    — Planyo has it, native doesn't (migration gap)
 *   - mismatch       — both sides have it but dates / status differ
 *
 * Use this to verify convergence before flipping the gantt /
 * dashboard / calendar pages over to /api/timeline-native (the
 * Chunk 8 cutover). Read-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface TimelineJob {
  id: string
  cartId: string
  company: string
  jobName: string
  jobNum: string
  rwOrderNumber: string | null
  agent: string
  status: string
  startDate: string
  endDate: string
}

interface TimelineResponse {
  ok?: boolean
  jobs: TimelineJob[]
  units?: unknown[]
  total?: number
  error?: string
  window?: { from: string; to: string }
}

type Bucket = 'in-both' | 'native-only' | 'planyo-only' | 'mismatch'

interface DiffRow {
  bucket: Bucket
  key: string
  planyo: TimelineJob | null
  native: TimelineJob | null
  reason?: string
}

function pairKey(job: TimelineJob): string {
  // Prefer RW order number when present (stable across systems);
  // fall back to jobName+startDate.
  if (job.rwOrderNumber) return `rw:${job.rwOrderNumber}`
  return `name:${(job.jobName || '').toLowerCase().trim()}|${job.startDate}`
}

const BUCKET_LABEL: Record<Bucket, string> = {
  'in-both': 'agree',
  'native-only': 'native only',
  'planyo-only': 'Planyo only',
  mismatch: 'mismatch',
}

const BUCKET_BADGE: Record<Bucket, string> = {
  'in-both': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'native-only': 'bg-blue-50 text-blue-700 border-blue-200',
  'planyo-only': 'bg-amber-50 text-amber-800 border-amber-200',
  mismatch: 'bg-rose-50 text-rose-700 border-rose-200',
}

export default function TimelineShadowPage() {
  const [planyo, setPlanyo] = useState<TimelineResponse | null>(null)
  const [native, setNative] = useState<TimelineResponse | null>(null)
  const [planyoError, setPlanyoError] = useState<string | null>(null)
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | Bucket>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setPlanyoError(null)
    setNativeError(null)
    try {
      const [pRes, nRes] = await Promise.all([
        fetch('/api/timeline').catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) })),
        fetch('/api/timeline-native').catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) })),
      ])
      const pJson = (await (pRes as Response).json()) as TimelineResponse
      const nJson = (await (nRes as Response).json()) as TimelineResponse
      if (!(pRes as Response).ok || pJson.error) setPlanyoError(pJson.error || `HTTP ${(pRes as Response).status}`)
      if (!(nRes as Response).ok || nJson.error) setNativeError(nJson.error || `HTTP ${(nRes as Response).status}`)
      setPlanyo(pJson)
      setNative(nJson)
    } catch (e) {
      setPlanyoError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const diff = useMemo<DiffRow[]>(() => {
    if (!planyo?.jobs || !native?.jobs) return []
    const planyoByKey = new Map<string, TimelineJob>()
    for (const j of planyo.jobs) planyoByKey.set(pairKey(j), j)
    const nativeByKey = new Map<string, TimelineJob>()
    for (const j of native.jobs) nativeByKey.set(pairKey(j), j)
    const allKeys = new Set([...planyoByKey.keys(), ...nativeByKey.keys()])
    const rows: DiffRow[] = []
    for (const key of allKeys) {
      const p = planyoByKey.get(key) ?? null
      const n = nativeByKey.get(key) ?? null
      if (p && n) {
        const sameDates = p.startDate === n.startDate && p.endDate === n.endDate
        const sameStatus = p.status === n.status
        if (sameDates && sameStatus) {
          rows.push({ bucket: 'in-both', key, planyo: p, native: n })
        } else {
          const reasons: string[] = []
          if (!sameDates) reasons.push(`dates differ (planyo ${p.startDate}→${p.endDate} vs native ${n.startDate}→${n.endDate})`)
          if (!sameStatus) reasons.push(`status differs (planyo=${p.status} native=${n.status})`)
          rows.push({ bucket: 'mismatch', key, planyo: p, native: n, reason: reasons.join('; ') })
        }
      } else if (n && !p) {
        rows.push({ bucket: 'native-only', key, planyo: null, native: n })
      } else if (p && !n) {
        rows.push({ bucket: 'planyo-only', key, planyo: p, native: null })
      }
    }
    rows.sort((a, b) => {
      const order: Record<Bucket, number> = { mismatch: 0, 'planyo-only': 1, 'native-only': 2, 'in-both': 3 }
      if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket]
      const aDate = a.planyo?.startDate ?? a.native?.startDate ?? ''
      const bDate = b.planyo?.startDate ?? b.native?.startDate ?? ''
      return aDate.localeCompare(bDate)
    })
    return rows
  }, [planyo, native])

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { 'in-both': 0, 'native-only': 0, 'planyo-only': 0, mismatch: 0 }
    for (const r of diff) c[r.bucket]++
    return c
  }, [diff])

  const visible = filter === 'all' ? diff : diff.filter((r) => r.bucket === filter)

  return (
    <div className="p-6 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Timeline shadow</h1>
        <p className="text-sm text-zinc-600 mt-1">
          Side-by-side: <code className="bg-zinc-100 px-1 rounded">/api/timeline</code> (Planyo-backed, today's prod source)
          vs. <code className="bg-zinc-100 px-1 rounded">/api/timeline-native</code> (native, reads BookingAssignment).
          Use this to verify convergence before flipping the gantt / dashboard / calendar pages over to the native source.
          Pairs jobs by RW order number when present, falls back to job name + start date.
        </p>
      </header>

      <section className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-medium px-4 py-1.5 rounded"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <div className="text-sm text-zinc-600">
            {planyo?.jobs && (
              <>
                Planyo: <span className="font-semibold text-zinc-900">{planyo.jobs.length}</span> jobs
              </>
            )}
            {native?.jobs && (
              <>
                {' · '}Native: <span className="font-semibold text-zinc-900">{native.jobs.length}</span> jobs
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {(['all', 'mismatch', 'planyo-only', 'native-only', 'in-both'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2 py-1 rounded border ${
                  filter === f ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                }`}
              >
                {f === 'all' ? 'all' : BUCKET_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        {planyoError && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">Planyo: {planyoError}</div>}
        {nativeError && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">Native: {nativeError}</div>}
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {(['mismatch', 'planyo-only', 'native-only', 'in-both'] as Bucket[]).map((b) => (
          <div key={b} className="bg-white border border-zinc-200 rounded p-3">
            <div className="text-xs uppercase text-zinc-500">{BUCKET_LABEL[b]}</div>
            <div
              className={`text-xl font-semibold ${
                b === 'in-both' ? 'text-emerald-700' : b === 'mismatch' ? 'text-rose-700' : 'text-amber-700'
              }`}
            >
              {counts[b]}
            </div>
          </div>
        ))}
      </section>

      <section className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Bucket</th>
              <th className="text-left px-3 py-2 font-medium">Key</th>
              <th className="text-left px-3 py-2 font-medium">Planyo</th>
              <th className="text-left px-3 py-2 font-medium">Native</th>
              <th className="text-left px-3 py-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  {loading ? 'Loading…' : 'No rows.'}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={`${r.bucket}-${r.key}`} className="hover:bg-zinc-50 align-top">
                <td className="px-3 py-2">
                  <span className={`inline-block text-xs px-2 py-0.5 rounded border ${BUCKET_BADGE[r.bucket]}`}>
                    {BUCKET_LABEL[r.bucket]}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-600">{r.key}</td>
                <td className="px-3 py-2 text-zinc-700">
                  {r.planyo ? (
                    <>
                      <div className="font-mono text-zinc-900">{r.planyo.jobNum}</div>
                      <div className="text-xs text-zinc-500">{r.planyo.company}</div>
                      <div className="text-xs text-zinc-500">{r.planyo.startDate} → {r.planyo.endDate}</div>
                      <div className="text-xs text-zinc-500">status: {r.planyo.status}</div>
                    </>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-700">
                  {r.native ? (
                    <>
                      <div className="font-mono text-zinc-900">{r.native.jobNum}</div>
                      <div className="text-xs text-zinc-500">{r.native.company}</div>
                      <div className="text-xs text-zinc-500">{r.native.startDate} → {r.native.endDate}</div>
                      <div className="text-xs text-zinc-500">status: {r.native.status}</div>
                    </>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-600">{r.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
