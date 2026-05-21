'use client'

import { useEffect, useMemo, useState } from 'react'

// Chunk 3 of native-scheduling-v1-brief.md — shadow mode. Surfaces the
// native engine's per-unit availability alongside Planyo's answer for
// the same category and date range, with a per-row agreement marker.
// No writes; this page is for eyeballing the engine before Chunks 4-7
// start trusting it.

type Category = {
  id: string
  name: string
  slug: string
  totalUnits: number
  planyoResourceId: number | null
}

type Agreement =
  | 'agree-free'
  | 'agree-booked'
  | 'planyo-says-booked-native-free'
  | 'native-says-booked-planyo-free'
  | 'name-only-planyo'
  | 'name-only-native'

type DiffRow = {
  unitName: string
  planyo: { state: 'available' | 'booked' | 'unknown'; bookedBy: string | null }
  native: { state: 'free' | 'buffer' | 'booked' | 'unknown'; assetId: string | null; tier: string | null }
  agreement: Agreement
}

type ShadowDiff = {
  ok: boolean
  category: Category
  window: { start: string; end: string; bufferDays: number }
  nativeSummary: {
    serviceableCount: number
    freeCount: number
    bufferCount: number
    bookedCount: number
    availableToHold: number
  }
  planyoError: string | null
  counts: Record<Agreement, number>
  rows: DiffRow[]
}

const AGREEMENT_LABEL: Record<Agreement, string> = {
  'agree-free': 'agree (free)',
  'agree-booked': 'agree (booked)',
  'planyo-says-booked-native-free': 'Planyo booked / native free',
  'native-says-booked-planyo-free': 'native booked / Planyo free',
  'name-only-planyo': 'name only in Planyo',
  'name-only-native': 'name only in native',
}

const AGREEMENT_BADGE: Record<Agreement, string> = {
  'agree-free': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'agree-booked': 'bg-blue-50 text-blue-700 border-blue-200',
  'planyo-says-booked-native-free': 'bg-rose-50 text-rose-700 border-rose-200',
  'native-says-booked-planyo-free': 'bg-rose-50 text-rose-700 border-rose-200',
  'name-only-planyo': 'bg-amber-50 text-amber-700 border-amber-200',
  'name-only-native': 'bg-amber-50 text-amber-700 border-amber-200',
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function SchedulingShadowPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState<string>('')
  const [start, setStart] = useState<string>(todayISO())
  const [end, setEnd] = useState<string>(addDaysISO(todayISO(), 7))
  const [bufferDays, setBufferDays] = useState<number>(1)
  const [data, setData] = useState<ShadowDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setCategories(d.categories)
          const firstWithPlanyo = d.categories.find((c: Category) => c.planyoResourceId !== null)
          setCategoryId(firstWithPlanyo?.id ?? d.categories[0]?.id ?? '')
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  async function run() {
    if (!categoryId || !start || !end) return
    setLoading(true)
    setError(null)
    try {
      const url = `/api/scheduling/shadow-diff?categoryId=${categoryId}&start=${start}&end=${end}&bufferDays=${bufferDays}`
      const res = await fetch(url)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'request failed')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const disagreements = useMemo(() => {
    if (!data) return 0
    return (
      data.counts['planyo-says-booked-native-free'] +
      data.counts['native-says-booked-planyo-free'] +
      data.counts['name-only-planyo'] +
      data.counts['name-only-native']
    )
  }, [data])

  return (
    <div className="p-6 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Scheduling shadow mode</h1>
        <p className="text-sm text-zinc-600 mt-1">
          Side-by-side: Planyo's current answer vs. the native engine's answer for the same category and window. Read-only —
          no holds or assignments are written here. Use this to verify the engine matches Planyo before native write paths
          land.
        </p>
      </header>

      <section className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-zinc-600 uppercase tracking-wide">Category</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5 bg-white"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.totalUnits}){c.planyoResourceId === null ? ' — no Planyo id' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-zinc-600 uppercase tracking-wide">Start</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-600 uppercase tracking-wide">End</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-600 uppercase tracking-wide">Buffer days</span>
            <input
              type="number"
              min={0}
              max={7}
              value={bufferDays}
              onChange={(e) => setBufferDays(parseInt(e.target.value || '0', 10))}
              className="mt-1 block w-full rounded border-zinc-300 text-sm px-2 py-1.5"
            />
          </label>
          <button
            onClick={run}
            disabled={loading || !categoryId}
            className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-medium px-4 py-2 rounded"
          >
            {loading ? 'Comparing…' : 'Run comparison'}
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}
      </section>

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div className="bg-white border border-zinc-200 rounded p-3">
              <div className="text-xs uppercase text-zinc-500">Serviceable</div>
              <div className="text-xl font-semibold text-zinc-900">{data.nativeSummary.serviceableCount}</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-3">
              <div className="text-xs uppercase text-zinc-500">Free</div>
              <div className="text-xl font-semibold text-emerald-700">{data.nativeSummary.freeCount}</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-3">
              <div className="text-xs uppercase text-zinc-500">Buffer</div>
              <div className="text-xl font-semibold text-amber-700">{data.nativeSummary.bufferCount}</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-3">
              <div className="text-xs uppercase text-zinc-500">Booked</div>
              <div className="text-xl font-semibold text-blue-700">{data.nativeSummary.bookedCount}</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-3">
              <div className="text-xs uppercase text-zinc-500">Hold capacity</div>
              <div className="text-xl font-semibold text-zinc-900">{data.nativeSummary.availableToHold}</div>
            </div>
            <div className="bg-white border border-zinc-200 rounded p-3">
              <div className="text-xs uppercase text-zinc-500">Disagreements</div>
              <div className={`text-xl font-semibold ${disagreements === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {disagreements}
              </div>
            </div>
          </section>

          {data.planyoError && (
            <div className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Planyo side unavailable: {data.planyoError}
            </div>
          )}

          <section className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Unit</th>
                  <th className="text-left px-3 py-2 font-medium">Planyo</th>
                  <th className="text-left px-3 py-2 font-medium">Native</th>
                  <th className="text-left px-3 py-2 font-medium">Tier</th>
                  <th className="text-left px-3 py-2 font-medium">Agreement</th>
                  <th className="text-left px-3 py-2 font-medium">Booked by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rows.map((r) => (
                  <tr key={r.unitName} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-mono text-zinc-900">{r.unitName}</td>
                    <td className="px-3 py-2">{r.planyo.state}</td>
                    <td className="px-3 py-2">{r.native.state}</td>
                    <td className="px-3 py-2 text-zinc-500">{r.native.tier ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded border ${AGREEMENT_BADGE[r.agreement]}`}>
                        {AGREEMENT_LABEL[r.agreement]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{r.planyo.bookedBy ?? '—'}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                      No units returned by either source for this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
