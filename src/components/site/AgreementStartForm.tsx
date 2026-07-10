'use client'

/**
 * Branch C "new job" form (client side of /portal/agreement-start/[token]).
 * Submit posts to /api/public/agreement-start/[token]; on success shows the
 * two next-step buttons — "Sign your rental agreement →" (portal magic link,
 * paperwork ready) and "Start your order →" (public order form). Honeypot
 * mirrors the other public intakes.
 */
import { useState } from 'react'

const field =
  'w-full px-3 py-2 border border-[#ddd7c9] rounded-lg text-[14px] text-[#1a1a1a] placeholder:text-[#b7b0a0] focus:outline-none focus:border-[#1a1a1a] bg-white'
const label = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8b8272] mb-1'

export function AgreementStartForm({ token }: { token: string }) {
  const [jobName, setJobName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<null | { portalUrl: string; orderFormUrl: string }>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/public/agreement-start/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobName, companyName, firstName, lastName, startDate: startDate || null, endDate: endDate || null, website }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok || !d.portalUrl) {
        setErr(d.error || 'Something went wrong — please try again.')
        return
      }
      setDone({ portalUrl: d.portalUrl, orderFormUrl: d.orderFormUrl })
    } catch {
      setErr('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-2">
        <h2 className="text-[18px] font-serif text-[#1a1a1a] m-0">You&rsquo;re set up.</h2>
        <p className="mt-2 mb-6 text-[13.5px] text-[#555]">
          Your job portal is ready — sign the rental agreement, then build your order whenever
          you&rsquo;re ready.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <a href={done.portalUrl} style={{ background: '#D4A547', color: '#1a1a1a' }} className="inline-block font-semibold text-[15px] px-7 py-3 rounded-lg no-underline">
            Sign your rental agreement →
          </a>
          <a href={done.orderFormUrl} className="inline-block font-semibold text-[13px] px-6 py-2.5 rounded-lg border border-[#1a1a1a] text-[#1a1a1a] no-underline">
            Start your order →
          </a>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label}>Job / production name *</label>
        <input className={field} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. Night Shoot — Season 2" required maxLength={200} />
      </div>
      <div>
        <label className={label}>Company *</label>
        <input className={field} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Production company" required maxLength={200} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>First name *</label>
          <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
        </div>
        <div>
          <label className={label}>Last name</label>
          <input className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Start date</label>
          <input className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={label}>End date</label>
          <input className={field} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      {/* Honeypot — hidden from humans; bots fill it. */}
      <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }} placeholder="website" />
      {err && <p className="text-[12.5px] text-rose-600 m-0">{err}</p>}
      <button type="submit" disabled={busy} style={{ background: '#D4A547', color: '#1a1a1a' }} className="w-full font-semibold text-[15px] px-6 py-3 rounded-lg border-0 cursor-pointer disabled:opacity-50">
        {busy ? 'Setting up…' : 'Create my job & open the paperwork →'}
      </button>
    </form>
  )
}
