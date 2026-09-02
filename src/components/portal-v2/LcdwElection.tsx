'use client'

import { useEffect, useState } from 'react'
import { LCDW_TERMS, LCDW_ELIGIBILITY_NOTE } from './terms'
import { LCDW_DAILY_RATE, FUEL_PER_GALLON, LCDW_WAIVED_DAMAGE_LIMIT, usd, usd2 } from '@/lib/contracts/fees'

/**
 * The LCDW accept/decline election, as a SECTION OF THE RENTAL AGREEMENT.
 *
 * Wes, 2026-09-02: "LCDW needs to be a part of the rental agreement." He had
 * asked for the same thing on 2026-08-29 ("a clear option toggle choice in
 * the Rental Agreement too") and what shipped then was a better standalone
 * card, which is not the same thing.
 *
 * It was its own checklist step with its own terms body and its OWN
 * signature, which put the client in an odd position: the agreement they had
 * just signed already contains the LCDW addendum in full (see
 * RentalAgreementBody / SignedAgreementDocument — CANONICAL_CLAUSES →
 * FLEET_AGREEMENT → LCDW_ADDENDUM), so they were signing the same addendum
 * twice and could leave the waiver unanswered on a fully-signed agreement.
 *
 * Hence: no signature and no submit button in here. This block renders
 * INSIDE the agreement's signing flow, and the agreement's signature is the
 * writing that confirms the election — which is what the addendum asks for
 * ("Acceptance/decline of LCDW must be confirmed in writing per fleet
 * vehicle rental").
 *
 * Rendering is conditional on `coverage.hasVehicles`: a stage-only or
 * supplies-only job has nothing to waive, and asking anyway produced the
 * "Required" step Wes flagged on a job that could never need it.
 */

export interface LcdwCoverage {
  covered: string[]
  excluded: Array<{ description: string; reason?: string }>
  allExcluded: boolean
  hasVehicles: boolean
}

/**
 * Fetch which of THIS client's vehicles the waiver would cover.
 * Lives here rather than in each portal so the two surfaces cannot drift on
 * what "eligible" means. Null while loading or on failure — callers treat
 * null as "don't ask", which fails to the safe side: an unanswered election
 * is recoverable, a wrongly-charged $24/day/vehicle is a refund.
 */
export function useLcdwCoverage(token: string, enabled = true) {
  const [coverage, setCoverage] = useState<LcdwCoverage | null>(null)
  useEffect(() => {
    if (!enabled || !token) return
    let live = true
    fetch(`/api/portal/${token}/lcdw`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d && !d.error) setCoverage(d as LcdwCoverage)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [token, enabled])
  return coverage
}

/** Does this booking need an LCDW answer at all? */
export function lcdwApplies(coverage: LcdwCoverage | null): boolean {
  return !!coverage?.hasVehicles
}

export function LcdwElection({
  coverage,
  choice,
  onChoice,
  fuelAcknowledged,
  onFuelAcknowledged,
  radioGroupName = 'lcdw-election',
}: {
  coverage: LcdwCoverage | null
  choice: 'accept' | 'decline' | null
  onChoice: (c: 'accept' | 'decline') => void
  fuelAcknowledged: boolean
  onFuelAcknowledged: (v: boolean) => void
  /** Distinct per surface so two rendered groups can't share a radio name. */
  radioGroupName?: string
}) {
  if (!lcdwApplies(coverage)) return null

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <div className="text-sm font-bold text-amber-800">
          Limited Collision Damage Waiver — {usd2(LCDW_DAILY_RATE)} / day / vehicle
        </div>
        <div className="text-[11px] text-amber-700 mt-0.5">
          Part of this rental agreement — choose accept or decline below, then sign once.
        </div>
      </div>

      {/* Which of THEIR vehicles this covers. The addendum's eligibility
          paragraph is generic; a client reading it cannot tell whether their
          own order is covered, and the expensive way to find out is a claim. */}
      <div className="rounded-xl border border-gray-200 p-3 text-xs">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">On your order</div>
        {coverage!.covered.length > 0 ? (
          <ul className="space-y-0.5 text-gray-700">
            {coverage!.covered.map((c) => (
              <li key={c}>✓ {c} — covered</li>
            ))}
          </ul>
        ) : (
          <div className="text-gray-700 font-semibold">
            None of the vehicles on your order are eligible for LCDW.
          </div>
        )}
        {coverage!.excluded.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-gray-500">
            {coverage!.excluded.map((e) => (
              <li key={e.description}>
                — {e.description}: not eligible
                {e.reason === 'partner-vehicle' ? ' (partner vehicle)' : ' (specialty vehicle)'}
              </li>
            ))}
          </ul>
        )}
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
          style={{
            borderColor: choice === 'accept' ? '#111827' : '#e5e7eb',
            background: choice === 'accept' ? '#f9fafb' : 'white',
          }}
        >
          <input
            type="radio"
            name={radioGroupName}
            checked={choice === 'accept'}
            onChange={() => onChoice('accept')}
            className="mt-0.5 accent-gray-900"
          />
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Accept LCDW — {usd2(LCDW_DAILY_RATE)}/day/vehicle
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              SirReel limits my liability for the first {usd(LCDW_WAIVED_DAMAGE_LIMIT)} in physical damage to vehicles
            </div>
          </div>
        </label>
        <label
          className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-all"
          style={{
            borderColor: choice === 'decline' ? '#111827' : '#e5e7eb',
            background: choice === 'decline' ? '#f9fafb' : 'white',
          }}
        >
          <input
            type="radio"
            name={radioGroupName}
            checked={choice === 'decline'}
            onChange={() => onChoice('decline')}
            className="mt-0.5 accent-gray-900"
          />
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
          onChange={(e) => onFuelAcknowledged(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-gray-900"
        />
        <span className="text-sm text-gray-700 font-medium">
          I acknowledge the {usd2(FUEL_PER_GALLON)}/gallon fuel return policy — vehicles must be returned at the same
          fuel level as dispatched.
        </span>
      </label>
    </div>
  )
}
