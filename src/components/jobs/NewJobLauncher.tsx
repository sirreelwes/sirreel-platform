'use client'

/**
 * "+ New Job" — the manual entry point and the resolver's demo
 * call-site (Job-as-root step 2). Gathers the minimal facts, then
 * hands them to JobResolverModal, which ranks existing Jobs before
 * anything is created. The agent always makes the new-vs-existing
 * call; nothing is created until they choose.
 *
 * Production company is a live typeahead over /api/companies: pick an
 * existing company (links by id — no duplicate) OR explicitly create a
 * new one from what you typed (companyId stays null → the resolver
 * creates it server-side).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal'

interface CompanyHit {
  id: string
  name: string
}

export function NewJobLauncher({ buttonClassName }: { buttonClassName?: string } = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyResults, setCompanyResults] = useState<CompanyHit[]>([])
  const [companySearching, setCompanySearching] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const reset = () => {
    setName(''); setCompany(''); setCompanyId(null); setCompanyResults([]); setCompanyOpen(false)
    setContactName(''); setContactPhone(''); setContactEmail('')
    setOpen(false); setResolving(false)
  }

  const searchCompanies = async (q: string) => {
    setCompany(q)
    setCompanyId(null) // typing invalidates any prior pick
    setCompanyOpen(true)
    if (q.trim().length < 1) {
      setCompanyResults([]); setCompanySearching(false)
      return
    }
    setCompanySearching(true)
    try {
      const res = await fetch(`/api/companies?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setCompanyResults(data.companies || [])
    } catch {
      setCompanyResults([])
    } finally {
      setCompanySearching(false)
    }
  }

  const pickCompany = (c: CompanyHit) => {
    setCompany(c.name); setCompanyId(c.id); setCompanyResults([]); setCompanyOpen(false)
  }

  // Keep the typed name as a NEW company (companyId null → server creates it).
  const useTypedAsNew = () => {
    setCompanyId(null); setCompanyResults([]); setCompanyOpen(false)
  }

  const onResolved = (job: ResolvedJob) => {
    setConfirmation(
      job.created
        ? `Created ${job.jobCode} — ${job.name}`
        : `Added to existing ${job.jobCode} — ${job.name}`,
    )
    reset()
    router.refresh()
    setTimeout(() => setConfirmation(null), 6000)
  }

  const typed = company.trim()
  const exactExists = companyResults.some((c) => c.name.toLowerCase() === typed.toLowerCase())

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={buttonClassName ?? 'px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-semibold'}
      >
        + New Job
      </button>
      {confirmation && (
        <span className="ml-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
          ✓ {confirmation}
        </span>
      )}

      {open && !resolving && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={reset}>
          <div className="bg-white rounded-2xl w-[460px] max-w-[95vw] p-5 shadow-2xl border border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">New Job</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Enter what you know — we&rsquo;ll check for an existing Job first.</p>
              </div>
              <button onClick={reset} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Job name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
              </div>
              <div className="relative">
                <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Production company *</label>
                <input
                  value={company}
                  onChange={(e) => searchCompanies(e.target.value)}
                  onFocus={() => { if (typed.length > 0 && !companyId) setCompanyOpen(true) }}
                  placeholder="Search existing or type a new company…"
                  autoComplete="off"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
                />
                {companyId && (
                  <div className="text-[10px] text-emerald-600 mt-0.5">✓ existing company — will be linked, not duplicated</div>
                )}
                {companyOpen && typed.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                    {companySearching && <div className="px-3 py-2 text-xs text-gray-400">Searching…</div>}
                    {!companySearching && companyResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickCompany(c)}
                        className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
                      >
                        {c.name}
                      </button>
                    ))}
                    {!companySearching && !exactExists && (
                      <button
                        type="button"
                        onClick={useTypedAsNew}
                        className="w-full text-left px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 border-t border-gray-100"
                      >
                        ＋ Create new company: “{typed}”
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Contact name</label>
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Phone</label>
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Email</label>
                  <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                </div>
              </div>
              <button
                onClick={() => setResolving(true)}
                disabled={!name.trim() || !typed}
                className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold"
              >
                Continue — check for existing Jobs →
              </button>
            </div>
          </div>
        </div>
      )}

      {open && resolving && (
        <JobResolverModal
          context={{
            jobNameHint: name,
            companyId,
            companyName: company,
            contactName,
            contactPhone,
            contactEmail,
            sourceRef: 'manual:new-job-launcher',
          }}
          onResolved={onResolved}
          onClose={() => setResolving(false)}
        />
      )}
    </>
  )
}
