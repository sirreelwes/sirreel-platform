'use client'

import { useEffect, useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { TSX } from '@/lib/brand/tsxTokens'
import { STUDIO_TERMS } from './terms'
import { stageAreaLabel, STRYKER_TRIGGER_KEY, includedComplexAreaLabels } from '@/lib/contracts/stageAreas'
import {
  STRYKER_MMA_TITLE,
  STRYKER_EXHIBIT_A,
  renderStrykerParagraphs,
} from '@/lib/contracts/strykerAgreement'
import { CardShell, ContextChip, DoneNote, LockedNote } from './CardShell'
import type { V2Booking, V2Paperwork } from './types'

/**
 * Studio / Standing Sets contract card.
 *
 * Stage rates are individually negotiated, so this card is GATED: it only
 * becomes signable once a SirReel agent has prepared the terms (areas +
 * day rate) in PaperworkRequest.stageDetails. Until then the client sees
 * an "awaiting terms" state. When the hospital set is among the areas the
 * Stryker Master Media Agreement addendum is folded into the terms and
 * must be explicitly acknowledged.
 *
 * Submits through POST /api/portal/v2/[token]/stage-sign, which enforces
 * the same gate server-side and records the signoff.
 */

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function StudioContractCard({
  token,
  booking,
  paperwork,
  signerName,
  done,
  locked,
  open,
  onToggle,
  onSigned,
}: {
  token: string
  booking: V2Booking
  paperwork: V2Paperwork
  /** Threaded from the collect-once intake for the signoff record. */
  signerName: string
  done: boolean
  locked: boolean
  open: boolean
  onToggle: () => void
  onSigned: () => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [strykerAcknowledged, setStrykerAcknowledged] = useState(false)
  const [strykerSig, setStrykerSig] = useState<string | null>(null)
  const [strykerPrintedName, setStrykerPrintedName] = useState('')
  const [strykerNameSeeded, setStrykerNameSeeded] = useState(false)
  const [sig, setSig] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  let sd: any = null
  try {
    sd = paperwork.stageDetails ? JSON.parse(paperwork.stageDetails) : null
  } catch {
    sd = null
  }
  const sets: string[] = sd?.sets || []
  const prelitSets: string[] = sd?.prelitSets || []
  const hasHospital = sets.includes(STRYKER_TRIGGER_KEY)

  // Agent-prepared terms gate: rate and areas are negotiated per job, so
  // the contract is only signable once both exist on the request.
  const termsReady = sets.length > 0 && !!sd?.ratePerDay

  const status = done ? 'done' : locked ? 'locked' : !termsReady ? 'pending' : 'todo'

  // Stryker MMA merge fields — populated from the job/client record. The
  // server rebuilds the same text at signing for the persisted snapshot.
  const producerName = booking.company?.name || 'Producer'
  const fmtLong = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  // endDate is date-only (UTC midnight) — format in UTC so the return
  // date shown to the client matches the booking's calendar date.
  const fmtLongUTC = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
  const strykerParagraphs = hasHospital
    ? renderStrykerParagraphs({
        producerName,
        producerAddress: booking.company?.billingAddress || '',
        projectTitle: booking.jobName,
        agreementDate: fmtLong(new Date().toISOString()),
        returnDate: fmtLongUTC(booking.endDate),
      })
    : []

  // Pre-fill the Stryker printed name from the collect-once intake once.
  useEffect(() => {
    if (strykerNameSeeded || !signerName) return
    setStrykerPrintedName((v) => v || signerName)
    setStrykerNameSeeded(true)
  }, [signerName, strykerNameSeeded])

  const strykerComplete = !hasHospital || (strykerAcknowledged && !!strykerSig && !!strykerPrintedName.trim())

  return (
    <CardShell
      icon="🎬"
      title="Studio Contract"
      subtitle="Standing sets license agreement"
      status={status}
      statusLabel={done ? 'Signed' : !termsReady && !locked ? 'Awaiting Terms Approval' : undefined}
      chips={hasHospital ? <ContextChip>Stryker agreement</ContextChip> : undefined}
      open={open}
      onToggle={onToggle}
      actionLabel="Review & sign"
    >
      {locked && !done ? (
        <LockedNote title="Studio Contract" />
      ) : done ? (
        <div className="space-y-3">
          <DoneNote
            title="Studio Contract Signed"
            sub={hasHospital ? 'Studio contract + Stryker agreement on file with SirReel' : 'Signed & on file with SirReel'}
          />
          {sd?.signoff && (
            <a
              href={`/api/portal/v2/${token}/stage-contract-pdf`}
              className="block text-center py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold"
            >
              Download signed copy (PDF)
            </a>
          )}
        </div>
      ) : !termsReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <span className="text-xl">⏳</span>
          <div>
            <div className="text-sm font-bold text-amber-800">Your agent is preparing your contract terms</div>
            <div className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Stage rates and areas are tailored to your production
              {booking.agent?.name ? ` — ${booking.agent.name} is finalizing your negotiated rate and the sets you'll be using.` : '.'}{' '}
              You&rsquo;ll be able to review and sign here as soon as they&rsquo;re set. No action needed from you yet.
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl text-xs">
            <div>
              <span className="text-gray-400 uppercase font-bold text-[10px]">Production</span>
              <div className="font-semibold mt-0.5">{booking.jobName}</div>
            </div>
            <div>
              <span className="text-gray-400 uppercase font-bold text-[10px]">Company</span>
              <div className="font-semibold mt-0.5">{booking.company?.name}</div>
            </div>
            <div>
              <span className="text-gray-400 uppercase font-bold text-[10px]">Rental Start</span>
              <div className="font-semibold mt-0.5">{fmtDate(booking.startDate)}</div>
            </div>
            <div>
              <span className="text-gray-400 uppercase font-bold text-[10px]">Rental End</span>
              <div className="font-semibold mt-0.5">{fmtDate(booking.endDate)}</div>
            </div>
          </div>

          {sets.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Sets</div>
              <div className="space-y-1">
                {sets.map((s) => (
                  <div key={s} className="flex items-center gap-2 text-sm">
                    <span>🎬</span>
                    <span>
                      {stageAreaLabel(s)}
                      {prelitSets.includes(s) ? ' (Pre-lit)' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sd && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {sd.ratePerDay && (
                <div className="p-2 bg-gray-50 rounded-lg">
                  <span className="text-gray-400 block mb-0.5">Rate Per Day</span>
                  <span className="font-bold text-sm">${sd.ratePerDay}</span>
                </div>
              )}
              <div className="p-2 bg-gray-50 rounded-lg">
                <span className="text-gray-400 block mb-0.5">OT Rate</span>
                <span className="font-bold text-sm">${sd.otRate || '300'}/hr</span>
              </div>
              {sd.prepDays && (
                <div className="p-2 bg-gray-50 rounded-lg">
                  <span className="text-gray-400 block mb-0.5">Prep Days</span>
                  <span className="font-bold">{sd.prepDays}</span>
                </div>
              )}
              {sd.shootDays && (
                <div className="p-2 bg-gray-50 rounded-lg">
                  <span className="text-gray-400 block mb-0.5">Shoot Days</span>
                  <span className="font-bold">{sd.shootDays}</span>
                </div>
              )}
              {sd.strikeDays && (
                <div className="p-2 bg-gray-50 rounded-lg">
                  <span className="text-gray-400 block mb-0.5">Strike Days</span>
                  <span className="font-bold">{sd.strikeDays}</span>
                </div>
              )}
              {sd.darkDays && (
                <div className="p-2 bg-gray-50 rounded-lg">
                  <span className="text-gray-400 block mb-0.5">Dark Days</span>
                  <span className="font-bold">{sd.darkDays}</span>
                </div>
              )}
            </div>
          )}
          {(() => {
            const amenities = includedComplexAreaLabels(sd?.complexAreas)
            return amenities.length > 0 ? (
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Complex areas included</div>
                <div className="flex flex-wrap gap-1.5">
                  {amenities.map((label) => (
                    <span key={label} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-700">
                      ✓ {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          })()}

          {sd?.notes && (
            <div className="text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg p-2">
              <span className="font-bold">Notes: </span>
              {sd.notes}
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Terms & Conditions</div>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 border border-gray-100 rounded-xl p-3 bg-gray-50 text-xs text-gray-600 leading-relaxed">
              {STUDIO_TERMS.map((t) => (
                <p key={t.heading}>
                  <strong>{t.heading}</strong> {t.text}
                </p>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" />
            <span className="text-sm text-gray-700 font-medium">I have read and agree to all terms and conditions of this Studio Contract.</span>
          </label>

          {hasHospital && (
            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#D4A547', backgroundColor: 'rgba(212,165,71,0.06)' }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8a6a1f' }}>
                  Required for the Hospital Set · Signed separately
                </div>
                <h3 className="font-bold text-gray-900 mt-1">{STRYKER_MMA_TITLE}</h3>
                <div className="text-xs text-gray-500 mt-0.5">
                  Production / Show Title: <span className="font-semibold text-gray-700">{booking.jobName}</span>
                </div>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 border border-gray-200 rounded-xl p-3 bg-white text-xs text-gray-600 leading-relaxed">
                {strykerParagraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                <div className="pt-1">
                  <div className="font-bold text-gray-800 mb-1.5">Exhibit A</div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pb-1 pr-2 font-semibold">Product Description</th>
                        <th className="pb-1 pr-2 font-semibold">Product No.</th>
                        <th className="pb-1 pr-2 font-semibold">Qty</th>
                        <th className="pb-1 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {STRYKER_EXHIBIT_A.map((r) => (
                        <tr key={r.productNo} className="border-t border-gray-100">
                          <td className="py-1 pr-2">{r.description}</td>
                          <td className="py-1 pr-2">{r.productNo}</td>
                          <td className="py-1 pr-2">{r.quantity}</td>
                          <td className="py-1">{r.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={strykerAcknowledged}
                  onChange={(e) => setStrykerAcknowledged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-gray-900"
                />
                <span className="text-sm text-gray-700 font-medium">
                  I have read and agree to the Stryker Master Media Use Agreement above on behalf of {producerName}.
                </span>
              </label>

              <div>
                <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Printed name (Stryker agreement signer) *</label>
                <input
                  value={strykerPrintedName}
                  onChange={(e) => setStrykerPrintedName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-gray-400"
                />
              </div>

              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Stryker Master Media Use Agreement — Signature
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  Sign here on behalf of {producerName}. This signature is separate from the studio contract signature below.
                </p>
                <SigCanvas onChange={setStrykerSig} placeholder="Sign the Stryker agreement here" />
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Studio Contract — Authorized Signature</div>
            <p className="text-xs text-gray-500 mb-2">
              I am an Authorized Representative of the Producer and I understand and accept the terms and conditions in this contract.
            </p>
            <SigCanvas onChange={setSig} />
          </div>

          {error && <div className="text-[11px] text-red-600">{error}</div>}
          <button
            onClick={async () => {
              setError('')
              setSubmitting(true)
              try {
                const r = await fetch(`/api/portal/v2/${token}/stage-sign`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    studioAgreed: agreed,
                    strykerAcknowledged,
                    strykerSignatureData: strykerSig || '',
                    strykerPrintedName,
                    signerName,
                    signatureData: sig || '',
                  }),
                })
                if (!r.ok) {
                  const data = await r.json().catch(() => ({}))
                  setError(data.error || 'Failed to sign — please try again.')
                  return
                }
                onSigned()
              } catch (err: any) {
                setError(err?.message || 'Failed to sign')
              } finally {
                setSubmitting(false)
              }
            }}
            disabled={!agreed || !strykerComplete || !sig || submitting}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: TSX.ink }}
          >
            {submitting ? 'Saving…' : 'Sign Studio Contract ✓'}
          </button>
        </div>
      )}
    </CardShell>
  )
}
