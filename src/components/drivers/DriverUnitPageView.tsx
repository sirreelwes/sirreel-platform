'use client'

/**
 * The body of /drive/unit/[token] — a PARTNER's driver's page (King Kong's driver on the
 * EcoFlux). Sibling of /drive/[token], which is a production's driver on one
 * of OUR trucks; same phone-first, one-column, dark treatment, different job.
 *
 * What this driver needs: where to take the unit, when, who to ask for, a
 * button to say "I have it", a way to ask the production something, and a
 * place to log hours. They see their employer's name and the unit. They
 * never see the production's name, company or phone numbers — every message
 * to or from the production goes through SirReel (see lib/sub-rentals/
 * conduit.ts for the ruling).
 *
 * No login: the token is the credential, minted when the partner named them.
 */

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, MapPin, Clock, CheckCircle2, MessageSquare } from 'lucide-react'
import { DriverHoursCard, type HoursEntry } from '@/components/drivers/DriverHoursCard'

interface Logistics {
  leavingFrom: string | null
  address: string | null
  accessNotes: string | null
  arriveTime: string | null
  callTime: string | null
  driverNotes: string | null
  onSiteContactName: string | null
  pickupAddress: string | null
  pickupAccessNotes: string | null
  pickupTime: string | null
  updatedAt: string | null
  hasAny: boolean
}
interface View {
  driverName: string
  vendorName: string
  unitName: string
  status: string
  startDate: string | null
  endDate: string | null
  reference: string | null
  logistics: Logistics
  ack: { at: string; note: string | null; stale: boolean } | null
  hours: { entries: HoursEntry[]; total: number }
  hoursPromptOpen: boolean
  closed: boolean
}

const fmtDay = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : null
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export type DriverUnitData = View

/**
 * `preview` (HQ): render from `initialData`, never fetch (a staff look must
 * not count as the driver opening their page), and make every control inert.
 * `frame` drops the full-screen wrapper so it sits inside the HQ shell.
 */
