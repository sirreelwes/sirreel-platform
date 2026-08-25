'use client'

/**
 * The two fields the Quick Reply email would have carried if email could
 * carry fields (it can't — Gmail strips <form>). Posts to the public,
 * token-scoped POST /api/public/client-details.
 *
 * Deliberately plain: two text inputs and a button, no CRM typeahead. A
 * client picking from our company list would leak who else we work with,
 * and matching is the agent's job on accept anyway — see the accept path
 * in ClientDetailSuggestion.
 */

import { useState } from 'react'

interface Props {
  token: string
  /** Which fields we were actually missing, from the signed token. */
  ask: { company: boolean; project: boolean }
}

export function ClientDetailsForm({ token, ask }: Props) {
  const [company, setCompany] = useState('')
  const [project, setProject] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ask for at least one field even if the token somehow says neither.
  const wantCompany = ask.company || !ask.project
  const wantProject = ask.project || !ask.company

  const ready =
    (!wantCompany || company.trim().length > 1) && (!wantProject || project.trim().length > 1)

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/public/client-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          companyName: wantCompany ? company.trim() : null,
          projectName: wantProject ? project.trim() : null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setError(json?.error || 'Something went wrong. Please reply to our email instead.')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong. Please reply to our email instead.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[#cfe3cf] bg-[#f2f8f2] px-4 py-5 text-center">
        <div className="text-[22px]" aria-hidden>✓</div>
        <div className="mt-1 text-[15px] font-semibold text-[#0c0c0d]">Thank you — got it</div>
        <p className="mt-1 text-[13px] text-[#5b554b]">
          Your rep has what they need and will follow up shortly. You can close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {wantCompany && (
        <label className="block">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-[#5b554b]">
            Production company
          </span>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Ridgeline Pictures, LLC"
            autoFocus
            className="mt-1.5 block w-full rounded-lg border border-[#d8d2c6] bg-white px-3 py-2.5 text-[15px] text-[#0c0c0d] focus:border-[#c39a3f] focus:outline-none focus:ring-1 focus:ring-[#c39a3f]"
          />
          <span className="mt-1 block text-[12px] text-[#8a8375]">
            Whoever the rental is billed to.
          </span>
        </label>
      )}

      {wantProject && (
        <label className="block">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-[#5b554b]">
            Project name
          </span>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="e.g. Foul Play S2"
            autoFocus={!wantCompany}
            className="mt-1.5 block w-full rounded-lg border border-[#d8d2c6] bg-white px-3 py-2.5 text-[15px] text-[#0c0c0d] focus:border-[#c39a3f] focus:outline-none focus:ring-1 focus:ring-[#c39a3f]"
          />
          <span className="mt-1 block text-[12px] text-[#8a8375]">
            The show or spot this is for — a working title is fine.
          </span>
        </label>
      )}

      {error && (
        <div className="rounded-lg border border-[#e6c4c4] bg-[#fbf2f2] px-3 py-2 text-[13px] text-[#8a2f2f]">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!ready || busy}
        className="w-full rounded-lg bg-[#c07a2c] px-4 py-3 text-[15px] font-bold text-white transition-colors hover:bg-[#a9691f] disabled:cursor-not-allowed disabled:bg-[#d9d3c7]"
      >
        {busy ? 'Sending…' : 'Send to my rep'}
      </button>
    </div>
  )
}
