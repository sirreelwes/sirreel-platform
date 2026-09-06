'use client'

/**
 * The driver's page for a partner's own booking — the partner's brand,
 * the day's facts, and the four things the driver does: "I have it",
 * "Rolling" (check-out with meters), hours, "Back on the lot" (check-in
 * with meters). Phone-first: 44px targets, 16px inputs, map buttons.
 */
import { useState } from 'react'
import { MapPin, Clock, CheckCircle2, Truck, Phone } from 'lucide-react'
import { DriverHoursCard } from '@/components/drivers/DriverHoursCard'
import type { DriverBookingView as View } from '@/lib/hq-white-label/driverFlow'

const fmtDay = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—')
const fmtAt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function DriverBookingView({ token, initial }: { token: string; initial: View }) {
  const [v, setV] = useState<View>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ackNote, setAckNote] = useState('')
  const [out, setOut] = useState({ odometer: '', generator: '', notes: '' })
  const [back, setBack] = useState({ odometer: v.rolling?.odometer != null ? '' : '', generator: '', notes: '' })
  const accent = v.accent

  async function post(action: 'ack' | 'checkout' | 'checkin', body: unknown) {
    setBusy(action)
    setErr(null)
    const r = await fetch(`/api/public/utliiz-drive/${token}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await r.json().catch(() => ({}))) as { view?: View; error?: string }
    setBusy(null)
    if (!r.ok || !j.view) return setErr(j.error ?? 'Something went wrong.')
    setV(j.view)
  }

  const range = v.startDate === v.endDate ? fmtDay(v.startDate) : `${fmtDay(v.startDate)} – ${fmtDay(v.endDate)}`
  const maps = v.location ? { apple: `https://maps.apple.com/?q=${encodeURIComponent(v.location)}`, google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.location)}` } : null
  const input = 'w-full rounded-xl border border-[#d5d9de] bg-white px-3 py-3 text-[16px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[var(--hq-accent)]/30'
  const label = 'block text-[11px] font-bold uppercase tracking-widest text-[#6b7280] mb-1'
  const primary = 'w-full min-h-[52px] rounded-xl px-5 py-3.5 text-[17px] font-bold text-white disabled:opacity-50'

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[#111827] antialiased pb-[env(safe-area-inset-bottom)]" style={{ ['--hq-accent' as string]: accent, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      <header className="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-4 text-white" style={{ background: accent }}>
        <div className="text-[12px] font-bold uppercase tracking-[2px] opacity-85">{v.brandName}</div>
        <h1 className="mt-1 text-[26px] font-black leading-tight">{v.unitName}</h1>
        <div className="text-[15px] opacity-90">{v.title} · {range}</div>
        {v.closed && <div className="mt-2 inline-block rounded-md bg-white/20 px-2 py-0.5 text-[12px] font-bold uppercase">{v.status === 'CANCELLED' ? 'Cancelled' : 'Finished'}</div>}
      </header>

      <main className="px-4 py-4 space-y-4 max-w-[560px] mx-auto">
        <section className="rounded-2xl bg-white border border-[#e3e6ea] p-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 mt-0.5 shrink-0" style={{ color: accent }} />
            <div>
              <div className={label}>Call time</div>
              <div className="text-[22px] font-black">{v.callTime ?? 'To be set'}</div>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <MapPin className="w-5 h-5 mt-0.5 shrink-0" style={{ color: accent }} />
            <div className="min-w-0 flex-1">
              <div className={label}>Location</div>
              <div className="text-[16px] font-semibold leading-snug">{v.location ?? 'To be set'}</div>
              {maps && (
                <div className="mt-2 flex gap-2">
                  <a href={maps.apple} className="min-h-[44px] inline-flex items-center rounded-lg border border-[#d5d9de] px-3 text-[14px] font-semibold no-underline text-[#111827]">Apple Maps</a>
                  <a href={maps.google} className="min-h-[44px] inline-flex items-center rounded-lg border border-[#d5d9de] px-3 text-[14px] font-semibold no-underline text-[#111827]">Google Maps</a>
                </div>
              )}
            </div>
          </div>
          {v.leavingFrom && (
            <div className="mt-4 flex items-start gap-3">
              <Truck className="w-5 h-5 mt-0.5 shrink-0" style={{ color: accent }} />
              <div>
                <div className={label}>Leaving from</div>
                <div className="text-[15px]">{v.leavingFrom}</div>
              </div>
            </div>
          )}
          {v.notes && <p className="mt-4 rounded-xl bg-[#f5f6f8] px-3 py-2.5 text-[14px] text-[#374151]">{v.notes}</p>}
          {v.officePhone && (
            <a href={`tel:${v.officePhone}`} className="mt-4 min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-[#d5d9de] px-3 text-[14px] font-semibold no-underline text-[#111827]"><Phone className="w-4 h-4" />Call the office</a>
          )}
        </section>

        {!v.closed && (
          <section className={`rounded-2xl border p-4 ${v.acked && !v.acked.stale ? 'bg-white border-[#e3e6ea]' : 'bg-[#fff7e0] border-[#f0dfa0]'}`}>
            {v.acked && !v.acked.stale ? (
              <p className="flex items-center gap-2 text-[15px] text-[#1f6b45]"><CheckCircle2 className="w-5 h-5" />You confirmed {fmtAt(v.acked.at)}.</p>
            ) : (
              <>
                <div className="text-[15px] font-semibold">{v.acked?.stale ? 'Something changed since you confirmed.' : 'Got it?'}</div>
                <p className="mt-1 text-[14px] text-[#4b5563]">Tap so the office knows the call time and location reached you.</p>
                <input value={ackNote} onChange={(e) => setAckNote(e.target.value)} placeholder="anything they should know (optional)" className={`${input} mt-3`} />
                <button onClick={() => post('ack', { note: ackNote })} disabled={busy === 'ack'} className={`${primary} mt-3`} style={{ background: accent }}>{busy === 'ack' ? 'Sending…' : 'I have it'}</button>
              </>
            )}
          </section>
        )}

        {!v.closed && !v.rolling && (
          <section className="rounded-2xl bg-white border border-[#e3e6ea] p-4">
            <div className="text-[15px] font-semibold">Rolling</div>
            <p className="mt-1 text-[14px] text-[#4b5563]">When you leave the lot, put in the meters and tap Rolling. The office sees the unit is out.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><label className={label}>Odometer</label><input inputMode="numeric" value={out.odometer} onChange={(e) => setOut((o) => ({ ...o, odometer: e.target.value }))} className={input} placeholder="miles" /></div>
              <div><label className={label}>Generator hrs</label><input inputMode="decimal" value={out.generator} onChange={(e) => setOut((o) => ({ ...o, generator: e.target.value }))} className={input} placeholder="hour meter" /></div>
            </div>
            <input value={out.notes} onChange={(e) => setOut((o) => ({ ...o, notes: e.target.value }))} placeholder="condition notes (optional)" className={`${input} mt-3`} />
            <button onClick={() => post('checkout', out)} disabled={busy === 'checkout'} className={`${primary} mt-3`} style={{ background: accent }}>{busy === 'checkout' ? 'Saving…' : 'Rolling'}</button>
          </section>
        )}
        {v.rolling && (
          <section className="rounded-2xl bg-white border border-[#e3e6ea] p-4">
            <p className="flex items-center gap-2 text-[15px] text-[#1d4f8f]"><Truck className="w-5 h-5" />Rolled {fmtAt(v.rolling.at)}{v.rolling.odometer != null ? ` · odometer ${v.rolling.odometer}` : ''}{v.rolling.generator != null ? ` · gen ${v.rolling.generator} h` : ''}</p>
          </section>
        )}

        <div className="[&_section]:!bg-[#111827] [&_section]:!border-[#111827]">
          <DriverHoursCard
            endpoint={`/api/public/utliiz-drive/${token}/hours`}
            entries={v.hours.entries}
            total={v.hours.total}
            defaultDate={v.today}
            prompt={!v.closed && !!v.startDate && v.startDate <= v.today}
            // The hours route answers the full view (meters and usage included); the card's type is the narrower one.
            onChange={(h) => setV((d) => ({ ...d, hours: h as unknown as View['hours'] }))}
            meters
            lastMeters={{ odometer: v.rolling?.odometer ?? null, generatorHours: v.rolling?.generator ?? null }}
          />
        </div>

        {!v.closed && v.rolling && !v.back && (
          <section className="rounded-2xl bg-white border border-[#e3e6ea] p-4">
            <div className="text-[15px] font-semibold">Back on the lot</div>
            <p className="mt-1 text-[14px] text-[#4b5563]">At wrap: meters again, anything the office should know about the unit, then tap. That closes the job.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div><label className={label}>Odometer</label><input inputMode="numeric" value={back.odometer} onChange={(e) => setBack((o) => ({ ...o, odometer: e.target.value }))} className={input} placeholder="miles" /></div>
              <div><label className={label}>Generator hrs</label><input inputMode="decimal" value={back.generator} onChange={(e) => setBack((o) => ({ ...o, generator: e.target.value }))} className={input} placeholder="hour meter" /></div>
            </div>
            <input value={back.notes} onChange={(e) => setBack((o) => ({ ...o, notes: e.target.value }))} placeholder="damage, fuel, anything (optional)" className={`${input} mt-3`} />
            <button onClick={() => post('checkin', back)} disabled={busy === 'checkin'} className={`${primary} mt-3`} style={{ background: accent }}>{busy === 'checkin' ? 'Saving…' : 'Back on the lot'}</button>
          </section>
        )}
        {v.back && (
          <section className="rounded-2xl bg-white border border-[#e3e6ea] p-4">
            <p className="flex items-center gap-2 text-[15px] text-[#1f6b45]"><CheckCircle2 className="w-5 h-5" />Back {fmtAt(v.back.at)}{v.back.odometer != null ? ` · odometer ${v.back.odometer}` : ''}{v.back.generator != null ? ` · gen ${v.back.generator} h` : ''}. Thanks — the office has it.</p>
          </section>
        )}

        {err && <div className="rounded-xl border border-[#f2c9c9] bg-[#fff5f5] px-4 py-3 text-[14px] text-[#991b1b]">{err}</div>}
        <p className="text-[12px] text-[#6b7280] text-center pb-6">This page is yours for this job. Questions go to {v.brandName}.</p>
      </main>
    </div>
  )
}
