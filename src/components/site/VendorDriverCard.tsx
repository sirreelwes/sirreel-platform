'use client'

/**
 * The vendor names their driver, on their own token page — no login.
 *
 * Since 2026-09-05 naming a driver does three things at once: mints the
 * relay address (production ↔ driver email, through us), sends the driver
 * their OWN page (location, call time, confirm, hours), and tells the
 * production who is coming. The card then tracks the driver's side — have
 * they opened the page, have they confirmed, what hours have they logged —
 * because that is what the partner will otherwise phone us to ask.
 *
 * `readOnly` is the HQ preview: the same card, nothing clickable.
 */

import { useState } from 'react'

export interface VendorDriverState {
  driverPageSent: boolean
  driverViewedAt: string | null
  driverAck: { at: string; note: string | null; stale: boolean } | null
  hours: { total: number; days: number }
}

export default function VendorDriverCard({
  token,
  initialDriverName,
  initialDriverEmail,
  initialDriverPhone,
  initialRelayAddress,
  state,
  readOnly = false,
}: {
  token: string
  initialDriverName: string | null
  initialDriverEmail: string | null
  initialDriverPhone: string | null
  initialRelayAddress: string | null
  state: VendorDriverState
  readOnly?: boolean
}) {
  const [name, setName] = useState(initialDriverName ?? '')
  const [email, setEmail] = useState(initialDriverEmail ?? '')
  const [phone, setPhone] = useState(initialDriverPhone ?? '')
  const [relay, setRelay] = useState(initialRelayAddress)
  const [editing, setEditing] = useState(!initialRelayAddress && !readOnly)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sentNote, setSentNote] = useState<string | null>(null)
  const [st, setSt] = useState<VendorDriverState>(state)

  async function save() {
    if (readOnly) return
    setBusy(true); setError(null); setSentNote(null)
    try {
      const r = await fetch(`/api/public/vendor/${token}/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverName: name, driverEmail: email, driverPhone: phone }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Could not save the driver.'); return }
      setRelay(j.relayAddress)
      setEditing(false)
      setSt({ driverPageSent: true, driverViewedAt: null, driverAck: null, hours: { total: 0, days: 0 } })
      setSentNote(
        j.driverMailed
          ? `${name.trim()} has been emailed their driver page${j.productionMailed ? ', and the production has been told who is coming' : ''}.`
          : `Saved. We couldn’t email ${name.trim()} just now — SirReel will make sure they get their page.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setBusy(false) }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const field =
    'w-full border border-[#e4dfd4] rounded-lg px-3 py-2 text-[15px] bg-white focus:outline-none focus:border-[#c39a3f]'
  const label = 'block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5'

  return (
    <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div
          className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          Driver
        </div>
        {relay && !editing && !readOnly && (
          <button onClick={() => setEditing(true)} className="text-[13px] font-semibold text-[#a37f2c] hover:text-[#8a6a22]">
            Change driver
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
      )}
      {sentNote && (
        <div className="mb-3 text-[13px] text-[#2f7d5d] bg-[#eef6f1] border border-[#cfe5d8] rounded px-3 py-2">{sentNote}</div>
      )}

      {editing ? (
        <>
          <p className="text-[14px] text-[#5a554c] leading-relaxed mb-4">
            Tell us who is driving. They get their own page with the location and call time, and the production is told who to expect — nobody needs anybody else&rsquo;s number.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Driver name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Full name" />
            </div>
            <div>
              <label className={label}>Driver email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="driver@example.com" />
            </div>
            <div>
              <label className={label}>Driver phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={field} placeholder="Optional" />
            </div>
          </div>
          <button
            onClick={save}
            disabled={busy || !name.trim() || !email.trim()}
            className="mt-4 inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 text-[14px] font-bold disabled:opacity-50"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {busy ? 'Saving…' : relay ? 'Update driver' : 'Assign driver'}
          </button>
          {relay && (
            <button onClick={() => setEditing(false)} className="mt-4 ml-3 text-[13px] text-[#8b857a] hover:text-[#3a362f]">
              Cancel
            </button>
          )}
          {relay && (
            <p className="mt-3 text-[12px] text-[#8b857a]">
              Changing the driver issues a new address and a new page — the current ones stop working.
            </p>
          )}
        </>
      ) : !relay ? (
        <p className="text-[14px] text-[#5a554c]">No driver named yet.</p>
      ) : (
        <>
          <p className="text-[16px] font-semibold text-[#0c0c0d]">{name}</p>
          <p className="text-[14px] text-[#5a554c]">
            {email}
            {phone ? ` · ${phone}` : ''}
          </p>

          {/* The driver's side, as far as we can see it. */}
          <ul className="mt-3 space-y-1 text-[13px] text-[#3a362f]">
            <li>
              {st.driverPageSent ? (
                st.driverViewedAt
                  ? <>Opened their driver page {fmt(st.driverViewedAt)}.</>
                  : <>Sent their driver page — not opened yet.</>
              ) : (
                <>Driver page not sent yet.</>
              )}
            </li>
            <li>
              {st.driverAck ? (
                st.driverAck.stale
                  ? <span className="text-[#a37f2c]">Confirmed an earlier version of the location/call time — waiting on them to re-confirm.</span>
                  : <span className="text-[#2f7d5d]">Confirmed the location and call time {fmt(st.driverAck.at)}.</span>
              ) : (
                <span>Has not yet confirmed the location and call time.</span>
              )}
            </li>
            {st.hours.days > 0 && (
              <li>Logged <strong>{st.hours.total} hrs</strong> over {st.hours.days} {st.hours.days === 1 ? 'day' : 'days'} — detail below.</li>
            )}
          </ul>

          <div className="mt-4 rounded-[12px] border border-[#e4dfd4] bg-[#faf7f0] p-4">
            <div className={label}>Their address for this job</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={relay ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 border border-[#e4dfd4] rounded px-2 py-1.5 text-[13px] font-mono bg-white text-[#3a362f]"
              />
              <button
                onClick={async () => {
                  if (!relay) return
                  await navigator.clipboard.writeText(relay)
                  setCopied(true); setTimeout(() => setCopied(false), 1800)
                }}
                className="px-3 py-1.5 text-[13px] rounded border border-[#e4dfd4] text-[#3a362f] hover:bg-white shrink-0"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2.5 text-[13px] text-[#5a554c] leading-relaxed">
              Anything the production emails to this address lands in {name || 'your driver'}&rsquo;s inbox, and a reply goes back to them through us. Their driver page shows the same location and call time and is where they confirm and log hours.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
