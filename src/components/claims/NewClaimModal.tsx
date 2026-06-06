'use client'

/**
 * One-step "Onboard active claim" form. Captures the full current
 * snapshot of a historical / in-flight claim in a single submission
 * so Ana can load the backlog without create-then-edit per field.
 *
 * Sections (all in one scrollable panel):
 *   1. Client + incident        — required: company, date of loss,
 *                                 incident description.
 *   2. Carrier + identifiers    — required: filedAgainst. Optional:
 *                                 carrierClaimNumber, policyNumber.
 *   3. Adjuster                 — optional: name / email / phone.
 *   4. Status + next action     — current ClaimStatus + nextActionAt.
 *   5. Ledger money-so-far      — every money field on the claim.
 *
 * Submits to POST /api/claims in one call. Booking/asset stay null
 * (the onboarding path). On success the new SR-CLM is minted with
 * the full snapshot and the rep lands on the detail page.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface CompanyHit {
  id: string
  name: string
}

const STATUS_CHOICES: { value: string; label: string }[] = [
  { value: 'DRAFT',         label: 'Draft' },
  { value: 'READY_TO_SEND', label: 'Ready to send' },
  { value: 'SUBMITTED',     label: 'Submitted' },
  { value: 'ACKNOWLEDGED',  label: 'Acknowledged' },
  { value: 'NEGOTIATING',   label: 'Negotiating' },
  { value: 'SETTLED',       label: 'Settled' },
  { value: 'DENIED',        label: 'Denied' },
  { value: 'ESCALATED',     label: 'Escalated' },
  { value: 'CLOSED',        label: 'Closed' },
]

export function NewClaimModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()

  // 1 — Client + incident
  const [companyQ, setCompanyQ] = useState('')
  const [companyHits, setCompanyHits] = useState<CompanyHit[]>([])
  const [company, setCompany] = useState<CompanyHit | null>(null)
  const [incidentDate, setIncidentDate] = useState('')
  const [incidentDescription, setIncidentDescription] = useState('')

  // 2 — Carrier + identifiers
  const [filedAgainst, setFiledAgainst] = useState('')
  const [carrierClaimNumber, setCarrierClaimNumber] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')

  // 3 — Adjuster
  const [adjusterName, setAdjusterName] = useState('')
  const [adjusterEmail, setAdjusterEmail] = useState('')
  const [adjusterPhone, setAdjusterPhone] = useState('')

  // 4 — Status + next action + note
  const [status, setStatus] = useState('SUBMITTED')
  const [nextActionAt, setNextActionAt] = useState('')
  const [notes, setNotes] = useState('')

  // 5 — Ledger money snapshot
  const [lossAmount, setLossAmount] = useState('')
  const [contractAmount, setContractAmount] = useState('')
  const [acvReceived, setAcvReceived] = useState('')
  const [depreciationApplied, setDepreciationApplied] = useState('')
  const [deductibleAmount, setDeductibleAmount] = useState('')
  const [adminFeeAmount, setAdminFeeAmount] = useState('')
  const [totalDemand, setTotalDemand] = useState('')
  const [amountOffered, setAmountOffered] = useState('')
  const [amountSettled, setAmountSettled] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Company typeahead — 200ms debounce, min 2 chars.
  useEffect(() => {
    let cancelled = false
    if (companyQ.trim().length < 2) { setCompanyHits([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/companies?search=${encodeURIComponent(companyQ)}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setCompanyHits((data.companies || []).slice(0, 8))
      } catch { /* empty state OK */ }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [companyQ])

  // Send only the populated fields so the server can distinguish
  // "left blank" from "explicitly empty." Numeric strings flow
  // through verbatim — the endpoint's asMoney coerces them.
  const submit = async () => {
    if (submitting) return
    setError(null)
    if (!company) { setError('Pick a renter (company).'); return }
    if (!incidentDate) { setError('Date of loss is required.'); return }
    if (incidentDescription.trim().length < 10) {
      setError('Incident description must be at least 10 characters.')
      return
    }
    if (!filedAgainst.trim()) { setError('Carrier (filedAgainst) is required.'); return }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        companyId: company.id,
        incidentDate,
        incidentDescription: incidentDescription.trim(),
        filedAgainst: filedAgainst.trim(),
        status,
      }
      // Optional strings — only include when populated.
      if (carrierClaimNumber.trim()) body.carrierClaimNumber = carrierClaimNumber.trim()
      if (policyNumber.trim())       body.policyNumber       = policyNumber.trim()
      if (adjusterName.trim())       body.adjusterName       = adjusterName.trim()
      if (adjusterEmail.trim())      body.adjusterEmail      = adjusterEmail.trim()
      if (adjusterPhone.trim())      body.adjusterPhone      = adjusterPhone.trim()
      if (nextActionAt)              body.nextActionAt       = nextActionAt
      if (notes.trim())              body.notes              = notes.trim()
      // Money fields — server coerces. Empty stays out so the column
      // remains null.
      const money = {
        lossAmount, contractAmount, acvReceived, depreciationApplied,
        deductibleAmount, adminFeeAmount, totalDemand, amountOffered, amountSettled,
      }
      for (const [k, v] of Object.entries(money)) {
        if (v.trim()) body[k] = Number(v)
      }

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
        className="w-full max-w-2xl rounded-2xl bg-white shadow-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-lt-hairline px-5 py-4">
          <h3 className="text-base font-semibold text-lt-fg">Onboard active claim</h3>
          <p className="mt-1 text-xs text-lt-fg3">
            Captures the full current snapshot in one pass — submits as a single SR-CLM with
            badges and the contract-vs-insurance ledger immediately populated. Booking and
            asset stay blank (no HQ record required for historical onboarding).
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* 1 — Client + incident */}
          <SectionHeader>Client + incident</SectionHeader>

          <Field label="Renter (Company)" required>
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
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of loss" required>
              <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>
          </div>

          <Field label="Incident / loss description" required>
            <textarea
              value={incidentDescription}
              onChange={(e) => setIncidentDescription(e.target.value)}
              rows={3}
              placeholder="What happened, what was damaged, anything material for the carrier."
              className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            <div className="text-[10px] text-lt-fg3 mt-0.5">Minimum 10 characters.</div>
          </Field>

          {/* 2 — Carrier + identifiers */}
          <SectionHeader>Carrier + identifiers</SectionHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Carrier (filed against)" required>
              <input type="text" value={filedAgainst} onChange={(e) => setFiledAgainst(e.target.value)}
                placeholder="e.g. Federated Insurance"
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>
            <Field label="Carrier claim #">
              <input type="text" value={carrierClaimNumber} onChange={(e) => setCarrierClaimNumber(e.target.value)}
                placeholder="e.g. 0AB459860"
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
            </Field>
            <Field label="Policy #">
              <input type="text" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
            </Field>
          </div>

          {/* 3 — Adjuster */}
          <SectionHeader>Adjuster</SectionHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input type="text" value={adjusterName} onChange={(e) => setAdjusterName(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>
            <Field label="Email">
              <input type="email" value={adjusterEmail} onChange={(e) => setAdjusterEmail(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>
            <Field label="Phone">
              <input type="tel" value={adjusterPhone} onChange={(e) => setAdjusterPhone(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>
          </div>

          {/* 4 — Status + next action + note */}
          <SectionHeader>Current status + next action</SectionHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current status">
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg">
                {STATUS_CHOICES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Next action due">
              <input type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>
          </div>
          <Field label="Note (internal)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What's the next thing you owe on this claim, or any private context."
              className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
          </Field>

          {/* 5 — Ledger money snapshot */}
          <SectionHeader>Money so far</SectionHeader>
          <div className="grid grid-cols-3 gap-3">
            <MoneyField label="Loss amount"      value={lossAmount}          onChange={setLossAmount} />
            <MoneyField label="Contract billed"  value={contractAmount}      onChange={setContractAmount} />
            <MoneyField label="ACV received"     value={acvReceived}         onChange={setAcvReceived} />
            <MoneyField label="Depreciation"     value={depreciationApplied} onChange={setDepreciationApplied} />
            <MoneyField label="Deductible"       value={deductibleAmount}    onChange={setDeductibleAmount} />
            <MoneyField label="Admin fee (10%)"  value={adminFeeAmount}      onChange={setAdminFeeAmount} />
            <MoneyField label="Total demand"     value={totalDemand}         onChange={setTotalDemand} />
            <MoneyField label="Amount offered"   value={amountOffered}       onChange={setAmountOffered} />
            <MoneyField label="Amount settled"   value={amountSettled}       onChange={setAmountSettled} />
          </div>
          <p className="text-[11px] text-lt-fg3">
            <span className="font-semibold">amountSettled is GROSS</span> — the dollar the carrier honored
            before the renter&apos;s deductible. The ledger nets it at compute time, so don&apos;t pre-subtract.
          </p>

          {error && (
            <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/40 px-3 py-2 text-xs text-chip-bad-fg">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-lt-hairline bg-white px-5 py-3 flex items-center justify-end gap-2">
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
            disabled={submitting || !company || !incidentDate || incidentDescription.trim().length < 10 || !filedAgainst.trim()}
            className="text-xs font-semibold bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white px-4 py-2 rounded-lg"
          >
            {submitting ? 'Creating…' : 'Create claim →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-lt-hairline pt-4 -mt-1 text-[10px] uppercase tracking-wider font-semibold text-lt-fg3 first:border-t-0 first:pt-0">
      {children}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-lt-fg3 mb-1">
        {label}
        {required && <span className="text-chip-bad-fg ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center rounded-lg border border-lt-hairline bg-lt-inner focus-within:border-lt-fg2">
        <span className="pl-3 text-lt-fg3 text-sm">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent px-2 py-2 text-sm text-lt-fg font-mono focus:outline-none"
        />
      </div>
    </Field>
  )
}
