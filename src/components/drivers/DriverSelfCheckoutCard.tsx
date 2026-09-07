'use client'

/**
 * "Check out the vehicle" — the driver's own walk-around on a blind
 * (unattended) pickup, on the driver job page.
 *
 * Wes 2026-09-05: "make the driver take pictures of the vehicle, 4 sides,
 * confirm mileage (or take a dashboard pic showing) and check the vehicle
 * out." Same slots and the same GuidedPhotoCapture as the yard's check-out
 * screen so the return can be laid beside it; the four sides are a hard
 * requirement here (the server refuses without them), mileage is a typed
 * number OR an odometer photo, and the fuel gauge / interior are welcome
 * but optional.
 *
 * Phone-first: this is read in a dark lot at 5am. Big targets, one column,
 * the button at the bottom says exactly what is still missing.
 */

import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, Camera } from 'lucide-react'
import { GuidedPhotoCapture, type StagedPhoto } from '@/components/fleet/GuidedPhotoCapture'
import type { PhotoPosition } from '@/lib/fleet/photoPositions'

/** This driver's side of a handoff — see /api/drive/[token]. */
export interface DriverHandoffView {
  holdsIt: boolean
  returned: boolean
  receivedFrom: { name: string; at: string } | null
  gaveTo: { name: string; at: string } | null
}

export interface SelfCheckoutView {
  enabled: boolean
  reason: 'not-unattended' | 'already-done' | 'vehicle-returned' | 'cancelled' | null
  done: { at: string; mileage: number | null; fuelLevel: string | null; photoCount: number } | null
  required: PhotoPosition[]
  optional: PhotoPosition[]
  licenseBlocker: string | null
  licenseUnchecked: boolean
}

const FUEL_LEVELS = ['full', '3/4', '1/2', '1/4', 'empty'] as const

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export function DriverSelfCheckoutCard({
  token, bookingAssignmentId, unitName, state, licenceDone, onDone, handoff }: {
  token: string
  bookingAssignmentId: string
  unitName: string
  state: SelfCheckoutView
  licenceDone: boolean
  onDone: () => Promise<void> | void
  handoff?: DriverHandoffView | null
}) {
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const [mileage, setMileage] = useState('')
  const [fuel, setFuel] = useState<string>('')
  const [damage, setDamage] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [justDone, setJustDone] = useState<{ photos: number } | null>(null)

  const onPhotos = useCallback((p: StagedPhoto[]) => setPhotos(p), [])

  const taken = useMemo(() => new Set(photos.filter((p) => p.status === 'done' && p.position).map((p) => p.position as string)), [photos])
  const uploading = photos.some((p) => p.status === 'uploading')
  const missingSides = state.required.filter((s) => !taken.has(s.id))
  const hasOdo = taken.has('ODOMETER')
  const mileageOk = mileage.trim() !== '' && Number.isFinite(Number(mileage))
  const blockers: string[] = []
  if (!licenceDone) blockers.push('your license (both sides, above)')
  if (missingSides.length) blockers.push(missingSides.map((s) => s.label.toLowerCase()).join(', '))
  if (!mileageOk && !hasOdo) blockers.push('mileage or an odometer photo')
  const ready = blockers.length === 0 && !uploading && !state.licenseBlocker

  async function submit() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/drive/${token}/checkout`, {
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
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not check the vehicle out. Please try again.')
      setJustDone({ photos: j.photosAttached ?? photos.length })
      await onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not check the vehicle out. Please try again.')
    } finally { setBusy(false) }
  }

  // ── Done, either just now or on an earlier open.
  if (state.done || justDone) {
    const d = state.done
    return (
      <section className="mb-4 rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={26} aria-hidden className="mt-0.5 flex-shrink-0 text-emerald-400" />
          <div>
            <h2 className="text-[16px] font-bold text-emerald-100">
              {handoff?.gaveTo && !handoff.holdsIt
                ? `You handed ${unitName} off to ${handoff.gaveTo.name}`
                : `${unitName} is checked out to you`}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-emerald-200/90">
              {d ? `${fmtWhen(d.at)}` : 'Just now'}
              {d?.mileage != null ? ` · ${d.mileage.toLocaleString('en-US')} mi` : ''}
              {d?.fuelLevel ? ` · fuel ${d.fuelLevel}` : ''}
              {` · ${d?.photoCount ?? justDone?.photos ?? 0} photos on file`}
            </p>
            {/* The handoff, from this driver's side. Names only. */}
            {handoff?.receivedFrom && (
              <p className="mt-1 text-[13px] leading-relaxed text-emerald-200/80">
                Handed off to you from {handoff.receivedFrom.name}, who checked it out {fmtWhen(handoff.receivedFrom.at)}.
              </p>
            )}
            {handoff?.gaveTo && (
              <p className="mt-1 text-[13px] leading-relaxed text-emerald-200/80">
                {handoff.gaveTo.name} checked it out after you, {fmtWhen(handoff.gaveTo.at)}
                {handoff.holdsIt ? '.' : ' — the vehicle is on their record now.'}
              </p>
            )}
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">
              {handoff?.gaveTo && !handoff.holdsIt
                ? 'Your photos and mileage stay on file for the time you had it. Thanks for driving with SirReel.'
                : 'SirReel has your photos and the mileage. Drive safe — the drop-off instructions are on this page when you need them.'}
            </p>
          </div>
        </div>
      </section>
    )
  }

  // Staff did the handover (PICKED_UP without a self check-out).
  if (!state.enabled && state.reason === 'already-done') {
    return (
      <section className="mb-4 rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
        <h2 className="text-[15px] font-bold text-emerald-100">You&rsquo;ve collected {unitName}</h2>
        <p className="mt-1 text-[13px] text-zinc-300">SirReel staff checked the vehicle out with you.</p>
      </section>
    )
  }

  if (!state.enabled) return null

  return (
    <section className="mb-4 rounded-2xl border border-amber-700 bg-amber-950/20 p-4">
      <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-amber-400">Check out the vehicle</h2>
      <p className="text-[14px] leading-relaxed text-zinc-200">
        Before you drive off: photograph all four sides of {unitName}, note the mileage, and tap
        <strong> Check out</strong>. This is your record of how the vehicle was when you took it.
      </p>
      {state.licenseBlocker && (
        <p className="mt-2.5 rounded-xl border border-rose-800 bg-rose-950/40 px-3.5 py-2.5 text-[13px] text-rose-200">
          {state.licenseBlocker}
        </p>
      )}

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
          placeholder={hasOdo ? 'Optional — you took the odometer photo' : 'e.g. 48213'}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500"
        />
        <p className="mt-1 text-[12px] text-zinc-500">
          Type the number, or take the odometer photo above — either works. Both is best.
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
          I can see damage on the vehicle already
          <span className="block text-[12px] text-zinc-500">Tick this and add close-ups above — it protects you.</span>
        </span>
      </label>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Anything else SirReel should know (optional)"
        className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500"
      />

      {err && <p className="mt-3 text-[13px] text-rose-300">{err}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || busy}
        className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-[16px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
      >
        <Camera size={18} aria-hidden />
        {busy ? 'Checking out…' : uploading ? 'Uploading photos…' : `Check out ${unitName}`}
      </button>
      {!ready && !busy && blockers.length > 0 && (
        <p className="mt-2 text-center text-[12px] text-zinc-400">Still need: {blockers.join(' · ')}</p>
      )}
    </section>
  )
}
