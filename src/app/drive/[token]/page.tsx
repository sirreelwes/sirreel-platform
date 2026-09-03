'use client'

/**
 * /drive/[token] — the driver's job page.
 *
 * The one link a driver gets, and the only SirReel surface most of them
 * will ever see. Assume: on a phone, outdoors, possibly at 5am, in a
 * hurry, and not a customer — so everything is one column, nothing is
 * behind a tab, and the two things that block the day (licence, where to
 * go) sit at the top.
 *
 * No login: the token is the credential. It therefore shows the driver
 * only what they need to do THIS job — never pricing, client contacts, or
 * the gate code itself (see the API route for why).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { PublicAssistantWidget } from '@/components/site/PublicAssistantWidget'
import { KeyRound } from 'lucide-react'

type Side = 'front' | 'back'

// ── Getting to the yard ──────────────────────────────────────────────
// Drivers do NOT enter at the Lankershim address — that's the mailing
// address. Vehicle access is Gate 1 off Kewen Ave (Wes 2026-08-23), so
// the instruction is shown on every pickup regardless of what the order
// says, and both map links carry it in the destination label.
//
// NOTE: the map pin is still the Lankershim address, which is the only
// location we hold. If Gate 1 has its own street number or coordinates,
// putting them here points the pin at the right kerb.
const YARD = {
  label: 'SirReel — Gate 1, Kewen Ave',
  address: '8500 Lankershim Blvd, Sun Valley, CA 91352',
  gateInstruction: 'Enter through Gate 1 off Kewen Ave',
} as const

// Apple Maps understands ?daddr= and opens the native app on iOS; on a
// desktop it falls back to the web viewer. Google takes ?q=. Both get the
// same destination string so the two buttons can't disagree.
const mapsQuery = encodeURIComponent(YARD.address)
const APPLE_MAPS = `https://maps.apple.com/?daddr=${mapsQuery}`
const GOOGLE_MAPS = `https://maps.google.com/?q=${mapsQuery}`

interface DriveData {
  driver: { firstName: string | null; lastName: string | null; phone: string | null; needsDetails: boolean }
  license: { hasFront: boolean; hasBack: boolean; ok: boolean; code: string; message: string }
  vehicle: { unitName: string; description: string | null; makeModel: string | null; licensePlate: string | null }
  job: { productionName: string; companyName: string | null; startDate: string; endDate: string }
  instructions: { pickup: string | null; dropoff: string | null; unattendedPickup: boolean; unattendedReturn: boolean }
  access: { gateCode: string | null; lockboxCode: string | null }
  loadList: Array<{ id: string; orderNumber: string; description: string; quantity: number }>
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })

export default function DriverJobPage({ params }: { params: { token: string } }) {
  const token = params.token
  const [data, setData] = useState<DriveData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Side | null>(null)
  const [upErr, setUpErr] = useState<string | null>(null)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [savingMe, setSavingMe] = useState(false)
  const [meErr, setMeErr] = useState<string | null>(null)
  const [meSaved, setMeSaved] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/drive/${token}`)
    if (!res.ok) {
      setLoadError(
        res.status === 410
          ? 'This link has expired. Ask your production contact for a new one.'
          : 'This link isn’t valid. Check with whoever sent it to you.',
      )
      return
    }
    const j = await res.json()
    setData(j)
    // Prefill from what we hold so a returning driver isn't retyping.
    setFirst((v) => v || j.driver?.firstName || '')
    setLast((v) => v || j.driver?.lastName || '')
    setPhone((v) => v || j.driver?.phone || '')
  }, [token])
  useEffect(() => { void load() }, [load])

  async function saveDetails() {
    setSavingMe(true); setMeErr(null)
    try {
      const res = await fetch(`/api/drive/${token}/profile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last, phone }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not save that.')
      setMeSaved(true)
      await load()
    } catch (e) {
      setMeErr(e instanceof Error ? e.message : 'Could not save that.')
    } finally { setSavingMe(false) }
  }

  async function upload(side: Side, file: File) {
    setBusy(side); setUpErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('side', side)
      const res = await fetch(`/api/drive/${token}/license`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed. Please try again.')
      await load()
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : 'Upload failed. Please try again.')
    } finally { setBusy(null) }
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

  if (!data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <p className="text-sm text-zinc-500">Loading your job…</p>
      </main>
    )
  }

  const licenceDone = data.license.hasFront && data.license.hasBack
  const sameDay = data.job.startDate === data.job.endDate

  return (
    <main className="min-h-screen bg-zinc-950 text-white pb-24">
      <div className="mx-auto w-full max-w-md px-5 py-7">
        <header className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-500">
            {data.driver.firstName ? `${data.driver.firstName} — you're driving` : "You're driving"}
          </div>
          <h1 className="mt-1 text-3xl font-bold leading-tight">{data.vehicle.unitName}</h1>
          <p className="mt-1 text-[15px] text-zinc-300">
            {data.vehicle.description}
            {data.vehicle.makeModel ? ` · ${data.vehicle.makeModel}` : ''}
          </p>
          {data.vehicle.licensePlate && (
            <p className="text-[13px] text-zinc-500">Plate {data.vehicle.licensePlate}</p>
          )}
          <p className="mt-2 text-[14px] text-zinc-400">
            {data.job.productionName}
            {data.job.companyName ? ` · ${data.job.companyName}` : ''}
          </p>
        </header>

        {/* Licence first — it's the thing that stops the day if it's missing. */}
        {!licenceDone && (
          <Section title="Before you pick up" tone="warn">
            <p className="text-[14px] leading-relaxed text-zinc-200">
              We need a photo of your driver&rsquo;s license — both sides. Without it we
              can&rsquo;t hand over the keys.
            </p>
            {upErr && <p className="mt-2 text-[13px] text-rose-300">{upErr}</p>}
            <div className="mt-3 space-y-2">
              <SidePicker label="Front of license" hint="The side with your photo"
                done={data.license.hasFront} busy={busy === 'front'} disabled={busy !== null}
                onPick={(f) => upload('front', f)} />
              <SidePicker label="Back of license" hint="The side with the barcode"
                done={data.license.hasBack} busy={busy === 'back'} disabled={busy !== null}
                onPick={(f) => upload('back', f)} />
            </div>
          </Section>
        )}
        {licenceDone && (
          <div className="mb-4 rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-[14px] text-emerald-200">
            License received — nothing else needed from you before pickup.
          </div>
        )}

        {/* Who they are. An invite carries only an email, so without this
            the roster shows a guessed name and dispatch has no number to
            call when someone is late at the gate. Asked of the driver
            rather than typed by an agent from a phone call. */}
        <Section title="Your details" tone={data.driver.needsDetails && !meSaved ? 'warn' : undefined}>
          {data.driver.needsDetails && !meSaved && (
            <p className="mb-2.5 text-[14px] leading-relaxed text-zinc-200">
              Confirm your name and a number we can reach you on if there&rsquo;s a problem
              at pickup.
            </p>
          )}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={first} onChange={(e) => { setFirst(e.target.value); setMeSaved(false) }}
                placeholder="First name" autoComplete="given-name"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500" />
              <input value={last} onChange={(e) => { setLast(e.target.value); setMeSaved(false) }}
                placeholder="Last name" autoComplete="family-name"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500" />
            </div>
            {/* type=tel brings up the phone keypad on a phone. */}
            <input value={phone} onChange={(e) => { setPhone(e.target.value); setMeSaved(false) }}
              type="tel" inputMode="tel" autoComplete="tel" placeholder="Mobile number"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-500" />
            {meErr && <p className="text-[13px] text-rose-300">{meErr}</p>}
            <button type="button" onClick={saveDetails} disabled={savingMe || !first.trim()}
              className={`w-full rounded-xl px-4 py-3 text-[15px] font-semibold disabled:opacity-40 ${
                meSaved ? 'bg-zinc-800 text-zinc-200' : 'bg-amber-600 text-white hover:bg-amber-500'
              }`}>
              {savingMe ? 'Saving…' : meSaved ? 'Saved' : 'Save my details'}
            </button>
          </div>
        </Section>

        <Section title="When">
          <p className="text-[15px] text-white">{fmtDay(data.job.startDate)}</p>
          {!sameDay && (
            <p className="mt-0.5 text-[14px] text-zinc-400">back by {fmtDay(data.job.endDate)}</p>
          )}
        </Section>

        <Section title="Picking up">
          {data.instructions.unattendedPickup && (
            <Badge>Unattended pickup — nobody will meet you</Badge>
          )}

          {/* Always shown. Every driver enters the same way, and a driver
              who follows the mailing address alone ends up at the wrong
              side of the lot. */}
          <div className="mb-2.5 rounded-xl border border-amber-700/60 bg-amber-950/25 px-3.5 py-2.5">
            <div className="text-[15px] font-semibold text-amber-200">{YARD.gateInstruction}</div>
            <div className="mt-0.5 text-[13px] text-zinc-300">{YARD.address}</div>
          </div>

          {data.instructions.pickup && (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-200">
              {data.instructions.pickup}
            </p>
          )}

          {/* One closing line, chosen by how the pickup is staffed. Unattended
              is the case that goes wrong: there is nobody on site to catch a
              driver's mistake, so the instructions stop being a courtesy and
              become the procedure. Never paired with "check in with staff" —
              that is the opposite instruction. */}
          {data.instructions.unattendedPickup ? (
            <p className={`text-[14px] leading-relaxed text-amber-200/90 ${data.instructions.pickup ? 'mt-2.5' : ''}`}>
              {data.instructions.pickup
                ? 'Nobody will be on site to meet you — please follow these pickup instructions exactly. If anything is unclear, or what you find does not match, use the assistant below before moving the vehicle.'
                : 'Nobody will be on site to meet you, and no pickup instructions have been posted yet. Use the assistant below to get them before you arrive — do not attempt the pickup without them.'}
            </p>
          ) : !data.instructions.pickup ? (
            <p className="text-[14px] leading-relaxed text-zinc-400">
              Please check in with SirReel staff to sign out the vehicle — if it&rsquo;s
              outside business hours, use the assistant below.
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={APPLE_MAPS} target="_blank" rel="noopener noreferrer"
              className="rounded-lg bg-zinc-800 px-3 py-2.5 text-center text-[13px] font-semibold text-zinc-100 hover:bg-zinc-700">
              Apple Maps ↗
            </a>
            <a href={GOOGLE_MAPS} target="_blank" rel="noopener noreferrer"
              className="rounded-lg bg-zinc-800 px-3 py-2.5 text-center text-[13px] font-semibold text-zinc-100 hover:bg-zinc-700">
              Google Maps ↗
            </a>
          </div>
        </Section>

        {(data.instructions.dropoff || data.instructions.unattendedReturn) && (
          <Section title="Dropping off">
            {data.instructions.unattendedReturn && (
              <Badge>Unattended return — follow these exactly</Badge>
            )}
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-200">
              {data.instructions.dropoff || 'Return to the yard; instructions to follow from your production contact.'}
            </p>
          </Section>
        )}

        {/* Real access codes — a named driver gets these directly
            (Wes 2026-08-22). Kept together and marked, because a driver
            forwarding this screenshot is how a lot code walks. */}
        {(data.access.gateCode || data.access.lockboxCode) && (
          <Section title="Getting in">
            <div className="space-y-2.5">
              {data.access.gateCode && (
                <CodeBlock label="Lot gate code" value={data.access.gateCode} />
              )}
              {data.access.lockboxCode && (
                <CodeBlock
                  label={`Lockbox — ${data.vehicle.unitName}`}
                  value={data.access.lockboxCode}
                  hint="The keys are in the lockbox on this vehicle."
                />
              )}
            </div>
            <p className="mt-2.5 text-[12px] leading-relaxed text-zinc-500">
              These are for you and this job. Please don&rsquo;t pass them on or post a photo
              of this screen — the gate code is the same one every driver uses.
            </p>
          </Section>
        )}

        {data.loadList.length > 0 && (
          <Section title={`On the vehicle (${data.loadList.length})`}>
            <p className="mb-2 text-[13px] text-zinc-400">
              What should be loaded. Worth a look before you roll — flag anything missing.
            </p>
            <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
              {data.loadList.map((li) => (
                <li key={li.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                  <span className="text-[14px] text-zinc-100">{li.description}</span>
                  {li.quantity > 1 && (
                    <span className="flex-shrink-0 text-[13px] font-semibold text-zinc-400">×{li.quantity}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Something wrong?">
          <p className="text-[14px] leading-relaxed text-zinc-300">
            Use the <strong>Need help?</strong> button in the corner — it answers day or night.
            Or call <a href="tel:+18884777335" className="font-semibold text-amber-500">(888) 477-7335</a>.
          </p>
        </Section>

        <p className="mt-6 text-[12px] leading-relaxed text-zinc-600">
          This page is personal to you — please don&rsquo;t forward it. Your license images are
          stored privately and are visible only to SirReel staff.
        </p>
      </div>

      {/* Floating "Need help?" assistant — same one the public site runs. */}
      <PublicAssistantWidget />
    </main>
  )
}

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <section className={`mb-4 rounded-2xl border p-4 ${
      tone === 'warn' ? 'border-amber-700 bg-amber-950/25' : 'border-zinc-800 bg-zinc-900'
    }`}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">{title}</h2>
      {children}
    </section>
  )
}

function CodeBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-[28px] font-bold tracking-[0.18em] text-white">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-zinc-400">{hint}</div>}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 inline-block rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
      {children}
    </div>
  )
}

function SidePicker({
  label, hint, done, busy, disabled, onPick,
}: { label: string; hint: string; done: boolean; busy: boolean; disabled: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 ${
      done ? 'border-emerald-800 bg-emerald-950/30' : 'border-zinc-700 bg-zinc-900'
    }`}>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-white">{label}</div>
        <div className="text-[12px] text-zinc-400">{done ? 'Received — tap to replace' : hint}</div>
      </div>
      <button type="button" onClick={() => ref.current?.click()} disabled={disabled}
        className={`flex-shrink-0 rounded-xl px-4 py-2.5 text-[14px] font-semibold disabled:opacity-40 ${
          done ? 'bg-zinc-800 text-zinc-200' : 'bg-amber-600 text-white hover:bg-amber-500'
        }`}>
        {busy ? 'Uploading…' : done ? 'Retake' : 'Take photo'}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
    </div>
  )
}
