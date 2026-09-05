'use client'

/**
 * Point of origin — where this unit leaves from.
 *
 * Wes 2026-09-05: "the assumption should be that the vehicles will leave the
 * vendor's main lot" (King Kong: 8924 Lankershim Blvd, Sun Valley), and the
 * partner updates it on their page. Two levels: the partner's LOT (theirs,
 * across every booking) and an override for THIS booking (a unit staged
 * elsewhere). The driver's page reads whichever applies as "Leaving from";
 * HQ reads it for mileage.
 */

import { useState } from 'react'

export default function VendorOriginCard({
  token, lotAddress, originAddress, unitName, readOnly = false,
}: { token: string; lotAddress: string | null; originAddress: string | null; unitName: string; readOnly?: boolean }) {
  const [lot, setLot] = useState(lotAddress ?? '')
  const [override, setOverride] = useState(originAddress ?? '')
  const [savedLot, setSavedLot] = useState(lotAddress ?? '')
  const [savedOverride, setSavedOverride] = useState(originAddress ?? '')
  const [editing, setEditing] = useState(!lotAddress && !readOnly)
  const [useOverride, setUseOverride] = useState(!!originAddress)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function save() {
    if (readOnly) return
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await fetch(`/api/public/vendor/${token}/origin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotAddress: lot, originAddress: useOverride ? override : '' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error ?? 'That didn’t save.'); return }
      setSavedLot(j.lotAddress ?? ''); setSavedOverride(j.originAddress ?? '')
      setEditing(false); setNote('Saved — your driver’s page shows it.')
    } catch (e) { setError(e instanceof Error ? e.message : 'request failed') } finally { setBusy(false) }
  }

  const effective = savedOverride || savedLot
  const eyebrow = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]'
  const field = 'w-full border border-[#e4dfd4] rounded-lg px-3 py-2.5 text-[16px] bg-white focus:outline-none focus:border-[#c39a3f]'
  const label = 'block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5'

  return (
    <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className={eyebrow} style={{ fontFamily: 'Archivo, sans-serif' }}>Leaving from</div>
        {!editing && !readOnly && <button onClick={() => setEditing(true)} className="min-h-[40px] px-2 -mr-2 text-[13px] font-semibold text-[#a37f2c] hover:text-[#8a6a22]">Change</button>}
      </div>
      {error && <div className="mb-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}
      {note && <div className="mb-3 text-[13px] text-[#2f7d5d] bg-[#eef6f1] border border-[#cfe5d8] rounded px-3 py-2">{note}</div>}

      {!editing ? (
        effective ? (
          <>
            <p className="text-[15px] font-semibold text-[#0c0c0d] whitespace-pre-line">{effective}</p>
            <p className="mt-1 text-[13px] text-[#5a554c]">{savedOverride ? `For this booking only — your lot is ${savedLot || 'not on file'}.` : 'Your lot. Every booking leaves from here unless you say otherwise.'}</p>
          </>
        ) : (
          <p className="text-[14px] text-[#5a554c]">Where do your units leave from? Add your lot address so the driver&rsquo;s page and mileage start from the right place.</p>
        )
      ) : (
        <div className="space-y-3">
          <div>
            <label className={label}>Your lot</label>
            <input value={lot} onChange={(e) => setLot(e.target.value)} className={field} placeholder="8924 Lankershim Blvd, Sun Valley, CA 91352" />
            <p className="mt-1 text-[12px] text-[#8b857a]">Applies to all your bookings.</p>
          </div>
          <label className="flex items-center gap-2 text-[14px] text-[#3a362f] cursor-pointer">
            <input type="checkbox" checked={useOverride} onChange={(e) => setUseOverride(e.target.checked)} className="accent-amber-600 w-4 h-4" />
            The {unitName} leaves from somewhere else for this booking
          </label>
          {useOverride && (
            <div>
              <label className={label}>For this booking</label>
              <input value={override} onChange={(e) => setOverride(e.target.value)} className={field} placeholder="Where the unit is staged" />
            </div>
          )}
          <div className="flex items-center gap-4">
            <button onClick={save} disabled={busy || (!lot.trim() && !(useOverride && override.trim()))}
              className="inline-flex min-h-[44px] items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 text-[14px] font-bold disabled:opacity-50"
              style={{ fontFamily: 'Archivo, sans-serif' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {(savedLot || savedOverride) && <button onClick={() => setEditing(false)} className="min-h-[40px] text-[13px] text-[#8b857a] hover:text-[#3a362f]">Cancel</button>}
          </div>
        </div>
      )}
    </div>
  )
}
