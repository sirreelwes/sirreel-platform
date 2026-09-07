'use client'

/**
 * "Return the vehicle" — the driver's own drop-off on a blind (unattended)
 * return, on the driver job page. The mirror of DriverSelfReturnCard's
 * sibling, DriverSelfCheckoutCard: same slots, same GuidedPhotoCapture,
 * four sides required, mileage typed OR an odometer shot.
 *
 * Wes 2026-09-07. Phone-first, read in the yard at wrap.
 */

import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, PackageCheck } from 'lucide-react'
import { GuidedPhotoCapture, type StagedPhoto } from '@/components/fleet/GuidedPhotoCapture'
import type { PhotoPosition } from '@/lib/fleet/photoPositions'

export interface SelfReturnView {
  enabled: boolean
  reason: 'not-unattended' | 'not-picked-up' | 'not-holder' | 'already-done' | 'vehicle-returned' | 'cancelled' | null
  done: {
    at: string
    mileage: number | null
    fuelLevel: string | null
    photoCount: number
    milesDriven: number | null
    receivedByYard: boolean
  } | null
  required: PhotoPosition[]
  optional: PhotoPosition[]
  mileageOut: number | null
}

const FUEL_LEVELS = ['full', '3/4', '1/2', '1/4', 'empty'] as const

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export function DriverSelfReturnCard({
  token, bookingAssignmentId, unitName, state, onDone }: {
  token: string
  bookingAssignmentId: string
  unitName: string
  state: SelfReturnView
  onDone: () => Promise<void> | void
}) {
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const [mileage, setMileage] = useState('')
  const [fuel, setFuel] = useState<string>('')
  const [damage, setDamage] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [justDone, setJustDone] = useState<{ photos: number; milesDriven: number | null } | null>(null)

  const onPhotos = useCallback((p: StagedPhoto[]) => setPhotos(p), [])

  const taken = useMemo(() => new Set(photos.filter((p) => p.status === 'done' && p.position).map((p) => p.position as string)), [photos])
  const uploading = photos.some((p) => p.status === 'uploading')
  const missingSides = state.required.filter((s) => !taken.has(s.id))
  const hasOdo = taken.has('ODOMETER')
  const mileageOk = mileage.trim() !== '' && Number.isFinite(Number(mileage))
  const milesDriven =
    mileageOk && state.mileageOut != null && Number(mileage) >= state.mileageOut ? Number(mileage) - state.mileageOut : null
  const blockers: string[] = []
  if (missingSides.length) blockers.push(missingSides.map((s) => s.label.toLowerCase()).join(', '))
  if (!mileageOk && !hasOdo) blockers.push('mileage or an odometer photo')
  const ready = blockers.length === 0 && !uploading

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/drive/${token}/return`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mileage: mileageOk ? Number(mileage) : null,
          fuelLevel: fuel || null,
          damageNoted: damage,
          notes: notes.trim() || null,
          stagedPhotos: photos.filter((p) => p.status === 'done' && p.key).map((p) => ({
            key: p.key, filename: p.filename, contentType: p.contentType, position: p.position,
          })),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not record the return. Please try again.')
      setJustDone({ photos: j.photosAttached ?? photos.length, milesDriven: j.milesDriven ?? null })
      await onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record the return. Please try again.')
    } finally { setBusy(false) }
  }

  // ── Done, either just now or on an earlier open.
  if (state.done || justDone) {
    const d = state.done
    const driven = d?.milesDriven ?? justDone?.milesDriven ?? null
    return (
      <section className="mb-4 rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={26} aria-hidden className="mt-0.5 flex-shrink-0 text-emerald-400" />
          <div>
            <h2 className="text-[16px] font-bold text-emerald-100">
              {d?.receivedByYard ? `SirReel has received ${unitName}` : `${unitName} is returned`}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-emerald-200/90">
              {d ? fmtWhen(d.at) : 'Just now'}
              {d?.mileage != null ? ` · ${d.mileage.toLocaleString('en-US')} mi` : ''}
              {driven != null ? ` · ${driven.toLocaleString('en-US')} mi driven` : ''}
              {d?.fuelLevel ? ` · fuel ${d.fuelLevel}` : ''}
              {` · ${d?.photoCount ?? justDone?.photos ?? 0} photos on file`}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">
              {d?.receivedByYard
                ? 'The yard has checked it in. Thanks for driving with SirReel.'
                : 'SirReel has your photos and readings, and the yard will check the vehicle in from them. Thanks for driving with SirReel.'}
            </p>
          </div>
        </div>
      </section>
    )
  }

  // The yard received it without a self return (staffed drop).
  if (!state.enabled && state.reason === 'vehicle-returned') {
    return (
      <section className="mb-4 rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
        <h2 className="text-[15px] font-bold text-emerald-100">{unitName} is back with SirReel</h2>
        <p className="mt-1 text-[13px] text-zinc-300">Staff checked the vehicle in. Thanks for driving with SirReel.</p>
      </section>
    )
  }

  if (!state.enabled) return null

  return (
    <section className="mb-4 rounded-2xl border border-amber-700 bg-amber-950/20 p-4">
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-amber-400">Return the vehicle</h2>
      <p className="text-[14px] leading-relaxed text-zinc-200">
        Once {unitName} is parked and the keys are back where the drop-off instructions say: photograph
        all four sides, note the mileage, and tap <strong>Return</strong>. This is your record of how you
        left it — nobody from SirReel is here to see it.
      </p>

      <div className="mt-4">
        <GuidedPhotoCapture
          bookingAssignmentId={bookingAssignmentId}
          onChange={onPhotos}
          uploadEndpoint={`/api/drive/${token}/checkout/photo`}
          requiredPositions={state.required}
          optionalPositions={state.optional}
          title="Photos"
        />
      </div>

      <div className="mt-4">
        <label className="block text-[13px] font-semibold text-zinc-300 mb-1.5">Mileage on the dash</label>
        <input
          value={mileage}
          onChange={(e) => setMileage(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={hasOdo ? 'Optional — you took the odometer photo' : state.mileageOut != null ? `Went out at ${state.mileageOut.toLocaleString('en-US')}` : 'e.g. 48213'}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500"
        />
        <p className="mt-1 text-[12px] text-zinc-500">
          {milesDriven != null
            ? `${milesDriven.toLocaleString('en-US')} miles driven this run.`
            : 'Type the number, or take the odometer photo above — either works. Both is best.'}
        </p>
      </div>

      <div className="mt-4">
        <label className="block text-[13px] font-semibold text-zinc-300 mb-1.5">Fuel <span className="font-normal text-zinc-500">(optional)</span></label>
        <div className="grid grid-cols-5 gap-1.5">
          {FUEL_LEVELS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFuel(fuel === f ? '' : f)}
              className={`min-h-[44px] rounded-lg border text-[13px] font-semibold ${
                fuel === f ? 'border-amber-500 bg-amber-600 text-white' : 'border-zinc-700 bg-zinc-900 text-zinc-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3">
        <input type="checkbox" checked={damage} onChange={(e) => setDamage(e.target.checked)} className="mt-1 h-5 w-5 accent-amber-500" />
        <span className="text-[14px] leading-relaxed text-zinc-200">
          There is new damage since I picked it up
          <span className="block text-[12px] text-zinc-500">Tick this and add close-ups above — honesty here is what protects you.</span>
        </span>
      </label>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Where you parked it, where the keys are, anything else (optional)"
        className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500"
      />

      {err && <p className="mt-3 text-[13px] text-rose-300">{err}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || busy}
        className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-[16px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
      >
        <PackageCheck size={18} aria-hidden />
        {busy ? 'Recording the return…' : uploading ? 'Uploading photos…' : `Return ${unitName}`}
      </button>
      {!ready && !busy && blockers.length > 0 && (
        <p className="mt-2 text-center text-[12px] text-zinc-400">Still need: {blockers.join(' · ')}</p>
      )}
    </section>
  )
}
