'use client'
/**
 * The delivery contact, on a partner's booking page — for units the partner
 * DELIVERS (restroom trailers, generators on a trailer) rather than drives to
 * set.
 *
 * Wes 2026-09-07: "for restroom trailers we typically don't require driver
 * info because they deliver and pick up — rarely interact with client. But
 * we may want to ask the delivery person in case delivery or pickup
 * instructions change last minute … reachable by text or call only."
 *
 * So this is NOT the driver card: no roster, no driver job page, no relay
 * address, no hours. A name and a mobile, so the office can reach whoever
 * is on the truck if the address or the timing moves on the day. Email is
 * optional and only stored. Posts to the same driver route with
 * `deliveryContact: true`, which skips the conduit fan-out.
 */
import { useState } from 'react'

export default function VendorDeliveryContactCard({
  token,
  status,
  unitName,
  initialName,
  initialPhone,
  initialEmail,
  readOnly = false,
}: {
  token: string
  status: string
  unitName: string
  initialName: string | null
  initialPhone: string | null
  initialEmail: string | null
  readOnly?: boolean
}) {
  const [saved, setSaved] = useState<{ name: string; phone: string; email: string | null } | null>(
    initialName && initialPhone ? { name: initialName, phone: initialPhone, email: initialEmail } : null,
  )
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName ?? '')
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [email, setEmail] = useState(initialEmail ?? '')
  // Unchecked by default — carriers reject pre-ticked SMS consent (Twilio 30925).
  const [okToText, setOkToText] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const canEdit = !readOnly && status !== 'CANCELLED'
  const eyebrow = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]'
  const field = 'w-full border border-[#e4dfd4] rounded-lg px-3 py-2.5 text-[16px] bg-white focus:outline-none focus:border-[#0F7A93]'
  const label = 'block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5'
  const primary = 'inline-flex min-h-[44px] items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 text-[14px] font-bold disabled:opacity-50'
  const quiet = 'min-h-[40px] px-2 text-[13px] font-semibold text-[#0C657A] disabled:opacity-50'

  async function save() {
    if (!canEdit) return
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await fetch(`/api/public/vendor/${token}/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryContact: true, driverName: name, driverPhone: phone, driverEmail: email, smsConsent: okToText }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error ?? 'That didn’t go through.')
      setSaved({ name: j.driverName, phone: j.driverPhone, email: j.driverEmail ?? null })
      setEditing(false)
      setNote('Saved. The office will text or call this number if anything about the drop-off or pickup changes.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={label}>Name</label>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Who's on the truck" autoComplete="name" />
      </div>
      <div>
        <label className={label}>Mobile</label>
        <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Text or call" inputMode="tel" autoComplete="tel" />
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Email <span className="normal-case tracking-normal font-normal">(optional)</span></label>
        <input className={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Only if you'd like them copied" inputMode="email" autoComplete="email" />
      </div>
      <label className="sm:col-span-2 flex items-start gap-2.5 text-[13px] leading-relaxed text-[#3d392f] cursor-pointer">
        <input type="checkbox" checked={okToText} onChange={(e) => setOkToText(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#0F7A93]" />
        <span>
          OK for SirReel Studio Services to text this number about this booking &mdash; day-of changes to the drop-off or
          pickup. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. Consent
          is not a condition of the booking.{' '}
          <a href="https://sirreel.com/sms-terms" target="_blank" rel="noreferrer" className="underline underline-offset-2">Terms</a> &middot;{' '}
          <a href="https://sirreel.com/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">Privacy</a>.
        </span>
      </label>
      <div className="sm:col-span-2 flex items-center gap-3 pt-1">
        <button type="button" onClick={save} disabled={busy || !name.trim() || !phone.trim()} className={primary}>
          {busy ? 'Saving…' : saved ? 'Update contact' : 'Save contact'}
        </button>
        {saved && (
          <button type="button" onClick={() => setEditing(false)} className={quiet}>Cancel</button>
        )}
      </div>
    </div>
  )

  return (
    <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className={eyebrow} style={{ fontFamily: 'Archivo, sans-serif' }}>Delivery contact</div>
        {saved && !editing && canEdit && (
          <button type="button" onClick={() => setEditing(true)} className={`${quiet} -mr-2`}>Change</button>
        )}
      </div>
      <p className="text-[14px] text-[#5a554c] leading-relaxed mb-4">
        Who&rsquo;s delivering and picking up the {unitName}? A name and a mobile we can text or call if the address
        or the timing changes on the day. Nothing else &mdash; they won&rsquo;t need a page or a login.
      </p>
      {error && <div className="mb-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}
      {note && <div className="mb-3 text-[13px] text-[#2f7d5d] bg-[#eef6f1] border border-[#cfe5d8] rounded px-3 py-2">{note}</div>}
      {saved && !editing ? (
        <div className="text-[16px] text-[#1a1a1a]">
          <div className="font-semibold">{saved.name}</div>
          <div className="text-[#5a554c]">
            <a href={`tel:${saved.phone.replace(/[^\d+]/g, '')}`} className="underline underline-offset-2">{saved.phone}</a>
            {saved.email ? ` · ${saved.email}` : ''}
          </div>
        </div>
      ) : canEdit ? (
        form
      ) : (
        <div className="text-[14px] text-[#8b857a]">No delivery contact yet.</div>
      )}
    </div>
  )
}
