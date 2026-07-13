'use client'

import { useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { TSX } from '@/lib/brand/tsxTokens'
import { STUDIO_TERMS, STRYKER_ADDENDUM, STAGE_SET_LABELS } from './terms'
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
  const hasHospital = sets.includes('hospital')

  // Agent-prepared terms gate: rate and areas are negotiated per job, so
  // the contract is only signable once both exist on the request.
  const termsReady = sets.length > 0 && !!sd?.ratePerDay

  const status = done ? 'done' : locked ? 'locked' : !termsReady ? 'pending' : 'todo'

  return (
    <CardShell
      icon="🎬"
      title="Studio Contract"
      subtitle="Standing sets license agreement"
      status={status}
      statusLabel={done ? 'Signed' : !termsReady && !locked ? 'Awaiting terms' : undefined}
      chips={hasHospital ? <ContextChip>Stryker addendum</ContextChip> : undefined}
      open={open}
      onToggle={onToggle}
      actionLabel="Review & sign"
    >
      {locked && !done ? (
        <LockedNote title="Studio Contract" />
      ) : done ? (
        <DoneNote title="Studio Contract Signed" sub="Signed & on file with SirReel" />
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
                      {STAGE_SET_LABELS[s] || s}
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
              {hasHospital && (
                <p>
                  <strong>{STRYKER_ADDENDUM.heading}</strong> {STRYKER_ADDENDUM.text}
                </p>
              )}
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" />
            <span className="text-sm text-gray-700 font-medium">I have read and agree to all terms and conditions of this Studio Contract.</span>
          </label>

          {hasHospital && (
            <div className="rounded-xl border p-3" style={{ borderColor: '#D4A547', backgroundColor: 'rgba(212,165,71,0.06)' }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8a6a1f' }}>
                Stryker addendum — required for the Hospital Set
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mb-2">{STRYKER_ADDENDUM.text}</p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={strykerAcknowledged}
                  onChange={(e) => setStrykerAcknowledged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-gray-900"
                />
                <span className="text-sm text-gray-700 font-medium">
                  I acknowledge the Stryker Master Media Agreement addendum and agree to its terms regarding Stryker medical equipment on set.
                </span>
              </label>
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Authorized Signature</div>
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
            disabled={!agreed || (hasHospital && !strykerAcknowledged) || !sig || submitting}
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
