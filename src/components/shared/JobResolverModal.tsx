'use client'

/**
 * JobResolverModal — the agent-facing half of the Job-as-root
 * resolver. Given inbound context (a gantt drag's dates, an email's
 * company+contact, a manual form), it calls POST /api/jobs/resolve and
 * presents TWO paths. The machine DISCOVERS; the agent DECIDES:
 *
 *   "Add to existing Job" — ranked candidates, each with its match
 *   reasons, plus a searchable fallback (the classic typeahead) for
 *   when the ranking missed.
 *
 *   "Create new Job" — the pre-filled draft (name/company/contact)
 *   for confirm/edit, then POST /api/jobs (createJobFromDraft).
 *
 * There is NEVER a silent auto-pick: a CLEAN_MATCH renders as the
 * highlighted default but still requires the agent's click.
 */

import { useEffect, useState } from 'react'

export interface ResolverContext {
  companyId?: string | null
  companyName?: string | null
  contactEmail?: string | null
  contactName?: string | null
  contactPhone?: string | null
  jobNameHint?: string | null
  dates?: { start: string; end: string } | null
  threadId?: string | null
  planyoCartId?: string | null
  sourceRef?: string | null
}

export interface ResolvedJob {
  id: string
  jobCode: string
  name: string
  companyName?: string | null
  /** True when the agent chose "Create new Job". */
  created: boolean
}

interface Candidate {
  jobId: string
  jobCode: string
  name: string
  status: string
  companyName: string | null
  startDate: string | null
  endDate: string | null
  agentName: string | null
  score: number
  reasons: string[]
}

interface ResolveResult {
  bucket: 'CLEAN_MATCH' | 'CANDIDATES' | 'NO_MATCH'
  candidates: Candidate[]
  companyAmbiguity: string | null
  resolvedCompany: { id: string; name: string } | null
  resolvedPerson: { id: string; name: string; email: string } | null
  draft: {
    name: string
    companyId?: string | null
    companyName?: string | null
    contactName?: string | null
    contactPhone?: string | null
    contactEmail?: string | null
    startDate?: string | null
    endDate?: string | null
  }
}