export function DriverUnitPageView({ token, initialData = null, preview = false }: { token: string; initialData?: View | null; preview?: boolean }) {
  const [data, setData] = useState<View | null>(initialData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ackNote, setAckNote] = useState('')
  const [acking, setAcking] = useState(false)
  const [ackErr, setAckErr] = useState<string | null>(null)
  const [ackDone, setAckDone] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState<string | null>(null)
  const [askDone, setAskDone] = useState(false)

  const load = useCallback(async () => {
    if (preview) return
    const res = await fetch(`/api/drive/unit/${token}`)
    if (!res.ok) {
      setLoadError('This link isn’t valid. Check with whoever sent it to you.')
      return
    }
    setData(await res.json())
  }, [token, preview])
  useEffect(() => { void load() }, [load])

  async function ack() {
    if (preview) return
    setAcking(true); setAckErr(null); setAckDone(null)
    try {
      const res = await fetch(`/api/drive/unit/${token}/ack`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: ackNote }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not send that.')
      setData((d) => (d ? { ...d, ack: j.ack ?? d.ack, logistics: j.logistics ?? d.logistics } : d))
      setAckDone(j.productionMailed ? 'The production has been told you have it.' : 'Confirmed. SirReel has it on record.')
      setAckNote('')
    } catch (e) {
      setAckErr(e instanceof Error ? e.message : 'Could not send that.')
    } finally { setAcking(false) }
  }

  async function ask() {
    if (preview) return
    setAsking(true); setAskErr(null); setAskDone(false)
    try {
      const res = await fetch(`/api/drive/unit/${token}/question`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: q }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not send that.')
      setAskDone(true); setQ('')
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : 'Could not send that.')
    } finally { setAsking(false) }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="mb-3 flex justify-center"><KeyRound size={30} aria-hidden /></div>
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

  const l = data.logistics
  const first = data.driverName.split(/\s+/)[0]
  const sameDay = !!data.startDate && data.startDate === data.endDate
  const needsAck = l.hasAny && (!data.ack || data.ack.stale)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

  const Root = preview ? 'div' : 'main'
  return (
    <Root className={preview ? 'rounded-[28px] bg-zinc-950 text-white pb-8 border-[6px] border-zinc-800 shadow-xl' : 'min-h-screen bg-zinc-950 text-white pb-[max(6rem,env(safe-area-inset-bottom))]'}>
      <div className="mx-auto w-full max-w-md px-5 py-7">
        <header className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-500">
            {first} — you&rsquo;re driving
          </div>
          <h1 className="mt-1 text-3xl font-bold leading-tight">{data.unitName}</h1>
          <p className="mt-1 text-[15px] text-zinc-300">
            {sameDay ? fmtDay(data.startDate) : `${fmtDay(data.startDate) ?? 'TBC'} → ${fmtDay(data.endDate) ?? 'TBC'}`}
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">
            {data.vendorName}{data.reference ? ` · SirReel ref ${data.reference}` : ''}
          </p>
        </header>

        {data.closed && (
          <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-[14px] text-zinc-300">
            This job is {data.status === 'CANCELLED' ? 'cancelled' : 'finished'}. Nothing more is needed from you here.
          </div>
        )}

        {/* Where and when — the reason the page exists. */}
        <Section title="Where and when" tone={needsAck && !data.closed ? 'warn' : undefined}>
          {l.hasAny ? (
            <dl className="space-y-3">
              {l.leavingFrom && (
                <Row label="Leaving from">
                  <div className="text-[15px] text-zinc-200">{l.leavingFrom}</div>
                </Row>
              )}
              {l.address && (
                <Row icon={<MapPin size={16} aria-hidden />} label="Report to">
                  <div className="text-[17px] font-semibold leading-snug text-white">{l.address}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <a href={`https://maps.apple.com/?daddr=${encodeURIComponent(l.address)}`} target="_blank" rel="noreferrer"
                      className="flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-700 text-[14px] font-semibold text-white active:bg-zinc-800">
                      Apple Maps
                    </a>
                    <a href={`https://maps.google.com/?q=${encodeURIComponent(l.address)}`} target="_blank" rel="noreferrer"
                      className="flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-700 text-[14px] font-semibold text-white active:bg-zinc-800">
                      Google Maps
                    </a>
                  </div>
                </Row>
              )}
              {l.accessNotes && <Row label="Gate / access"><p className="text-[15px] text-zinc-200 leading-relaxed">{l.accessNotes}</p></Row>}
              {(l.callTime || l.arriveTime) && (
                <Row icon={<Clock size={16} aria-hidden />} label="Call time">
                  <div className="text-[28px] font-bold leading-tight text-white">{l.callTime ?? l.arriveTime}</div>
                </Row>
              )}
              {l.onSiteContactName && <Row label="Ask for"><p className="text-[15px] text-zinc-200">{l.onSiteContactName}</p></Row>}
              {l.driverNotes && (
                <Row label="From the production">
                  <p className="text-[15px] text-zinc-200 leading-relaxed whitespace-pre-line">{l.driverNotes}</p>
                </Row>
              )}
              {(l.pickupAddress && l.pickupAddress !== l.address) || l.pickupTime ? (
                <Row label="Collect">
                  {l.pickupAddress && l.pickupAddress !== l.address && <div className="text-[15px] text-zinc-200">{l.pickupAddress}</div>}
                  {l.pickupAccessNotes && l.pickupAddress !== l.address && <div className="text-[13px] text-zinc-400">{l.pickupAccessNotes}</div>}
                  {l.pickupTime && <div className="text-[15px] text-zinc-200">{l.pickupTime}</div>}
                </Row>
              ) : null}
              {l.updatedAt && <p className="text-[12px] text-zinc-500">Last updated {fmtWhen(l.updatedAt)}</p>}
            </dl>
          ) : (
            <p className="text-[14px] leading-relaxed text-zinc-300">
              The production hasn&rsquo;t sent the location and call time yet. You&rsquo;ll get an email the moment they do — this page always shows the latest.
            </p>
          )}
        </Section>

        {/* Confirm — the production is waiting on this. */}
        {l.hasAny && !data.closed && (
          <Section title="Confirm you have it" tone={needsAck ? 'warn' : undefined}>
            {data.ack && !data.ack.stale ? (
              <div className="flex items-start gap-2 text-emerald-200">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
                <p className="text-[14px] leading-relaxed">
                  You confirmed on {fmtWhen(data.ack.at)}. The production knows you have the details.
                  {data.ack.note && <span className="block text-[13px] text-emerald-300/80 mt-1">Your note: {data.ack.note}</span>}
                </p>
              </div>
            ) : (
              <>
                <p className="text-[14px] leading-relaxed text-zinc-200">
                  {data.ack?.stale
                    ? 'The location or call time changed since you last confirmed. Please check the details above and confirm again.'
                    : 'The production is waiting to hear that the location and call time reached you.'}
                </p>
                <textarea
                  value={ackNote} onChange={(e) => setAckNote(e.target.value)} rows={2}
                  placeholder="Anything they should know? (optional)"
                  className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-[16px] text-white focus:outline-none focus:border-amber-500"
                />
                {ackErr && <p className="mt-2 text-[13px] text-rose-300">{ackErr}</p>}
                <button
                  onClick={ack} disabled={acking || preview}
                  className="mt-3 w-full min-h-[52px] rounded-xl bg-amber-500 px-5 py-3.5 text-[17px] font-bold text-zinc-950 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50"
                >
                  {acking ? 'Sending…' : 'I have the location and call time'}
                </button>
              </>
            )}
            {ackDone && <p className="mt-3 text-[13px] text-emerald-300">{ackDone}</p>}
          </Section>
        )}

        <DriverHoursCard
          readOnly={preview}
          endpoint={`/api/drive/unit/${token}/hours`}
          entries={data.hours.entries}
          total={data.hours.total}
          defaultDate={today}
          prompt={data.hoursPromptOpen && !data.closed}
          onChange={(h) => setData((d) => (d ? { ...d, hours: h } : d))}
        />

        {!data.closed && (
          <Section title="Ask the production">
            <p className="text-[13px] leading-relaxed text-zinc-400">
              Goes to the production through SirReel. Their answer comes back to your email.
            </p>
            {askDone ? (
              <p className="mt-2 flex items-center gap-2 text-[14px] text-emerald-300">
                <MessageSquare size={16} aria-hidden /> Sent. Watch your inbox for the reply.
                <button onClick={() => setAskDone(false)} className="ml-auto text-[12px] text-zinc-400 hover:text-white">Ask another</button>
              </p>
            ) : (
              <>
                <textarea
                  value={q} onChange={(e) => setQ(e.target.value)} rows={3}
                  placeholder="e.g. Is there room to turn a 40ft coach at the north gate?"
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-[16px] text-white focus:outline-none focus:border-amber-500"
                />
                {askErr && <p className="mt-2 text-[13px] text-rose-300">{askErr}</p>}
                <button
                  onClick={ask} disabled={preview || asking || q.trim().length < 3}
                  className="mt-2 min-h-[48px] w-full rounded-xl border border-zinc-700 px-4 py-3 text-[15px] font-semibold text-white hover:border-zinc-500 active:bg-zinc-800 disabled:opacity-50"
                >
                  {asking ? 'Sending…' : 'Send question'}
                </button>
              </>
            )}
          </Section>
        )}

        <a href="tel:+18884777335"
          className="mt-4 flex min-h-[48px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-[15px] font-semibold text-white active:bg-zinc-800">
          Problem on the day? Call SirReel dispatch
        </a>
        <p className="mt-3 text-center text-[12px] text-zinc-500">(888) 477-7335 · This link is personal to you.</p>
      </div>
    </Root>
  )
}

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <section className={`mb-4 rounded-2xl border p-4 ${tone === 'warn' ? 'border-amber-700 bg-amber-950/25' : 'border-zinc-800 bg-zinc-900'}`}>
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">{title}</h2>
      {children}
    </section>
  )
}

function Row({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500">{icon}{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
