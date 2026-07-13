'use client'

import { useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { TSX } from '@/lib/brand/tsxTokens'
import { LCDW_TERMS, LCDW_ELIGIBILITY_NOTE } from './terms'
import { CardShell, ContextChip, DoneNote, LockedNote } from './CardShell'

/**
 * LCDW card — accept/decline the Limited Collision Damage Waiver and
 * acknowledge the fuel policy. Submits through the existing endpoint:
 * POST /api/portal/[token]/sign  { step: 'lcdw', ... }.
 */
export function LcdwCard({
  token,
  done,
  accepted,
  locked,
  signerName,
  open,
  onToggle,
  onSigned,
}: {
  token: string
  done: boolean
  /** Persisted lcdwAccepted flag (for the done summary). */
  accepted: boolean
  locked: boolean
  signerName: string
  open: boolean
  onToggle: () => void
  onSigned: (accepted: boolean) => void
}) {
  const [choice, setChoice] = useState<'accept' | 'decline' | null>(null)
  const [fuelAcknowledged, setFuelAcknowledged] = useState(false)
  const [sig, setSig] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const status = done ? 'done' : locked ? 'locked' : 'todo'

  return (
    <CardShell
      icon="🛡️"
      title="Damage Waiver (LCDW)"
      subtitle="Accept or decline · $24/day/vehicle"
      status={status}
      statusLabel={done ? (accepted ? 'Accepted' : 'Declined') : undefined}
      chips={<ContextChip>Fuel policy $10/gal</ContextChip>}
      open={open}
      onToggle={onToggle}
      actionLabel="Choose"
    >
      {locked && !done ? (
        <LockedNote title="LCDW" />
      ) : done ? (
        <DoneNote
          title={accepted ? 'LCDW Accepted — $24/day/vehicle' : 'LCDW Declined'}
          sub={`Fuel policy acknowledged · Signed by ${signerName || 'client'}`}
        />
      ) : (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="text-sm font-bold text-amber-800">Limited Collision Damage Waiver — $24.00 / day / vehicle</div>
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1 border border-gray-100 rounded-xl p-3 bg-gray-50 text-xs text-gray-600 leading-relaxed">
            {LCDW_TERMS.map((t) => (
              <p key={t.heading}>
                <strong>{t.heading}</strong> {t.text}
              </p>
            ))}
            <p className="font-semibold text-gray-700">{LCDW_ELIGIBILITY_NOTE}</p>
          </div>
          <div className="space-y-2">
            <label
              className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-all"
              style={{ borderColor: choice === 'accept' ? '#111827' : '#e5e7eb', background: choice === 'accept' ? '#f9fafb' : 'white' }}
            >
              <input type="radio" name="v2-lcdw" checked={choice === 'accept'} onChange={() => setChoice('accept')} className="mt-0.5 accent-gray-900" />
              <div>
                <div className="text-sm font-semibold text-gray-900">Accept LCDW — $24.00/day/vehicle</div>
                <div className="text-xs text-gray-500 mt-0.5">SirReel limits my liability for the first $1,000 in physical damage to vehicles</div>
              </div>
            </label>
            <label
              className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-all"
              style={{ borderColor: choice === 'decline' ? '#111827' : '#e5e7eb', background: choice === 'decline' ? '#f9fafb' : 'white' }}
            >
              <input type="radio" name="v2-lcdw" checked={choice === 'decline'} onChange={() => setChoice('decline')} className="mt-0.5 accent-gray-900" />
              <div>
                <div className="text-sm font-semibold text-gray-900">Decline LCDW</div>
                <div className="text-xs text-gray-500 mt-0.5">I will provide my own coverage for vehicle damage</div>
              </div>
            </label>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={fuelAcknowledged}
              onChange={(e) => setFuelAcknowledged(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-gray-900"
            />
            <span className="text-sm text-gray-700 font-medium">
              I acknowledge the $10.00/gallon fuel return policy — vehicles must be returned at the same fuel level as dispatched.
            </span>
          </label>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Signature</div>
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
                  body: JSON.stringify({
                    step: 'lcdw',
                    lcdwAccepted: choice === 'accept',
                    fuelAcknowledged,
                    lcdwSignatureData: sig || '',
                  }),
                })
                if (!r.ok) {
                  setError('Failed to save — please try again.')
                  return
                }
                onSigned(choice === 'accept')
              } catch (err: any) {
                setError(err?.message || 'Failed to save')
              } finally {
                setSubmitting(false)
              }
            }}
            disabled={!choice || !fuelAcknowledged || !sig || submitting}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: TSX.ink }}
          >
            {submitting ? 'Saving…' : 'Sign & Save ✓'}
          </button>
        </div>
      )}
    </CardShell>
  )
}
