'use client'

/**
 * Branch C "new job" form (client side of /portal/agreement-start/[token]).
 * Submit posts to /api/public/agreement-start/[token]; on success shows the
 * two next-step buttons — "Sign your rental agreement →" (portal magic link,
 * paperwork ready) and "Start your order →" (public order form). Honeypot
 * mirrors the other public intakes.
 *
 * Name fields arrive prefilled when the gate recognised the sender, and stay
 * editable — the address on file isn't always the person filling this in.
 *
 * The company field suggests existing clients as you type (see the companies
 * route for what that exposes and why). Picking a suggestion means the new
 * job attaches to that client's existing record, so it also asks the person
 * to confirm they're authorized to book for them.
 */
import { useEffect, useRef, useState } from 'react'

const field =
  'w-full px-3 py-2 border border-[#ddd7c9] rounded-lg text-[14px] text-[#1a1a1a] placeholder:text-[#b7b0a0] focus:outline-none focus:border-[#1a1a1a] bg-white'
const label = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8b8272] mb-1'

export function AgreementStartForm({
  token,
  initialFirstName = '',
  initialLastName = '',
}: {
  token: string
  initialFirstName?: string
  initialLastName?: string
}) {
  const [jobName, setJobName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<null | { portalUrl: string; orderFormUrl: string }>(null)

  // Company typeahead
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showList, setShowList] = useState(false)
  // Set once the typed name matches a known client — that's when the
  // attestation applies, because the job will attach to their record.
  const [matchedExisting, setMatchedExisting] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  // Enough of a name to attest against.
  const showAttestation = companyName.trim().length >= 2

  // Debounced lookup. 250ms is long enough that a fast typist makes one
  // request instead of one per keystroke.
  useEffect(() => {
    const q = companyName.trim()
    if (q.length < 3) {
      setSuggestions([])
      setMatchedExisting(false)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/public/agreement-start/${encodeURIComponent(token)}/companies?q=${encodeURIComponent(q)}`,
        )
        const d = (await r.json().catch(() => ({}))) as { companies?: string[] }
        if (cancelled) return
        const list = d.companies ?? []
        setSuggestions(list)
        // Only ever PROMOTE to matched here. An empty or slow response used to
        // clear a match the user had explicitly selected from the list.
        if (list.some((c) => c.toLowerCase() === q.toLowerCase())) setMatchedExisting(true)
      } catch {
        if (!cancelled) setSuggestions([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [companyName, token])

  // Close the list on an outside click — without this it hangs over the
  // fields below and swallows taps on mobile.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowList(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (showAttestation && !authorized) {
      setErr('Please confirm you’re authorized to book for this company.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/public/agreement-start/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobName,
          companyName,
          firstName,
          lastName,
          startDate: startDate || null,
          endDate: endDate || null,
          authorizedRepresentative: matchedExisting ? authorized : null,
          website,
        }),
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
        <label className={label} htmlFor="sr-jobname">Job / production name *</label>
        <input id="sr-jobname" className={field} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. Night Shoot — Season 2" required maxLength={200} />
      </div>

      <div ref={boxRef} className="relative">
        <label className={label} htmlFor="sr-company">Company *</label>
        <input
          id="sr-company"
          className={field}
          value={companyName}
          onChange={(e) => {
            setCompanyName(e.target.value)
            setShowList(true)
            // Without this the previous submit error stays on screen while
            // the field it refers to has already changed.
            setErr(null)
          }}
          onFocus={() => setShowList(true)}
          placeholder="Production company"
          required
          maxLength={200}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList && suggestions.length > 0}
          aria-autocomplete="list"
          aria-controls="sr-company-list"
        />
        {showList && suggestions.length > 0 && (
          <ul
            id="sr-company-list"
            role="listbox"
            className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#ddd7c9] rounded-lg shadow-sm max-h-[190px] overflow-y-auto list-none p-0 m-0"
          >
            {suggestions.map((c) => (
              <li key={c} role="option" aria-selected={c.toLowerCase() === companyName.trim().toLowerCase()}>
                <button
                  type="button"
                  onClick={() => {
                    setCompanyName(c)
                    setMatchedExisting(true)
                    setShowList(false)
                  }}
                  className="w-full text-left px-3 py-2 text-[13.5px] text-[#1a1a1a] bg-transparent border-0 cursor-pointer hover:bg-[#f5f3ee]"
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Shown whenever a company is named, NOT gated on matchedExisting.
            That flag is recomputed on every keystroke and a transient empty
            lookup flips it false — which left the submit error on screen with
            no checkbox to satisfy it, making the form impossible to submit.
            Attesting is reasonable for any company, so the gate goes away. */}
        {showAttestation && (
          <label className="mt-2 flex items-start gap-2 text-[12.5px] leading-relaxed text-[#555] cursor-pointer">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
              className="mt-[3px] flex-none"
            />
            <span>
              I am an authorized representative of <strong>{companyName.trim()}</strong> and may book
              on their behalf.
            </span>
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="sr-first">First name *</label>
          <input id="sr-first" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
        </div>
        <div>
          <label className={label} htmlFor="sr-last">Last name</label>
          <input id="sr-last" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="sr-start">Start date</label>
          <input id="sr-start" className={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="sr-end">End date</label>
          <input id="sr-end" className={field} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
