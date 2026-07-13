'use client'

import { useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { TSX } from '@/lib/brand/tsxTokens'
import { STUDIO_TERMS, STRYKER_ADDENDUM, STAGE_SET_LABELS } from './terms'
import { CardShell, ContextChip, DoneNote, LockedNote } from './CardShell'
import type { V2Booking, V2Paperwork } from './types'

/**
 * Studio / Standing Sets contract card. Renders the stageDetails JSON the
 * legacy portal renders and submits through the existing endpoint:
 * POST /api/portal/[token]/sign  { step: 'studio', ... }.
 */

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function StudioContractCard({
  token,
  booking,
  paperwork,
  done,
  locked,
  open,
  onToggle,
  onSigned,
}: {
  token: string
  booking: V2Booking
  paperwork: V2Paperwork
  done: boolean
  locked: boolean
  open: boolean
  onToggle: () => void
  onSigned: () => void
}) {
  const [agreed, setAgreed] = useState(false)
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

  const status = done ? 'done' : locked ? 'locked' : 'todo'

  return (
    <CardShell
      icon="🎬"
      title="Studio Contract"
      subtitle="Standing sets license agreement"
      status={status}
      statusLabel={done ? 'Signed' : undefined}
      chips={hasHospital ? <ContextChip>Stryker addendum</ContextChip> : undefined}
      open={open}
      onToggle={onToggle}
      actionLabel="Review & sign"
    >
      {locked && !done ? (
        <LockedNote title="Studio Contract" />
      ) : done ? (
        <DoneNote title="Studio Contract Signed" sub="Signed & on file with SirReel" />
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
                const r = await fetch(`/api/portal/${token}/sign`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ step: 'studio', studioAgreed: agreed, signatureData: sig || '' }),
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
            }}
            disabled={!agreed || !sig || submitting}
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
