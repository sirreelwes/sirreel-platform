'use client'

/**
 * Manual onboarding modal — opens from the /claims dashboard's
 * "+ New claim" button. POSTs to /api/claims with the minimum set
 * (company + carrier + incident date + incident text) plus any
 * adjuster / money-so-far fields the rep wants to seed.
 *
 * Booking + asset are intentionally OMITTED here — they're nullable
 * now, and historical onboarding rarely has an HQ booking/asset
 * record to point at. If the claim opens from an actual LD invoice
 * later, that goes through /api/invoices/[id]/claim (openLdClaim)
 * which DOES require + derive booking/asset from the invoice graph.
 *
 * On success: navigates to the new /claims/[id] detail page so the
 * rep can flesh out the rest of the fields via the existing
 * diff-PATCH form.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface CompanyHit {
  id: string
  name: string
}

export function NewClaimModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()

  // Company typeahead — uses the existing /api/crm/companies?search=
  // which the CRM list already calls. No new endpoint needed.
  const [companyQ, setCompanyQ] = useState('')
  const [companyHits, setCompanyHits] = useState<CompanyHit[]>([])
  const [company, setCompany] = useState<CompanyHit | null>(null)

  const [filedAgainst, setFiledAgainst] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [incidentDescription, setIncidentDescription] = useState('')

  // Optional money-so-far + adjuster — collapsed by default to keep
  // the required-fields view tight. Rep can flesh out post-create on
  // the detail page either way.
  const [more, setMore] = useState(false)
  const [policyNumber, setPolicyNumber] = useState('')
  const [carrierClaimNumber, setCarrierClaimNumber] = useState('')
  const [adjusterName, setAdjusterName] = useState('')
  const [adjusterEmail, setAdjusterEmail] = useState('')
  const [adjusterPhone, setAdjusterPhone] = useState('')
  const [repairEstimate, setRepairEstimate] = useState('')
  const [totalDemand, setTotalDemand] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Typeahead — debounce-light: re-fire whenever the query changes.
  // Cap min length at 2 so a single character doesn't blast the API.
  useEffect(() => {
    let cancelled = false
    if (companyQ.trim().length < 2) {
      setCompanyHits([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/companies?search=${encodeURIComponent(companyQ)}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setCompanyHits((data.companies || []).slice(0, 8))
      } catch {
        // ignore — empty state is fine
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [companyQ])

  const submit = async () => {
    if (submitting) return
    setError(null)
    if (!company) { setError('Pick a company.'); return }
    if (!filedAgainst.trim()) { setError('Carrier required.'); return }
    if (!incidentDate) { setError('Incident date required.'); return }
    if (incidentDescription.trim().length < 10) {
      setError('Incident description must be at least 10 characters.')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        companyId: company.id,
        filedAgainst: filedAgainst.trim(),
        incidentDate,
        incidentDescription: incidentDescription.trim(),
      }
      if (policyNumber.trim()) body.policyNumber = policyNumber.trim()
      if (carrierClaimNumber.trim()) body.carrierClaimNumber = carrierClaimNumber.trim()
      if (adjusterName.trim()) body.adjusterName = adjusterName.trim()
      if (adjusterEmail.trim()) body.adjusterEmail = adjusterEmail.trim()
      if (adjusterPhone.trim()) body.adjusterPhone = adjusterPhone.trim()
      // Money fields seeded on create flow through PATCH-shape, not the
      // create endpoint (which doesn't accept them). Rep adds them on
      // the detail page after redirect.
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Create failed (HTTP ${res.status})`)
        return
      }
      // If the rep filled money-so-far, PATCH the new claim before
      // routing. Lets them seed all values from one open.
      const seedMoney: Record<string, number> = {}
      if (repairEstimate.trim()) seedMoney.repairEstimate = Number(repairEstimate)
      if (totalDemand.trim())    seedMoney.totalDemand    = Number(totalDemand)
      if (Object.keys(seedMoney).length > 0) {
        await fetch(`/api/claims/${data.claim.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(seedMoney),
        }).catch(() => null)
      }
      router.push(`/claims/${data.claim.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-base font-semibold text-lt-fg">Onboard a claim</h3>
          <p className="mt-1 text-xs text-lt-fg3">
            For historical / in-flight claims that didn&apos;t come through an LD invoice.
            Booking + asset are optional — leave blank if there&apos;s no HQ record.
          </p>
        </div>

        {/* Company picker */}
        <div className="mb-3">
          <label className="block text-[11px] uppercase tracking-wider text-lt-fg3 mb-1">Renter (Company)</label>
          {company ? (
            <div className="flex items-center justify-between rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm">
              <span className="text-lt-fg">{company.name}</span>
              <button onClick={() => setCompany(null)} className="text-xs text-lt-fg3 hover:text-lt-fg">Change</button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={companyQ}
                onChange={(e) => setCompanyQ(e.target.value)}
                placeholder="Search company by name…"
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
              />
              {companyHits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-lt-hairline bg-white shadow-md max-h-56 overflow-y-auto">
                  {companyHits.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCompany(c); setCompanyQ(''); setCompanyHits([]) }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-lt-inner"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <Field label="Carrier (filed against)">
          <input
            type="text"
            value={filedAgainst}
            onChange={(e) => setFiledAgainst(e.target.value)}
            placeholder="e.g. Federated Insurance"
            className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
          />
        </Field>

        <Field label="Incident date">
          <input
            type="date"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
          />
        </Field>

        <Field label="Incident description">
          <textarea
            value={incidentDescription}
            onChange={(e) => setIncidentDescription(e.target.value)}
            rows={3}
            placeholder="Short summary — what happened, what was damaged."
            className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg"
          />
          <div className="text-[10px] text-lt-fg3 mt-0.5">Minimum 10 characters.</div>
        </Field>

        {/* Optional fields toggle */}
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="text-[11px] text-lt-fg2 hover:text-lt-fg font-semibold mb-2"
        >
          {more ? '− Hide adjuster + money fields' : '+ Add adjuster + money fields'}
        </button>
        {more && (
          <div className="space-y-3 mb-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Policy #">
                <input type="text" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Carrier claim #">
                <input type="text" value={carrierClaimNumber} onChange={(e) => setCarrierClaimNumber(e.target.value)}
                  placeholder="e.g. 0AB459860"
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
              </Field>
              <Field label="Adjuster name">
                <input type="text" value={adjusterName} onChange={(e) => setAdjusterName(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Adjuster email">
                <input type="email" value={adjusterEmail} onChange={(e) => setAdjusterEmail(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Adjuster phone">
                <input type="tel" value={adjusterPhone} onChange={(e) => setAdjusterPhone(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Repair estimate ($)">
                <input type="text" inputMode="decimal" value={repairEstimate} onChange={(e) => setRepairEstimate(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
              </Field>
              <Field label="Total demand ($)">
                <input type="text" inputMode="decimal" value={totalDemand} onChange={(e) => setTotalDemand(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/40 px-3 py-2 text-xs text-chip-bad-fg">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-xs font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !company || !filedAgainst.trim() || !incidentDate || incidentDescription.trim().length < 10}
            className="text-xs font-semibold bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white px-3 py-1.5 rounded-lg"
          >
            {submitting ? 'Creating…' : 'Create claim →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-[11px] uppercase tracking-wider text-lt-fg3 mb-1">{label}</label>
      {children}
    </div>
  )
}
