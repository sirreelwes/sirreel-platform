'use client'

/**
 * /driver/[token] — the driver portal. No login: the token in the URL is
 * the credential, so the page shows as little as possible (first name
 * only) and never reads back what was uploaded.
 *
 * Built phone-first because that is where it gets used: either the driver
 * opens the link on their own phone, or staff hand them a tablet at the
 * counter during pickup. Both sides are separate uploads so a driver can
 * do the front, get interrupted, and come back for the back.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'

type Side = 'front' | 'back'

interface PortalState {
  firstName: string
  hasFront: boolean
  hasBack: boolean
}

export default function DriverPortalPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [state, setState] = useState<PortalState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Side | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/driver-portal/${token}`)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setLoadError(
        res.status === 410
          ? 'This link has expired. Ask your SirReel contact to send a new one.'
          : j.error || 'This link is not valid.',
      )
      return
    }
    const j = await res.json()
    setState({ firstName: j.firstName ?? '', hasFront: !!j.hasFront, hasBack: !!j.hasBack })
  }, [token])

  useEffect(() => { void load() }, [load])

  async function upload(side: Side, file: File) {
    setBusy(side)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('side', side)
      const res = await fetch(`/api/driver-portal/${token}/license`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed. Please try again.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-3xl mb-3"><KeyRound size={30} aria-hidden /></div>
          <p className="text-[15px] text-zinc-300">{loadError}</p>
        </div>
      </main>
    )
  }

  const done = !!state?.hasFront && !!state?.hasBack

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto w-full max-w-md px-5 py-8">
        <header className="mb-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-500">SirReel</div>
          <h1 className="mt-1 text-2xl font-semibold">
            {state?.firstName ? `Hi ${state.firstName} —` : 'Driver check-in'}
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-400">
            We need a photo of your driver&rsquo;s license before you take a vehicle.
            Both sides, please. It goes straight into our records — it is not shared
            with anyone else.
          </p>
        </header>

        {done && (
          <div className="mb-5 rounded-xl border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-[14px] text-emerald-200">
            Got both sides — you&rsquo;re all set. You can close this page.
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-[14px] text-rose-200">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <SideUploader
            label="Front of license"
            hint="The side with your photo"
            done={!!state?.hasFront}
            busy={busy === 'front'}
            disabled={busy !== null}
            onPick={(f) => upload('front', f)}
          />
          <SideUploader
            label="Back of license"
            hint="The side with the barcode"
            done={!!state?.hasBack}
            busy={busy === 'back'}
            disabled={busy !== null}
            onPick={(f) => upload('back', f)}
          />
        </div>

        <p className="mt-6 text-[12px] leading-relaxed text-zinc-500">
          Your license images are stored privately and are visible only to SirReel
          staff. Questions? Call after-hours: (888) 477-7335.
        </p>
      </div>
    </main>
  )
}

function SideUploader({
  label, hint, done, busy, disabled, onPick,
}: {
  label: string
  hint: string
  done: boolean
  busy: boolean
  disabled: boolean
  onPick: (f: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        done ? 'border-emerald-800 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">{label}</div>
          <div className="text-[12px] text-zinc-400">{done ? 'Received — tap to replace' : hint}</div>
        </div>
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={disabled}
          className={`flex-shrink-0 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-colors disabled:opacity-40 ${
            done ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700' : 'bg-amber-600 text-white hover:bg-amber-500'
          }`}
        >
          {busy ? 'Uploading…' : done ? 'Retake' : 'Take photo'}
        </button>
      </div>
      {/* capture="environment" opens the rear camera straight away on a
          phone; on desktop it degrades to a normal file picker. */}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
