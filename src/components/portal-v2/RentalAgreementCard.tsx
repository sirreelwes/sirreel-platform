'use client'

import { useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { PORTAL } from '@/lib/brand/portalTokens'
import { RENTAL_TERMS } from './terms'
import { CardShell, DoneNote, LockedNote } from './CardShell'
import { LcdwElection, useLcdwCoverage, lcdwApplies } from './LcdwElection'
import type { V2AgreementState, V2Booking, V2Intake } from './types'
import { ClipboardList, PenLine } from 'lucide-react'

/**
 * Rental Agreement card — wraps the two existing signing paths untouched:
 *
 *  - Dual-path SignedAgreement machine (when GET /api/portal/[token]/agreement
 *    returns a state): native sign via POST /agreement/sign, download via
 *    /agreement/download, redline via /agreement/upload-redline.
 *  - Legacy inline signing (no SignedAgreement): terms + signature via
 *    POST /api/portal/[token]/sign  { step: 'agreement', ... }.
 *
 * Signer identity is threaded in from the collect-once intake.
 */

const fmtDateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—'

export function RentalAgreementCard({
  token,
  intake,
  booking,
  done,
  locked,
  agreementState,
  open,
  onToggle,
  onSigned,
  onAgreementStateChange,
}: {
  token: string
  intake: V2Intake
  booking: V2Booking
  done: boolean
  locked: boolean
  agreementState: V2AgreementState | null
  open: boolean
  onToggle: () => void
  onSigned: () => void
  onAgreementStateChange: (next: V2AgreementState) => void
}) {
  const [step, setStep] = useState<'intro' | 'read' | 'ack' | 'sign'>('intro')
  // Two SEPARATE attestations. They were previously collapsed into one
  // "I confirm the acknowledgment above" checkbox covering both agreeing to
  // the terms and warranting authority to bind the company. Those are
  // distinct representations — the second is what makes the signature
  // enforceable against the company rather than the individual — and a
  // single bundled tick is materially weaker evidence that the signer was
  // ever asked the authority question at all.
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false)
  const acknowledged = agreedTerms && authorityConfirmed
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [signerCompany, setSignerCompany] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // LCDW is a section of this agreement, not a step after it (Wes
  // 2026-09-02). The addendum is already printed in the document below; the
  // election and the one signature belong on the same page.
  const lcdwCoverage = useLcdwCoverage(token)
  const lcdwNeeded = lcdwApplies(lcdwCoverage)
  const [lcdwChoice, setLcdwChoice] = useState<'accept' | 'decline' | null>(null)
  const [fuelAcknowledged, setFuelAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const [redlineFile, setRedlineFile] = useState<File | null>(null)
  const [redlineUploading, setRedlineUploading] = useState(false)

  // Best known company, used to PREFILL the required field below. This used
  // to fall back to the literal string 'my company', which produced the
  // attestation "I am authorized to sign on behalf of my company" — a
  // warranty that names no entity and therefore binds no one.
  const knownCompany = agreementState?.job?.company || booking.company?.name || intake.company || ''
  // What the attestation actually names: the signer's own entry. The client
  // is the authority on their legal entity name; ours may be a shorthand.
  const companyName = signerCompany.trim() || knownCompany
  const underReview = agreementState && ['REDLINE_UPLOADED', 'UNDER_REVIEW'].includes(agreementState.status)
  const signedState = agreementState && ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'].includes(agreementState.status)
  const negotiated = agreementState?.status === 'NEGOTIATED_READY'

  const status = done || signedState ? 'done' : locked ? 'locked' : underReview ? 'pending' : 'todo'

  const beginSigning = () => {
    setError('')
    setAgreedTerms(false)
    setAuthorityConfirmed(false)
    setSig(null)
    setSignerName(intake.fullName)
    setSignerTitle(intake.title)
    setSignerEmail(intake.email)
    setSignerCompany(knownCompany)
    setStep('read')
  }

  const pdfSrc =
    negotiated && agreementState?.documentToSignUrl
      ? `/api/portal/${token}/agreement/pdf`
      : `/api/portal/${token}/contract/download?format=pdf`

  const ackTerms =
    'I have read, understood, and agree to the terms and conditions of this ' +
    'Equipment and Vehicle Rental Agreement.'
  // Reads sensibly while the required Company field is still empty — the
  // signer sees this text update as they type, and Continue is gated on a
  // non-empty company, so the recorded version always names an entity.
  const ackAuthority = companyName
    ? `I am authorized to sign this Agreement on behalf of ${companyName}, and ` +
      `I have authority to bind ${companyName} to its terms.`
    : 'I am authorized to sign this Agreement on behalf of the company named ' +
      'above, and I have authority to bind it to its terms.'
  // Stored verbatim in the audit record, so it must state BOTH attestations
  // the signer actually ticked.
  const ackText = `${ackTerms} ${ackAuthority}`

  /** Post the election for the path that cannot carry it inline. Returns
   *  false (with the error shown) if it could not be recorded. */
  const recordLcdwElection = async (): Promise<boolean> => {
    if (!lcdwNeeded) return true
    try {
      const r = await fetch(`/api/portal/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'lcdw',
          lcdwAccepted: lcdwChoice === 'accept',
          fuelAcknowledged,
          lcdwSignatureData: sig || '',
        }),
      })
      if (!r.ok) {
        setError('Signed, but your damage-waiver choice did not save. Please reopen this step.')
        return false
      }
      return true
    } catch {
      setError('Signed, but your damage-waiver choice did not save. Please reopen this step.')
      return false
    }
  }

  const submitNative = async () => {
    setError('')
    setSubmitting(true)
    try {
      const r = await fetch(`/api/portal/${token}/agreement/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName,
          signerTitle,
          signerEmail,
          signatureImageData: sig || '',
          acknowledgmentText: ackText,
          acknowledged: true,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) {
        setError(data.error || 'Failed to sign')
        return
      }
      if (agreementState) {
        onAgreementStateChange({
          ...agreementState,
          status: data.status || 'SIGNED_BASELINE',
          statusUpdatedAt: data.signedAt || new Date().toISOString(),
        })
      }
      // The native path signs an ORDER's agreement; the election lives on the
      // PaperworkRequest, so it is a second write. Reported loudly if it
      // fails — a signed agreement with no recorded waiver answer is exactly
      // the gap this change exists to close.
      if (!(await recordLcdwElection())) return
      onSigned()
    } catch (err: any) {
      setError(err?.message || 'Failed to sign')
    } finally {
      setSubmitting(false)
    }
  }

  const submitLegacy = async () => {
    setError('')
    setSubmitting(true)
    try {
      const r = await fetch(`/api/portal/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'agreement',
          signerName,
          signerTitle,
          signerEmail,
          signerPhone: intake.phone,
          poNumber: '',
          dotNumber: '',
          additionalContacts: [],
          termsRead: true,
          signatureData: sig || '',
          // Same submit, same signature — recorded atomically by the route.
          ...(lcdwNeeded ? { lcdwAccepted: lcdwChoice === 'accept', fuelAcknowledged } : {}),
        }),
      })
      if (!r.ok) {
        setError('Failed to sign — please try again.')
        return
      }
      onSigned()
    } catch (err: any) {
      setError(err?.message || 'Failed to sign')
    } finally {
      setSubmitting(false)
    }
  }

  // Everything the ack step must collect before signing — now including the
  // waiver election, when the booking has a vehicle to waive.
  const ackComplete =
    acknowledged &&
    !!signerName &&
    !!signerTitle &&
    !!signerEmail &&
    !!signerCompany.trim() &&
    (!lcdwNeeded || (!!lcdwChoice && fuelAcknowledged))

  const useNativeFlow = !!agreementState && ['PORTAL_GENERATED', 'DOWNLOAD_SENT', 'NEGOTIATED_READY'].includes(agreementState.status)

  return (
    <CardShell
      icon={<PenLine size={16} aria-hidden />}
      title="Rental Agreement"
      subtitle="Equipment & vehicle rental agreement"
      status={status}
      statusLabel={done || signedState ? 'Signed' : underReview ? 'Redline in review' : undefined}
      open={open}
      onToggle={onToggle}
      actionLabel="Review & sign"
    >
      {locked && !done && !signedState ? (
        <LockedNote title="Rental Agreement" />
      ) : done || signedState ? (
        <div className="space-y-3">
          <DoneNote
            title="Rental Agreement Signed"
            sub={signedState ? `Signed ${fmtDateTime(agreementState?.statusUpdatedAt)}` : undefined}
          />
          {signedState && (
            <a
              href={`/api/portal/${token}/agreement/signed-copy`}
              className="block text-center py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold"
            >
              Download signed copy
            </a>
          )}
        </div>
      ) : underReview ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <span className="text-xl"><ClipboardList size={20} aria-hidden /></span>
          <div>
            <div className="text-sm font-bold text-amber-800">Your redline is in review</div>
            <div className="text-xs text-amber-700 mt-0.5">
              Received {fmtDateTime(agreementState?.statusUpdatedAt)}. We&rsquo;ll email you when the negotiated version is ready to sign.
            </div>
          </div>
        </div>
      ) : step === 'intro' ? (
        <div className="space-y-3">
          {negotiated && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800">
              Our team has incorporated your redline. The <span className="font-semibold">negotiated version</span> is ready to sign.
            </div>
          )}
          <p className="text-xs text-gray-500">
            Review the standard {negotiated ? 'negotiated ' : ''}agreement and sign right here — or download a copy for legal review first.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={beginSigning}
              className="flex-1 py-3 text-white rounded-xl text-xs font-semibold"
              style={{ backgroundColor: PORTAL.ink }}
            >
              Review & sign now
            </button>
            <a
              href={
                useNativeFlow
                  ? `/api/portal/${token}/agreement/download`
                  : `/api/portal/${token}/contract/download?format=pdf`
              }
              className="flex-1 text-center py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50"
            >
              Download for review
            </a>
          </div>
          {agreementState?.status === 'DOWNLOAD_SENT' && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Have a redline?</div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files[0]
                  if (f) setRedlineFile(f)
                }}
                onClick={() => document.getElementById('v2-redline-file')?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer ${
                  redlineFile ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                }`}
              >
                {redlineFile ? (
                  <div className="text-xs font-semibold text-indigo-700">{redlineFile.name}</div>
                ) : (
                  <div className="text-xs text-gray-500">Drop your edited .docx or .pdf here, or tap to browse</div>
                )}
                <input
                  id="v2-redline-file"
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(e) => setRedlineFile(e.target.files?.[0] || null)}
                />
              </div>
              {redlineFile && (
                <button
                  onClick={async () => {
                    setRedlineUploading(true)
                    setError('')
                    try {
                      const fd = new FormData()
                      fd.append('file', redlineFile)
                      const r = await fetch(`/api/portal/${token}/agreement/upload-redline`, { method: 'POST', body: fd })
                      const data = await r.json().catch(() => ({}))
                      if (!r.ok) {
                        setError(data.error || 'Upload failed')
                        return
                      }
                      setRedlineFile(null)
                      if (agreementState) {
                        onAgreementStateChange({
                          ...agreementState,
                          status: data.status || 'REDLINE_UPLOADED',
                          statusUpdatedAt: new Date().toISOString(),
                        })
                      }
                    } finally {
                      setRedlineUploading(false)
                    }
                  }}
                  disabled={redlineUploading}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold"
                >
                  {redlineUploading ? 'Uploading…' : 'Submit redline for review'}
                </button>
              )}
            </div>
          )}
          {error && <div className="text-[11px] text-red-600">{error}</div>}
        </div>
      ) : step === 'read' ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Step 1 of 3 · Read the agreement, then continue.</p>
          {useNativeFlow ? (
            <iframe src={pdfSrc} className="w-full h-[380px] rounded-xl border border-gray-200 bg-gray-50" title="Rental Agreement" />
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1 border border-gray-100 rounded-xl p-3 bg-gray-50">
              {RENTAL_TERMS.map((t) => (
                <div key={t.n} className="text-xs text-gray-600 leading-relaxed">
                  <span className="font-semibold text-gray-800">
                    {t.n}. {t.title}.{' '}
                  </span>
                  {t.text}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between">
            <button onClick={() => setStep('intro')} className="text-xs text-gray-500 hover:text-gray-900">
              ← Back
            </button>
            <button
              onClick={() => setStep('ack')}
              className="py-2 px-4 text-white rounded-xl text-xs font-semibold"
              style={{ backgroundColor: PORTAL.ink }}
            >
              Continue →
            </button>
          </div>
        </div>
      ) : step === 'ack' ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Step 2 of 3 · Confirm who&rsquo;s signing.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Full Name *</label>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Title *</label>
              <input
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Company *</label>
              <input
                value={signerCompany}
                onChange={(e) => setSignerCompany(e.target.value)}
                placeholder="Legal entity name, e.g. Critical Role Productions LLC"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
              <p className="mt-1 text-[10px] text-gray-400">
                The entity this Agreement binds. Use the full legal name if it
                differs from what we have on file.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Email *</label>
              <input
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
            </div>
          </div>
          <div className="space-y-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-gray-900 shrink-0"
              />
              <span className="text-xs text-gray-700 leading-relaxed">{ackTerms}</span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={authorityConfirmed}
                onChange={(e) => setAuthorityConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-gray-900 shrink-0"
              />
              <span className="text-xs text-gray-700 leading-relaxed">{ackAuthority}</span>
            </label>
          </div>
          {/* The waiver election, in the agreement rather than after it. The
              addendum is already printed in the document above, so this is
              the client answering a clause of the thing they are signing. */}
          {lcdwNeeded && (
            <div className="pt-1 border-t border-gray-100">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 mt-3">
                Damage waiver election
              </div>
              <LcdwElection
                coverage={lcdwCoverage}
                choice={lcdwChoice}
                onChoice={setLcdwChoice}
                fuelAcknowledged={fuelAcknowledged}
                onFuelAcknowledged={setFuelAcknowledged}
                radioGroupName="v2-lcdw"
              />
            </div>
          )}
          <div className="flex justify-between">
            <button onClick={() => setStep('read')} className="text-xs text-gray-500 hover:text-gray-900">
              ← Back
            </button>
            <button
              onClick={() => setStep('sign')}
              disabled={!ackComplete}
              className="py-2 px-4 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold"
              style={ackComplete ? { backgroundColor: PORTAL.ink } : undefined}
            >
              Continue →
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Step 3 of 3 · Draw your signature and submit.{lcdwNeeded ? ' One signature covers the agreement and your LCDW election.' : ''}</p>
          <SigCanvas onChange={setSig} />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 leading-relaxed">
            By submitting, you create a legally binding electronic signature on behalf of{' '}
            <span className="font-semibold">{companyName}</span>. Your IP address and signing time are recorded in the audit trail.
          </div>
          {error && <div className="text-[11px] text-red-600">{error}</div>}
          <div className="flex justify-between">
            <button onClick={() => setStep('ack')} disabled={submitting} className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40">
              ← Back
            </button>
            <button
              onClick={useNativeFlow ? submitNative : submitLegacy}
              disabled={!sig || submitting}
              className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold"
            >
              {submitting ? 'Submitting…' : 'Submit & Sign'}
            </button>
          </div>
        </div>
      )}
    </CardShell>
  )
}