export function JobResolverModal({
  context,
  onResolved,
  onClose,
}: {
  context: ResolverContext
  onResolved: (job: ResolvedJob) => void
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [path, setPath] = useState<'existing' | 'new'>('existing')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // fallback search
  const [search, setSearch] = useState('')
  const [searchHits, setSearchHits] = useState<Candidate[]>([])
  // new-job draft (editable)
  const [dName, setDName] = useState('')
  const [dCompany, setDCompany] = useState('')
  const [dContactName, setDContactName] = useState('')
  const [dContactEmail, setDContactEmail] = useState('')
  const [dContactPhone, setDContactPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/jobs/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    })
      .then((r) => r.json())
      .then((d: ResolveResult & { error?: string }) => {
        if (d.error) throw new Error(d.error)
        setResult(d)
        setPath(d.bucket === 'NO_MATCH' ? 'new' : 'existing')
        if (d.bucket === 'CLEAN_MATCH' && d.candidates[0]) setSelectedId(d.candidates[0].jobId)
        setDName(d.draft.name || context.jobNameHint || '')
        setDCompany(d.draft.companyName || '')
        setDContactName(d.draft.contactName || '')
        setDContactEmail(d.draft.contactEmail || '')
        setDContactPhone(d.draft.contactPhone || '')
      })
      .catch((e) => setError(e.message || 'Failed to resolve'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // fallback typeahead against the classic jobs search
  useEffect(() => {
    if (path !== 'existing' || search.trim().length < 1) {
      setSearchHits([])
      return
    }
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ search: search.trim(), statuses: 'NEW,QUOTED,ACTIVE,HOLD' })
      const r = await fetch(`/api/jobs?${params.toString()}`).then((x) => x.json())
      const known = new Set((result?.candidates || []).map((c) => c.jobId))
      setSearchHits(
        (r.jobs || [])
          .filter((j: any) => !known.has(j.id))
          .slice(0, 6)
          .map((j: any) => ({
            jobId: j.id, jobCode: j.jobCode, name: j.name, status: j.status,
            companyName: j.company?.name ?? null, startDate: j.startDate, endDate: j.endDate,
            agentName: j.agent?.name ?? null, score: 0, reasons: ['search result'],
          })),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [search, path, result])

  const confirmExisting = () => {
    const all = [...(result?.candidates || []), ...searchHits]
    const j = all.find((c) => c.jobId === selectedId)
    if (!j) return
    onResolved({ id: j.jobId, jobCode: j.jobCode, name: j.name, companyName: j.companyName, created: false })
  }

  const createNew = async () => {
    setSubmitting(true)
    setError('')
    try {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dName,
          companyId: result?.resolvedCompany && dCompany === result.resolvedCompany.name ? result.resolvedCompany.id : undefined,
          companyName: dCompany,
          contactName: dContactName,
          contactEmail: dContactEmail,
          contactPhone: dContactPhone,
          startDate: context.dates?.start || undefined,
          endDate: context.dates?.end || undefined,
          status: 'NEW',
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to create job')
      onResolved({
        id: d.job.id, jobCode: d.job.jobCode, name: d.job.name,
        companyName: d.job.company?.name ?? dCompany, created: true,
      })
    } catch (e: any) {
      setError(e.message || 'Failed to create job')
    } finally {
      setSubmitting(false)
    }
  }

  const CandidateCard = ({ c, highlighted }: { c: Candidate; highlighted: boolean }) => (
    <button
      type="button"
      onClick={() => setSelectedId(c.jobId)}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selectedId === c.jobId
          ? 'border-emerald-400 bg-emerald-50'
          : highlighted
            ? 'border-sky-300 bg-sky-50 hover:border-sky-400'
            : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900 truncate">
          [{c.jobCode}] {c.name}
        </div>
        {highlighted && selectedId !== c.jobId && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 flex-shrink-0">best match</span>
        )}
        {selectedId === c.jobId && <span className="text-emerald-600 text-sm flex-shrink-0">✓</span>}
      </div>
      <div className="text-[11px] text-gray-500 mt-0.5">
        {c.companyName || '(no company)'} · {c.status.toLowerCase()}
        {c.startDate ? ` · ${c.startDate}${c.endDate ? `–${c.endDate}` : ''}` : ' · no dates'}
        {c.agentName ? ` · ${c.agentName}` : ''}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {c.reasons.map((r, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {r}
          </span>
        ))}
      </div>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[560px] max-w-[95vw] max-h-[85vh] overflow-y-auto p-5 shadow-2xl border border-gray-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">New Job or Existing Job?</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Everything lives inside a Job — pick where this work belongs.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Looking for matching jobs…</div>
        ) : (
          <>
            {result?.companyAmbiguity && (
              <div className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                ⚠ {result.companyAmbiguity}
              </div>
            )}

            <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setPath('existing')}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${path === 'existing' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                Add to existing Job{result?.candidates.length ? ` (${result.candidates.length} found)` : ''}
              </button>
              <button
                onClick={() => setPath('new')}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${path === 'new' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                Create new Job
              </button>
            </div>

            {path === 'existing' ? (
              <div className="space-y-2">
                {result?.candidates.length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-2">
                    No likely matches found — search below, or create a new Job.
                  </div>
                )}
                {result?.candidates.map((c, i) => (
                  <CandidateCard key={c.jobId} c={c} highlighted={i === 0 && result.bucket === 'CLEAN_MATCH'} />
                ))}
                <div className="pt-1">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Not listed? Search all open jobs…"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
                  />
                </div>
                {searchHits.map((c) => (
                  <CandidateCard key={c.jobId} c={c} highlighted={false} />
                ))}
                <button
                  onClick={confirmExisting}
                  disabled={!selectedId}
                  className="w-full py-2.5 mt-1 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold"
                >
                  Add to selected Job →
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Job name *</label>
                  <input value={dName} onChange={(e) => setDName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Production company *</label>
                  <input value={dCompany} onChange={(e) => setDCompany(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                  {result?.resolvedCompany && dCompany === result.resolvedCompany.name && (
                    <div className="text-[10px] text-emerald-600 mt-0.5">✓ matches existing company record</div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Contact name</label>
                    <input value={dContactName} onChange={(e) => setDContactName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Phone</label>
                    <input value={dContactPhone} onChange={(e) => setDContactPhone(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Email</label>
                    <input value={dContactEmail} onChange={(e) => setDContactEmail(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                  </div>
                </div>
                {result?.resolvedPerson && dContactEmail === result.resolvedPerson.email && (
                  <div className="text-[10px] text-emerald-600 -mt-2">✓ {result.resolvedPerson.name} is already in the CRM — will be linked, not duplicated</div>
                )}
                {error && <div className="text-[11px] text-red-600">{error}</div>}
                <button
                  onClick={createNew}
                  disabled={submitting || !dName.trim() || !dCompany.trim()}
                  className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold"
                >
                  {submitting ? 'Creating…' : 'Create new Job (starts as NEW) →'}
                </button>
              </div>
            )}
            {error && path === 'existing' && <div className="mt-2 text-[11px] text-red-600">{error}</div>}
          </>
        )}
      </div>
    </div>
  )
}
