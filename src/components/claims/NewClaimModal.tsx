'use client'

/**
 * "Onboard active claim" modal — paste-to-prefill is the primary
 * path; manual field entry stays as the fallback.
 *
 * Three states:
 *   1. CHOOSE       — two big mode cards. Paste (primary) or Manual.
 *   2. PASTE        — textarea + "Parse & continue" button. After
 *                     parse: dedup warning (if applicable) + company
 *                     match picker, then the form pre-filled with
 *                     AI-extracted values (each marked so the rep
 *                     verifies before submit).
 *   3. FORM         — full snapshot form, same as the prior
 *                     manual-only path. AI-extracted fields carry a
 *                     small "AI" badge so the rep knows what came
 *                     from the parse.
 *
 * After a successful POST /api/claims, we POST the raw pasted text
 * to /api/claims/[id]/paste-document so the source chain is
 * preserved as a ClaimDocument(CORRESPONDENCE) row. Failure there
 * is non-fatal — the claim is already created.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface CompanyHit { id: string; name: string }
interface ParsedClaim {
  clientCompanyName: string | null
  carrierName: string | null
  carrierClaimNumber: string | null
  policyNumber: string | null
  adjusterName: string | null
  adjusterEmail: string | null
  adjusterPhone: string | null
  lossDescription: string | null
  dateOfLoss: string | null
  lossAmount: number | null
  acvReceived: number | null
  depreciationApplied: number | null
  deductibleAmount: number | null
  totalDemand: number | null
  amountOffered: number | null
  amountSettled: number | null
  statusGuess: string | null
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

type Step = 'CHOOSE' | 'PASTE' | 'FORM'

export function NewClaimModal({
  onClose,
  prefillFromClaimMailId,
}: {
  onClose: () => void
  /**
   * Optional ClaimMail row id. When set, the modal skips the
   * CHOOSE/PASTE steps and lands directly on FORM with the stored
   * parse already populating the fields. The reviewer just adds the
   * missing carrier + claim# and saves.
   */
  prefillFromClaimMailId?: string
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(prefillFromClaimMailId ? 'FORM' : 'CHOOSE')

  // ── Paste-mode state ────────────────────────────────────────────
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<{
    found: boolean;
    existing?: { id: string; claimNumber: string; status: string; filedAgainst: string };
  } | null>(null)
  const [proceedAnyway, setProceedAnyway] = useState(false)
  // Field-level "this came from the AI" markers so the form can show
  // a small chip next to each prefilled field.
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set())
  // Whether the form values were seeded from a parse — drives the
  // paste-document attach call after a successful create.
  const [parseUsed, setParseUsed] = useState(false)

  // ── Form state — same shape as the previous one-step form ──────
  const [companyQ, setCompanyQ] = useState('')
  const [companyHits, setCompanyHits] = useState<CompanyHit[]>([])
  const [company, setCompany] = useState<CompanyHit | null>(null)
  const [incidentDate, setIncidentDate] = useState('')
  const [incidentDescription, setIncidentDescription] = useState('')
  const [filedAgainst, setFiledAgainst] = useState('')
  const [carrierClaimNumber, setCarrierClaimNumber] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [adjusterName, setAdjusterName] = useState('')
  const [adjusterEmail, setAdjusterEmail] = useState('')
  const [adjusterPhone, setAdjusterPhone] = useState('')
  const [status, setStatus] = useState('SUBMITTED')
  const [nextActionAt, setNextActionAt] = useState('')
  const [notes, setNotes] = useState('')
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
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Pre-fill from a ClaimMail row when the caller passed an id. Same
  // seed-logic shape as the paste-flow's parsePaste(), just sourced
  // from the persisted parse instead of a fresh Sonnet call. Fires
  // exactly once.
  useEffect(() => {
    if (!prefillFromClaimMailId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/claims/mail-triage/${prefillFromClaimMailId}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const ex = (data.row?.parse ?? null) as ParsedClaim | null
        if (!ex) return
        const fills = new Set<string>()
        const ifPresent = (key: string, v: unknown, setter: (s: string) => void) => {
          if (v == null) return
          setter(String(v))
          fills.add(key)
        }
        ifPresent('filedAgainst', ex.carrierName, setFiledAgainst)
        ifPresent('carrierClaimNumber', ex.carrierClaimNumber, setCarrierClaimNumber)
        ifPresent('policyNumber', ex.policyNumber, setPolicyNumber)
        ifPresent('adjusterName', ex.adjusterName, setAdjusterName)
        ifPresent('adjusterEmail', ex.adjusterEmail, setAdjusterEmail)
        ifPresent('adjusterPhone', ex.adjusterPhone, setAdjusterPhone)
        ifPresent('incidentDescription', ex.lossDescription, setIncidentDescription)
        ifPresent('incidentDate', ex.dateOfLoss, setIncidentDate)
        ifPresent('lossAmount', ex.lossAmount, setLossAmount)
        ifPresent('acvReceived', ex.acvReceived, setAcvReceived)
        ifPresent('depreciationApplied', ex.depreciationApplied, setDepreciationApplied)
        ifPresent('deductibleAmount', ex.deductibleAmount, setDeductibleAmount)
        ifPresent('totalDemand', ex.totalDemand, setTotalDemand)
        ifPresent('amountOffered', ex.amountOffered, setAmountOffered)
        ifPresent('amountSettled', ex.amountSettled, setAmountSettled)
        if (ex.statusGuess) {
          setStatus(ex.statusGuess)
          fills.add('status')
        }
        if (ex.clientCompanyName) {
          // Pre-seed the company-search box. The typeahead will fire on
          // its own and populate hits; reviewer picks the right one.
          setCompanyQ(ex.clientCompanyName)
        }
        setAiFilled(fills)
        setParseUsed(true)
      } catch { /* network blip — modal still usable empty */ }
    })()
    return () => { cancelled = true }
  }, [prefillFromClaimMailId])

  // Manual company typeahead (also used after paste when the parse
  // didn't auto-resolve a company).
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

  const parsePaste = async () => {
    if (pasteText.trim().length < 30 || parsing) return
    setParsing(true)
    setParseError(null)
    setDuplicate(null)
    try {
      const res = await fetch('/api/claims/parse-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setParseError(data?.error || `Parse failed (HTTP ${res.status})`)
        return
      }
      const ex = data.extracted as ParsedClaim
      const matches = (data.companyMatches || []) as CompanyHit[]
      const dup = data.duplicate as typeof duplicate

      // Seed the form. Track every prefilled field in aiFilled so
      // the rendered form can mark them. Only mark fields where the
      // LLM gave us a non-null value — the rep can tell at a glance
      // which fields they need to verify vs which they need to fill.
      const fills = new Set<string>()
      const ifPresent = (key: string, v: unknown, setter: (s: string) => void) => {
        if (v == null) return
        setter(String(v))
        fills.add(key)
      }

      ifPresent('filedAgainst', ex.carrierName, setFiledAgainst)
      ifPresent('carrierClaimNumber', ex.carrierClaimNumber, setCarrierClaimNumber)
      ifPresent('policyNumber', ex.policyNumber, setPolicyNumber)
      ifPresent('adjusterName', ex.adjusterName, setAdjusterName)
      ifPresent('adjusterEmail', ex.adjusterEmail, setAdjusterEmail)
      ifPresent('adjusterPhone', ex.adjusterPhone, setAdjusterPhone)
      ifPresent('incidentDescription', ex.lossDescription, setIncidentDescription)
      ifPresent('incidentDate', ex.dateOfLoss, setIncidentDate)
      ifPresent('lossAmount', ex.lossAmount, setLossAmount)
      ifPresent('acvReceived', ex.acvReceived, setAcvReceived)
      ifPresent('depreciationApplied', ex.depreciationApplied, setDepreciationApplied)
      ifPresent('deductibleAmount', ex.deductibleAmount, setDeductibleAmount)
      ifPresent('totalDemand', ex.totalDemand, setTotalDemand)
      ifPresent('amountOffered', ex.amountOffered, setAmountOffered)
      ifPresent('amountSettled', ex.amountSettled, setAmountSettled)
      if (ex.statusGuess) {
        setStatus(ex.statusGuess)
        fills.add('status')
      }

      // Company match: only auto-pick on exactly one hit. Otherwise
      // surface the list so the rep confirms (or searches further).
      if (matches.length === 1) {
        setCompany(matches[0])
        fills.add('company')
      } else if (matches.length > 1) {
        setCompanyHits(matches)
        setCompanyQ(ex.clientCompanyName ?? '')
      } else if (ex.clientCompanyName) {
        // No hits — pre-seed the search box with the extracted name
        // so the rep doesn't have to retype to discover the absence.
        setCompanyQ(ex.clientCompanyName)
      }

      setAiFilled(fills)
      setParseUsed(true)
      setDuplicate(dup ?? null)
      setProceedAnyway(false)
      setStep('FORM')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setParsing(false)
    }
  }

  const submit = async () => {
    if (submitting) return
    setSubmitError(null)
    if (!company) { setSubmitError('Pick a renter (company).'); return }
    if (!incidentDate) { setSubmitError('Date of loss is required.'); return }
    if (incidentDescription.trim().length < 10) {
      setSubmitError('Incident description must be at least 10 characters.')
      return
    }
    if (!filedAgainst.trim()) { setSubmitError('Carrier (filedAgainst) is required.'); return }
    if (duplicate?.found && !proceedAnyway) {
      setSubmitError('Resolve the duplicate-carrier-number warning above (or check "proceed anyway").')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        companyId: company.id,
        incidentDate,
        incidentDescription: incidentDescription.trim(),
        filedAgainst: filedAgainst.trim(),
        status,
      }
      if (carrierClaimNumber.trim()) body.carrierClaimNumber = carrierClaimNumber.trim()
      if (policyNumber.trim())       body.policyNumber       = policyNumber.trim()
      if (adjusterName.trim())       body.adjusterName       = adjusterName.trim()
      if (adjusterEmail.trim())      body.adjusterEmail      = adjusterEmail.trim()
      if (adjusterPhone.trim())      body.adjusterPhone      = adjusterPhone.trim()
      if (nextActionAt)              body.nextActionAt       = nextActionAt
      if (notes.trim())              body.notes              = notes.trim()
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
        setSubmitError(data?.error || `Create failed (HTTP ${res.status})`)
        return
      }
      const newId = data.claim.id as string

      // If we came from paste, attach the raw text as a
      // ClaimDocument so the source chain is preserved. Non-fatal —
      // the claim is already created either way.
      if (parseUsed && pasteText.trim().length >= 30) {
        try {
          await fetch(`/api/claims/${newId}/paste-document`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: pasteText, parseUsed: true }),
          })
        } catch { /* non-fatal */ }
      }

      router.push(`/claims/${newId}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-lt-hairline px-5 py-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-lt-fg">Onboard active claim</h3>
            <p className="mt-1 text-xs text-lt-fg3">
              {step === 'CHOOSE' && 'Paste a forwarded email chain to pre-fill, or enter manually.'}
              {step === 'PASTE' && 'Paste the full chain — Claude will extract carrier, adjuster, dates, and money so far.'}
              {step === 'FORM' && parseUsed && 'Verify the AI-extracted fields, fill any gaps, then submit.'}
              {step === 'FORM' && !parseUsed && 'Captures the full snapshot in one pass.'}
            </p>
          </div>
          {step !== 'CHOOSE' && (
            <button
              type="button"
              onClick={() => setStep('CHOOSE')}
              className="text-[11px] text-lt-fg3 hover:text-lt-fg"
            >
              ← Restart
            </button>
          )}
        </div>

        {step === 'CHOOSE' && (
          <div className="p-5 space-y-3">
            <ModeCard
              title="Paste email chain"
              kicker="Primary"
              description="Drop a forwarded thread; Claude extracts carrier, adjuster, dates, and money so far. You review every field."
              onClick={() => setStep('PASTE')}
            />
            <ModeCard
              title="Enter manually"
              kicker="Fallback"
              description="Type each field yourself. Use this when there's no email chain or the parse won't help."
              onClick={() => { setParseUsed(false); setAiFilled(new Set()); setStep('FORM') }}
            />
          </div>
        )}

        {step === 'PASTE' && (
          <div className="p-5 space-y-3">
            <label className="block text-[11px] uppercase tracking-wider text-lt-fg3">
              Pasted email chain
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={14}
              placeholder="Paste the forwarded email chain here (from / to / subject / body — everything you have)."
              className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-xs text-lt-fg font-mono"
            />
            <div className="flex items-center justify-between text-[11px] text-lt-fg3">
              <span>{pasteText.length.toLocaleString()} characters · minimum 30</span>
              {parsing && <span className="text-lt-fg2">Parsing — Sonnet usually takes 3-6s for a chain…</span>}
            </div>
            {parseError && (
              <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/40 px-3 py-2 text-xs text-chip-bad-fg">
                {parseError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep('CHOOSE')}
                disabled={parsing}
                className="text-xs font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50 px-3 py-1.5"
              >
                Back
              </button>
              <button
                type="button"
                onClick={parsePaste}
                disabled={parsing || pasteText.trim().length < 30}
                className="text-xs font-semibold bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white px-4 py-2 rounded-lg"
              >
                {parsing ? 'Parsing…' : 'Parse & continue →'}
              </button>
            </div>
          </div>
        )}

        {step === 'FORM' && (
          <div className="p-5 space-y-5">
            {/* Dedup warning — shown only when parse-mode found a match */}
            {duplicate?.found && duplicate.existing && (
              <div className="rounded-lg border border-chip-warn-fg/30 bg-chip-warn-bg/50 px-3 py-2.5 text-xs text-chip-warn-fg">
                <div className="font-semibold">A claim already exists with this carrier #</div>
                <div className="mt-1 text-lt-fg2">
                  <span className="font-mono">{duplicate.existing.claimNumber}</span>
                  {' · '}{duplicate.existing.status}
                  {' · '}{duplicate.existing.filedAgainst}
                  {' — '}
                  <a href={`/claims/${duplicate.existing.id}`} target="_blank" rel="noreferrer"
                     className="underline underline-offset-2 hover:text-lt-fg">open ↗</a>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={proceedAnyway}
                    onChange={(e) => setProceedAnyway(e.target.checked)}
                  />
                  <span>Proceed anyway — I&apos;ve confirmed this is a separate claim.</span>
                </label>
              </div>
            )}

            {/* AI-prefill banner */}
            {parseUsed && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                <span className="font-semibold">Pre-filled from the pasted chain.</span> Fields with the{' '}
                <AiBadge inline /> tag came from the AI parse — verify each one before submitting.
              </div>
            )}

            <SectionHeader>Client + incident</SectionHeader>

            <Field label="Renter (Company)" required ai={aiFilled.has('company')}>
              {company ? (
                <div className="flex items-center justify-between rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm">
                  <span className="text-lt-fg">{company.name}</span>
                  <button onClick={() => setCompany(null)} className="text-xs text-lt-fg3 hover:text-lt-fg">Change</button>
                </div>
              ) : (
                <div className="relative">
                  <input type="text" value={companyQ} onChange={(e) => setCompanyQ(e.target.value)}
                    placeholder="Search company by name…"
                    className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
                  {companyHits.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-lt-hairline bg-white shadow-md max-h-56 overflow-y-auto">
                      {companyHits.map((c) => (
                        <button key={c.id} type="button"
                          onClick={() => { setCompany(c); setCompanyQ(''); setCompanyHits([]) }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-lt-inner">
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {parseUsed && companyHits.length === 0 && companyQ && (
                    <p className="mt-1 text-[10px] text-lt-fg3">
                      No matches found for the parsed name — search manually. Do NOT auto-create from the parse.
                    </p>
                  )}
                </div>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of loss" required ai={aiFilled.has('incidentDate')}>
                <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
            </div>

            <Field label="Incident / loss description" required ai={aiFilled.has('incidentDescription')}>
              <textarea value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              <div className="text-[10px] text-lt-fg3 mt-0.5">Minimum 10 characters.</div>
            </Field>

            <SectionHeader>Carrier + identifiers</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Carrier (filed against)" required ai={aiFilled.has('filedAgainst')}>
                <input type="text" value={filedAgainst} onChange={(e) => setFiledAgainst(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Carrier claim #" ai={aiFilled.has('carrierClaimNumber')}>
                <input type="text" value={carrierClaimNumber} onChange={(e) => setCarrierClaimNumber(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
              </Field>
              <Field label="Policy #" ai={aiFilled.has('policyNumber')}>
                <input type="text" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg font-mono" />
              </Field>
            </div>

            <SectionHeader>Adjuster</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" ai={aiFilled.has('adjusterName')}>
                <input type="text" value={adjusterName} onChange={(e) => setAdjusterName(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Email" ai={aiFilled.has('adjusterEmail')}>
                <input type="email" value={adjusterEmail} onChange={(e) => setAdjusterEmail(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
              <Field label="Phone" ai={aiFilled.has('adjusterPhone')}>
                <input type="tel" value={adjusterPhone} onChange={(e) => setAdjusterPhone(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
            </div>

            <SectionHeader>Current status + next action</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Current status" ai={aiFilled.has('status')}>
                <select value={status} onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg">
                  {STATUS_CHOICES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
              </Field>
              <Field label="Next action due">
                <input type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)}
                  className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
              </Field>
            </div>
            <Field label="Note (internal)">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className="w-full rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-sm text-lt-fg" />
            </Field>

            <SectionHeader>Money so far</SectionHeader>
            <div className="grid grid-cols-3 gap-3">
              <MoneyField label="Loss amount"      value={lossAmount}          onChange={setLossAmount}          ai={aiFilled.has('lossAmount')} />
              <MoneyField label="Contract billed"  value={contractAmount}      onChange={setContractAmount}      ai={false} />
              <MoneyField label="ACV received"     value={acvReceived}         onChange={setAcvReceived}         ai={aiFilled.has('acvReceived')} />
              <MoneyField label="Depreciation"     value={depreciationApplied} onChange={setDepreciationApplied} ai={aiFilled.has('depreciationApplied')} />
              <MoneyField label="Deductible"       value={deductibleAmount}    onChange={setDeductibleAmount}    ai={aiFilled.has('deductibleAmount')} />
              <MoneyField label="Admin fee (10%)"  value={adminFeeAmount}      onChange={setAdminFeeAmount}      ai={false} />
              <MoneyField label="Total demand"     value={totalDemand}         onChange={setTotalDemand}         ai={aiFilled.has('totalDemand')} />
              <MoneyField label="Amount offered"   value={amountOffered}       onChange={setAmountOffered}       ai={aiFilled.has('amountOffered')} />
              <MoneyField label="Amount settled"   value={amountSettled}       onChange={setAmountSettled}       ai={aiFilled.has('amountSettled')} />
            </div>
            <p className="text-[11px] text-lt-fg3">
              <span className="font-semibold">amountSettled is GROSS</span> — the dollar the carrier honored
              before the renter&apos;s deductible. The ledger nets it at compute time.
            </p>

            {submitError && (
              <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg/40 px-3 py-2 text-xs text-chip-bad-fg">
                {submitError}
              </div>
            )}
          </div>
        )}

        {step === 'FORM' && (
          <div className="sticky bottom-0 border-t border-lt-hairline bg-white px-5 py-3 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={submitting}
              className="text-xs font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50 px-3 py-1.5">
              Cancel
            </button>
            <button type="button" onClick={submit}
              disabled={submitting || !company || !incidentDate || incidentDescription.trim().length < 10 || !filedAgainst.trim()}
              className="text-xs font-semibold bg-lt-fg hover:bg-black disabled:bg-lt-inner text-white px-4 py-2 rounded-lg">
              {submitting ? 'Creating…' : 'Create claim →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ModeCard({
  title, kicker, description, onClick,
}: {
  title: string
  kicker: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-lt-hairline bg-lt-card hover:border-lt-fg2 transition-colors px-4 py-3.5"
    >
      <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3">{kicker}</div>
      <div className="text-sm font-semibold text-lt-fg mt-0.5">{title}</div>
      <p className="text-xs text-lt-fg2 mt-1 leading-snug">{description}</p>
    </button>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-lt-hairline pt-4 -mt-1 text-[10px] uppercase tracking-wider font-semibold text-lt-fg3 first:border-t-0 first:pt-0">
      {children}
    </div>
  )
}

function AiBadge({ inline }: { inline?: boolean }) {
  return (
    <span
      title="Pre-filled by the AI parse — verify before submitting"
      className={
        `inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded ` +
        `bg-violet-100 text-violet-800 ${inline ? '' : 'ml-1.5'}`
      }
    >
      AI
    </span>
  )
}

function Field({
  label, required, ai, children,
}: {
  label: string; required?: boolean; ai?: boolean; children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center text-[11px] uppercase tracking-wider text-lt-fg3 mb-1">
        <span>{label}</span>
        {required && <span className="text-chip-bad-fg ml-0.5">*</span>}
        {ai && <AiBadge />}
      </label>
      {children}
    </div>
  )
}

function MoneyField({
  label, value, onChange, ai,
}: {
  label: string; value: string; onChange: (v: string) => void; ai?: boolean
}) {
  return (
    <Field label={label} ai={ai}>
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
