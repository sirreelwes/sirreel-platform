'use client'

/**
 * "+ New Job" — the manual entry point and the resolver's demo
 * call-site (Job-as-root step 2). Gathers the minimal facts, then
 * hands them to JobResolverModal, which ranks existing Jobs before
 * anything is created. The agent always makes the new-vs-existing
 * call; nothing is created until they choose.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal'

export function NewJobLauncher({ buttonClassName }: { buttonClassName?: string } = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const reset = () => {
    setName(''); setCompany(''); setContactName(''); setContactPhone(''); setContactEmail('')
    setOpen(false); setResolving(false)
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
              <div>
                <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Production company *</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
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
                disabled={!name.trim() || !company.trim()}
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
