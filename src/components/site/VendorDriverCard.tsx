'use client'

/**
 * The vendor names their driver, on their own token page — no login.
 *
 * Once saved the card shows the relay address, because the vendor is who has
 * to tell the driver that production mail will arrive from it. The copy is
 * explicit that the driver should just reply: keeping the conversation on the
 * relay is what keeps it visible in HQ and keeps the two sides apart.
 */

import { useState } from 'react'

export default function VendorDriverCard({
  token,
  initialDriverName,
  initialDriverEmail,
  initialDriverPhone,
  initialRelayAddress,
}: {
  token: string
  initialDriverName: string | null
  initialDriverEmail: string | null
  initialDriverPhone: string | null
  initialRelayAddress: string | null
}) {
  const [name, setName] = useState(initialDriverName ?? '')
  const [email, setEmail] = useState(initialDriverEmail ?? '')
  const [phone, setPhone] = useState(initialDriverPhone ?? '')
  const [relay, setRelay] = useState(initialRelayAddress)
  const [editing, setEditing] = useState(!initialRelayAddress)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function save() {
    setBusy(true); setError(null)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally { setBusy(false) }
  }

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
        {relay && !editing && (
          <button onClick={() => setEditing(true)} className="text-[13px] font-semibold text-[#a37f2c] hover:text-[#8a6a22]">
            Change driver
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
      )}

      {editing ? (
        <>
          <p className="text-[14px] text-[#5a554c] leading-relaxed mb-4">
            Tell us who is driving and we&rsquo;ll open a line between them and the production.
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
              Changing the driver issues a new address — the current one stops working.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-[16px] font-semibold text-[#0c0c0d]">{name}</p>
          <p className="text-[14px] text-[#5a554c]">
            {email}
            {phone ? ` · ${phone}` : ''}
          </p>

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
              The production will send directions, call sheets and call times to this address and
              they will land in {name || 'your driver'}&rsquo;s inbox. Tell them to simply reply —
              their answer goes back to the production through us, so nobody needs the other&rsquo;s
              address and we can see the whole thread.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
