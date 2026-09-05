'use client'

/**
 * /drive/profile/[token] — a partner's driver fills in their own profile.
 *
 * Phone-first, one column, dark like the other driver pages. Four things,
 * in the order they block a job: name + mobile, licence front, licence
 * back, which of the partner's units they're trained to drive. Each saves
 * on its own so a driver interrupted after the front photo comes back to a
 * half-done page rather than a blank one. Camera opens straight from the
 * licence buttons (`capture`), because that is where the card is.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, CheckCircle2 } from 'lucide-react'

interface View {
  vendorName: string
  email: string
  firstName: string
  lastName: string
  phone: string
  license: { front: boolean; back: boolean }
  vehicles: { id: string; name: string; vehicleType: string | null; trained: boolean }[]
  complete: boolean
  completedAt: string | null
}

type Side = 'front' | 'back'

export function DriverProfilePageView({ token }: { token: string }) {
  const [data, setData] = useState<View | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [trained, setTrained] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<Side | null>(null)
  const [upErr, setUpErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/drive/profile/${token}`)
    if (!res.ok) { setLoadError('This link isn’t valid. Ask whoever sent it for a new one.'); return }
    const j: View = await res.json()
    setData(j)
    setFirst((v) => v || j.firstName); setLast((v) => v || j.lastName); setPhone((v) => v || j.phone)
    setTrained(new Set(j.vehicles.filter((v) => v.trained).map((v) => v.id)))
  }, [token])
  useEffect(() => { void load() }, [load])

  async function save() {
    setSaving(true); setErr(null); setSaved(false)
    try {
      const res = await fetch(`/api/drive/profile/${token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last, phone, trainedVehicleIds: [...trained] }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not save that.')
      setData(j); setSaved(true)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save that.') } finally { setSaving(false) }
  }

  async function upload(side: Side, file: File) {
    setBusy(side); setUpErr(null)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('side', side)
      const res = await fetch(`/api/drive/profile/${token}/license`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed. Please try again.')
      setData(j)
    } catch (e) { setUpErr(e instanceof Error ? e.message : 'Upload failed. Please try again.') } finally { setBusy(null) }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm text-center"><div className="mb-3 flex justify-center"><KeyRound size={30} aria-hidden /></div><p className="text-[15px] text-zinc-300">{loadError}</p></div>
      </main>
    )
  }
  if (!data) return <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center"><p className="text-sm text-zinc-500">Loading…</p></main>

  const detailsDone = !!(first.trim() && phone.trim()) && !!(data.firstName && data.phone)
  const licenceDone = data.license.front && data.license.back
  const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-[16px] text-white focus:outline-none focus:border-amber-500'
  const label = 'block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1'

  return (
    <main className="min-h-screen bg-zinc-950 text-white pb-[max(6rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-md px-5 py-7">
        <header className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-500">Driver profile</div>
          <h1 className="mt-1 text-3xl font-bold leading-tight">{data.vendorName}</h1>
          <p className="mt-1 text-[15px] text-zinc-300">
            {data.vendorName} listed you as one of their drivers for jobs booked through SirReel. Fill in the four things below and you&rsquo;re set.
          </p>
        </header>

        {data.complete && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-[14px] text-emerald-200">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
            <span>Profile complete — {data.vendorName} has been told. You can come back here to update anything.</span>
          </div>
        )}

        <Section title="1 · Your details" done={detailsDone}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>First name</label><input value={first} onChange={(e) => setFirst(e.target.value)} className={field} autoComplete="given-name" /></div>
            <div><label className={label}>Last name</label><input value={last} onChange={(e) => setLast(e.target.value)} className={field} autoComplete="family-name" /></div>
            <div className="col-span-2"><label className={label}>Mobile</label><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} autoComplete="tel" placeholder="(818) 555-0100" /></div>
            <div className="col-span-2"><label className={label}>Email</label><input value={data.email} readOnly className={`${field} text-zinc-400`} /></div>
          </div>
        </Section>

        <Section title="2 · Driver’s licence — front" done={data.license.front}>
          <SidePicker label={data.license.front ? 'Front received — retake' : 'Photograph the front'} hint="The side with your photo" done={data.license.front} busy={busy === 'front'} disabled={busy !== null} onPick={(f) => upload('front', f)} />
        </Section>
        <Section title="3 · Driver’s licence — back" done={data.license.back}>
          <SidePicker label={data.license.back ? 'Back received — retake' : 'Photograph the back'} hint="The side with the barcode" done={data.license.back} busy={busy === 'back'} disabled={busy !== null} onPick={(f) => upload('back', f)} />
          {upErr && <p className="mt-2 text-[13px] text-rose-300">{upErr}</p>}
        </Section>

        <Section title="4 · Units you’re trained to drive" done={trained.size > 0}>
          {data.vehicles.length === 0 ? (
            <p className="text-[14px] text-zinc-400">{data.vendorName} hasn&rsquo;t listed any units with SirReel yet — nothing to tick.</p>
          ) : (
            <ul className="space-y-2">
              {data.vehicles.map((v) => (
                <li key={v.id}>
                  <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 cursor-pointer">
                    <input type="checkbox" checked={trained.has(v.id)} onChange={(e) => setTrained((s) => { const n = new Set(s); e.target.checked ? n.add(v.id) : n.delete(v.id); return n })} className="w-5 h-5 accent-amber-500" />
                    <span className="min-w-0"><span className="block text-[15px] font-semibold text-white">{v.name}</span>{v.vehicleType && <span className="block text-[12px] text-zinc-400">{v.vehicleType}</span>}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {err && <p className="mb-3 text-[13px] text-rose-300">{err}</p>}
        <button onClick={save} disabled={saving || !first.trim() || !phone.trim()}
          className="w-full min-h-[52px] rounded-xl bg-amber-500 px-5 py-3.5 text-[17px] font-bold text-zinc-950 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save my details'}
        </button>
        {saved && <p className="mt-3 text-center text-[13px] text-emerald-300">Saved.</p>}
        {!licenceDone && <p className="mt-3 text-center text-[12px] text-zinc-500">Licence photos save on their own the moment you take them.</p>}

        <p className="mt-6 text-center text-[12px] text-zinc-500">Questions? SirReel: (888) 477-7335 · This link is personal to you.</p>
      </div>
    </main>
  )
}

function Section({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className={`mb-4 rounded-2xl border p-4 ${done ? 'border-zinc-800 bg-zinc-900' : 'border-amber-700 bg-amber-950/25'}`}>
      <h2 className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">
        {title}{done && <CheckCircle2 size={14} className="text-emerald-400" aria-hidden />}
      </h2>
      {children}
    </section>
  )
}

function SidePicker({ label, hint, done, busy, disabled, onPick }: { label: string; hint: string; done: boolean; busy: boolean; disabled: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
      <button onClick={() => ref.current?.click()} disabled={disabled}
        className={`w-full min-h-[52px] rounded-xl px-4 py-3 text-left text-[15px] font-semibold ${done ? 'border border-zinc-700 text-white' : 'bg-amber-500 text-zinc-950 active:bg-amber-600'} disabled:opacity-50`}>
        {busy ? 'Uploading…' : label}
        <span className={`block text-[12px] font-normal ${done ? 'text-zinc-400' : 'text-zinc-800'}`}>{hint}</span>
      </button>
    </div>
  )
}
