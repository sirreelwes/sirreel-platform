'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

function fmt(d: string) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function PaperworkBadge({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold ${
      done ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-400'
    }`}>
      <span>{done ? '✓' : '○'}</span>
      <span>{label}</span>
    </div>
  )
}

export default function ClientDashboardPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') || ''

  const [jobs, setJobs] = useState<any[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<any>(null)

  useEffect(() => {
    if (!token) { setError('No access token'); setLoading(false); return }
    fetch(`/api/client/jobs?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJobs(d.jobs || [])
          setEmail(d.email || '')
        } else {
          setError(d.error || 'Access denied')
        }
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Loading your jobs...</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Link expired</h2>
        <p className="text-sm text-gray-500 mb-4">{error}</p>
        <button onClick={() => router.push('/client-login')}
          className="w-full py-3 bg-[#1f3d5c] text-white rounded-xl text-sm font-bold hover:bg-[#2a4f77]">
          Request a new link
        </button>
      </div>
    </div>
  )

  const completedJobs = jobs.filter(j => ['RETURNED','CANCELLED','ARCHIVED'].includes(j.status) || j.completed_at)
  const activeJobs = jobs.filter(j => !completedJobs.includes(j))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1f3d5c] px-6 py-5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-lg">SirReel</div>
            <div className="text-blue-200 text-xs">Job History · {email}</div>
          </div>
          <div className="text-blue-200 text-xs">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Active/Upcoming */}
        {activeJobs.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Active & Upcoming</div>
            <div className="space-y-3">
              {activeJobs.map((job, i) => (
                <JobCard key={i} job={job} token={token} onSelect={setSelected} />
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {completedJobs.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Past Jobs</div>
            <div className="space-y-3">
              {completedJobs.map((job, i) => (
                <JobCard key={i} job={job} token={token} onSelect={setSelected} />
              ))}
            </div>
          </div>
        )}

        {jobs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-sm">No jobs found for this email.</div>
          </div>
        )}
      </div>

      {/* Job detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-start">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-bold">{selected.company_name}</div>
                <h3 className="text-lg font-bold text-gray-900">{selected.job_name || 'Job'}</h3>
                <div className="text-sm text-gray-500">{fmt(selected.start_date)} – {fmt(selected.end_date)}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Paperwork status */}
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Paperwork</div>
                <div className="grid grid-cols-2 gap-2">
                  <PaperworkBadge done={selected.rental_agreement} label="Rental Agreement" />
                  <PaperworkBadge done={selected.lcdw_accepted} label="LCDW" />
                  <PaperworkBadge done={selected.coi_received} label="COI" />
                  <PaperworkBadge done={selected.credit_card_auth} label="CC Auth" />
                  {selected.contract_type === 'stage' || selected.contract_type === 'both' ? (
                    <PaperworkBadge done={selected.studio_contract_signed} label="Studio Contract" />
                  ) : null}
                </div>
              </div>

              {/* Agent */}
              {selected.agent_name && (
                <div className="text-sm text-gray-500">
                  <span className="font-semibold text-gray-700">Agent:</span> {selected.agent_name}
                </div>
              )}

              {/* Portal link */}
              <a href={`/portal/${selected.portal_token}`}
                className="block w-full py-3 bg-[#1f3d5c] text-white rounded-xl text-sm font-bold text-center hover:bg-[#2a4f77] transition-colors">
                Open Job Portal →
              </a>

              {(!selected.coi_received) && (
                <a href={`/portal/${selected.portal_token}`}
                  className="block w-full py-3 border-2 border-amber-300 bg-amber-50 text-amber-700 rounded-xl text-sm font-bold text-center hover:bg-amber-100 transition-colors">
                  ⚠️ COI Required — Upload Now
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function JobCard({ job, token, onSelect }: { job: any; token: string; onSelect: (j: any) => void }) {
  const paperworkDone = [job.rental_agreement, job.lcdw_accepted, job.coi_received, job.credit_card_auth].filter(Boolean).length
  const paperworkTotal = 4
  const allDone = paperworkDone === paperworkTotal
  const needsCoi = !job.coi_received

  return (
    <div onClick={() => onSelect(job)}
      className="bg-white rounded-2xl border border-gray-200 p-4 cursor-pointer hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] text-gray-400 font-medium">{job.company_name}</div>
          <div className="text-sm font-bold text-gray-900 truncate">{job.job_name || 'Job'}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">{fmt(job.start_date)} – {fmt(job.end_date)}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
            allDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {paperworkDone}/{paperworkTotal} docs
          </div>
          {needsCoi && (
            <div className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              COI needed
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
